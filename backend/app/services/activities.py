"""Activities: what happened (and what is scheduled) on any CRM record.

Guarantees held by the server: every manual activity is attached to a real, visible record and its link chain is resolved from stored data; user, time and status are stamped here;
types that assert a fact (Proposal Sent, Quotation Accepted ...) are only accepted when that fact is true on the record; Follow-up / Task / Payment Follow-up also create a real task;
system-recorded events can never be edited or deleted."""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import Activity, Campaign, Company, Contact, Contract, Customer, Deal, Enquiry, Expense, Invoice, Lead, Payment, Project, Proposal, Quotation, SalesOrder
from app.services import tasks as task_svc
from app.services.codec import to_json
from app.services.records import Ctx, Hooks
from app.services.timeline import notify

SYSTEM_EVENT_TYPES = ("Created", "Updated", "Revision", "Conversion", "Assignment", "Qualification", "MeetingShared", "Invoice", "Payment", "Expense", "Campaign", "Quotation", "StatusChange", "Attachment")
CONTACT_TYPES = ("Call", "Email", "WhatsApp", "SMS", "Meeting", "Demo / Presentation", "Site Visit", "Customer Interaction")
ADMIN_ROLES = ("Super Admin", "Admin")
MANAGER_JOBS = ("Sales Manager",)

# type -> (needs, only, schedulable, makes a task, verify)
DEFS = {
    "Call": (("outcome",), None, False, False, None), "Email": (("subject",), None, False, False, None), "WhatsApp": (("description",), None, False, False, None),
    "SMS": (("description",), None, False, False, None), "Meeting": (("subject", "time"), None, True, False, None), "Follow-up": (("subject", "due"), None, True, True, None),
    "Task": (("subject", "due"), None, True, True, None), "Demo / Presentation": (("subject", "time"), None, True, False, None), "Site Visit": (("subject", "time", "location"), None, True, False, None),
    "Note": (("description",), None, False, False, None), "Proposal Sent": ((), ("Proposal",), False, False, "proposalSent"), "Quotation Sent": ((), ("Quotation",), False, False, "quotationSent"),
    "Quotation Accepted / Rejected": (("outcome",), ("Quotation",), False, False, "quotationOutcome"), "Deal Stage Changed": (("toStatus",), ("Deal",), False, False, "dealStage"),
    "Status Changed": (("toStatus",), None, False, False, "status"), "Document Uploaded": (("documentName",), None, False, False, None),
    "Payment Follow-up": (("due",), ("Invoice", "Payment", "Sales Order", "Customer"), True, True, "paymentDue"), "Customer Interaction": (("channel", "description"), ("Customer", "Contact", "Company"), False, False, None),
    "Other / Custom Activity": (("customType", "description"), None, False, False, None),
}
RELATED = {
    "Enquiry": (Enquiry, lambda r: f"{r.id} · {r.name or r.company}", "enquiryId"), "Lead": (Lead, lambda r: f"{r.name}{' · ' + r.company if r.company else ''}", "leadId"),
    "Deal": (Deal, lambda r: f"{r.id} · {r.name}", "dealId"), "Contact": (Contact, lambda r: f"{r.name}{' · ' + r.company_name if r.company_name else ''}", "contactId"),
    "Company": (Company, lambda r: r.name, "companyId"), "Customer": (Customer, lambda r: r.name, "customerId"), "Proposal": (Proposal, lambda r: f"{r.number} · {r.title}", "proposalId"),
    "Quotation": (Quotation, lambda r: f"{r.number} · {r.customer_name}", "quotationId"), "Sales Order": (SalesOrder, lambda r: f"{r.number} · {r.customer_name}", "salesOrderId"),
    "Invoice": (Invoice, lambda r: f"{r.number} · {r.customer_name}", "invoiceId"), "Payment": (Payment, lambda r: f"{r.number or r.reference} · {r.customer_name}", "paymentId"),
    "Campaign": (Campaign, lambda r: f"{r.number} · {r.name}", "campaignId"), "Expense": (Expense, lambda r: f"{r.number} · {r.description}", "expenseId"),
    "Contract": (Contract, lambda r: f"{r.number} · {r.customer_name}", "contractId"), "Project": (Project, lambda r: f"{r.id} · {r.name}", "projectId"),
}


def to_iso(day: str | None, time: str | None = None) -> datetime | None:
    if not day:
        return None
    try:
        return datetime.fromisoformat(f"{day}T{time or '09:00'}:00").replace(tzinfo=UTC)
    except ValueError:
        return None


