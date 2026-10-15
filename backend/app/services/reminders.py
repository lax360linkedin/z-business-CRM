"""Reminders the server raises on its own timer: contract expiry (with the automatic renewal task), project deadlines and milestones, and follow-ups that are due on leads and
enquiries. Each reminder carries a key (event + person) and is created once - re-running the sweep never repeats it. They are in-app notifications only: no e-mail or WhatsApp
service is connected, so none is claimed."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Contract, Enquiry, Lead, Project, Task
from app.services import tasks as task_svc
from app.services import timeline

CONTRACT_KEY = "contract_settings"
DEFAULT_TYPES = ["Service Agreement", "Software Development Agreement", "AMC / Maintenance Contract", "Annual Support Contract", "Subscription Agreement", "Consulting Agreement", "NDA",
                 "Partnership Agreement", "Vendor Agreement", "Custom Contract"]
DEFAULT_CONFIG = {"approvalRequired": True, "reminderDays": [90, 60, 30, 15, 7], "expiringSoonDays": 60, "renewalTaskDays": 30}


def contract_settings(db: Session) -> dict:
    row = db.get(AppSetting, CONTRACT_KEY)
    stored = dict(row.value) if row else {}
    types = stored.get("types") if isinstance(stored.get("types"), list) and stored.get("types") else DEFAULT_TYPES
    return {"types": types, "config": {**DEFAULT_CONFIG, **(stored.get("config") or {})}}


def _plural(n: int) -> str:
    return f"{n} day{'' if n == 1 else 's'}"


def contract_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    cfg = contract_settings(db)["config"]
    made = 0
    contracts = list(db.execute(select(Contract).where(Contract.status.in_(("Active", "Expiring Soon", "Expired")), Contract.end_date.is_not(None))).scalars())
    renewed_from = {c.renewed_from_id for c in db.execute(select(Contract).where(Contract.renewed_from_id.is_not(None), Contract.status != "Cancelled")).scalars()}
    for c in contracts:
        if c.renewed_to_id or c.id in renewed_from:
            continue
        left = (c.end_date - today).days
        project = db.get(Project, c.project_id) if c.project_id else None
        who = list(dict.fromkeys(x for x in (c.owner, project.manager if project else None) if x))

        def notify(key: str, message: str) -> None:
            nonlocal made
            for uid in who:
                if timeline.notify(db, user_id=uid, message=message, type="Contract Update", icon="file", related_type="Contract", related_id=c.id, branch=c.branch, dedupe_key=key):
                    made += 1

        if left < 0:
            notify(f"ctr-expired:{c.id}:{c.end_date}", f"Contract {c.number} ({c.customer_name}) expired on {c.end_date} and has not been renewed.")
            continue
        if (c.attributes or {}).get("renewalDecision") == "not-renewing":
            continue
        hit = sorted(d for d in cfg["reminderDays"] if left <= d)[:1]
        if hit:
            when = "today" if left == 0 else f"in {_plural(left)}"
            notify(f"ctr-remind:{c.id}:{c.end_date}:{hit[0]}", f"Contract {c.number} ({c.customer_name}) ends {when}.")
        key = f"contractRenewal:{c.id}"
        has_task = db.execute(select(Task.id).where(Task.automation_key == key, Task.status != "Cancelled")).first() is not None
        if left <= cfg["renewalTaskDays"] and not has_task and c.owner:
            notice = (c.end_date - timedelta(days=int(c.notice_period_days))) if c.notice_period_days else None
            due = notice if notice and notice >= today else (today + timedelta(days=7) if left > 7 else c.end_date)
            try:
                task_svc.create_task(db, task_svc.SYSTEM, task_svc._ALL, {
                    "title": f"Renewal follow-up — {c.number}", "taskType": "Follow-up", "priority": "High", "dueDate": due.isoformat(), "reminderMinutes": "1440", "assignees": [c.owner],
                    "relatedType": "Contract", "relatedId": c.id, "visibility": "Team",
                    "description": f"Contract {c.number} ({c.customer_name}) ends {c.end_date}{f'; notice period {c.notice_period_days} days' if c.notice_period_days else ''}. Agree the renewal with the client."},
                    branch=c.branch, automation_key=key, source="automation", message="Created automatically before the contract ends")
                made += 1
            except Exception:  # noqa: BLE001  - a failed reminder task must not stop the sweep
                pass
    return made


def project_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    made = 0
    open_projects = list(db.execute(select(Project).where(Project.status.notin_(("Completed", "Cancelled")))).scalars())
    milestones = list(db.execute(select(Task).where(Task.task_type == "Milestone", Task.status.notin_(("Completed", "Cancelled")), Task.due_date.is_not(None))).scalars())
    for pr in open_projects:
        team = [x for x in [pr.manager, *((pr.attributes or {}).get("team") or [])] if x]

        def add(key: str, users: list[str], message: str) -> None:
            nonlocal made
            for uid in dict.fromkeys(users):
                if timeline.notify(db, user_id=uid, message=message, type="Project Update", icon="folder", related_type="Project", related_id=pr.id, branch=pr.branch, dedupe_key=key):
                    made += 1

        if pr.deadline:
            left = (pr.deadline - today).days
            if left < 0:
                add(f"proj-overdue:{pr.id}:{pr.deadline}", team, f"“{pr.name}” is overdue — it was due {pr.deadline}.")
            elif left <= 7:
                add(f"proj-deadline:{pr.id}:{pr.deadline}", team, f"“{pr.name}” is due {'today' if left == 0 else f'in {_plural(left)}'}.")
        for t in milestones:
            if ((t.attributes or {}).get("links") or {}).get("projectId") != pr.id:
                continue
            d = (t.due_date - today).days
            if 0 <= d <= 3:
                add(f"proj-milestone:{t.id}:{t.due_date}", [*((t.attributes or {}).get("assignees") or []), pr.manager], f"Milestone “{t.title}” on {pr.name} is due {'today' if d == 0 else f'in {_plural(d)}'}.")
    return made


def followup_reminders(db: Session, today: date | None = None) -> int:
    today = today or date.today()
    made = 0
    for model, owner_attr, closed, kind in ((Lead, "assigned_to", ("Converted", "Lost"), "Lead"), (Enquiry, "assigned_user", ("Converted", "Duplicate", "Spam"), "Enquiry")):
        for r in db.execute(select(model).where(model.next_follow_up.is_not(None), model.next_follow_up <= today, model.status.notin_(closed))).scalars():
            owner = getattr(r, owner_attr, None)
            if not owner:
                continue
            overdue = r.next_follow_up < today
            label = f"{r.name} ({getattr(r, 'company', '') or 'No company'})"
            if timeline.notify(db, user_id=owner, message=f"{'Overdue' if overdue else 'Today’s'} follow-up: {label}.", type="Follow-up Reminder", icon="clock", related_type=kind, related_id=r.id,
                               branch=r.branch, dedupe_key=f"fu:{r.id}:{today}"):
                made += 1
    return made


def run(db: Session) -> dict:
    return {"contracts": contract_reminders(db), "projects": project_reminders(db), "followUps": followup_reminders(db)}
