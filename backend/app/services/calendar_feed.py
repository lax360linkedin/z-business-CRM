"""The calendar owns no data. Every dated thing the CRM knows about is assembled here, per request and for the signed-in person only, straight from the records that hold it:
tasks they may see, scheduled meetings / demos / visits / follow-up activities, each lead / enquiry / deal / contact's next follow-up, reminders still to fire, and business due
dates (invoices, quotation & proposal validity, deliveries, contracts, campaigns, projects, expenses, document reviews) for the modules they can open. Nothing is copied, so a change
anywhere shows up the next time the calendar loads. Duplicates are collapsed: a follow-up that already has a task (or an activity that spawned one) appears once."""
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.config import get_settings
from app.core.errors import forbidden, invalid, not_found
from app.models import (Activity, Campaign, Company, Contact, Contract, Customer, Deal, Document, Enquiry, Expense, Invoice, Lead, Payment, Product, Project, Proposal, Quotation, SalesOrder)
from app.services import data_scope, documents, tasks as task_svc
from app.services import expenses as expense_svc
from app.services.codec import to_json
from app.services.modules import SPEC_BY_KEY

MEETING_TYPES = ("Meeting", "Demo / Presentation", "Site Visit")
FOLLOWUP_TYPES = ("Follow-up", "Payment Follow-up")
DEFAULT_MEETING_REMINDER = 15
REMINDER_LABELS = {"At time of event": 0, "5 minutes before": 5, "15 minutes before": 15, "30 minutes before": 30, "1 hour before": 60, "1 day before": 1440}
ADMIN_ROLES = ("Super Admin", "Admin", "Sales Manager")
FOLLOWUP_RECORDS = {"Lead": ("leads", "Leads", "assigned_to"), "Enquiry": ("enquiries", "Enquiries", "assigned_user"), "Deal": ("deals", "Deals", "salesperson"), "Contact": ("contacts", "Contacts", "assigned_to")}
CLOSED = {"Lead": lambda r: r.status in ("Converted", "Lost", "Unqualified"),
          "Enquiry": lambda r: r.status in ("Converted", "Duplicate", "Spam", "Not Interested", "Closed", "Unqualified"),
          "Deal": lambda r: str(r.stage or "").startswith("Closed"), "Contact": lambda r: False}
LABEL_MODELS = {"Enquiry": Enquiry, "Lead": Lead, "Deal": Deal, "Contact": Contact, "Company": Company, "Customer": Customer, "Proposal": Proposal, "Quotation": Quotation, "Sales Order": SalesOrder,
                "Invoice": Invoice, "Payment": Payment, "Contract": Contract, "Project": Project, "Product": Product, "Campaign": Campaign, "Expense": Expense, "Document": Document}
LINK_KEY_TYPES = {"enquiryId": "Enquiry", "leadId": "Lead", "contactId": "Contact", "companyId": "Company", "dealId": "Deal", "proposalId": "Proposal", "quotationId": "Quotation",
                  "customerId": "Customer", "salesOrderId": "Sales Order", "invoiceId": "Invoice", "paymentId": "Payment", "expenseId": "Expense", "contractId": "Contract", "projectId": "Project",
                  "documentId": "Document", "productId": "Product", "campaignId": "Campaign"}
LINK_KEY_REV = {v: k for k, v in LINK_KEY_TYPES.items()}
ROUTES = {"Enquiry": "/enquiries/{}", "Lead": "/leads/{}", "Deal": "/deals/{}", "Contact": "/contacts/{}", "Company": "/companies/{}", "Customer": "/customers/{}", "Proposal": "/proposals/{}",
          "Quotation": "/quotations/{}", "Sales Order": "/sales-orders/{}", "Invoice": "/invoices/{}", "Payment": "/payments/{}", "Contract": "/contracts/{}", "Project": "/projects/{}",
          "Product": "/products/{}", "Campaign": "/campaigns/{}", "Expense": "/expenses/{}", "Document": "/documents/{}"}


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().org_timezone)


def local(dt: datetime) -> datetime:
    return dt.astimezone(tz())


def local_date(dt: datetime) -> str:
    return local(dt).date().isoformat()


def local_time(dt: datetime) -> str:
    return local(dt).strftime("%H:%M")


def date_only(v) -> str | None:
    return str(v)[:10] if v else None


