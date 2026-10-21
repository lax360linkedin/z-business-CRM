"""Tasks: the work list. One record per task (the Calendar reads it directly; completing it writes the Activity). Everything the React task UI used to enforce in the
browser is enforced here: the 13-permission matrix, who can see what, status workflow, subtasks, recurrence, reminders and overdue alerts, and the audit events."""
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.config import get_settings
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import (Activity, AppSetting, Campaign, Company, Contact, Contract, Customer, Deal, Document, Employee, Enquiry, Expense, Invoice, Lead, Payment, Product, Project, Proposal, Quotation, SalesOrder,
                        SavedFilter, Task, TaskEvent, TaskPerson, User)
from app.services import timeline
from app.services.codec import to_json

STATUSES = ("To Do", "In Progress", "Waiting / On Hold", "Completed", "Cancelled", "Reopened")
OPEN = ("To Do", "In Progress", "Waiting / On Hold", "Reopened")
TRANSITIONS = {
    "To Do": ("In Progress", "Waiting / On Hold", "Completed", "Cancelled"), "In Progress": ("To Do", "Waiting / On Hold", "Completed", "Cancelled"),
    "Waiting / On Hold": ("To Do", "In Progress", "Completed", "Cancelled"), "Reopened": ("In Progress", "Waiting / On Hold", "Completed", "Cancelled"),
    "Completed": ("Reopened",), "Cancelled": ("Reopened",),
}
PRIORITIES = ("Low", "Medium", "High", "Urgent")
TYPES = ("General", "Milestone", "Call", "Email", "WhatsApp", "Meeting", "Follow-up", "Demo", "Proposal", "Quotation", "Payment Follow-up", "Document", "Review", "Site Visit")
VISIBILITY = ("Private", "Team", "Department", "Manager + Team", "Organization")
CONTACT_TYPES = ("Call", "Email", "WhatsApp", "Meeting", "Follow-up", "Demo")
MANAGER_ROLES = ("Admin", "MD", "Sales Manager", "Project Manager")
PERM_KEYS = ("view", "create", "edit", "complete", "reopen", "assign", "reassign", "delete", "changePriority", "changeDueDate", "viewTeam", "viewDepartment", "viewAll")
_ALL = {k: True for k in PERM_KEYS}
_NONE = {k: False for k in PERM_KEYS}
_DOER = {**_NONE, "view": True, "create": True, "edit": True, "complete": True, "reopen": True, "changePriority": True, "changeDueDate": True}
_MANAGER = {**_ALL, "viewAll": False}
_OVERSIGHT = {**_NONE, "view": True, "viewTeam": True, "viewDepartment": True, "viewAll": True}
DEFAULT_PERMISSIONS = {
    "Admin": _ALL, "MD": _OVERSIGHT, "CEO": _OVERSIGHT, "Sales Manager": _MANAGER, "Project Manager": _MANAGER, "HR": {**_DOER, "assign": True, "viewDepartment": True},
    "Sales Executive": _DOER, "Project Staff": _DOER, "Marketing": _DOER, "Accounts": _DOER, "Support": _DOER, "Employee": _DOER,
}
DEFAULT_AUTOMATION = {
    "newLead": {"enabled": True, "label": "New lead → initial follow-up task", "dueInDays": 1, "priority": "High", "lookbackDays": 14},
    "dealCreated": {"enabled": True, "label": "Deal created → requirement follow-up", "dueInDays": 2, "priority": "Medium", "lookbackDays": 14},
    "proposalSent": {"enabled": True, "label": "Proposal sent → proposal follow-up", "dueInDays": 3, "priority": "High", "lookbackDays": 14},
    "quotationSent": {"enabled": True, "label": "Quotation sent → quotation follow-up", "dueInDays": 3, "priority": "High", "lookbackDays": 14},
    "invoiceOverdue": {"enabled": True, "label": "Invoice overdue → payment follow-up", "dueInDays": 0, "priority": "Urgent", "lookbackDays": 60},
    "leadContacted": {"enabled": True, "label": "Lead contacted → suggest next follow-up", "suggestOnly": True},
    "taskOverdue": {"enabled": True, "label": "Task overdue → notify owner and manager", "notifyManager": True},
}
# Due-date reminders every assigned person gets before a task is due (minutes before the due moment). The administrator can switch each one on or off in Task settings.
REMINDER_CHOICES = (2880, 1440, 720, 300, 180, 60, 30, 15)
DEFAULT_REMINDERS = {"enabled": True, "intervals": [1440, 300, 60]}
UPLOAD_RULES = {"maxBytes": 1048576, "extensions": ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "png", "jpg", "jpeg"], "maxPerTask": 10}

# task related-record types -> (model, label attribute, link key)
RELATED = {
    "Enquiry": (Enquiry, "name", "enquiryId"), "Lead": (Lead, "name", "leadId"), "Deal": (Deal, "name", "dealId"), "Contact": (Contact, "name", "contactId"), "Company": (Company, "name", "companyId"),
    "Customer": (Customer, "name", "customerId"), "Proposal": (Proposal, "number", "proposalId"), "Quotation": (Quotation, "number", "quotationId"), "Sales Order": (SalesOrder, "number", "salesOrderId"),
    "Invoice": (Invoice, "number", "invoiceId"), "Payment": (Payment, "number", "paymentId"), "Expense": (Expense, "number", "expenseId"), "Product": (Product, "name", "productId"),
    "Campaign": (Campaign, "name", "campaignId"), "Project": (Project, "name", "projectId"), "Contract": (Contract, "number", "contractId"), "Document": (Document, "name", "documentId"),
}
LINK_ATTR = {key: re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower() for _, _, key in RELATED.values()}


@dataclass
class Actor:
    id: str | None
    name: str
    level: str = "Employee"
    job_role: str = "Employee"
    department: str = ""
    system: bool = False


SYSTEM = Actor(id=None, name="Automation", level="System", system=True)


def actor_of(p: Principal) -> Actor:
    return Actor(id=p.actor_id, name=p.name, level=p.level, job_role=p.user.job_role, department=p.user.department or "")


def iso(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).astimezone(UTC).isoformat().replace("+00:00", "Z")


def org_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().org_timezone)


def today() -> str:
    return datetime.now(UTC).astimezone(org_tz()).date().isoformat()


def nice_due(d: date | None, t: str | None = None) -> str:
    """'Fri 24 Oct 2026, 5:00 PM' (or just the date when the task has no time)."""
    if not d:
        return "no due date"
    out = f"{d.strftime('%a')} {d.day} {d.strftime('%b %Y')}"
    if t:
        hh, mm = (int(x) for x in t.split(":")[:2])
        out += f", {hh % 12 or 12}:{mm:02d} {'AM' if hh < 12 else 'PM'}"
    return out


