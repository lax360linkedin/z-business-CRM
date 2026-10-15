from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.db.session import get_db
from app.services import activities as svc

router = APIRouter(prefix="/activities", tags=["Activities"])


@router.post("/log", status_code=201, summary="Log a manual activity (validated against the record it belongs to)")
def log(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Activities", "create")), db: Session = Depends(get_db)):
    return svc.log_manual(db, p, payload)


@router.post("/{activity_id}/complete")
def complete(activity_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Activities", "edit")), db: Session = Depends(get_db)):
    return svc.complete(db, p, activity_id, payload.get("notes", ""))


@router.post("/{activity_id}/cancel")
def cancel(activity_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Activities", "view")), db: Session = Depends(get_db)):
    return svc.cancel(db, p, activity_id, payload.get("reason", ""))


@router.post("/{activity_id}/reschedule")
def reschedule(activity_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Activities", "view")), db: Session = Depends(get_db)):
    return svc.reschedule(db, p, activity_id, payload)


@router.post("/{activity_id}/edit")
def edit(activity_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Activities", "view")), db: Session = Depends(get_db)):
    return svc.edit(db, p, activity_id, payload)


@router.delete("/{activity_id}")
def delete(activity_id: str, p: Principal = Depends(require("Activities", "view")), db: Session = Depends(get_db)):
    return svc.delete(db, p, activity_id)
