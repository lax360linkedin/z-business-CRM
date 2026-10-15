"""Workspace settings (company profile, tax defaults, notification preferences), the audit-trail reader for administrators, and an honest system status panel."""
import re
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.config import get_settings
from app.core.errors import forbidden, invalid
from app.core.security import PASSWORD_RULES
from app.models import AppSetting, AuditLog
from app.services import audit, auth_service, storage
from app.services.codec import serialise_value

DEFAULTS = {
    "company": {"name": "", "industry": "", "phone": "", "email": "", "website": "", "address": "", "gstNumber": ""},
    "tax": {"gstNumber": "", "rate": 18, "inclusive": False},
    "notifications": {"events": {}},  # an event type is on unless it is switched off here
    "security": {"idleTimeoutMinutes": None},  # None = the server default (IDLE_TIMEOUT_MINUTES)
}
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def get(db: Session, key: str) -> dict:
    row = db.get(AppSetting, f"workspace:{key}")
    return {**DEFAULTS[key], **(row.value if row else {})}


def all_settings(db: Session) -> dict:
    return {k: get(db, k) for k in DEFAULTS}


def _text(value, limit: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(value if value is not None else "")).strip()[:limit]


def put(db: Session, p: Principal, key: str, body: dict) -> dict:
    if key not in DEFAULTS:
        raise invalid("Unknown settings group.")
    if p.level not in ("Super Admin", "Admin"):
        audit.record(db, user=p.user, action=f"Denied: change {key} settings", module="Settings", result="Denied", info=p.info)
        db.commit()
        raise forbidden("Only an administrator can change workspace settings.")
    cur = get(db, key)
    new = dict(cur)
    errors: dict[str, str] = {}
    if key == "company":
        for field, limit in (("name", 120), ("industry", 160), ("phone", 30), ("email", 254), ("website", 200), ("address", 400), ("gstNumber", 15)):
            if field in body:
                new[field] = _text(body[field], limit)
        if new["email"] and not EMAIL.match(new["email"]):
            errors["email"] = "Enter a valid email address."
        if new["gstNumber"] and not GSTIN.match(new["gstNumber"].upper()):
            errors["gstNumber"] = "Enter a valid 15-character GSTIN."
        new["gstNumber"] = new["gstNumber"].upper()
        if len(new["name"]) < 2:
            errors["name"] = "Enter the company name."
    elif key == "tax":
        if "rate" in body:
            try:
                new["rate"] = float(body["rate"])
                if not 0 <= new["rate"] <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                errors["rate"] = "Enter a rate between 0 and 100."
        if "inclusive" in body:
            new["inclusive"] = bool(body["inclusive"])
        if "gstNumber" in body:
            new["gstNumber"] = _text(body["gstNumber"], 15).upper()
            if new["gstNumber"] and not GSTIN.match(new["gstNumber"]):
                errors["gstNumber"] = "Enter a valid 15-character GSTIN."
    elif key == "security":
        if not p.is_super_admin:
            audit.record(db, user=p.user, action="Denied: change security settings", module="Settings", result="Denied", info=p.info)
            db.commit()
            raise forbidden("Only the Super Admin can change security settings.")
        try:
            minutes = int(body["idleTimeoutMinutes"]) if body.get("idleTimeoutMinutes") not in (None, "") else None
        except (TypeError, ValueError):
            minutes = -1
        if minutes is not None and not 5 <= minutes <= 480:
            errors["idleTimeoutMinutes"] = "Choose between 5 and 480 minutes."
        new["idleTimeoutMinutes"] = minutes
    else:  # notifications
        events = body.get("events")
        if not isinstance(events, dict):
            errors["events"] = "Send the event switches."
        else:
            new["events"] = {_text(k, 60): bool(v) for k, v in events.items() if _text(k, 60)}
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    row = db.get(AppSetting, f"workspace:{key}")
    if row is None:
        db.add(AppSetting(key=f"workspace:{key}", value=new, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = new, p.actor_id
    audit.record(db, user=p.user, action=f"Settings changed: {key}", module="Settings", details=", ".join(sorted(body)), info=p.info)
    db.commit()
    db.info.pop("notification_prefs", None)
    return new


def notification_enabled(db: Session, event_type: str) -> bool:
    prefs = db.info.get("notification_prefs")
    if prefs is None:
        prefs = get(db, "notifications").get("events", {})
        db.info["notification_prefs"] = prefs
    return prefs.get(event_type, True) is not False


# ---- audit trail ----------------------------------------------------------------------------------------------------------
def read_audit(db: Session, p: Principal, params: dict) -> dict:
    """Administrators read the append-only trail: the Super Admin everything, an Admin their own branch."""
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can read the audit trail.")
    conds = []
    if p.level == "Admin":
        conds.append(or_(AuditLog.branch == p.user.branch, AuditLog.user_id == p.actor_id))
    if params.get("module"):
        conds.append(AuditLog.module == params["module"])
    if params.get("result"):
        conds.append(AuditLog.result == params["result"])
    if params.get("userId"):
        conds.append(AuditLog.user_id == params["userId"])
    if params.get("role"):
        conds.append(AuditLog.role == params["role"])
    if params.get("kind") == "login":
        conds.append(AuditLog.module == "Authentication")
    needle = (params.get("q") or "").strip().lower()
    if needle:
        like = f"%{needle}%"
        conds.append(or_(func.lower(AuditLog.action).like(like), func.lower(AuditLog.details).like(like), func.lower(AuditLog.user_name).like(like), func.lower(func.coalesce(AuditLog.record_id, "")).like(like)))
    for key, op in (("from", "ge"), ("to", "le")):
        if params.get(key):
            try:
                d = date.fromisoformat(params[key][:10])
            except ValueError:
                raise invalid("Use a valid date.", {key: "Use a valid date."}) from None
            at = datetime(d.year, d.month, d.day, tzinfo=UTC) if op == "ge" else datetime(d.year, d.month, d.day, tzinfo=UTC) + timedelta(days=1)
            conds.append(AuditLog.at >= at if op == "ge" else AuditLog.at < at)
    try:
        page, size = max(1, int(params.get("page", 1))), min(200, max(1, int(params.get("pageSize", 50))))
    except ValueError:
        raise invalid("Invalid pagination.") from None
    total = db.execute(select(func.count(AuditLog.id)).where(*conds)).scalar_one()
    rows = db.execute(select(AuditLog).where(*conds).order_by(AuditLog.at.desc(), AuditLog.id.desc()).offset((page - 1) * size).limit(size)).scalars()
    return {"data": [{"id": r.id, "date": serialise_value(r.at), "userId": r.user_id, "user": r.user_name, "role": r.role, "branch": r.branch, "action": r.action, "module": r.module, "record": r.record_id,
                      "success": r.result == "Success", "result": r.result, "detail": r.details, "ip": r.ip} for r in rows], "total": total, "page": page, "pageSize": size}


# ---- system status ---------------------------------------------------------------------------------------------------------
def system_status(p: Principal, db: Session) -> dict:
    """What is connected and what is enforced - stated plainly, never decorative. Only administrators see it."""
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can see the system status.")
    s = get_settings()
    return {
        "environment": s.app_env,
        "email": {"connected": False, "note": "No mail server is configured. Quotations and reset links are recorded but not e-mailed."},
        "whatsapp": {"connected": False, "note": "No WhatsApp Business API is configured."},
        "storage": {"backend": storage.backend_name(), "bucket": s.supabase_storage_bucket if storage.backend_name() == "supabase" else None},
        "scheduler": {"enabled": s.scheduler_enabled and not s.is_test, "intervalSeconds": s.scheduler_interval_seconds},
        "security": {"accessTokenMinutes": s.access_token_expire_minutes, "sessionDays": s.session_days, "idleTimeoutMinutes": auth_service.idle_timeout_minutes(db), "idleTimeoutDefault": s.idle_timeout_minutes, "maxFailedLogins": s.max_failed_logins, "lockoutMinutes": s.lockout_minutes,
                     "passwordRules": [label for _, label in PASSWORD_RULES], "orgTimezone": s.org_timezone},
    }