def validate(data: dict) -> None:
    errors = {}
    atype = data.get("type")
    if atype not in DEFS:
        raise invalid("Choose an activity type.", {"type": "Choose an activity type."})
    needs, only, schedulable, _, _ = DEFS[atype]
    if not data.get("relatedType") or not data.get("relatedId"):
        errors["relatedId"] = "Pick the record this activity belongs to."
    elif only and data["relatedType"] not in only:
        errors["relatedType"] = f"{atype} can only be logged on: {', '.join(only)}."
    checks = {"subject": (lambda: str(data.get("subject") or "").strip(), "Add a title."), "description": (lambda: str(data.get("description") or "").strip(), "Add the details."),
              "outcome": (lambda: data.get("outcome"), "Choose the outcome."), "time": (lambda: data.get("date") and data.get("time"), "Set the date and start time."),
              "due": (lambda: data.get("date"), "Set a due date."), "location": (lambda: str(data.get("location") or "").strip(), "Where is the visit?"),
              "toStatus": (lambda: str(data.get("toStatus") or "").strip(), "Enter the new status."), "documentName": (lambda: str(data.get("documentName") or "").strip(), "Name the document."),
              "channel": (lambda: data.get("channel"), "Choose the channel."), "customType": (lambda: str(data.get("customType") or "").strip(), "Name this activity type.")}
    for need in needs:
        if not checks[need][0]():
            errors["date" if need in ("time", "due") else need] = checks[need][1]
    if data.get("subject") and len(data["subject"]) > 160:
        errors["subject"] = "Title is too long (max 160)."
    if data.get("description") and len(data["description"]) > 2000:
        errors["description"] = "Details are limited to 2000 characters."
    if data.get("date"):
        when = to_iso(data["date"], data.get("time"))
        if when is None:
            errors["date"] = "Enter a valid date."
        else:
            days = (when - datetime.now(UTC)).total_seconds() / 86400
            if days > 366:
                errors["date"] = "That is more than a year ahead."
            elif days < -366:
                errors["date"] = "That is more than a year ago."
            elif not schedulable and days > 1:
                errors["date"] = f"{atype} records something that has happened - it cannot be in the future."
    if errors:
        raise invalid(next(iter(errors.values())), errors)


def balance(inv: Invoice | None) -> float:
    return max(0.0, float(inv.amount or 0) - float(inv.paid_amount or 0)) if inv is not None and inv.status != "Cancelled" else 0.0


def verify(db: Session, kind: str | None, data: dict, rec) -> str | None:
    if kind == "proposalSent":
        return None if rec.status in ("Sent", "Viewed", "Revision Requested", "Accepted", "Rejected", "Expired") or rec.sent_at else f"{rec.number} has not been sent to the client yet - use Send Proposal on the proposal first."
    if kind == "quotationSent":
        return None if rec.status in ("Sent", "Viewed", "Negotiation", "Accepted", "Rejected") or (rec.attributes or {}).get("sentAt") else f"{rec.number} has not been sent yet (status: {rec.status})."
    if kind == "quotationOutcome":
        return None if rec.status == data.get("outcome") else f"{rec.number} is {rec.status}, not {data.get('outcome')}. Update the quotation first."
    if kind == "dealStage":
        wanted = data.get("toStatus")
        return None if rec.stage == wanted or any(h.get("stage") == wanted for h in (rec.attributes or {}).get("stageHistory") or []) else f'{rec.name} has never been in "{wanted}". Change the stage on the deal first.'
    if kind == "status":
        current = getattr(rec, "status", None) or getattr(rec, "stage", None)
        if current is None:
            return "This record has no status to record."
        return None if str(current).lower() == str(data.get("toStatus", "")).strip().lower() else f'This record\'s status is "{current}", not "{data.get("toStatus")}".'
    if kind == "paymentDue":
        t = data["relatedType"]
        if t == "Invoice":
            due = balance(rec)
        elif t in ("Payment", "Sales Order"):
            due = balance(db.get(Invoice, getattr(rec, "invoice_id", None))) if getattr(rec, "invoice_id", None) else 0
        else:
            due = sum(balance(i) for i in db.execute(select(Invoice).where(Invoice.customer_id == rec.id)).scalars())
        return None if due > 0 else "Nothing is outstanding on this record - a payment follow-up is not needed."
    return None


def links_for(rec, key: str) -> dict:
    links = {key: rec.id}
    for _, _, link_key in RELATED.values():
        attr = "".join("_" + c.lower() if c.isupper() else c for c in link_key)
        value = getattr(rec, attr, None)
        if value and link_key != key:
            links[link_key] = value
    return links