def start_of(day: str | None, time: str | None) -> datetime | None:
    if not day:
        return None
    h, m = (int(x) for x in (time or "00:00").split(":")[:2])
    y, mo, d = (int(x) for x in day.split("-"))
    return datetime(y, mo, d, h, m, tzinfo=tz())


# ---- the activity rules (calendarRules.js) ----------------------------------------------------------------------------------
def activity_status(a: dict) -> str:
    ms = a.get("meetingStatus")
    if ms:
        return "Scheduled" if ms == "Rescheduled" else ms
    if a.get("followUpDate") and (a.get("status") or "Completed") == "Completed" and not a.get("completedAt") and not a.get("completedBy"):
        return "Scheduled"
    return a.get("status") or "Completed"


def activity_when(a: dict, raw: datetime | None) -> dict | None:
    if a.get("meetingDate"):
        return {"date": str(a["meetingDate"])[:10], "time": a.get("meetingStartTime") or None, "endTime": a.get("meetingEndTime") or None}
    if a.get("followUpDate"):
        return {"date": str(a["followUpDate"])[:10], "time": a.get("followUpTime") or None, "endTime": None}
    if raw is None:
        return None
    loc = local(raw)
    has_time = not (loc.hour == 0 and loc.minute == 0)
    return {"date": loc.date().isoformat(), "time": loc.strftime("%H:%M") if has_time else None, "endTime": a.get("meetingEndTime") or None}


def activity_kind(a: dict) -> str | None:
    if a.get("source") == "task" or a.get("taskId"):
        return None
    if a.get("type") in MEETING_TYPES or a.get("meetingStatus"):
        return "meeting"
    if a.get("type") in FOLLOWUP_TYPES:
        return "followup" if a.get("status") == "Scheduled" or a.get("followUpDate") else None
    if a.get("status") == "Scheduled" and a.get("type") not in ("Created", "Updated", "Note"):
        return "followup"
    return None


def reminder_minutes(a: dict) -> int | None:
    v = a.get("reminderMinutes")
    if v not in (None, ""):
        return int(v)
    if a.get("reminder") in REMINDER_LABELS:
        return REMINDER_LABELS[a["reminder"]]
    return DEFAULT_MEETING_REMINDER if a.get("type") in MEETING_TYPES or a.get("meetingStatus") else None


# ---- helpers --------------------------------------------------------------------------------------------------------------
class Finder:
    def __init__(self, db: Session):
        self.db, self.cache = db, {}

    def find(self, rtype: str, rid: str | None):
        model = LABEL_MODELS.get(rtype)
        if not model or not rid:
            return None
        key = (rtype, rid)
        if key not in self.cache:
            self.cache[key] = self.db.execute(select(model).where(model.id == rid)).scalar_one_or_none()
        return self.cache[key]

    def label(self, rtype: str, rec) -> str:
        if rtype == "Payment":
            return str(getattr(rec, "number", None) or getattr(rec, "reference", None) or rec.id)
        for attr in ("number", "name", "title", "subject"):
            if getattr(rec, attr, None):
                base = str(getattr(rec, attr))
                return f"{base} · {getattr(rec, 'customer_name')}" if rtype in ("Quotation", "Sales Order", "Invoice") and getattr(rec, "customer_name", "") else base
        return rec.id

    def chain(self, links: dict | None) -> list[dict]:
        out = []
        for key, rtype in LINK_KEY_TYPES.items():
            rid = (links or {}).get(key)
            rec = self.find(rtype, rid) if rid else None
            if rec is not None:
                out.append({"type": rtype, "id": rid, "label": self.label(rtype, rec), "route": ROUTES[rtype].format(rid)})
        return out


def _visible_rows(db: Session, p: Principal, spec_key: str):
    spec = SPEC_BY_KEY[spec_key]
    stmt = select(spec.model)
    extra = spec.row_filter(p) if spec.row_filter else None
    return db.execute(stmt.where(extra) if extra is not None else stmt).scalars()