def remaining_text(delta: timedelta) -> str:
    """'1 day 2 hours', '4 hours 30 minutes', '45 minutes' - what is left before the due moment."""
    minutes = max(0, int(delta.total_seconds() // 60))
    days, rest = divmod(minutes, 1440)
    hours, mins = divmod(rest, 60)
    plural = lambda n, w: f"{n} {w}{'' if n == 1 else 's'}"  # noqa: E731
    if days:
        return plural(days, "day") + (f" {plural(hours, 'hour')}" if hours else "")
    if hours:
        return plural(hours, "hour") + (f" {plural(mins, 'minute')}" if mins else "")
    return plural(max(mins, 1), "minute")


# ---- settings & permissions ----------------------------------------------------------------------------------------------
def settings(db: Session) -> dict:
    row = db.get(AppSetting, "task_settings")
    stored = row.value if row else {}
    automation = {k: {**v, **(stored.get("automation", {}).get(k) or {})} for k, v in DEFAULT_AUTOMATION.items()}
    return {"id": "default", "permissions": stored.get("permissions", {}), "automation": automation, "uploadRules": {**UPLOAD_RULES, **stored.get("uploadRules", {})},
            "managerNotifyOverdueDays": stored.get("managerNotifyOverdueDays", 3), "notifyManagerOnReminder": bool(stored.get("notifyManagerOnReminder")), "reminders": reminder_settings(stored.get("reminders")),
            "updatedAt": stored.get("updatedAt")}


def reminder_settings(stored: dict | None) -> dict:
    """The standard due-date reminders: switched on/off as a whole, and which intervals (minutes before the due moment) are used - only the offered choices, longest first."""
    stored = stored if isinstance(stored, dict) else {}
    wanted = stored.get("intervals", DEFAULT_REMINDERS["intervals"])
    intervals = sorted({int(m) for m in wanted if str(m).isdigit() and int(m) in REMINDER_CHOICES}, reverse=True) if isinstance(wanted, list) else list(DEFAULT_REMINDERS["intervals"])
    return {"enabled": bool(stored.get("enabled", True)), "intervals": intervals, "choices": list(REMINDER_CHOICES)}


def perms_of(db: Session, actor: Actor, module: dict | None = None) -> dict:
    if actor.system or actor.level == "Super Admin":
        return dict(_ALL)
    key = "Admin" if actor.level == "Admin" else actor.job_role
    base = {**_NONE, **DEFAULT_PERMISSIONS.get(key, _DOER), **settings(db)["permissions"].get(key, {})}
    if module is not None:  # the account's own module permission for Tasks narrows the role defaults
        if not module.get("view"):
            return dict(_NONE)
        if not module.get("create"):
            base["create"] = False
        if not module.get("edit"):
            base.update(edit=False, complete=False, changePriority=False, changeDueDate=False, assign=False, reassign=False)
        if not module.get("delete"):
            base["delete"] = False
    return base


def people(task: Task, kind: str) -> list[str]:
    return list((task.attributes or {}).get(kind, []))


def is_open(task: Task) -> bool:
    return task.status in OPEN


def due_dt(task: Task) -> datetime | None:
    if not task.due_date:
        return None
    return datetime.fromisoformat(f"{task.due_date.isoformat()}T{task.due_time or '23:59'}:00").replace(tzinfo=org_tz())


def is_overdue(task: Task, now: datetime | None = None) -> bool:
    d = due_dt(task)
    return bool(d and is_open(task) and d < (now or datetime.now(UTC)))


def days_late(task: Task, now: datetime) -> int:
    return (now.astimezone(org_tz()).date() - task.due_date).days


def overdue_level(task: Task, now: datetime) -> int:
    if not is_overdue(task, now):
        return -1
    days = days_late(task, now)
    return 7 if days >= 7 else 3 if days >= 3 else 1 if days >= 1 else 0


def overdue_label(task: Task, now: datetime) -> str | None:
    if not is_overdue(task, now):
        return None
    days = days_late(task, now)
    return "Overdue 7+ days" if days >= 7 else "Overdue 3+ days" if days >= 3 else f"Overdue {days} day{'s' if days > 1 else ''}" if days >= 1 else "Overdue today"


def reminder_at(due: str | None, due_time: str | None, minutes: str | None, custom: str | None) -> datetime | None:
    if minutes == "custom":
        return datetime.fromisoformat(custom.replace("Z", "+00:00")) if custom else None
    if not due or not minutes:
        return None
    return datetime.fromisoformat(f"{due}T{due_time or '09:00'}:00").replace(tzinfo=org_tz()) - timedelta(minutes=int(minutes))


def next_occurrence(due: date, rec: dict) -> date | None:
    n = max(1, int(rec.get("interval") or 1))
    freq = rec.get("frequency")
    if freq in ("daily", "custom"):
        return due + timedelta(days=n)
    if freq == "weekly":
        return due + timedelta(days=7 * n)
    if freq == "monthly":
        month = due.month - 1 + n
        year, month = due.year + month // 12, month % 12 + 1
        day = min(due.day, [31, 29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
        return date(year, month, day)
    return None


# ---- visibility ----------------------------------------------------------------------------------------------------------
def can_view(actor: Actor, perms: dict, task: Task) -> bool:
    if actor.system:
        return True
    if not perms["view"]:
        return False
    mine = task.created_by == actor.id or actor.id in people(task, "assignees") or actor.id in people(task, "watchers")
    if mine or perms["viewAll"]:
        return True
    same_team = bool(actor.department) and (task.department or "") == actor.department
    v = task.visibility
    if v == "Organization":
        return True
    if v == "Department":
        return perms["viewDepartment"] and (task.department == actor.department if task.department else same_team)
    if v == "Team":
        return perms["viewTeam"] and same_team
    if v == "Manager + Team":
        return (perms["viewTeam"] and same_team) or (actor.job_role in MANAGER_ROLES and perms["viewDepartment"] and same_team)
    return False


def can_act(actor: Actor, perms: dict, task: Task) -> bool:
    if actor.system or task.created_by == actor.id or actor.id in people(task, "assignees") or perms["viewAll"]:
        return True
    same_team = bool(actor.department) and (task.department or "") == actor.department
    return (perms["viewTeam"] or perms["viewDepartment"]) and same_team and (perms["edit"] or perms["complete"])


def caps_for(actor: Actor, perms: dict, task: Task) -> dict:
    acts, openness = can_act(actor, perms, task), is_open(task)
    claim = perms["edit"] and not people(task, "assignees") and can_view(actor, perms, task)
    return {
        "edit": acts and perms["edit"] and openness, "complete": acts and perms["complete"] and openness, "reopen": acts and perms["reopen"] and not openness, "cancel": acts and perms["edit"] and openness,
        "status": acts and perms["edit"] and openness, "assign": acts and perms["assign"] and openness, "reassign": acts and perms["reassign"] and openness, "claim": claim and openness,
        "delete": acts and perms["delete"], "changePriority": acts and perms["changePriority"] and openness, "changeDueDate": acts and perms["changeDueDate"] and openness,
        "comment": can_view(actor, perms, task), "attach": acts and (perms["edit"] or perms["create"]), "duplicate": acts and perms["create"],
    }


def guard(db: Session, actor: Actor, perms: dict, task: Task, need: str | None = None) -> dict:
    if not can_view(actor, perms, task):
        raise forbidden("You do not have access to this task.")
    caps = caps_for(actor, perms, task)
    if need and not caps.get(need):
        closed = not is_open(task) and need in ("edit", "complete", "cancel", "status", "assign", "reassign", "changePriority", "changeDueDate")
        if closed:
            raise conflict(f"This task is {task.status.lower()} - reopen it first.")
        raise forbidden("You do not have permission to do that on this task.")
    return caps


# ---- storage helpers -----------------------------------------------------------------------------------------------------
def get_task(db: Session, task_id: str) -> Task:
    task = db.execute(select(Task).where(Task.id == task_id)).scalar_one_or_none()
    if task is None:
        raise not_found("Task not found.")
    return task


def set_attrs(task: Task, **values) -> None:
    task.attributes = {**(task.attributes or {}), **values}


def sync_people(db: Session, task: Task) -> None:
    db.execute(delete(TaskPerson).where(TaskPerson.task_id == task.id))
    db.flush()
    rows = {(e, "assignee") for e in people(task, "assignees")} | {(e, "watcher") for e in people(task, "watchers")}
    for employee_id, kind in rows:
        db.add(TaskPerson(task_id=task.id, employee_id=employee_id, kind=kind))


def log_event(db: Session, task_id: str, actor: Actor, type: str, message: str, **extra) -> TaskEvent:
    event = TaskEvent(id=ids.new_id(db, "TEV", 6), task_id=task_id, type=type, by=actor.id, at=datetime.now(UTC), message=message[:2000], from_value=str(extra.pop("from", "") or "")[:300] or None,
                      to_value=str(extra.pop("to", "") or "")[:300] or None, data={k: v for k, v in extra.items() if v is not None})
    db.add(event)
    return event


def event_json(e: TaskEvent, names: dict) -> dict:
    return {"id": e.id, "taskId": e.task_id, "type": e.type, "by": e.by, "byName": names.get(e.by, "Automation" if e.by is None else e.by), "at": iso(e.at), "message": e.message, "from": e.from_value, "to": e.to_value, **(e.data or {})}


def names_of(db: Session, ids_: list[str | None] | None = None) -> dict:
    stmt = select(Employee.id, Employee.full_name)
    if ids_ is not None:
        stmt = stmt.where(Employee.id.in_([i for i in ids_ if i]))
    return {row[0]: row[1] for row in db.execute(stmt).all()}


def alert(db: Session, recipients: list[str | None], task: Task, type: str, message: str, actor_id: str | None, key: str | None = None) -> int:
    """One in-app notification per recipient (never the person who made the change). `key` identifies the event: the same event is never notified twice to the same person. The
    notification carries the recipient's own branch, so it is visible to them wherever the task was raised. Returns how many were created."""
    wanted = [r for r in dict.fromkeys(recipients) if r and r != actor_id]
    if not wanted:
        return 0
    home = {i: b for i, b in db.execute(select(Employee.id, Employee.branch).where(Employee.id.in_(wanted))).all()}
    made = 0
    for emp in wanted:
        if timeline.notify(db, user_id=emp, message=message, type=type, related_type="Task", related_id=task.id, branch=home.get(emp) or task.branch, task_id=task.id, dedupe_key=key):
            made += 1
    return made


def assignment_message(actor_name: str, task: Task) -> str:
    article = "an" if task.priority[:1].lower() in "aeiou" else "a"
    return f"{actor_name} assigned you {article} {task.priority}-priority task: “{task.title}” - due {nice_due(task.due_date, task.due_time)}"


def check_same_branch(db: Session, branch: str | None, ids_: list[str]) -> None:
    """A task belongs to one branch and can only be given to people of that branch (a person of another branch could neither open it nor be told about it)."""
    if not branch or not ids_:
        return
    outside = [name for name, b in db.execute(select(Employee.full_name, Employee.branch).where(Employee.id.in_(ids_))).all() if b and b != branch]
    if outside:
        raise invalid(f"{', '.join(outside)} work{'s' if len(outside) == 1 else ''} in another branch. A task can only be assigned to people of its own branch ({branch}).", {"assignees": "Pick people of this task's branch."})


def decorate(actor: Actor, perms: dict, task: Task, subs: dict[str, tuple[int, int]]) -> dict:
    out = to_json(task)
    total, done = subs.get(task.id, (0, 0))
    out.update(subtaskCount=total, subtasksDone=done, overdue=is_overdue(task), overdueLabel=overdue_label(task, datetime.now(UTC)), _can=caps_for(actor, perms, task))
    out.pop("attributes", None)
    return out


def subtask_counts(db: Session) -> dict[str, tuple[int, int]]:
    rows = db.execute(select(Task.parent_id, func.count(Task.id), func.sum(case((Task.status == "Completed", 1), else_=0))).where(Task.parent_id.is_not(None)).group_by(Task.parent_id)).all()
    return {r[0]: (r[1], int(r[2] or 0)) for r in rows}


def visible_tasks(db: Session, actor: Actor, perms: dict) -> list[Task]:
    stmt = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
    if not (perms["viewAll"] or actor.system):
        participant = select(TaskPerson.task_id).where(TaskPerson.employee_id == actor.id)
        stmt = stmt.where(or_(Task.created_by == actor.id, Task.id.in_(participant), Task.visibility == "Organization",
                              and_(Task.visibility.in_(("Department", "Team", "Manager + Team")), Task.department == (actor.department or ""))))
    return [t for t in db.execute(stmt).scalars() if can_view(actor, perms, t)]


# ---- related records ---------------------------------------------------------------------------------------------------
def resolve_related(db: Session, related_type: str | None, related_id: str | None) -> dict:
    if not related_type and not related_id:
        return {"relatedType": None, "relatedId": None, "relatedName": "", "links": {}}
    if related_type not in RELATED:
        raise invalid(f'"{related_type}" cannot be linked to a task.', {"relatedType": "Choose a CRM record type."})
    model, label, key = RELATED[related_type]
    record = db.execute(select(model).where(model.id == related_id)).scalar_one_or_none()
    if record is None:
        raise not_found(f"That {str(related_type).lower()} no longer exists.")
    links = {key: record.id}
    for link_key, attr in LINK_ATTR.items():
        value = getattr(record, attr, None)
        if value and link_key != key:
            links[link_key] = value
    return {"relatedType": related_type, "relatedId": record.id, "relatedName": str(getattr(record, label, "") or record.id)[:240], "links": links, "branch": getattr(record, "branch", None)}


def active_employee_ids(db: Session, wanted: list[str]) -> list[str]:
    if not wanted:
        return []
    found = {r[0] for r in db.execute(select(Employee.id).where(Employee.id.in_(wanted), Employee.status.in_(("Active", "Probation", "On Leave", "Remote")))).all()}
    return [i for i in wanted if i in found]


def expand_team(db: Session, team: dict | None, branch: str | None = None) -> list[str]:
    if not team or not team.get("value"):
        return []
    if team.get("kind") == "role":
        stmt = select(User.employee_id).where(User.job_role == team["value"], User.status == "Active")
    else:
        stmt = select(User.employee_id).where(User.department == team["value"], User.status == "Active")
    if branch:
        stmt = stmt.where(User.branch == branch)
    return [r[0] for r in db.execute(stmt).all()]


def validate(data: dict) -> None:
    errors = {}
    title = str(data.get("title") or "").strip()
    if not title:
        errors["title"] = "Give the task a title."
    elif len(title) > 160:
        errors["title"] = "Title is too long (max 160)."
    if data.get("description") and len(data["description"]) > 4000:
        errors["description"] = "Description is limited to 4000 characters."
    if data.get("priority") and data["priority"] not in PRIORITIES:
        errors["priority"] = "Invalid priority."
    if data.get("taskType") and data["taskType"] not in TYPES:
        errors["taskType"] = "Invalid task type."
    if data.get("visibility") and data["visibility"] not in VISIBILITY:
        errors["visibility"] = "Invalid visibility."
    if data.get("dueDate") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(data["dueDate"])):
        errors["dueDate"] = "Enter a valid due date."
    if data.get("startDate") and data.get("dueDate") and str(data["startDate"]) > str(data["dueDate"]):
        errors["dueDate"] = "Due date cannot be before the start date."
    if data.get("dueTime") and not re.fullmatch(r"\d{2}:\d{2}", str(data["dueTime"])):
        errors["dueTime"] = "Enter a valid time."
    if data.get("reminderMinutes") and data["reminderMinutes"] != "custom" and not data.get("dueDate"):
        errors["reminderMinutes"] = "A reminder needs a due date."
    if data.get("reminderMinutes") == "custom" and not data.get("customReminderAt"):
        errors["customReminderAt"] = "Pick the reminder date and time."
    rec = data.get("recurrence") or {}
    if rec.get("frequency") and rec["frequency"] != "none" and not data.get("dueDate"):
        errors["recurrence"] = "A repeating task needs a due date."
    if errors:
        raise invalid(next(iter(errors.values())), errors)


# ---- create ----------------------------------------------------------------------------------------------------------------
def create_task(db: Session, actor: Actor, perms: dict, data: dict, *, branch: str | None = None, automation_key: str | None = None, source: str = "manual", message: str | None = None,
                duplicate_of: str | None = None, allow_duplicate: bool = False, recurring_root: str | None = None, recurrence_key: str | None = None, activity_id: str | None = None) -> Task:
    if not actor.system and not perms["create"]:
        raise forbidden("You do not have permission to create tasks.")
    data = dict(data)
    if data.get("assignedTo") and not data.get("assignees"):
        data["assignees"] = [data["assignedTo"]]
    validate(data)
    rel = resolve_related(db, data.get("relatedType"), data.get("relatedId"))
    parent = None
    if data.get("parentId"):
        parent = get_task(db, data["parentId"])
        if parent.parent_id:
            raise invalid("Subtasks cannot have their own subtasks.", {"parentId": "Only one level of subtasks."})
        if not actor.system:
            guard(db, actor, perms, parent, "edit")
    task_branch = rel.get("branch") or (parent.branch if parent else None) or branch
    assignees = None
    if data.get("assignees") is not None:
        assignees = active_employee_ids(db, list(data["assignees"]))
        if len(assignees) != len(set(data["assignees"])):
            raise invalid("One of the selected users is not an active user.", {"assignees": "Pick active users only."})
    team = data.get("assignedTeam") if isinstance(data.get("assignedTeam"), dict) and data["assignedTeam"].get("value") else None
    if team and not assignees:
        assignees = expand_team(db, team, task_branch)
    if assignees is None:
        assignees = [] if actor.system else [actor.id]
    if not actor.system and any(a != actor.id for a in assignees) and not perms["assign"]:
        raise forbidden("You do not have permission to assign tasks to other people.")
    if not actor.system:
        check_same_branch(db, task_branch, assignees)
    links = {**(rel["links"] or {}), **{k: v for k, v in (data.get("links") or {}).items() if k in ("productId", "campaignId", "projectId") and k not in (rel["links"] or {})}} if rel["links"] or not parent else dict((parent.attributes or {}).get("links") or {})
    watchers = [w for w in active_employee_ids(db, list(data.get("watchers") or [])) if w not in assignees]
    rec_in = data.get("recurrence") or {}
    rec = {"frequency": rec_in.get("frequency"), "interval": min(365, max(1, int(rec_in.get("interval") or 1)))} if rec_in.get("frequency") not in (None, "none") else {"frequency": "none", "interval": 1}
    if rec["frequency"] != "none" and rec["frequency"] not in ("daily", "weekly", "monthly", "custom"):
        raise invalid("Invalid recurrence.", {"recurrence": "Invalid recurrence."})
    if parent and rec["frequency"] != "none":
        raise invalid("A subtask cannot repeat on its own - repeat the parent task instead.", {"recurrence": "Not allowed on a subtask."})

    title = str(data["title"]).strip()
    if not automation_key and not allow_duplicate:
        cutoff = datetime.now(UTC) - timedelta(seconds=15)
        recent = db.execute(select(Task).where(Task.created_by == actor.id, Task.title == title, Task.created_at >= cutoff)).scalars().all()
        if any((t.related_id == rel["relatedId"] and (t.due_date.isoformat() if t.due_date else None) == (data.get("dueDate") or None) and set(people(t, "assignees")) == set(assignees)) for t in recent):
            raise conflict("This task was just created.")
    if automation_key and db.execute(select(Task.id).where(Task.automation_key == automation_key)).first():
        raise conflict("Automation already created this task.")

    task = Task(
        id=ids.new_id(db, "TSK", 5), title=title, description=str(data.get("description") or "").strip(), task_type=data.get("taskType") or "General", priority=data.get("priority") or "Medium", status="To Do",
        start_date=date.fromisoformat(data["startDate"]) if data.get("startDate") else None, due_date=date.fromisoformat(data["dueDate"]) if data.get("dueDate") else None, due_time=data.get("dueTime") or None,
        reminder_minutes=data.get("reminderMinutes") or "", reminder_at=reminder_at(data.get("dueDate"), data.get("dueTime"), data.get("reminderMinutes"), data.get("customReminderAt")),
        assigned_to=assignees[0] if assignees else None, department="", visibility=data.get("visibility") or "Team",
        related_type=rel["relatedType"], related_id=rel["relatedId"], related_name=rel["relatedName"], parent_id=parent.id if parent else None, source=source, automation_key=automation_key,
        recurrence_key=recurrence_key, activity_id=activity_id, created_by=actor.id, branch=task_branch,
        attributes={"taskV2": True, "assignees": assignees, "watchers": watchers, "links": links, "recurrence": rec, "assignedTeam": {"kind": "role" if team and team.get("kind") == "role" else "department", "value": team["value"]} if team else None,
                    "attachments": [], "customReminderAt": data.get("customReminderAt") if data.get("reminderMinutes") == "custom" else None, "recurringRootId": recurring_root, "duplicateOf": duplicate_of},
    )
    # the department of a task is the department NAME of its first assignee (or of whoever created it): visibility "Department / Team" is judged against it
    dept_user = db.execute(select(User.department).where(User.employee_id == (assignees[0] if assignees else actor.id))).scalar_one_or_none()
    task.department = dept_user or actor.department or ""
    db.add(task)
    db.flush()
    sync_people(db, task)
    log_event(db, task.id, actor, "Created", message or (f"Subtask created under {parent.id}" if parent else "Task created"), to=title)
    assigned_event = log_event(db, task.id, actor, "Assigned", f"Assigned to {', '.join(names_of(db, assignees).get(a, a) for a in assignees)}") if assignees else None
    if parent:
        log_event(db, parent.id, actor, "Subtask Added", f"Subtask added: {title}", to=task.id)
    if assigned_event is not None:  # tell each assignee (not the person who made the assignment): who assigned it, the title, the priority and when it is due; once per assignment event
        alert(db, assignees, task, "Task Assigned", assignment_message(actor.name, task), actor.id, key=f"task-assign:{task.id}:{assigned_event.id}")
    # keep the linked record's follow-up bookkeeping in step
    if rel["relatedType"] and task.due_date and task.task_type in CONTACT_TYPES:
        model = RELATED[rel["relatedType"]][0]
        record = db.execute(select(model).where(model.id == rel["relatedId"])).scalar_one_or_none()
        if record is not None and hasattr(record, "next_follow_up") and (record.next_follow_up is None or record.next_follow_up > task.due_date or record.next_follow_up < date.today()):
            record.next_follow_up = task.due_date
    return task


# ---- edit ------------------------------------------------------------------------------------------------------------------
def _fmt(d, t=None) -> str:
    return f"{d}{' ' + t if t else ''}" if d else "none"


def edit_task(db: Session, actor: Actor, perms: dict, task: Task, data: dict) -> Task:
    claiming = not people(task, "assignees") and isinstance(data.get("assignees"), list) and data["assignees"] == [actor.id] and set(data) <= {"assignees", "assignedTeam", "reason"}
    guard(db, actor, perms, task, "claim" if claiming else "edit")
    merged = {**to_json(task), **data}
    validate({**merged, "recurrence": data.get("recurrence", (task.attributes or {}).get("recurrence"))})
    events: list[tuple[str, str, dict]] = []
    changes: list[str] = []  # what the people already on the task are told about (priority, due date)
    before_assignees = people(task, "assignees")
    notify_new: list[str] = []  # people newly given the task
    notify_dropped: list[str] = []

    for field, label in (("title", "Title"), ("description", "Description")):
        if field in data:
            value = str(data[field] or "").strip()
            if value != (getattr(task, field) or ""):
                events.append(("Description Updated" if field == "description" else "Updated", f"{label} changed", {"field": field, "from": getattr(task, field) or "-", "to": value or "-"}))
                setattr(task, field, value)
    if "taskType" in data and data["taskType"] != task.task_type:
        events.append(("Updated", "Task type changed", {"field": "taskType", "from": task.task_type, "to": data["taskType"]}))
        task.task_type = data["taskType"]
    if "visibility" in data and data["visibility"] != task.visibility:
        events.append(("Updated", "Visibility changed", {"field": "visibility", "from": task.visibility, "to": data["visibility"]}))
        task.visibility = data["visibility"]
    if "startDate" in data and (data["startDate"] or None) != (task.start_date.isoformat() if task.start_date else None):
        events.append(("Updated", "Start date changed", {"field": "startDate", "from": task.start_date or "-", "to": data["startDate"] or "-"}))
        task.start_date = date.fromisoformat(data["startDate"]) if data["startDate"] else None
    if "priority" in data and data["priority"] != task.priority:
        if not perms["changePriority"]:
            raise forbidden("You do not have permission to change the priority.")
        events.append(("Priority Changed", f"Priority changed to {data['priority']}", {"field": "priority", "from": task.priority, "to": data["priority"]}))
        changes.append(f"priority {task.priority} → {data['priority']}")
        task.priority = data["priority"]
    due_changed = ("dueDate" in data and (data["dueDate"] or None) != (task.due_date.isoformat() if task.due_date else None)) or ("dueTime" in data and (data["dueTime"] or None) != task.due_time)
    old_due = (task.due_date, task.due_time)
    if due_changed:
        if not perms["changeDueDate"]:
            raise forbidden("You do not have permission to change the due date.")
        new_due = date.fromisoformat(data["dueDate"]) if data.get("dueDate") else (None if "dueDate" in data else task.due_date)
        new_time = (data.get("dueTime") or None) if "dueTime" in data else task.due_time
        task.due_date, task.due_time = new_due, new_time
        # a new due moment starts over: the overdue alerts and the standard reminders are recalculated, and only reminders that are still ahead of us (from now) will be sent
        set_attrs(task, overdueNotified=None, dueReminders=None, dueChangedAt=iso())
        events.append(("Due Date Changed", "Due date changed", {"field": "dueDate", "from": _fmt(old_due[0], old_due[1]), "to": _fmt(new_due, new_time)}))
        changes.append(f"due date {nice_due(old_due[0], old_due[1])} → {nice_due(new_due, new_time)}")
    if due_changed or "reminderMinutes" in data or "customReminderAt" in data:
        minutes = data.get("reminderMinutes", task.reminder_minutes)
        custom = data.get("customReminderAt", (task.attributes or {}).get("customReminderAt"))
        at = reminder_at(task.due_date.isoformat() if task.due_date else None, task.due_time, minutes, custom)
        if at != task.reminder_at:
            task.reminder_at, task.reminded_at = at, None
            if "reminderMinutes" in data and data["reminderMinutes"] != task.reminder_minutes:
                events.append(("Updated", "Reminder changed", {"field": "reminder", "from": task.reminder_minutes or "none", "to": minutes or "none"}))
        task.reminder_minutes = minutes or ""
        set_attrs(task, customReminderAt=custom if minutes == "custom" else None)
    if "recurrence" in data:
        freq = (data["recurrence"] or {}).get("frequency") or "none"
        if freq not in ("none", "daily", "weekly", "monthly", "custom"):
            raise invalid("Invalid recurrence.")
        if freq != "none" and task.parent_id:
            raise invalid("A subtask cannot repeat on its own - repeat the parent task instead.")
        rec = {"frequency": "none", "interval": 1} if freq == "none" else {"frequency": freq, "interval": min(365, max(1, int(data["recurrence"].get("interval") or 1)))}
        if rec != (task.attributes or {}).get("recurrence"):
            events.append(("Updated", "Recurrence changed", {"field": "recurrence", "from": ((task.attributes or {}).get("recurrence") or {}).get("frequency", "none"), "to": rec["frequency"]}))
            set_attrs(task, recurrence=rec)
    if "watchers" in data:
        watchers = [w for w in active_employee_ids(db, list(data["watchers"] or [])) if w not in people(task, "assignees")]
        if set(watchers) != set(people(task, "watchers")):
            set_attrs(task, watchers=watchers)
            events.append(("Updated", f"Followers updated ({len(watchers)})", {"field": "watchers"}))
    if "relatedType" in data or "relatedId" in data:
        rel = resolve_related(db, data.get("relatedType"), data.get("relatedId"))
        if (rel["relatedId"], rel["relatedType"]) != (task.related_id, task.related_type):
            task.related_type, task.related_id, task.related_name = rel["relatedType"], rel["relatedId"], rel["relatedName"]
            set_attrs(task, links=rel["links"])
            events.append(("Updated", "Related record changed", {"field": "related", "to": rel["relatedName"] or "-"}))
    if "assignees" in data or "assignedTeam" in data:
        team = data.get("assignedTeam") if isinstance(data.get("assignedTeam"), dict) and data["assignedTeam"].get("value") else None
        nxt = active_employee_ids(db, list(data["assignees"])) if data.get("assignees") is not None else []
        if data.get("assignees") is not None and len(nxt) != len(set(data["assignees"])):
            raise invalid("One of the selected users is not an active user.")
        if team and not nxt:
            nxt = expand_team(db, team, task.branch)
        prev = people(task, "assignees")
        if set(prev) != set(nxt):
            self_claim = not prev and nxt == [actor.id] and perms["edit"]
            if (not perms["reassign"]) if prev else not (perms["assign"] or self_claim):
                raise forbidden("You do not have permission to reassign tasks." if prev else "You do not have permission to assign tasks.")
            check_same_branch(db, task.branch, nxt)
            names = names_of(db)
            set_attrs(task, assignees=nxt, assignedTeam={"kind": "role" if team and team.get("kind") == "role" else "department", "value": team["value"]} if team else None)
            task.assigned_to = nxt[0] if nxt else None
            events.append(("Reassigned" if prev else "Assigned", f"{'Reassigned' if prev else 'Assigned'} to {', '.join(names.get(i, i) for i in nxt) or 'nobody'}",
                           {"field": "assignees", "from": ", ".join(names.get(i, i) for i in prev) or "Unassigned", "to": ", ".join(names.get(i, i) for i in nxt) or "Unassigned", "reason": str(data.get("reason") or "")[:300] or None}))
            notify_new = [i for i in nxt if i not in prev]
            notify_dropped = [i for i in prev if i not in nxt]
    if not events and not db.dirty:
        return task
    db.flush()
    sync_people(db, task)
    logged = [log_event(db, task.id, actor, type_, message, **extra) for type_, message, extra in events]
    db.flush()
    # notifications: each is tied to the event that caused it, so the same change is never announced twice to the same person
    assign_event = next((e for e in logged if e.type in ("Assigned", "Reassigned")), None)
    if assign_event is not None:
        alert(db, notify_new, task, "Task Assigned", assignment_message(actor.name, task), actor.id, key=f"task-assign:{task.id}:{assign_event.id}")
        alert(db, notify_dropped, task, "Task Updated", f"{actor.name} reassigned “{task.title}” to someone else - it is no longer on your list.", actor.id, key=f"task-unassign:{task.id}:{assign_event.id}")
    if changes:
        stay = [i for i in people(task, "assignees") if i in before_assignees]  # people newly assigned already got the full assignment message
        change_event = next((e for e in logged if e.type in ("Priority Changed", "Due Date Changed")), None)
        alert(db, stay, task, "Task Updated", f"{actor.name} changed “{task.title}”: {'; '.join(changes)}. Now {task.priority} priority, due {nice_due(task.due_date, task.due_time)}.", actor.id,
              key=f"task-update:{task.id}:{change_event.id}" if change_event else None)
    if due_changed and task.activity_id:
        activity = db.get(Activity, task.activity_id)
        if activity is not None and task.due_date:
            activity.date = datetime.fromisoformat(f"{task.due_date.isoformat()}T{task.due_time or '09:00'}:00").replace(tzinfo=UTC)
    return task


# ---- status ----------------------------------------------------------------------------------------------------------------
def open_subtasks(db: Session, task_id: str) -> list[Task]:
    return list(db.execute(select(Task).where(Task.parent_id == task_id, Task.status.in_(OPEN))).scalars())


def record_completion_activity(db: Session, actor: Actor, task: Task) -> str | None:
    note = (task.attributes or {}).get("completionNote") or ""
    linked = db.get(Activity, task.activity_id) if task.activity_id else None
    if linked is not None:
        linked.status = "Completed"
        linked.attributes = {**(linked.attributes or {}), "completedAt": iso(), "completedBy": actor.id, "outcomeNotes": note or None}
        return linked.id
    if not task.related_type or not task.related_id:
        return None
    existing_id = (task.attributes or {}).get("completionActivityId")
    entry = timeline.log_activity(db, related_type=task.related_type, related_id=task.related_id, related_name=task.related_name, type="Task", subject=f"Task completed: {task.title}", by=actor.id,
                                  branch=task.branch, notes=note, source="task", assigned_to=task.assigned_to or actor.id, extra={"taskId": task.id, "dueDate": task.due_date.isoformat() if task.due_date else None,
                                                                                                                        "taskType": task.task_type, "links": (task.attributes or {}).get("links") or {}})
    if existing_id:
        old = db.get(Activity, existing_id)
        if old is not None:
            db.delete(old)
    return entry.id


def change_status(db: Session, actor: Actor, perms: dict, task: Task, to: str, *, reason: str = "", force: bool = False, via_activity: bool = False) -> Task:
    need = {"Completed": "complete", "Reopened": "reopen", "Cancelled": "cancel"}.get(to, "status")
    if not actor.system:
        guard(db, actor, perms, task)
    if to not in STATUSES:
        raise invalid("Unknown status.")
    if to == task.status:
        raise conflict(f"This task is already {to}.")
    if to not in TRANSITIONS.get(task.status, ()):
        raise conflict(f"A {task.status} task cannot move to {to}.")
    if not actor.system:
        guard(db, actor, perms, task, need)
    reason = (reason or "").strip()
    if to == "Cancelled" and not reason:
        raise invalid("Give a reason for cancelling.", {"reason": "Required."})
    if to == "Completed" and not force:
        pending = open_subtasks(db, task.id)
        if pending:
            raise ApiError(409, f"{len(pending)} subtask{'s are' if len(pending) > 1 else ' is'} still open. Finish them first, or complete anyway.", "OPEN_SUBTASKS")
    previous, now = task.status, datetime.now(UTC)
    task.status = to
    if to == "Completed":
        task.completed_at, task.completed_by = now, actor.id
        set_attrs(task, completionNote=reason or None, cancelReason=None)
    elif to == "Cancelled":
        set_attrs(task, cancelledAt=iso(now), cancelledBy=actor.id, cancelReason=reason)
    elif to == "Reopened":
        task.completed_at = task.completed_by = task.reminded_at = None
        set_attrs(task, completionNote=None, cancelledAt=None, cancelledBy=None, cancelReason=None, reopenedAt=iso(now), reopenedBy=actor.id, overdueNotified=None)
    db.flush()
    log_event(db, task.id, actor, {"Completed": "Completed", "Reopened": "Reopened", "Cancelled": "Cancelled"}.get(to, "Status Changed"), f"{previous} → {to}{' — ' + reason if reason else ''}", field="status", **{"from": previous, "to": to}, reason=reason or None)
    watchers, assignees = people(task, "watchers"), people(task, "assignees")
    if to == "Completed":
        activity_id = task.activity_id if via_activity else record_completion_activity(db, actor, task)
        if activity_id and not task.activity_id:
            set_attrs(task, completionActivityId=activity_id)
        if task.task_type in CONTACT_TYPES and task.related_type:
            model = RELATED[task.related_type][0]
            record = db.execute(select(model).where(model.id == task.related_id)).scalar_one_or_none()
            if record is not None and hasattr(record, "last_contacted_date"):
                record.last_contacted_date = date.today()
        spawn_next_occurrence(db, actor, task)
        alert(db, [task.created_by, *watchers], task, "Task Completed", f"{actor.name} completed “{task.title}”", actor.id)
    elif to == "Reopened":
        existing_id = (task.attributes or {}).get("completionActivityId")
        if task.activity_id and (linked := db.get(Activity, task.activity_id)) is not None:
            linked.status = "Scheduled"
        if existing_id and (old := db.get(Activity, existing_id)) is not None:
            db.delete(old)
        set_attrs(task, completionActivityId=None)
        alert(db, [*assignees, task.created_by], task, "Task Assigned", f"{actor.name} reopened “{task.title}”", actor.id)
    elif to == "Cancelled":
        if task.activity_id and not via_activity and (linked := db.get(Activity, task.activity_id)) is not None:
            linked.status = "Cancelled"
        alert(db, [*assignees, task.created_by], task, "Task Assigned", f"{actor.name} cancelled “{task.title}”", actor.id)
    return task


def spawn_next_occurrence(db: Session, actor: Actor, task: Task) -> Task | None:
    rec = (task.attributes or {}).get("recurrence") or {}
    if rec.get("frequency") in (None, "none") or not task.due_date:
        return None
    due = next_occurrence(task.due_date, rec)
    if due is None:
        return None
    root = (task.attributes or {}).get("recurringRootId") or task.id
    key = f"{root}:{due.isoformat()}"
    if db.execute(select(Task.id).where(Task.recurrence_key == key)).first():
        return None
    shift = (due - task.due_date).days
    start = (task.start_date + timedelta(days=shift)).isoformat() if task.start_date else None
    nxt = create_task(db, SYSTEM, _ALL, {
        "title": task.title, "description": task.description, "taskType": task.task_type, "priority": task.priority, "startDate": start, "dueDate": due.isoformat(), "dueTime": task.due_time,
        "reminderMinutes": "" if task.reminder_minutes == "custom" else task.reminder_minutes, "assignees": people(task, "assignees"), "visibility": task.visibility, "watchers": people(task, "watchers"),
        "relatedType": task.related_type, "relatedId": task.related_id, "recurrence": rec, "links": (task.attributes or {}).get("links")}, branch=task.branch, source="recurring", allow_duplicate=True,
        recurring_root=root, recurrence_key=key, message=f"Created automatically - {rec['frequency']} recurrence of {task.id}")
    for sub in db.execute(select(Task).where(Task.parent_id == task.id)).scalars().all():
        create_task(db, SYSTEM, _ALL, {"title": sub.title, "taskType": sub.task_type, "priority": sub.priority, "assignees": people(sub, "assignees"), "dueDate": due.isoformat(), "parentId": nxt.id, "visibility": nxt.visibility},
                    branch=task.branch, allow_duplicate=True, source="recurring")
    set_attrs(task, nextTaskId=nxt.id)
    log_event(db, task.id, actor, "Recurring Created", f"Next {rec['frequency']} occurrence created: {nxt.id} (due {due.isoformat()})", to=nxt.id)
    return nxt


def sync_from_activity(db: Session, task_id: str | None, change: dict, actor: Actor) -> None:
    """The Activities module reports a linked activity being completed / cancelled / rescheduled, so the task never drifts."""
    task = db.get(Task, task_id) if task_id else None
    if task is None:
        return
    system = Actor(id=actor.id, name=actor.name, level="System", system=True)
    if change.get("status") == "Completed" and is_open(task):
        change_status(db, system, _ALL, task, "Completed", via_activity=True, force=True, reason=change.get("notes") or "")
    elif change.get("status") == "Cancelled" and is_open(task):
        change_status(db, system, _ALL, task, "Cancelled", via_activity=True, reason=change.get("reason") or "Cancelled from the activity")
    elif change.get("dueDate") and change["dueDate"] != (task.due_date.isoformat() if task.due_date else None):
        old = task.due_date
        task.due_date = date.fromisoformat(change["dueDate"])
        task.reminder_at, task.reminded_at = reminder_at(change["dueDate"], task.due_time, task.reminder_minutes, (task.attributes or {}).get("customReminderAt")), None
        log_event(db, task.id, actor, "Due Date Changed", "Due date changed", field="dueDate", **{"from": _fmt(old, task.due_time), "to": _fmt(task.due_date, task.due_time)})


# ---- comments, directory, summary ----------------------------------------------------------------------------------------
def add_comment(db: Session, actor: Actor, perms: dict, task: Task, data: dict) -> TaskEvent:
    guard(db, actor, perms, task, "comment")
    text = str(data.get("text") or "").strip()
    if not text:
        raise invalid("Write a comment first.", {"text": "Required."})
    if len(text) > 2000:
        raise invalid("Comments are limited to 2000 characters.", {"text": "Too long."})
    mentions = active_employee_ids(db, list(data.get("mentions") or []))
    internal = bool(data.get("internal"))
    event = log_event(db, task.id, actor, "Internal Note" if internal else "Comment", "Internal note added" if internal else "Comment added", text=text, mentions=mentions, internal=internal)
    newly = [m for m in mentions if m not in people(task, "assignees") and m not in people(task, "watchers") and task.created_by != m]
    if newly:
        set_attrs(task, watchers=[*people(task, "watchers"), *newly])
        sync_people(db, task)
    alert(db, mentions, task, "Task Mention", f"{actor.name} mentioned you on “{task.title}”: {text[:80]}", actor.id)
    alert(db, [m for m in [*people(task, "assignees"), task.created_by] if m not in mentions], task, "Task Comment", f"{actor.name} commented on “{task.title}”", actor.id)
    return event


def directory(db: Session, actor: Actor, perms: dict) -> dict:
    open_tasks = [t for t in db.execute(select(Task).where(Task.status.in_(OPEN))).scalars()]
    now = datetime.now(UTC)
    rows = []
    for u in db.execute(select(User).where(User.status == "Active")).scalars().unique():
        mine = [t for t in open_tasks if u.employee_id in people(t, "assignees")]
        rows.append({"id": u.employee_id, "name": u.name, "role": u.job_role, "department": u.department, "designation": u.employee.designation if u.employee else "", "email": u.email,
                     "active": len(mine), "overdue": sum(1 for t in mine if is_overdue(t, now)), "isMe": u.employee_id == actor.id})

    def group(key: str) -> list[dict]:
        out = []
        for value in sorted({r[key] for r in rows if r[key]}):
            members = [r for r in rows if r[key] == value]
            out.append({"value": value, "kind": "role" if key == "role" else "department", "members": [m["id"] for m in members], "active": sum(m["active"] for m in members), "overdue": sum(m["overdue"] for m in members)})
        return out

    return {"users": rows, "departments": group("department"), "roles": group("role"), "canAssignOthers": perms["assign"]}


def summary(db: Session, actor: Actor, perms: dict) -> dict:
    tasks = visible_tasks(db, actor, perms)
    now, t0 = datetime.now(UTC), today()
    open_ = [t for t in tasks if is_open(t)]
    metrics = {
        "total": len(tasks), "mine": sum(1 for t in open_ if actor.id in people(t, "assignees")), "dueToday": sum(1 for t in open_ if t.due_date and t.due_date.isoformat() == t0),
        "upcoming": sum(1 for t in open_ if t.due_date and t.due_date.isoformat() > t0), "overdue": sum(1 for t in open_ if is_overdue(t, now)), "highPriority": sum(1 for t in open_ if t.priority in ("High", "Urgent")),
        "inProgress": sum(1 for t in tasks if t.status == "In Progress"), "completed": sum(1 for t in tasks if t.status == "Completed"), "unassigned": sum(1 for t in open_ if not people(t, "assignees")),
        "cancelled": sum(1 for t in tasks if t.status == "Cancelled"),
    }
    team = []
    for u in db.execute(select(User).where(User.status == "Active")).scalars().unique():
        if not (perms["viewAll"] or u.employee_id == actor.id or ((perms["viewTeam"] or perms["viewDepartment"]) and u.department == actor.department)):
            continue
        mine = [t for t in tasks if u.employee_id in people(t, "assignees")]
        m_open = [t for t in mine if is_open(t)]
        row = {"userId": u.employee_id, "name": u.name, "role": u.job_role, "department": u.department, "pending": sum(1 for t in m_open if t.status != "In Progress"), "inProgress": sum(1 for t in m_open if t.status == "In Progress"),
               "overdue": sum(1 for t in m_open if is_overdue(t, now)), "dueToday": sum(1 for t in m_open if t.due_date and t.due_date.isoformat() == t0), "completed": sum(1 for t in mine if t.status == "Completed"), "open": len(m_open)}
        if row["open"] or row["completed"] or row["userId"] == actor.id:
            team.append(row)
    team.sort(key=lambda r: (-r["overdue"], -r["open"]))
    return {"metrics": metrics, "team": team, "scope": "organization" if perms["viewAll"] else "team" if (perms["viewTeam"] or perms["viewDepartment"]) else "own"}


# ---- engine ----------------------------------------------------------------------------------------------------------------
def managers_of(db: Session, task: Task) -> list[str]:
    dept = task.department
    if not dept:
        return []
    rows = db.execute(select(User.employee_id, User.job_role, User.access_level).where(User.status == "Active", User.department == dept)).all()
    return [r[0] for r in rows if (r[2] == "Admin" or r[1] in MANAGER_ROLES) and r[0] not in people(task, "assignees")]


def interval_label(minutes: int) -> str:
    """1440 -> '1 day', 300 -> '5 hours', 60 -> '1 hour', 30 -> '30 minutes'."""
    unit, size = ("day", 1440) if minutes >= 1440 and minutes % 1440 == 0 else ("hour", 60) if minutes >= 60 and minutes % 60 == 0 else ("minute", 1)
    n = minutes // size
    return f"{n} {unit}{'' if n == 1 else 's'}"


def due_reminders(db: Session, now: datetime, st: dict) -> int:
    """The standard due-date reminders (1 day, 5 hours and 1 hour before, as set in Task settings), sent in-app to the people the task is assigned to.

    * based on the task's real due moment (its date and time in the organisation's time zone; a task with no time is due at the end of that day);
    * only reminders still ahead when the due moment was set: a task raised 40 minutes before it is due never gets the 1-day or 5-hour reminder;
    * if the engine was not running at the exact moment, the reminder is sent as soon as it runs, saying how much time is really left - and only the closest applicable one is sent
      (the longer ones that were also missed are marked done, not sent late);
    * every reminder goes out once per task, person and interval (recorded on the task and as a notification key); changing the due date starts over and drops the old ones;
    * a task that is completed, cancelled or already overdue gets none."""
    cfg = st["reminders"]
    if not cfg["enabled"] or not cfg["intervals"]:
        return 0
    made = 0
    for t in db.execute(select(Task).where(Task.status.in_(OPEN), Task.due_date.is_not(None))).scalars().all():
        due = due_dt(t)
        assignees = people(t, "assignees")
        if due is None or due <= now or not assignees:
            continue
        due_key = f"{t.due_date}T{t.due_time or ''}"
        state = (t.attributes or {}).get("dueReminders")
        if not state or state.get("due") != due_key:
            changed = (t.attributes or {}).get("dueChangedAt")
            if state:  # the due moment was changed by some other route than the edit form: start over from now
                armed_at = now
            else:
                armed_at = datetime.fromisoformat(changed.replace("Z", "+00:00")) if changed else (t.created_at or now)
            state = {"due": due_key, "armedAt": iso(armed_at), "done": []}
        armed_at = datetime.fromisoformat(state["armedAt"].replace("Z", "+00:00"))
        # the intervals that apply to this task: their moment is after the due date was set (or the task was made) and is not the task's own custom reminder
        pending = [m for m in cfg["intervals"] if due - timedelta(minutes=m) > armed_at and str(m) != (t.reminder_minutes or "") and m not in state["done"]]
        reached = sorted(m for m in pending if due - timedelta(minutes=m) <= now)  # smallest = closest to the due moment
        if not reached:
            if state != (t.attributes or {}).get("dueReminders"):
                set_attrs(t, dueReminders=state)
            continue
        send = reached[0]
        message = f"Reminder: “{t.title}” is due in {remaining_text(due - now)} ({nice_due(t.due_date, t.due_time)}). {t.priority} priority."
        sent = alert(db, assignees, t, "Task Reminder", message, None, key=f"task-remind:{t.id}:{due_key}:{send}")
        state["done"] = sorted({*state["done"], *reached})
        set_attrs(t, dueReminders=state)
        if sent:
            log_event(db, t.id, SYSTEM, "Reminder Triggered", f"{interval_label(send)} reminder sent in-app to the assignee")
        made += sent
    return made


def run_engine(db: Session, now: datetime | None = None) -> dict:
    """Reminders, overdue alerts and the automatic follow-up tasks. Idempotent: every effect is recorded so a rerun does nothing twice."""
    now = now or datetime.now(UTC)
    st = settings(db)
    out = {"reminders": 0, "overdue": 0, "managerAlerts": 0, "created": 0}
    for t in db.execute(select(Task).where(Task.status.in_(OPEN), Task.reminder_at.is_not(None), Task.reminded_at.is_(None), Task.reminder_at <= now)).scalars().all():
        message = f"Reminder: “{t.title}” is due {_fmt(t.due_date, t.due_time)}"
        alert(db, [*people(t, "assignees"), *people(t, "watchers")], t, "Task Reminder", message, None)
        if st["notifyManagerOnReminder"]:
            alert(db, managers_of(db, t), t, "Task Reminder", message, None)
        t.reminded_at = now
        log_event(db, t.id, SYSTEM, "Reminder Triggered", "Reminder sent in-app to the assignee")
        out["reminders"] += 1
    out["dueReminders"] = due_reminders(db, now, st)
    if st["automation"]["taskOverdue"]["enabled"]:
        for t in db.execute(select(Task).where(Task.status.in_(OPEN), Task.due_date.is_not(None))).scalars().all():
            level = overdue_level(t, now)
            if level < 0:
                continue
            done = dict((t.attributes or {}).get("overdueNotified") or {})
            if done.get(str(level)):
                continue
            for lv in (0, 1, 3, 7):
                if lv <= level:
                    done[str(lv)] = iso(now)
            label = overdue_label(t, now)
            due_key = f"{t.due_date}T{t.due_time or ''}:{level}"
            message = f"“{t.title}” is overdue ({label}): it was due {nice_due(t.due_date, t.due_time)}. {t.priority} priority."
            alert(db, people(t, "assignees"), t, "Task Overdue", message, None, key=f"task-overdue:{t.id}:{due_key}")
            managers = []
            if st["automation"]["taskOverdue"].get("notifyManager") and level >= st["managerNotifyOverdueDays"]:
                managers = managers_of(db, t)
                alert(db, managers, t, "Task Overdue", message, None, key=f"task-overdue:{t.id}:{due_key}")
                out["managerAlerts"] += len(managers)
            set_attrs(t, overdueNotified=done)
            log_event(db, t.id, SYSTEM, "Overdue", f"{label} - owner notified{f' and {len(managers)} manager(s)' if managers else ''}")
            out["overdue"] += 1
    A = st["automation"]

    def make(rule: dict, key: str, record, related_type: str, assignee: str | None, title: str, task_type: str, description: str) -> None:
        if not rule["enabled"]:
            return
        try:
            create_task(db, SYSTEM, _ALL, {"title": title, "taskType": task_type, "description": description, "priority": rule["priority"], "dueDate": (now.date() + timedelta(days=int(rule["dueInDays"]))).isoformat(),
                                           "assignees": [assignee] if assignee else [], "visibility": "Team", "relatedType": related_type, "relatedId": record.id}, branch=record.branch, automation_key=key, source="automation",
                        message=f"Created by automation — {rule['label']}")
            out["created"] += 1
        except ApiError:
            pass

    cutoff = lambda days: now - timedelta(days=days)  # noqa: E731
    for lead in db.execute(select(Lead).where(Lead.status == "New", Lead.created_at >= cutoff(A["newLead"]["lookbackDays"]))).scalars().all():
        make(A["newLead"], f"newLead:{lead.id}", lead, "Lead", lead.assigned_to, f"Initial follow-up: {lead.name}", "Call", f"New lead from {lead.source or 'unknown source'} — make first contact and qualify.")
    for deal in db.execute(select(Deal).where(~Deal.stage.like("Closed%"), Deal.created_at >= cutoff(A["dealCreated"]["lookbackDays"]))).scalars().all():
        make(A["dealCreated"], f"dealCreated:{deal.id}", deal, "Deal", deal.salesperson, f"Requirement follow-up: {deal.name}", "Follow-up", "Confirm requirements and decision makers for this new deal.")
    for inv in db.execute(select(Invoice).where(Invoice.status.notin_(("Cancelled", "Void", "Paid", "Draft")), Invoice.due_date < now.date(), Invoice.due_date >= (now - timedelta(days=A["invoiceOverdue"]["lookbackDays"])).date())).scalars().all():
        if float(inv.amount or 0) - float(inv.paid_amount or 0) > 0:
            make(A["invoiceOverdue"], f"invoiceOverdue:{inv.id}", inv, "Invoice", inv.owner_id, f"Payment follow-up: {inv.number}", "Payment Follow-up",
                 f"Invoice is overdue — outstanding {float(inv.amount or 0) - float(inv.paid_amount or 0):.2f}. Contact the client for payment.")
    return out


OWNER_ATTRS = ("assigned_to", "assigned_user", "salesperson", "account_manager", "manager", "owner_id", "owner", "created_by")
OWNER_CHAIN = (("salesOrderId", SalesOrder), ("quotationId", Quotation), ("dealId", Deal), ("leadId", Lead), ("enquiryId", Enquiry))


def suggest_owner(db: Session, related_type: str | None, related_id: str | None) -> dict:
    """Who should a task about this record be assigned to by default: the person responsible for the record, else for the order / quotation / deal / lead / enquiry it grew out of."""
    rel = resolve_related(db, related_type, related_id)
    model, _, _ = RELATED[related_type]
    records = [db.get(model, related_id)] + [db.get(m, rel["links"][k]) for k, m in OWNER_CHAIN if rel["links"].get(k)]
    owner = next((getattr(r, a) for r in records if r is not None for a in OWNER_ATTRS if getattr(r, a, None)), None)
    name = db.execute(select(Employee.full_name).where(Employee.id == owner)).scalar_one_or_none() if owner else None
    return {"owner": owner, "ownerName": name, "relatedName": rel["relatedName"], "links": rel["links"]}
