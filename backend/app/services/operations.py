"""Operations: projects and contracts (their lifecycle rules, who may do what, derived progress / expiry)."""
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import String, cast, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import Contract, Employee, Project, Task
from app.services import audit, timeline
from app.services.codec import to_json
from app.services.records import Ctx, Hooks

PROJECT_FLOW = {"Planned": ("Active", "On Hold", "Cancelled"), "Active": ("On Hold", "Completed", "Cancelled"), "On Hold": ("Active", "Cancelled"), "Completed": ("Active",), "Cancelled": ("Planned",)}
PROJECT_OPEN = ("Planned", "Active", "On Hold")
PROJECT_TYPES = ("Implementation", "Development", "Design", "Marketing Campaign", "Consulting", "Support & Maintenance", "Infrastructure", "Other")
PROJECT_PRIORITIES = ("Low", "Medium", "High", "Urgent")
PROJECT_ORG_JOBS = ("MD", "CEO", "Accounts", "Sales Manager", "Project Manager")
PROJECT_FINANCE_JOBS = ("MD", "CEO", "Accounts", "Sales Manager", "Project Manager")

CONTRACT_FLOW = {
    "Draft": {"Internal Review": "edit", "Approved": "approve", "Cancelled": "changeStatus"}, "Internal Review": {"Pending Approval": "edit", "Draft": "edit", "Cancelled": "changeStatus"},
    "Pending Approval": {"Approved": "approve", "Internal Review": "approve", "Draft": "approve", "Cancelled": "changeStatus"}, "Approved": {"Sent": "send", "Draft": "edit", "Cancelled": "changeStatus"},
    "Sent": {"Signed": "changeStatus", "Draft": "edit", "Cancelled": "changeStatus"}, "Signed": {"Active": "changeStatus", "Terminated": "terminate"}, "Active": {"Terminated": "terminate"},
    "Expiring Soon": {"Terminated": "terminate"}, "Expired": {}, "Renewed": {}, "Terminated": {}, "Cancelled": {},
}
CONTRACT_AUTO = ("Expiring Soon", "Expired", "Renewed")
CONTRACT_REJECTIONS = (("Pending Approval", "Internal Review"), ("Pending Approval", "Draft"))
# the fields whose change is written to the contract's audit trail: (JSON key, column, label, audit action)
CONTRACT_WATCHED = (("title", "title", "Title", "Updated"), ("contractType", "contract_type", "Contract type", "Updated"), ("value", "value", "Contract value", "Value changed"),
                    ("startDate", "start_date", "Start date", "Date changed"), ("endDate", "end_date", "End date", "Date changed"), ("renewalDate", "renewal_date", "Renewal date", "Date changed"),
                    ("noticePeriodDays", "notice_period_days", "Notice period", "Updated"), ("owner", "owner", "Contract owner", "Assignment changed"), ("paymentTerms", "payment_terms", "Payment terms", "Updated"),
                    ("billingFrequency", "billing_frequency", "Billing frequency", "Updated"), ("autoRenew", "auto_renew", "Auto-renewal", "Updated"), ("projectId", "project_id", "Project", "Updated"),
                    ("contactId", "contact_id", "Contact", "Updated"))
CONTRACT_STATUS_TEXT = {"Internal Review": "submitted for internal review", "Pending Approval": "submitted for approval", "Approved": "approved", "Sent": "sent to the client", "Signed": "signed",
                        "Active": "activated", "Terminated": "terminated", "Cancelled": "cancelled", "Draft": "returned to draft"}
CONTRACT_APPROVER_JOBS = ("MD", "Sales Manager")
EXPIRING_SOON_DAYS = 60


# ================================ projects ========================================================================================
def project_scope(p: Principal):
    if p.level in ("Super Admin", "Admin") or p.user.job_role in PROJECT_ORG_JOBS:
        return None
    me = p.actor_id
    return or_(Project.manager == me, Project.created_by == me, cast(Project.attributes, String).like(f'%"{me}"%'))


