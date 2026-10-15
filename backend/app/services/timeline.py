"""Server-owned timeline entries (activities) and in-app notifications. Business actions write these themselves, in the same transaction as the change they describe -
the browser no longer posts them (so they cannot be forged, skipped or duplicated)."""
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import ids
from app.models import Activity, Notification


def now() -> datetime:
    return datetime.now(UTC)


def log_activity(db: Session, *, related_type: str, related_id: str, related_name: str = "", type: str, subject: str, by: str | None, branch: str | None, notes: str | None = None,
                 status: str = "Completed", source: str = "system", assigned_to: str | None = None, from_status: str | None = None, to_status: str | None = None,
                 extra: dict | None = None) -> Activity:
    activity = Activity(
        id=ids.new_id(db, "ACT", 5), related_type=related_type, related_id=related_id, related_name=(related_name or "")[:240], type=type, subject=subject[:300], by=by, branch=branch,
        notes=(notes or "")[:4000], status=status, source=source, assigned_to=assigned_to, from_status=from_status, to_status=to_status, date=now(), created_by=by, attributes=extra or {},
    )
    db.add(activity)
    return activity


def notify(db: Session, *, user_id: str | None, message: str, type: str = "info", icon: str = "bell", related_type: str | None = None, related_id: str | None = None,
           branch: str | None = None, task_id: str | None = None, dedupe_key: str | None = None) -> Notification | None:
    if not user_id:
        return None
    key = f"{dedupe_key}:{user_id}"[:160] if dedupe_key else None
    if key and db.execute(select(Notification.id).where(Notification.dedupe_key == key)).first():
        return None
    from app.services import workspace

    if not workspace.notification_enabled(db, type):  # the administrator switched this kind of notification off
        return None
    notification = Notification(id=ids.new_id(db, "NTF", 5), user_id=user_id, type=type, icon=icon, message=message[:1000], related_type=related_type, related_id=related_id, branch=branch, task_id=task_id, dedupe_key=key)
    db.add(notification)
    return notification