def log_manual(db: Session, p: Principal, data: dict) -> dict:
    if not p.can("Activities", "create"):
        raise forbidden("You do not have permission to log activities.")
    validate(data)
    needs, only, schedulable, makes_task, verify_kind = DEFS[data["type"]]
    model, label, link_key = RELATED[data["relatedType"]] if data["relatedType"] in RELATED else (None, None, None)
    if model is None:
        raise invalid(f'"{data["relatedType"]}" cannot hold activities.', {"relatedType": "Choose a CRM record type."})
    rec = db.execute(select(model).where(model.id == data["relatedId"])).scalar_one_or_none()
    if rec is None:
        raise not_found(f"That {data['relatedType'].lower()} no longer exists.")
    truth = verify(db, verify_kind, data, rec)
    if truth:
        raise conflict(truth)
    now = datetime.now(UTC)
    when = to_iso(data.get("date"), data.get("time")) or now
    future = when > now + timedelta(minutes=1)
    status = "Completed"
    if schedulable:
        status = "Scheduled" if future else ("Scheduled" if data.get("status") == "Scheduled" else "Completed")
    related_name = label(rec)
    subject = str(data.get("subject") or "").strip() or f"{data.get('customType') if data['type'] == 'Other / Custom Activity' else data['type']} - {related_name}"
    recent = db.execute(select(Activity).where(Activity.source == "manual", Activity.by == p.actor_id, Activity.type == data["type"], Activity.related_id == rec.id, Activity.subject == subject,
                                               Activity.created_at >= now - timedelta(seconds=15))).first()
    if recent:
        raise conflict("This activity was just logged.")
    contact = db.get(Contact, getattr(rec, "contact_id", None)) if getattr(rec, "contact_id", None) else None
    links = links_for(rec, link_key)
    extra: dict = {"description": str(data.get("description") or "").strip(), "loggedAt": now.isoformat().replace("+00:00", "Z"), "links": links,
                   "priority": data.get("priority") if data.get("priority") in ("Low", "Medium", "High") else "Medium"}
    if status == "Completed":
        extra.update(completedAt=now.isoformat().replace("+00:00", "Z"), completedBy=p.actor_id)
    t = data["type"]
    if t == "Call":
        extra.update(callOutcome=data.get("outcome"), callType=data.get("callType") or "Outgoing", duration=data.get("duration"))
    if t == "Email":
        extra.update(emailSubject=data.get("subject"), emailTo=contact.email if contact else None, emailStatus="Logged")
    if t in ("WhatsApp", "SMS"):
        extra.update(waTo=contact.phone if contact else None, waStatus="Logged", channel=t)
    if t in ("Meeting", "Demo / Presentation", "Site Visit"):
        joinable = t == "Meeting" and data["relatedType"] in ("Lead", "Enquiry", "Contact", "Deal", "Proposal") and data.get("meetingType") == "Online Meeting"
        extra.update(title=subject, meetingDate=data.get("date"), meetingStartTime=data.get("time"), meetingEndTime=data.get("endTime"), meetingType=data.get("meetingType") or t,
                     meetingStatus="Scheduled" if status == "Scheduled" else "Completed", location=data.get("location"))
        if joinable:
            extra["meetingLink"] = True  # replaced by the join path once the id exists (below)
    if t in ("Follow-up", "Payment Follow-up"):
        extra.update(followUpType=data.get("followUpType") or "Call", followUpDate=data.get("date"))
    if t in ("Task", "Payment Follow-up"):
        extra["dueDate"] = data.get("date")
    if data.get("reminderMinutes") not in (None, "") and str(data["reminderMinutes"]).isdigit() and int(data["reminderMinutes"]) in (0, 5, 15, 30, 60, 1440):
        extra["reminderMinutes"] = int(data["reminderMinutes"])
    if t == "Quotation Accepted / Rejected":
        extra["outcome"] = data.get("outcome")
    if t in ("Deal Stage Changed", "Status Changed"):
        extra["toStatus"], extra["fromStatus"] = data.get("toStatus"), data.get("fromStatus")
    if t == "Document Uploaded":
        extra.update(attachmentName=data.get("documentName"), attachmentAction="Received / shared")
    if t == "Customer Interaction":
        extra["channel"] = data.get("channel")
    if t == "Other / Custom Activity":
        extra["customType"] = data.get("customType")
    assignee = data.get("assignedTo") or p.actor_id
    new_id = ids.new_id(db, "MTG" if t == "Meeting" else "ACT", 5)
    if extra.get("meetingLink") is True:
        extra["meetingLink"] = f"/meetings/{new_id}"
    activity = Activity(id=new_id, related_type=data["relatedType"], related_id=rec.id, related_name=related_name[:240], status=status, by=p.actor_id, type=t,
                        subject=subject[:300], date=when, source="manual", assigned_to=assignee, notes=extra["description"][:4000], branch=rec.branch, created_by=p.actor_id, attributes=extra)
    db.add(activity)
    db.flush()
    if makes_task:
        actor, perms = task_svc.actor_of(p), task_svc.perms_of(db, task_svc.actor_of(p), None)
        follow = {"Call": "Call", "Email": "Email", "WhatsApp": "WhatsApp", "Meeting": "Meeting"}.get(data.get("followUpType"), "Follow-up")
        task = task_svc.create_task(db, task_svc.Actor(id=p.actor_id, name=p.name, level="System", system=True), task_svc._ALL, {
            "title": subject, "relatedType": data["relatedType"], "relatedId": rec.id, "assignees": [assignee], "priority": extra["priority"], "dueDate": data.get("date"), "dueTime": data.get("time"),
            "taskType": "Payment Follow-up" if t == "Payment Follow-up" else follow if t == "Follow-up" else "General", "description": extra["description"], "visibility": "Team"},
            branch=rec.branch, source="activity", allow_duplicate=True, activity_id=activity.id, message=f"Created from the logged {t} activity")
        activity.attributes = {**activity.attributes, "taskId": task.id}
    if t in CONTACT_TYPES and status == "Completed" and hasattr(rec, "last_contacted_date"):
        rec.last_contacted_date = when.date()
    if t in ("Follow-up", "Payment Follow-up") and hasattr(rec, "next_follow_up") and data.get("date"):
        rec.next_follow_up = date.fromisoformat(data["date"])
    if assignee != p.actor_id:
        notify(db, user_id=assignee, message=f"{p.name} assigned you: {subject}", type="Activity Assigned", related_type=data["relatedType"], related_id=rec.id, branch=rec.branch)
    db.commit()
    return to_json(activity)