# ---- the feed -------------------------------------------------------------------------------------------------------------
def build_events(db: Session, p: Principal, frm: str | None = None, to: str | None = None) -> list[dict]:
    finder = Finder(db)
    role = data_scope.role_of(p)
    me = p.actor_id
    events: list[dict] = []
    covered: set[str] = set()
    task_covered: set[str] = set()
    today = datetime.now(tz()).date().isoformat()
    now = datetime.now(tz())

    def in_range(d: str) -> bool:
        return (not frm or d >= frm) and (not to or d <= to)

    def push(ev: dict) -> None:
        if ev.get("date") and in_range(ev["date"]):
            events.append(ev)

    # tasks
    if p.can("Tasks", "view"):
        actor = task_svc.actor_of(p)
        perms = task_svc.perms_of(db, actor)
        subs = task_svc.subtask_counts(db)
        for task in task_svc.visible_tasks(db, actor, perms):
            t = task_svc.decorate(actor, perms, task, subs)
            open_ = task_svc.is_open(task)
            due = t.get("dueDate")
            if t.get("relatedId") and due and open_:
                covered.add(f"{t['relatedId']}|{due}")
                task_covered.add(f"{t['relatedId']}|{due}")
            lead = (t.get("links") or {}).get("leadId")
            if lead and due and open_:
                covered.add(f"{lead}|{due}")
            related = finder.chain(t.get("links"))
            if due:
                state = "done" if t["status"] == "Completed" else "cancelled" if t["status"] == "Cancelled" else "overdue" if t.get("overdue") else "open"
                push({"id": f"task:{t['id']}", "kind": "task", "type": t.get("taskType"), "title": t["title"], "date": due, "time": t.get("dueTime") or None, "endTime": None, "state": state, "status": t["status"],
                      "priority": t.get("priority"), "assignees": t.get("assignees") or [], "createdBy": t.get("createdBy"), "relatedType": t.get("relatedType"), "relatedId": t.get("relatedId"),
                      "relatedName": t.get("relatedName"), "related": related, "href": f"/tasks/{t['id']}", "hrefLabel": "Open task", "source": {"type": "task", "id": t["id"], "status": t["status"]},
                      "can": {"reschedule": bool(t["_can"].get("changeDueDate")), "complete": bool(t["_can"].get("complete")), "cancel": bool(t["_can"].get("cancel"))},
                      "description": t.get("description") or "", "recurring": (t.get("recurrence") or {}).get("frequency", "none") != "none"})
            if task.reminder_at and not task.reminded_at and open_:
                r = task.reminder_at
                push({"id": f"reminder:task:{t['id']}", "kind": "reminder", "type": "Reminder", "title": f"Reminder: {t['title']}", "date": local_date(r), "time": local_time(r), "state": "overdue" if r < datetime.now(UTC) else "open",
                      "status": "Reminder due", "priority": t.get("priority"), "assignees": t.get("assignees") or [], "relatedType": t.get("relatedType"), "relatedId": t.get("relatedId"),
                      "relatedName": t.get("relatedName"), "related": related, "href": f"/tasks/{t['id']}", "hrefLabel": "Open task", "source": {"type": "task", "id": t["id"]}, "can": {},
                      "description": f"Due {due or ''} {t.get('dueTime') or ''}".strip()})

    # activities: meetings, demos, visits, scheduled follow-ups
    see_all = p.can("Activities", "view")
    stmt = select(Activity).where(Activity.source != "task", or_(Activity.type.in_(MEETING_TYPES + FOLLOWUP_TYPES), Activity.status == "Scheduled"))
    cal_items = []
    for act in db.execute(stmt).scalars():
        a = to_json(act)
        kind = activity_kind(a)
        if not kind or a.get("mirrorOf"):
            continue
        when = activity_when(a, act.date)
        if not when:
            continue
        if kind == "followup" and f"{act.related_id}|{when['date']}" in task_covered:
            continue
        assignee = act.assigned_to or act.by
        if not see_all and act.by != me and assignee != me:
            continue
        cal_items.append((act, a, kind, when))
    for act, a, kind, when in cal_items:
        status = activity_status(a)
        start = start_of(when["date"], when["time"])
        open_ = status == "Scheduled"
        state = ("overdue" if start and start < now else "open") if open_ else "cancelled" if status in ("Cancelled", "No Show") else "done"
        if act.related_id and open_:
            covered.add(f"{act.related_id}|{when['date']}")
        assignee = act.assigned_to or act.by
        mine = act.by == me or assignee == me
        manual = (act.source or "manual") == "manual"
        may_change = manual and open_ and (mine or role in ADMIN_ROLES) and p.can("Activities", "edit")
        route = ROUTES.get(act.related_type)
        href = route.format(act.related_id) if route and act.related_id else None
        label = f"Open {act.related_type.lower()}" if route else None
        meeting_link = a.get("meetingLink") or None
        push({"id": f"activity:{act.id}", "kind": kind, "type": a.get("meetingType") if act.type == "Meeting" and a.get("meetingType") else act.type, "title": a.get("title") or act.subject or act.type,
              "date": when["date"], "time": when["time"], "endTime": when["endTime"], "state": state, "status": status, "priority": a.get("priority"), "assignees": [assignee] if assignee else [],
              "createdBy": act.by, "relatedType": act.related_type, "relatedId": act.related_id, "relatedName": act.related_name, "related": finder.chain(a.get("links")), "href": href, "hrefLabel": label,
              "meetingLink": meeting_link, "location": a.get("location"), "source": {"type": "activity", "id": act.id, "status": status},
              "can": {"reschedule": may_change, "complete": may_change, "cancel": may_change}, "description": a.get("description") or act.notes or "", "unlinked": not act.related_id})
        mins = reminder_minutes(a) if open_ else None
        if mins is not None and not a.get("reminderSentAt") and start:
            at = start - timedelta(minutes=mins)
            if at > now - timedelta(days=1):
                push({"id": f"reminder:activity:{act.id}", "kind": "reminder", "type": "Reminder", "title": f"Reminder: {a.get('title') or act.subject}", "date": at.date().isoformat(), "time": at.strftime("%H:%M"),
                      "state": "overdue" if at < now else "open", "status": "Reminder due", "assignees": [assignee] if assignee else [], "relatedType": act.related_type, "relatedId": act.related_id,
                      "relatedName": act.related_name, "related": [], "href": href, "hrefLabel": label, "source": {"type": "activity", "id": act.id}, "can": {},
                      "description": f"{f'{mins} min before' if mins else 'At'} {when['date']} {when['time'] or ''}".strip()})

    # a meeting copied onto a deal by older code is the same entry: keep the original on its own record
    groups: dict[str, list[dict]] = {}
    for e in events:
        if e["source"]["type"] == "activity" and e["kind"] in ("meeting", "followup") and not e["id"].startswith("reminder"):
            sig = f"{e['kind']}|{e['title']}|{e['date']}|{e.get('time') or ''}|{(e.get('assignees') or [''])[0]}|{e.get('meetingLink') or ''}"
            groups.setdefault(sig, []).append(e)
    drop: set[str] = set()
    for items in groups.values():
        if len(items) < 2:
            continue
        keep = next((e for e in items if str(e["source"]["id"]).startswith("MTG-")), None) or next((e for e in items if e["relatedType"] != "Deal"), None) or items[0]
        for e in items:
            if e is not keep:
                drop.add(e["id"])
                drop.add(f"reminder:{e['id']}")
    events[:] = [e for e in events if e["id"] not in drop]

    # each record's own next follow-up
    for rtype, (key, module, owner_attr) in FOLLOWUP_RECORDS.items():
        if not p.can(module, "view"):
            continue
        scope = data_scope.scope_for(p, module)
        for rec in _visible_rows(db, p, key):
            nxt = getattr(rec, "next_follow_up", None)
            d = date_only(nxt)
            if not d or CLOSED[rtype](rec) or f"{rec.id}|{d}" in covered:
                continue
            owner = getattr(rec, owner_attr, None)
            name = finder.label(rtype, rec)
            may_change = p.can(module, "edit") and (owner == me or scope != "Own" or role in ADMIN_ROLES)
            push({"id": f"followup:{rtype}:{rec.id}", "kind": "followup", "type": "Follow-up", "title": f"Follow up: {name}", "date": d, "time": None, "endTime": None, "state": "overdue" if d < today else "open",
                  "status": "Scheduled", "priority": getattr(rec, "priority", None) or None, "assignees": [owner] if owner else [], "relatedType": rtype, "relatedId": rec.id, "relatedName": name,
                  "related": finder.chain(record_links(rec, rtype)),
                  "href": ROUTES[rtype].format(rec.id), "hrefLabel": f"Open {rtype.lower()}", "source": {"type": "record", "recordType": rtype, "id": rec.id}, "can": {"reschedule": may_change},
                  "description": f"Next follow-up date on the {rtype.lower()}."})

    # business dates (read-only)
    def deadline(module: str, spec_key: str, rtype: str, field: str, skip, title: str, owner_attr: str | None, rows=None) -> None:
        if not p.can(module, "view"):
            return
        for r in (rows if rows is not None else _visible_rows(db, p, spec_key)):
            d = date_only(field(r) if callable(field) else getattr(r, field, None))
            if not d or skip(r):
                continue
            owner = getattr(r, owner_attr, None) if owner_attr else None
            name = finder.label(rtype, r)
            push({"id": f"deadline:{rtype}:{r.id}:{field if isinstance(field, str) else title}", "kind": "deadline", "type": title, "title": f"{title}: {name}", "date": d, "time": None, "endTime": None,
                  "state": "overdue" if d < today else "open", "status": title, "priority": None, "assignees": [owner] if owner else [], "relatedType": rtype, "relatedId": r.id, "relatedName": name,
                  "related": finder.chain(record_links(r, rtype)), "href": ROUTES[rtype].format(r.id), "hrefLabel": f"Open {rtype.lower()}", "source": {"type": "deadline", "recordType": rtype, "id": r.id},
                  "can": {}, "description": f"{title} date on the {rtype.lower()} record."})

    deadline("Invoices", "invoices", "Invoice", "due_date", lambda i: i.status in ("Paid", "Cancelled", "Void", "Draft") or float(i.amount or 0) - float(i.paid_amount or 0) <= 0, "Invoice due", None)
    deadline("Quotations", "quotations", "Quotation", "valid_until", lambda q: q.status in ("Accepted", "Rejected", "Expired", "Cancelled"), "Quotation valid until", "assigned_to")
    deadline("Proposals", "proposals", "Proposal", "valid_until", lambda x: x.status in ("Accepted", "Rejected", "Expired", "Draft"), "Proposal valid until", "assigned_to")
    deadline("Sales Orders", "salesOrders", "Sales Order", "expected_delivery_date", lambda s: s.status in ("Fulfilled", "Cancelled", "Delivered", "Invoiced"), "Delivery due", "salesperson")
    live = lambda c: c.status not in ("Active", "Expiring Soon", "Expired", "Signed", "Sent", "Approved")  # noqa: E731
    deadline("Contracts", "contracts", "Contract", "start_date", lambda c: c.status not in ("Signed", "Approved", "Sent", "Active") or (c.start_date and c.start_date.isoformat() < today), "Contract starts", "owner")
    deadline("Contracts", "contracts", "Contract", lambda c: (c.end_date - timedelta(days=int(c.notice_period_days))).isoformat() if c.end_date and c.notice_period_days else None, live, "Notice deadline", "owner")
    deadline("Contracts", "contracts", "Contract", "renewal_date", live, "Renewal due", "owner")
    deadline("Contracts", "contracts", "Contract", "end_date", live, "Contract ends", "owner")
    deadline("Campaigns", "campaigns", "Campaign", "start_date", lambda c: c.status not in ("Draft", "Scheduled"), "Campaign starts", "owner_id")
    deadline("Campaigns", "campaigns", "Campaign", "end_date", lambda c: c.status in ("Completed", "Cancelled", "Draft"), "Campaign ends", "owner_id")
    deadline("Projects", "projects", "Project", "deadline", lambda x: x.status in ("Completed", "Cancelled"), "Project deadline", "manager")

    # expenses: approval reminders, vendor payment due dates and reimbursement dates
    if p.can("Expenses", "view"):
        for e in db.execute(select(Expense).where(Expense.status.in_(("Submitted", "Under Review", "Approved")))).scalars():
            if not expense_svc.visible(db, p, e) or not expense_svc.perms_for(db, p, e)["viewFinancial"]:
                continue
            exp_links = {k: getattr(e, _snake(k), None) for k in ("customerId", "companyId", "contactId", "dealId", "invoiceId", "projectId", "contractId", "campaignId") if getattr(e, _snake(k), None)}

            def mk(key: str, title: str, d: str | None, text: str, who: list) -> None:
                if d:
                    push({"id": f"deadline:Expense:{e.id}:{key}", "kind": "deadline", "type": title, "title": f"{title}: {e.number} · {e.description}", "date": str(d)[:10], "time": None, "endTime": None,
                          "state": "overdue" if str(d)[:10] < today else "open", "status": title, "priority": None, "assignees": [w for w in who if w], "relatedType": "Expense", "relatedId": e.id,
                          "relatedName": e.number, "related": finder.chain(exp_links), "href": f"/expenses/{e.id}", "hrefLabel": "Open expense",
                          "source": {"type": "deadline", "recordType": "Expense", "id": e.id}, "can": {}, "description": text})

            attrs = e.attributes or {}
            if e.status in ("Submitted", "Under Review") and attrs.get("submittedAt"):
                due = datetime.fromisoformat(str(attrs["submittedAt"]).replace("Z", "+00:00")) + timedelta(days=2)
                mk("approval", "Expense approval due", local_date(due), f"Approval of {e.number} ({e.total}) is due.", [attrs.get("approverId")])
            if e.status == "Approved" and expense_svc.remaining_of(e) > 0:
                if e.kind == "Employee":
                    mk("reimburse", "Reimbursement due", attrs.get("reimbursementDueDate"), f"Reimburse for {e.number}.", [e.employee_id])
                else:
                    mk("vendorDue", "Vendor payment due", e.due_date.isoformat() if e.due_date else None, f"Pay the vendor for {e.number}.", [e.created_by])

    # documents that need a review by a date (only documents this person may see)
    rc = documents.RC(db, p)
    docs = list(db.execute(select(Document).where(Document.review_by.is_not(None), Document.status == "Active")).scalars())
    rc.preload_shares([d.id for d in docs])
    for d in docs:
        if not documents.evaluate(rc, d)["view"]:
            continue
        day = d.review_by.isoformat()
        links = {k: getattr(d, _snake(k), None) for k in ("enquiryId", "leadId", "contactId", "companyId", "dealId", "proposalId", "quotationId", "customerId", "salesOrderId", "invoiceId", "paymentId",
                                                         "contractId", "projectId") if getattr(d, _snake(k), None)}
        push({"id": f"deadline:Document:{d.id}:reviewBy", "kind": "deadline", "type": "Document review due", "title": f"Document review due: {d.name}", "date": day, "time": None, "endTime": None,
              "state": "overdue" if day < today else "open", "status": "Document review due", "priority": None, "assignees": [x for x in (d.assigned_to or d.owner_id,) if x], "relatedType": "Document",
              "relatedId": d.id, "relatedName": d.name, "related": finder.chain(links), "href": f"/documents/{d.id}", "hrefLabel": "Open document", "source": {"type": "deadline", "recordType": "Document", "id": d.id},
              "can": {}, "description": (d.attributes or {}).get("reviewNote") or "This document needs a review by this date."})

    events.sort(key=lambda e: f"{e['date']}T{e.get('time') or '00:00'}")
    return events


