from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.session import get_db
from app.models import Notification
from app.services import calendar_feed, reports, search as search_svc, workspace

router = APIRouter(tags=["Workspace"])


@router.get("/search", summary="Global search across everything the caller may open")
def search(q: str = Query("", max_length=100), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return search_svc.search(db, p, q)


@router.post("/notifications/read-all", summary="Mark all of my notifications as read")
def read_all(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == p.actor_id, Notification.read.is_(False)).values(read=True))
    db.commit()
    return {"success": True}


@router.get("/calendar/events", summary="Everything dated that the caller may see, assembled from the records that own it")
def calendar_events(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return calendar_feed.feed(db, p, dict(request.query_params))


@router.post("/calendar/followup/reschedule", summary="Move a record's next follow-up date")
def calendar_reschedule(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return calendar_feed.reschedule_followup(db, p, payload)


@router.get("/directory/people", summary="Names and public facts of the people the caller can see (pickers, owner names)")
def people(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return search_svc.people_directory(db, p)


@router.get("/directory/departments", summary="Department names and status (pickers) - without the workload figures of the full list")
def department_names(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from sqlalchemy import select
    from app.models import Department

    return [{"id": i, "name": n, "status": s} for i, n, s in db.execute(select(Department.id, Department.name, Department.status).order_by(Department.name)).all()]


@router.get("/reports/monthly-performance", summary="Revenue, deals won, new leads and customers per month (inside your branch scope)")
def monthly_performance(months: int = Query(12, ge=1, le=36), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return reports.monthly_performance(db, p, months)


@router.get("/settings", summary="Workspace settings: company profile, tax defaults, notification preferences")
def get_settings_(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return workspace.all_settings(db)


@router.put("/settings/{key}", summary="Change a settings group (administrators)")
def put_settings(key: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return workspace.put(db, p, key, payload)


@router.get("/audit", summary="The append-only audit trail (administrators)")
def audit_trail(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return workspace.read_audit(db, p, dict(request.query_params))


@router.get("/system/status", summary="What is connected and what is enforced (administrators)")
def system_status(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return workspace.system_status(p, db)
