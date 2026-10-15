"""Append-only audit trail. `record()` only adds the row: the caller's commit makes it durable (callers that raise afterwards commit first)."""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.system import AuditLog


@dataclass
class RequestInfo:
    ip: str = ""
    user_agent: str = ""
    device: str = ""


def record(db: Session, *, action: str, module: str = "", record_id: str | None = None, result: str = "Success", details: str = "", user=None, name: str | None = None,
           role: str | None = None, branch: str | None = None, info: RequestInfo | None = None) -> None:
    db.add(AuditLog(
        user_id=getattr(user, "id", None), user_name=(name or getattr(user, "name", "") or "")[:160], role=(role or getattr(user, "access_level", "") or "")[:40],
        branch=branch if branch is not None else getattr(user, "branch", None), action=action[:160], module=module[:60], record_id=record_id, result=result,
        details=details[:2000], ip=(info.ip if info else "")[:64],
    ))