def status_of(act: Activity) -> str:
    return act.status or "Completed"


def _mutable(p: Principal, act: Activity) -> None:
    if act.source != "manual":
        raise conflict("System-recorded events are part of the audit trail and cannot be changed.")
    if act.by != p.actor_id and p.level not in ADMIN_ROLES and p.user.job_role not in MANAGER_JOBS:
        raise forbidden("Only the person who logged this activity (or a manager) can change it.")


def _get(db: Session, activity_id: str) -> Activity:
    act = db.execute(select(Activity).where(Activity.id == activity_id)).scalar_one_or_none()
    if act is None:
        raise not_found("Activity not found.")
    return act


def _actor(p: Principal) -> task_svc.Actor:
    return task_svc.Actor(id=p.actor_id, name=p.name, level="System", system=True)


def complete(db: Session, p: Principal, activity_id: str, notes: str) -> dict:
    act = _get(db, activity_id)
    if not p.can("Activities", "edit"):
        raise forbidden("You do not have permission to update activities.")
    if act.source != "manual":
        raise conflict("Only logged activities can be completed here.")
    if status_of(act) != "Scheduled":
        raise conflict(f"This activity is already {status_of(act).lower()}.")
    notes = (notes or "").strip()[:1000]
    act.status = "Completed"
    act.attributes = {**act.attributes, "completedAt": task_svc.iso(), "completedBy": p.actor_id, "outcomeNotes": notes or None, **({"meetingStatus": "Completed"} if act.attributes.get("meetingStatus") else {})}
    task_svc.sync_from_activity(db, act.attributes.get("taskId"), {"status": "Completed", "notes": notes}, _actor(p))
    db.commit()
    return to_json(act)


def cancel(db: Session, p: Principal, activity_id: str, reason: str) -> dict:
    act = _get(db, activity_id)
    _mutable(p, act)
    if status_of(act) != "Scheduled":
        raise conflict(f"Only a scheduled activity can be cancelled (this one is {status_of(act).lower()}).")
    reason = (reason or "").strip()
    if not reason:
        raise invalid("Give a reason for cancelling.", {"reason": "Required."})
    act.status = "Cancelled"
    act.attributes = {**act.attributes, "cancelledAt": task_svc.iso(), "cancelledBy": p.actor_id, "cancelReason": reason[:500], **({"meetingStatus": "Cancelled"} if act.attributes.get("meetingStatus") else {})}
    task_svc.sync_from_activity(db, act.attributes.get("taskId"), {"status": "Cancelled", "reason": reason}, _actor(p))
    db.commit()
    return to_json(act)