def task_progress(db: Session, project_id: str) -> int | None:
    top = db.execute(select(Task).where(Task.related_type == "Project", Task.related_id == project_id, Task.parent_id.is_(None), Task.status != "Cancelled")).scalars().all()
    if not top:
        return None
    subs = {}
    for t in db.execute(select(Task).where(Task.parent_id.in_([x.id for x in top]))).scalars():
        done, total = subs.get(t.parent_id, (0, 0))
        subs[t.parent_id] = (done + (1 if t.status == "Completed" else 0), total + 1)
    score = sum(1 if t.status == "Completed" else (subs[t.id][0] / subs[t.id][1] if t.id in subs else 0) for t in top)
    return round(score / len(top) * 100)


class ProjectHooks(Hooks):
    def _can_lead(self, p: Principal, project: Project | None) -> bool:
        return p.level in ("Super Admin", "Admin") or (project is not None and project.manager == p.actor_id) or p.user.job_role == "Project Manager"

    def _validate(self, obj: Project) -> None:
        errors = {}
        if not (obj.name or "").strip():
            errors["name"] = "Give the project a name."
        elif len(obj.name) > 160:
            errors["name"] = "Name is too long (max 160 characters)."
        if not obj.customer_id:
            errors["customerId"] = "Choose the customer."
        if not obj.manager:
            errors["manager"] = "Choose the project manager."
        if obj.project_type not in PROJECT_TYPES:
            errors["projectType"] = "Choose a project type."
        if obj.priority not in PROJECT_PRIORITIES:
            errors["priority"] = "Choose a priority."
        if not obj.start_date:
            errors["startDate"] = "Set the start date."
        if not obj.deadline:
            errors["deadline"] = "Set the expected end date."
        elif obj.start_date and obj.deadline < obj.start_date:
            errors["deadline"] = "End date cannot be before the start date."
        if float(obj.value or 0) < 0:
            errors["value"] = "Project value cannot be negative."
        if errors:
            raise invalid(next(iter(errors.values())), errors)

    def before_create(self, ctx: Ctx, obj: Project, payload: dict) -> None:
        p = ctx.principal
        if p.level not in ("Super Admin", "Admin") and p.user.job_role not in ("Project Manager", "Sales Manager"):
            raise forbidden("Only a Project Manager, Sales Manager or Admin can create projects.")
        if not payload.get("salesOrderId") and p.level not in ("Super Admin", "Admin") and p.user.job_role != "Project Manager":
            raise forbidden("Projects are created from a sales order; creating one manually needs a Project Manager or Admin.")
        if obj.status not in PROJECT_FLOW:
            raise invalid("Choose a valid status.", {"status": "Not an allowed value."})
        obj.manager = obj.manager or p.actor_id
        self._validate(obj)
        key = Project.sales_order_id == obj.sales_order_id if obj.sales_order_id else (Project.deal_id == obj.deal_id if obj.deal_id else None)
        if key is not None:  # two people cannot both start the same order / deal
            dupe = ctx.db.execute(select(Project).where(key, Project.status != "Cancelled")).scalars().first()
            if dupe is not None:
                raise conflict(f"{dupe.name} ({dupe.id}) already exists for this {'sales order' if obj.sales_order_id else 'deal'}.", code="ALREADY_EXISTS")

    def after_create(self, ctx: Ctx, obj: Project, payload: dict) -> None:
        timeline.log_activity(ctx.db, related_type="Project", related_id=obj.id, related_name=obj.name, type="Created", subject=f"Project {obj.name} created", by=ctx.principal.actor_id, branch=obj.branch)
        timeline.notify(ctx.db, user_id=obj.manager, message=f"You were made the manager of project {obj.name}.", type="Project", related_type="Project", related_id=obj.id, branch=obj.branch) if obj.manager != ctx.principal.actor_id else None

    def before_update(self, ctx: Ctx, obj: Project, changes: dict, payload: dict) -> None:
        p = ctx.principal
        lead = self._can_lead(p, obj)
        member = obj.manager == p.actor_id or p.actor_id in (obj.attributes.get("team") or [])
        if not (lead or member):
            raise forbidden("Only the project's manager or team can change it.")
        if obj.status not in PROJECT_OPEN and not lead:
            raise forbidden("A closed project can only be changed by its manager.")
        if "status" in changes:
            target = changes["status"]
            if target not in PROJECT_FLOW:
                raise invalid("Choose a valid status.", {"status": "Not an allowed value."})
            if target not in PROJECT_FLOW[obj.status]:
                raise invalid(f"A project cannot move from {obj.status} to {target}.", {"status": f"Not allowed from {obj.status}."})
            if not lead:
                raise forbidden("Only the project manager can change the project status.")
            if obj.status == "Completed" and not (p.level in ("Super Admin", "Admin") or obj.manager == p.actor_id):
                raise forbidden("Only the project manager or an admin can reopen a completed project.")
            if target in ("On Hold", "Cancelled") and not str(payload.get("statusReason") or "").strip():
                raise invalid(f"Give a reason for moving the project to {target}.", {"statusReason": "Required."})
            ctx.state["old_status"] = obj.status
        ctx.state["team_before"] = list(obj.attributes.get("team") or [])

    def after_update(self, ctx: Ctx, obj: Project, changes: dict, payload: dict) -> None:
        who, label = ctx.principal.actor_id, {"name": "name", "priority": "priority", "startDate": "start date", "deadline": "end date", "value": "value", "manager": "project manager", "projectType": "type"}
        changed = [text for key, text in label.items() if key in changes]
        if changed:
            timeline.log_activity(ctx.db, related_type="Project", related_id=obj.id, related_name=obj.name, type="Updated", subject=f"Project updated — {', '.join(changed)}", by=who, branch=obj.branch)
        before, after = set(ctx.state.get("team_before", [])), set(obj.attributes.get("team") or [])
        names = dict(ctx.db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(before | after))).all()) if before | after else {}
        for added in sorted(after - before):
            timeline.log_activity(ctx.db, related_type="Project", related_id=obj.id, related_name=obj.name, type="Assignment", subject=f"Team member added: {names.get(added, added)}", by=who, branch=obj.branch)
            if added != who:
                timeline.notify(ctx.db, user_id=added, message=f"You were added to project {obj.name}.", type="Project", related_type="Project", related_id=obj.id, branch=obj.branch)
        for removed in sorted(before - after):
            timeline.log_activity(ctx.db, related_type="Project", related_id=obj.id, related_name=obj.name, type="Assignment", subject=f"Team member removed: {names.get(removed, removed)}", by=who, branch=obj.branch)
        if "status" in changes and "old_status" in ctx.state:
            old, new = ctx.state["old_status"], obj.status
            if new == "Completed":
                obj.progress = 100
                obj.actual_end_date = obj.actual_end_date or date.today()
            elif old == "Completed":
                obj.actual_end_date = None
            timeline.log_activity(ctx.db, related_type="Project", related_id=obj.id, related_name=obj.name, type="StatusChange", subject=f"Status changed from {old} to {new}", notes=payload.get("statusReason"),
                                  by=ctx.principal.actor_id, branch=obj.branch, from_status=old, to_status=new)
            timeline.notify(ctx.db, user_id=obj.manager, message=f"Project {obj.name} is now {new}.", type="Project", related_type="Project", related_id=obj.id, branch=obj.branch)

    def before_delete(self, ctx: Ctx, obj: Project) -> None:
        p = ctx.principal
        if not (p.level in ("Super Admin", "Admin") or obj.manager == p.actor_id):
            raise forbidden("Only the project manager or an admin can delete a project.")
        if obj.status not in ("Planned", "Cancelled"):
            raise conflict("Only a planned or cancelled project can be deleted. Cancel it first.")

    def present(self, ctx: Ctx, obj: Project, data: dict) -> dict:
        p = ctx.principal
        if obj.status == "Completed":
            data["progress"] = 100
        elif obj.progress_mode != "manual":
            computed = task_progress(ctx.db, obj.id)
            if computed is not None:
                data["progress"] = computed
        if not (p.level in ("Super Admin", "Admin") or p.user.job_role in PROJECT_FINANCE_JOBS or obj.manager == p.actor_id):
            for key in ("budget", "value", "billing"):
                data[key] = None
            data["financialHidden"] = True
        return data


