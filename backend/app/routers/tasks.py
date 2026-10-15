"""Task endpoints. Path order matters: the fixed words (me, summary, assignees ...) are declared before /tasks/{task_id}."""
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.core.errors import ApiError, forbidden, invalid, not_found
from app.db.session import get_db
from app.models import Activity, AppSetting, SavedFilter, Task, TaskEvent
from app.services import audit, tasks as svc
from app.services.codec import to_json

router = APIRouter(prefix="/tasks", tags=["Tasks"])


def actor_perms(db: Session, p: Principal):
    actor = svc.actor_of(p)
    return actor, svc.perms_of(db, actor, p.permissions.get("Tasks"))


@router.get("/me", summary="Your task permissions and the workspace's task settings")
def me(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    st = svc.settings(db)
    return {"user": {"id": actor.id, "name": actor.name, "role": actor.job_role if actor.level == "Employee" else actor.level, "department": actor.department, "accountId": p.user.id}, "perms": perms,
            "settings": {"automation": st["automation"], "uploadRules": st["uploadRules"], "managerNotifyOverdueDays": st["managerNotifyOverdueDays"]}, "emailConfigured": False, "whatsappConfigured": False}


@router.get("/summary")
def summary(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    return svc.summary(db, actor, perms)


@router.get("/assignees")
def assignees(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    return svc.directory(db, actor, perms)


@router.get("/suggest-owner", summary="The default assignee for a task about a CRM record, and the record's link chain")
def suggest_owner(relatedType: str, relatedId: str, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    return svc.suggest_owner(db, relatedType, relatedId)


@router.get("/suggestions")
def suggestions(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    from app.models import Lead

    cutoff = svc.date.today() - svc.timedelta(days=3)
    leads = db.execute(select(Lead).where(Lead.assigned_to == p.actor_id, Lead.status.notin_(("Lost", "Unqualified", "Converted")))).scalars().all()
    open_links = {t.related_id for t in db.execute(select(Task).where(Task.status.in_(svc.OPEN), Task.related_type == "Lead")).scalars()}
    return [{"relatedType": "Lead", "relatedId": lead.id, "relatedName": lead.name, "status": lead.status, "lastContactedDate": lead.last_contacted_date.isoformat() if lead.last_contacted_date else None,
             "reason": "Lead was contacted but has no follow-up scheduled"} for lead in leads if lead.id not in open_links and (lead.status == "Contacted" or (lead.last_contacted_date and lead.last_contacted_date >= cutoff))][:8]


@router.get("/filters")
def filters(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    rows = db.execute(select(SavedFilter).where(SavedFilter.owner_id == p.actor_id, SavedFilter.scope == "tasks").order_by(SavedFilter.created_at.desc())).scalars().all()
    return [{"id": r.id, "userId": r.owner_id, "name": r.name, "view": (r.attributes or {}).get("view", "list"), "filters": r.definition, "createdAt": svc.iso(r.created_at)} for r in rows]


@router.post("/filters", status_code=201)
def save_filter(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    name = str(payload.get("name") or "").strip()[:40]
    if not name:
        raise invalid("Name this filter.", {"name": "Required."})
    from sqlalchemy import func

    row = db.execute(select(SavedFilter).where(SavedFilter.owner_id == p.actor_id, SavedFilter.scope == "tasks", func.lower(SavedFilter.name) == name.lower())).scalar_one_or_none()
    if row is None:
        from app.db import ids

        row = SavedFilter(id=ids.new_id(db, "TFL", 4), owner_id=p.actor_id, scope="tasks", name=name, definition=payload.get("filters") or {}, attributes={"view": payload.get("view") or "list"})
        db.add(row)
    else:
        row.definition, row.attributes = payload.get("filters") or {}, {"view": payload.get("view") or "list"}
    db.commit()
    return {"id": row.id, "userId": row.owner_id, "name": row.name, "view": (row.attributes or {}).get("view", "list"), "filters": row.definition, "createdAt": svc.iso(row.created_at)}


@router.delete("/filters/{filter_id}")
def delete_filter(filter_id: str, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    row = db.get(SavedFilter, filter_id)
    if row is None or row.owner_id != p.actor_id:
        raise not_found("Saved filter not found.")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.get("/settings")
def get_settings(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    return svc.settings(db)


@router.put("/settings")
def put_settings(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can change task settings.")
    current = svc.settings(db)
    automation = {k: {**current["automation"][k], **{f: v for f, v in (payload.get("automation", {}).get(k) or {}).items() if f in ("enabled", "dueInDays", "priority", "lookbackDays", "notifyManager")}} for k in current["automation"]}
    value = {"permissions": payload.get("permissions", current["permissions"]), "automation": automation, "uploadRules": current["uploadRules"],
             "managerNotifyOverdueDays": int(payload.get("managerNotifyOverdueDays", current["managerNotifyOverdueDays"])), "notifyManagerOnReminder": bool(payload.get("notifyManagerOnReminder", current["notifyManagerOnReminder"])), "updatedAt": svc.iso()}
    row = db.get(AppSetting, "task_settings")
    if row is None:
        db.add(AppSetting(key="task_settings", value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id
    audit.record(db, user=p.user, action="Task settings changed", module="Tasks", info=p.info)
    db.commit()
    return svc.settings(db)


@router.post("/engine/run", summary="Run reminders, overdue alerts and automatic follow-ups now")
def engine(p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can run the task engine.")
    out = svc.run_engine(db)
    db.commit()
    return out


@router.get("")
def list_(request: Request, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    if not perms["view"]:
        raise forbidden("You do not have permission to view tasks.")
    tasks = svc.visible_tasks(db, actor, perms)
    q = request.query_params
    for key, attr in (("status", "status"), ("priority", "priority"), ("relatedId", "related_id"), ("relatedType", "related_type"), ("assignedTo", "assigned_to"), ("taskType", "task_type")):
        if q.get(key):
            wanted = set(q[key].split(","))
            tasks = [t for t in tasks if getattr(t, attr) in wanted]
    if q.get("q"):
        needle = q["q"].lower()
        tasks = [t for t in tasks if needle in t.title.lower() or needle in (t.related_name or "").lower() or needle in t.id.lower()]
    subs = svc.subtask_counts(db)
    rows = [svc.decorate(actor, perms, t, subs) for t in tasks]
    if str(q.get("all", "")).lower() == "true":
        return rows
    page, size = max(1, int(q.get("page", 1))), min(200, max(1, int(q.get("pageSize", 10))))
    return {"data": rows[(page - 1) * size: page * size], "total": len(rows), "page": page, "pageSize": size}


@router.post("", status_code=201)
def create(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "create")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = svc.create_task(db, actor, perms, payload, branch=p.scope.write)
    audit.record(db, user=p.user, action="Created Task", module="Tasks", record_id=task.id, info=p.info)
    db.commit()
    return svc.decorate(actor, perms, task, svc.subtask_counts(db))


def _task(db: Session, actor, perms, task_id: str):
    task = svc.get_task(db, task_id)
    svc.guard(db, actor, perms, task)
    return task


@router.get("/{task_id}/detail")
def detail(task_id: str, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = _task(db, actor, perms, task_id)
    subs = svc.subtask_counts(db)
    children = [svc.decorate(actor, perms, t, subs) for t in db.execute(select(Task).where(Task.parent_id == task.id)).scalars() if svc.can_view(actor, perms, t)]
    parent = db.get(Task, task.parent_id) if task.parent_id else None
    events = db.execute(select(TaskEvent).where(TaskEvent.task_id == task.id).order_by(TaskEvent.at.desc())).scalars().all()
    names = svc.names_of(db)
    activities = db.execute(select(Activity).where(Activity.id.in_([x for x in (task.activity_id, (task.attributes or {}).get("completionActivityId")) if x]))).scalars().all()
    nxt_id = (task.attributes or {}).get("nextTaskId")
    nxt = db.get(Task, nxt_id) if nxt_id else None
    related = []
    for key, rid in ((task.attributes or {}).get("links") or {}).items():
        spec = next(((t, v) for t, v in svc.RELATED.items() if v[2] == key), None)
        if spec:
            model, label, _ = spec[1]
            rec = db.execute(select(model).where(model.id == rid)).scalar_one_or_none()
            if rec is not None:
                related.append({"key": key, "type": spec[0], "id": rid, "label": str(getattr(rec, label, "") or rid), "route": f"/{model.__tablename__.replace('_', '-')}/{rid}"})
    return {"task": svc.decorate(actor, perms, task, subs), "subtasks": children, "events": [svc.event_json(e, names) for e in events], "related": related,
            "activities": [{"id": a.id, "type": a.type, "subject": a.subject, "status": a.status, "date": svc.iso(a.date)} for a in activities],
            "parent": {"id": parent.id, "title": parent.title} if parent and svc.can_view(actor, perms, parent) else None,
            "nextTask": {"id": nxt.id, "title": nxt.title, "dueDate": nxt.due_date.isoformat() if nxt.due_date else None} if nxt and svc.can_view(actor, perms, nxt) else None,
            "people": {i: names.get(i, i) for i in {task.created_by, *svc.people(task, "assignees"), *svc.people(task, "watchers"), *[e.by for e in events]} if i}}


@router.get("/{task_id}")
def get_(task_id: str, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    return svc.decorate(actor, perms, _task(db, actor, perms, task_id), svc.subtask_counts(db))


def _done(db: Session, p: Principal, actor, perms, task: Task, action: str):
    audit.record(db, user=p.user, action=f"{action} Task", module="Tasks", record_id=task.id, info=p.info)
    db.commit()
    return svc.decorate(actor, perms, task, svc.subtask_counts(db))


@router.put("/{task_id}")
def update(task_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    data = dict(payload)
    if "status" in data and data["status"] != task.status:
        svc.change_status(db, actor, perms, task, "To Do" if data["status"] == "Pending" else data["status"], reason=data.get("reason", ""))
    data.pop("status", None)
    data.pop("reason", None) if "assignees" not in data else None
    if data:
        svc.edit_task(db, actor, perms, task, data)
    return _done(db, p, actor, perms, task, "Updated")


@router.delete("/{task_id}")
def delete(task_id: str, p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    svc.guard(db, actor, perms, task, "delete")
    kids = db.execute(select(Task).where(Task.parent_id == task.id)).scalars().all()
    completion = (task.attributes or {}).get("completionActivityId")
    parent_id = task.parent_id
    for kid in kids:
        db.delete(kid)
    if completion and (a := db.get(Activity, completion)) is not None:
        db.delete(a)
    db.delete(task)
    audit.record(db, user=p.user, action="Deleted Task", module="Tasks", record_id=task_id, info=p.info)
    if parent_id:
        svc.log_event(db, parent_id, actor, "Subtask Removed", f"Subtask removed: {task.title}", **{"from": task_id})
    db.commit()
    return {"success": True}


def _status_route(name: str, target: str | None):
    def handler(task_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
        actor, perms = actor_perms(db, p)
        task = svc.get_task(db, task_id)
        to = target or ("To Do" if payload.get("status") == "Pending" else payload.get("status"))
        svc.change_status(db, actor, perms, task, to, reason=payload.get("reason") or payload.get("note") or "", force=bool(payload.get("force")))
        return _done(db, p, actor, perms, task, "Updated")

    router.post(f"/{{task_id}}/{name}")(handler)


for _name, _target in (("status", None), ("complete", "Completed"), ("reopen", "Reopened"), ("cancel", "Cancelled")):
    _status_route(_name, _target)


@router.post("/{task_id}/assign")
def assign(task_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    if not isinstance(payload.get("assignees"), list) and not payload.get("assignedTeam"):
        raise invalid("Choose who to assign this task to.")
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    svc.edit_task(db, actor, perms, task, {"assignees": payload.get("assignees") or [], "assignedTeam": payload.get("assignedTeam"), "reason": payload.get("reason")})
    return _done(db, p, actor, perms, task, "Assigned")


@router.post("/{task_id}/reschedule")
def reschedule(task_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    if not payload.get("dueDate"):
        raise invalid("Choose a new due date.", {"dueDate": "Required."})
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    svc.edit_task(db, actor, perms, task, {"dueDate": payload["dueDate"], "dueTime": payload.get("dueTime", task.due_time)})
    return _done(db, p, actor, perms, task, "Rescheduled")


@router.post("/{task_id}/duplicate", status_code=201)
def duplicate(task_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    svc.guard(db, actor, perms, task, "duplicate")
    attrs = task.attributes or {}
    copy = svc.create_task(db, actor, perms, {"title": f"{task.title} (copy)", "description": task.description, "taskType": task.task_type, "priority": task.priority, "startDate": task.start_date.isoformat() if task.start_date else None,
                                              "dueDate": task.due_date.isoformat() if task.due_date else None, "dueTime": task.due_time, "reminderMinutes": "" if task.reminder_minutes == "custom" else task.reminder_minutes,
                                              "assignees": svc.people(task, "assignees"), "visibility": task.visibility, "watchers": svc.people(task, "watchers"), "relatedType": task.related_type, "relatedId": task.related_id,
                                              "links": attrs.get("links"), "recurrence": attrs.get("recurrence"), "parentId": task.parent_id}, branch=task.branch, duplicate_of=task.id, allow_duplicate=True, message=f"Duplicated from {task.id}")
    if payload.get("withSubtasks") is not False:
        for sub in db.execute(select(Task).where(Task.parent_id == task.id)).scalars().all():
            svc.create_task(db, actor, perms, {"title": sub.title, "description": sub.description, "taskType": sub.task_type, "priority": sub.priority, "dueDate": sub.due_date.isoformat() if sub.due_date else None,
                                               "assignees": svc.people(sub, "assignees"), "visibility": sub.visibility, "parentId": copy.id}, branch=task.branch, allow_duplicate=True)
    svc.log_event(db, task.id, actor, "Duplicated", f"Duplicated as {copy.id}", to=copy.id)
    return _done(db, p, actor, perms, copy, "Duplicated")


@router.post("/{task_id}/comments", status_code=201)
def comment(task_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Tasks", "view")), db: Session = Depends(get_db)):
    actor, perms = actor_perms(db, p)
    task = svc.get_task(db, task_id)
    event = svc.add_comment(db, actor, perms, task, payload)
    db.commit()
    return svc.event_json(event, svc.names_of(db))


@router.post("/{task_id}/attachments")
def attachments_moved(task_id: str):
    raise ApiError(410, "Attachments moved to the Documents module - upload files from the record's Documents section.", "MOVED")