def reschedule(db: Session, p: Principal, activity_id: str, data: dict) -> dict:
    act = _get(db, activity_id)
    _mutable(p, act)
    if status_of(act) != "Scheduled":
        raise conflict("Only a scheduled activity can be rescheduled.")
    when = to_iso(data.get("date"), data.get("time"))
    if when is None or when < datetime.now(UTC) - timedelta(minutes=1):
        raise invalid("Choose a date and time in the future.", {"date": "Choose a future date."})
    a = act.attributes
    history = [*a.get("rescheduledFrom", []), {"date": a.get("meetingDate") or str(act.date)[:10], "time": a.get("meetingStartTime"), "at": task_svc.iso(), "by": p.actor_id}]
    patch = {"reminderSentAt": None, "rescheduledCount": a.get("rescheduledCount", 0) + 1, "rescheduledFrom": history}
    if a.get("meetingDate"):
        patch.update(meetingDate=data["date"], meetingStartTime=data.get("time") or a.get("meetingStartTime"), meetingStatus="Scheduled")
    if a.get("dueDate"):
        patch["dueDate"] = data["date"]
    if a.get("followUpDate"):
        patch.update(followUpDate=data["date"], followUpTime=data.get("time") or a.get("followUpTime"))
    act.date, act.status, act.attributes = when, "Scheduled", {**a, **patch}
    task_svc.sync_from_activity(db, a.get("taskId"), {"dueDate": data["date"]}, _actor(p))
    db.commit()
    return to_json(act)


def edit(db: Session, p: Principal, activity_id: str, data: dict) -> dict:
    act = _get(db, activity_id)
    _mutable(p, act)
    attrs = dict(act.attributes)
    if "subject" in data:
        if not str(data["subject"]).strip():
            raise invalid("Title cannot be empty.", {"subject": "Required."})
        act.subject = str(data["subject"]).strip()[:160]
    if "description" in data:
        act.notes = str(data["description"]).strip()[:2000]
        attrs["description"] = act.notes
    if data.get("priority") in ("Low", "Medium", "High"):
        attrs["priority"] = data["priority"]
    if data.get("assignedTo"):
        act.assigned_to = data["assignedTo"]
    act.attributes = {**attrs, "editedAt": task_svc.iso(), "editedBy": p.actor_id}
    task_svc.sync_from_activity(db, attrs.get("taskId"), {"title": data.get("subject"), "priority": data.get("priority"), "assignedTo": data.get("assignedTo")}, _actor(p))
    db.commit()
    return to_json(act)


def delete(db: Session, p: Principal, activity_id: str) -> dict:
    act = _get(db, activity_id)
    if not p.can("Activities", "delete") and act.by != p.actor_id:
        raise forbidden("You do not have permission to delete activities.")
    _mutable(p, act)
    task_id = act.attributes.get("taskId")
    db.delete(act)
    if task_id:
        from app.models import Task

        task = db.get(Task, task_id)
        if task is not None:
            for child in db.execute(select(Task).where(Task.parent_id == task.id)).scalars().all():
                db.delete(child)
            db.delete(task)
    db.commit()
    return {"success": True}


class ActivityHooks(Hooks):
    """Generic POST /activities: used by the record pages' quick-action dialogs (call / email / WhatsApp / meeting / note). The server decides who did it and where it belongs."""

    def before_create(self, ctx: Ctx, obj: Activity, payload: dict) -> None:
        if obj.type in SYSTEM_EVENT_TYPES:
            raise forbidden("System events are written by the CRM itself and cannot be created by a client.")
        spec = RELATED.get(obj.related_type)
        if spec is None:
            raise invalid("Choose the record this activity belongs to.", {"relatedType": "Unknown record type."})
        model, label, _ = spec
        rec = ctx.db.execute(select(model).where(model.id == obj.related_id)).scalar_one_or_none()
        if rec is None:
            raise not_found("The record this activity belongs to was not found.")
        obj.related_name, obj.branch, obj.by, obj.source = (obj.related_name or label(rec))[:240], rec.branch, ctx.principal.actor_id, "manual"
        obj.assigned_to = obj.assigned_to or ctx.principal.actor_id
        obj.status = obj.status or "Completed"
        obj.date = obj.date or datetime.now(UTC)
        obj.attributes = {**(obj.attributes or {}), "links": links_for(rec, spec[2])}
        if obj.status not in ("Scheduled", "Completed", "Cancelled"):
            raise invalid("Status must be Scheduled, Completed or Cancelled.", {"status": "Invalid."})

    def before_update(self, ctx: Ctx, obj: Activity, changes: dict, payload: dict) -> None:
        _mutable(ctx.principal, obj)

    def before_delete(self, ctx: Ctx, obj: Activity) -> None:
        _mutable(ctx.principal, obj)