# ================================ contracts =======================================================================================
def contract_caps(p: Principal) -> set[str]:
    grant = p.permissions.get("Contracts", {})
    if not grant.get("view"):
        return set()
    caps = {"view"}
    if grant.get("create"):
        caps.add("create")
    if grant.get("edit"):
        caps |= {"edit", "send", "changeStatus", "renew"}
        if p.level in ("Super Admin", "Admin") or p.user.job_role in CONTRACT_APPROVER_JOBS:
            caps |= {"approve", "terminate"}
    if grant.get("delete"):
        caps.add("delete")
    return caps


def effective_status(c: Contract, today: date | None = None, soon_days: int = EXPIRING_SOON_DAYS) -> str:
    today = today or date.today()
    if c.status in ("Active", "Expiring Soon", "Expired"):
        if c.end_date is None:
            return "Active" if c.status == "Expired" else c.status
        left = (c.end_date - today).days
        return "Expired" if left < 0 else "Expiring Soon" if left <= soon_days else "Active"
    return c.status


def refresh_contract_statuses(db: Session) -> int:
    from app.services import reminders

    soon = int(reminders.contract_settings(db)["config"].get("expiringSoonDays") or EXPIRING_SOON_DAYS)
    changed = 0
    for c in db.execute(select(Contract).where(Contract.status.in_(("Active", "Expiring Soon", "Expired")))).scalars().all():
        eff = effective_status(c, soon_days=soon)
        if eff != c.status:
            old, c.status = c.status, eff
            timeline.log_activity(db, related_type="Contract", related_id=c.id, related_name=c.number, type="StatusChange", subject=f"Contract {eff.lower()}", by=None, branch=c.branch, from_status=old, to_status=eff)
            if eff in ("Expiring Soon", "Expired"):
                timeline.notify(db, user_id=c.owner, message=f"Contract {c.number} ({c.customer_name}) is {eff.lower()}.", type="Contract", related_type="Contract", related_id=c.id, branch=c.branch)
            changed += 1
    return changed