def _snake(key: str) -> str:
    return documents.R.snake(key)


def record_links(rec, rtype: str | None = None) -> dict:
    """The CRM records this record points at (read from its own link columns), plus itself."""
    links = {k: getattr(rec, _snake(k)) for k in LINK_KEY_TYPES if getattr(rec, _snake(k), None)}
    if rtype:
        links[LINK_KEY_REV[rtype]] = rec.id
    return links


def feed(db: Session, p: Principal, params: dict) -> dict:
    if not p.can("Calendar", "view"):
        raise forbidden("You do not have access to the calendar.")
    return {"events": build_events(db, p, params.get("from") or None, params.get("to") or None), "me": p.actor_id, "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}


def reschedule_followup(db: Session, p: Principal, req: dict) -> dict:
    """Moving a record's own next-follow-up date (drag on the calendar): the same rules as editing that record."""
    rtype, rid, day = req.get("recordType"), req.get("id"), str(req.get("date") or "")
    entry = FOLLOWUP_RECORDS.get(rtype)
    if not entry:
        raise invalid("That record type has no follow-up date.")
    try:
        new_day = date.fromisoformat(day)
    except ValueError:
        raise invalid("Choose a valid date.", {"date": "Choose a valid date."}) from None
    key, module, _ = entry
    if not p.can(module, "edit"):
        raise forbidden(f"You do not have permission to edit {module.lower()}.")
    spec = SPEC_BY_KEY[key]
    stmt = select(spec.model).where(spec.model.id == rid)
    extra = spec.row_filter(p) if spec.row_filter else None
    rec = db.execute(stmt.where(extra) if extra is not None else stmt).scalar_one_or_none()
    if rec is None:
        raise not_found("Record not found.")
    rec.next_follow_up = new_day
    db.commit()
    return {"id": rid, "nextFollowUp": day}