def _inr(n: float) -> str:
    whole = f"{int(round(float(n or 0)))}"
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return "₹" + ",".join([*groups, tail])


def _show(db: Session, field: str, value) -> str:
    if value is None or value == "":
        return "—"
    if field == "owner":
        row = db.execute(select(Employee.full_name).where(Employee.id == value)).first()
        return row[0] if row else str(value)
    if field == "value":
        return _inr(value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return str(value)


def _status_meta(ctx: Ctx, payload: dict) -> dict:
    """What came with a status change: the reason, comments, the date the person gave and how it was sent. Arrives through POST /contracts/{id}/status, or in the body of a PUT."""
    meta = dict(ctx.state.get("meta") or {})
    for key in ("reason", "statusReason", "comments", "date", "method"):
        if meta.get(key) in (None, "") and payload.get(key) not in (None, ""):
            meta[key] = payload[key]
    meta["reason"] = str(meta.get("reason") or meta.get("statusReason") or "").strip()
    meta["comments"] = str(meta.get("comments") or "").strip()
    meta["method"] = str(meta.get("method") or "").strip()
    raw = str(meta.get("date") or "").strip()
    try:
        meta["date"] = date.fromisoformat(raw[:10]) if raw else None
    except ValueError:
        meta["date"] = None
    return meta


class ContractHooks(Hooks):
    def _validate(self, obj: Contract) -> None:
        errors = {}
        if not (obj.title or "").strip():
            errors["title"] = "Give the contract a title."
        if not obj.customer_id:
            errors["customerId"] = "Choose the customer."
        if not obj.contract_type:
            errors["contractType"] = "Choose a contract type."
        if not obj.start_date:
            errors["startDate"] = "Set the start date."
        if not obj.end_date:
            errors["endDate"] = "Set the end date."
        elif obj.start_date and obj.end_date < obj.start_date:
            errors["endDate"] = "The end date cannot be before the start date."
        if float(obj.value or 0) < 0:
            errors["value"] = "The contract value cannot be negative."
        if errors:
            raise invalid(next(iter(errors.values())), errors)

    def before_create(self, ctx: Ctx, obj: Contract, payload: dict) -> None:
        if "create" not in contract_caps(ctx.principal):
            raise forbidden("You do not have permission to create contracts.")
        if obj.status != "Draft":
            raise invalid("A contract starts as a Draft.", {"status": "Start as Draft."})
        obj.owner = obj.owner or ctx.principal.actor_id
        self._validate(obj)
        conds = [Contract.status.notin_(("Cancelled", "Renewed", "Terminated")), Contract.customer_id == obj.customer_id]
        if obj.sales_order_id:
            conds.append(Contract.sales_order_id == obj.sales_order_id)
        elif obj.deal_id:
            conds += [Contract.deal_id == obj.deal_id, Contract.contract_type == obj.contract_type]
        if (obj.sales_order_id or obj.deal_id) and not payload.get("allowDuplicate"):
            duplicate = ctx.db.execute(select(Contract).where(*conds)).scalars().first()
            if duplicate is not None:
                raise conflict(f"Contract {duplicate.number} already exists for this {'order' if obj.sales_order_id else 'deal'}.", code="ALREADY_EXISTS")

    def after_create(self, ctx: Ctx, obj: Contract, payload: dict) -> None:
        obj.attributes = {**obj.attributes, "audit": [{"at": timeline.now().isoformat(), "by": ctx.principal.actor_id, "action": "Created"}]}
        timeline.log_activity(ctx.db, related_type="Contract", related_id=obj.id, related_name=obj.number, type="Created", subject=f"Contract {obj.number} created for {obj.customer_name}", by=ctx.principal.actor_id, branch=obj.branch)

    def before_update(self, ctx: Ctx, obj: Contract, changes: dict, payload: dict) -> None:
        caps = contract_caps(ctx.principal)
        if "edit" not in caps and "changeStatus" not in caps:
            raise forbidden("You do not have permission to edit contracts.")
        if obj.status in ("Renewed", "Terminated", "Cancelled", "Expired"):
            raise conflict(f"A {obj.status.lower()} contract cannot be changed.")
        if obj.status not in ("Draft", "Internal Review") and set(changes) & {"value", "startDate", "endDate", "scope", "terms", "contractType", "customerId", "billingFrequency"}:
            raise conflict("The commercial terms of a contract can only be changed while it is a draft or in internal review.")
        ctx.state["before"] = {key: getattr(obj, col) for key, col, _, _ in CONTRACT_WATCHED if key in changes}
        if "status" in changes:
            target, current = changes["status"], effective_status(obj)
            if target in CONTRACT_AUTO:
                raise invalid(f"{target} is set by the system (dates / renewal), not by hand.", {"status": "Not allowed."})
            need = CONTRACT_FLOW.get(current, {}).get(target)
            if need is None:
                raise invalid(f"A contract cannot move from {current} to {target}.", {"status": f"Not allowed from {current}."})
            if need not in caps:
                raise forbidden("You do not have permission to make that status change.")
            from app.services import reminders

            if current == "Draft" and target == "Approved" and reminders.contract_settings(ctx.db)["config"].get("approvalRequired"):
                raise invalid("This workspace requires approval: submit the contract for review and approval first.", {"status": "Approval is required."})
            meta = _status_meta(ctx, payload)
            rejection = (current, target) in CONTRACT_REJECTIONS
            if rejection and not meta["reason"]:
                raise invalid("Give a reason for returning the contract.", {"statusReason": "Required."})
            if target in ("Cancelled", "Terminated") and not meta["reason"]:
                raise invalid(f"Give a reason for {'cancelling' if target == 'Cancelled' else 'terminating'} this contract.", {"statusReason": "Required."})
            if target == "Signed" and meta["date"] is None:
                raise invalid("Enter the date the contract was signed.", {"date": "Required."})
            if target == "Terminated" and meta["date"] is None:
                raise invalid("Enter the termination effective date.", {"date": "Required."})
            ctx.state.update(old_status=current, rejection=rejection, meta_done=meta)

    def after_update(self, ctx: Ctx, obj: Contract, changes: dict, payload: dict) -> None:
        self._validate(obj)
        now = timeline.now()
        iso = now.isoformat()
        actor = ctx.principal.actor_id
        audit_rows = list(obj.attributes.get("audit", []))
        extra: dict = {}
        diffs = [(key, label, action) for key, col, label, action in CONTRACT_WATCHED if key in ctx.state.get("before", {}) and getattr(obj, col) != ctx.state["before"][key]]
        for key, label, action in diffs:
            col = next(c for k, c, _, _ in CONTRACT_WATCHED if k == key)
            audit_rows.append({"at": iso, "by": actor, "action": action, "field": label, "from": _show(ctx.db, key, ctx.state["before"][key]), "to": _show(ctx.db, key, getattr(obj, col))})
        note = payload.get("auditEntry")
        if isinstance(note, dict) and str(note.get("action") or "").strip():  # a descriptive entry the person attaches (renewal decision, document generated ...): the server stamps who and when
            audit_rows.append({"at": iso, "by": actor, **{k: str(note.get(k) or "")[:300] for k in ("action", "field", "from", "to", "note") if note.get(k) not in (None, "")}})
        if diffs:
            timeline.log_activity(ctx.db, related_type="Contract", related_id=obj.id, related_name=obj.number, type="Updated", subject=f"Contract updated — {', '.join(label.lower() for _, label, _ in diffs)}", by=actor, branch=obj.branch)
        if "status" in changes and "old_status" in ctx.state:
            old, new, meta, rejection = ctx.state["old_status"], obj.status, ctx.state["meta_done"], ctx.state.get("rejection", False)
            approval = dict(obj.attributes.get("approval") or {})
            if new == "Pending Approval":
                approval.update(submittedBy=actor, submittedAt=iso, approvedBy=None, approvedAt=None, rejectionReason=None, comments=None)
            if new == "Approved":
                approval.update(approvedBy=actor, approvedAt=iso, comments=meta["comments"] or None, rejectionReason=None)
            if rejection:
                approval["history"] = [*approval.get("history", []), {"at": iso, "by": actor, "reason": meta["reason"], "from": old, "to": new}]
                approval.update(rejectionReason=meta["reason"], rejectedBy=actor, rejectedAt=iso, approvedBy=None, approvedAt=None)
            if approval != (obj.attributes.get("approval") or {}):
                extra["approval"] = approval
            if new == "Sent":
                extra.update(sentAt=iso, sentBy=actor, sentVia=meta["method"] or "Email")
            if new == "Signed":
                obj.signed_at = datetime.combine(meta["date"], time.min, tzinfo=UTC)
                extra.update(signedRecordedBy=actor)
            if new == "Active":
                extra.update(activatedAt=iso)
            if new == "Terminated":
                extra.update(terminatedAt=meta["date"].isoformat(), terminationReason=meta["reason"])
            if new == "Cancelled":
                extra.update(cancelledAt=iso, cancelReason=meta["reason"])
            entry = {"at": iso, "by": actor, "action": "Rejected" if rejection else "Status changed", "field": "Status", "from": old, "to": new,
                     "note": meta["reason"] or meta["comments"] or (f"via {meta['method']}" if meta["method"] else "")}
            audit_rows.append(entry)
            text = CONTRACT_STATUS_TEXT.get(new, new.lower())
            subject = f"Contract returned to {new}: {meta['reason']}" if rejection else f"Contract {text}"
            timeline.log_activity(ctx.db, related_type="Contract", related_id=obj.id, related_name=obj.number, type="StatusChange", subject=subject, by=actor, branch=obj.branch, from_status=old, to_status=new,
                                  notes=entry["note"])
            timeline.notify(ctx.db, user_id=obj.owner, message=f"Contract {obj.number} is now {new}.", type="Contract", related_type="Contract", related_id=obj.id, branch=obj.branch)
        if audit_rows != obj.attributes.get("audit", []) or extra:
            obj.attributes = {**obj.attributes, "audit": audit_rows, **extra}

    def before_delete(self, ctx: Ctx, obj: Contract) -> None:
        if "delete" not in contract_caps(ctx.principal):
            raise forbidden("You do not have permission to delete contracts.")
        if obj.status != "Draft":
            raise conflict("Only a draft contract can be deleted. Cancel it instead.")

    def present(self, ctx: Ctx, obj: Contract, data: dict) -> dict:
        data["effectiveStatus"] = effective_status(obj)
        return data


def change_contract_status(db: Session, p: Principal, contract_id: str, data: dict) -> dict:
    """Move a contract along its lifecycle. The reason / comments / date / sending method that go with the move are validated and recorded by the contract rules."""
    from app.services import records
    from app.services.modules import SPEC_BY_KEY

    spec = SPEC_BY_KEY["contracts"]
    ctx = records.Ctx(db, p, spec, state={"meta": {k: data.get(k) for k in ("reason", "statusReason", "comments", "date", "method")}})
    obj = records.get_or_404(db, spec, p, contract_id)
    payload = {"status": data.get("to") or data.get("status")}
    changes = records.apply_update(db, spec, p, obj, payload, ctx)
    db.flush()
    spec.hooks.after_update(ctx, obj, changes, payload)
    if changes:
        records._log(db, p, spec, "Updated", obj.id, "Status changed to " + str(obj.status))
    db.commit()
    return spec.hooks.present(ctx, obj, to_json(obj))


def renew_contract(db: Session, p: Principal, contract_id: str, data: dict) -> dict:
    old = db.execute(select(Contract).where(Contract.id == contract_id)).scalar_one_or_none()
    if old is None:
        raise not_found("Contract not found.")
    if "renew" not in contract_caps(p) or "create" not in contract_caps(p):
        raise forbidden("You do not have permission to renew contracts.")
    status = effective_status(old)
    if status not in ("Active", "Expiring Soon", "Expired"):
        raise conflict(f"A {status.lower()} contract cannot be renewed.")
    start = (old.end_date or date.today()) + timedelta(days=1)
    if data.get("months"):
        months = max(1, int(data["months"]))
        end_month = start.month - 1 + months
        end = date(start.year + end_month // 12, end_month % 12 + 1, min(start.day, 28)) - timedelta(days=1)
    else:  # the renewal runs for as long as the contract that is ending did (at least 30 days)
        term = max(30, ((old.end_date - old.start_date).days if old.end_date and old.start_date else 365))
        end = start + timedelta(days=term)
    new = Contract(
        id=ids.new_id(db, "CON", 4), number=ids.new_number(db, "CNT"), title=old.title, contract_type=old.contract_type, customer_id=old.customer_id, customer_name=old.customer_name, project_id=old.project_id,
        company_id=old.company_id, contact_id=old.contact_id, deal_id=old.deal_id, proposal_id=old.proposal_id, quotation_id=old.quotation_id, sales_order_id=old.sales_order_id, owner=old.owner,
        value=data.get("value", old.value), start_date=start, end_date=end, renewal_date=end - timedelta(days=int(old.notice_period_days or 30)), status="Draft", billing_frequency=old.billing_frequency, payment_terms=old.payment_terms,
        notice_period_days=old.notice_period_days, auto_renew=old.auto_renew, renewal_terms=old.renewal_terms, scope=old.scope, terms=old.terms, notes=old.notes, renewed_from_id=old.id,
        created_by=p.actor_id, branch=old.branch, attributes={"team": old.attributes.get("team", []), "templateId": old.attributes.get("templateId"), "audit": [{"at": timeline.now().isoformat(), "by": p.actor_id, "action": "Created", "to": "Draft", "note": f"Created as the renewal of {old.number}"}]},
    )
    db.add(new)
    db.flush()
    previous = old.status
    old.status, old.renewed_to_id = "Renewed", new.id
    old.attributes = {**old.attributes, "renewedAt": timeline.now().isoformat(), "renewalDecision": "renewed", "audit": [*old.attributes.get("audit", []), {"at": timeline.now().isoformat(), "by": p.actor_id, "action": "Renewed", "from": previous, "to": "Renewed", "note": f"Renewed as {new.number}"}]}
    timeline.log_activity(db, related_type="Contract", related_id=old.id, related_name=old.number, type="StatusChange", subject=f"Contract renewed - new contract {new.number}", by=p.actor_id, branch=old.branch, from_status=previous, to_status="Renewed")
    audit.record(db, user=p.user, action="Renew contract", module="Contracts", record_id=old.id, details=new.number, info=p.info)
    db.commit()
    return {"contract": to_json(new), "renewed": to_json(old)}


# ---- contract settings (types, approval, reminders) --------------------------------------------------------------------------
def put_contract_settings(db: Session, p: Principal, body: dict) -> dict:
    from app.models import AppSetting
    from app.services import audit, reminders

    if p.level not in ("Super Admin", "Admin") and p.user.job_role != "Sales Manager":
        audit.record(db, user=p.user, action="Denied: contract settings", module="Contracts", result="Denied", info=p.info)
        db.commit()
        raise forbidden("Only an administrator or a sales manager can change contract settings.")
    cur = reminders.contract_settings(db)
    types, cfg = list(cur["types"]), dict(cur["config"])
    if "types" in body:
        types = list(dict.fromkeys(str(t).strip()[:60] for t in (body["types"] or []) if str(t).strip()))
        if not types:
            raise invalid("Keep at least one contract type.", {"types": "Keep at least one type."})
    incoming = body.get("config") or {}

    def num(key: str, lo: int, hi: int) -> None:
        if key in incoming:
            try:
                n = round(float(incoming[key]))
            except (TypeError, ValueError):
                raise invalid(f"{key} must be a number.", {key: "Enter a number."}) from None
            if not lo <= n <= hi:
                raise invalid(f"{key} must be between {lo} and {hi}.", {key: f"{lo}–{hi}."})
            cfg[key] = n

    num("expiringSoonDays", 7, 365)
    num("renewalTaskDays", 7, 180)
    if "approvalRequired" in incoming:
        cfg["approvalRequired"] = bool(incoming["approvalRequired"])
    if "reminderDays" in incoming:
        days = sorted({round(float(d)) for d in (incoming["reminderDays"] or []) if str(d).strip() != ""}, reverse=True)
        if not days or any(d < 1 or d > 365 for d in days):
            raise invalid("Reminder days must be between 1 and 365.", {"reminderDays": "1–365."})
        cfg["reminderDays"] = days
    row = db.get(AppSetting, reminders.CONTRACT_KEY)
    value = {"types": types, "config": cfg}
    if row is None:
        db.add(AppSetting(key=reminders.CONTRACT_KEY, value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id
    audit.record(db, user=p.user, action="Contract settings changed", module="Contracts", details=", ".join(sorted(body)), info=p.info)
    db.commit()
    return reminders.contract_settings(db)
