from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.core.errors import forbidden
from app.db.session import get_db
from app.services import operations as svc

router = APIRouter(tags=["Operations"])


@router.get("/contracts/settings", summary="Contract types and workflow settings")
def contract_settings(p: Principal = Depends(require("Contracts", "view")), db: Session = Depends(get_db)):
    from app.services import reminders

    return reminders.contract_settings(db)


@router.put("/contracts/settings", summary="Change contract types and workflow settings")
def put_contract_settings(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Contracts", "view")), db: Session = Depends(get_db)):
    return svc.put_contract_settings(db, p, payload)


@router.post("/contracts/engine/run", summary="Sweep: Active / Expiring Soon / Expired follow the end date")
def contract_engine(p: Principal = Depends(require("Contracts", "view")), db: Session = Depends(get_db)):
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can run the contract engine.")
    changed = svc.refresh_contract_statuses(db)
    db.commit()
    return {"changed": changed}


@router.post("/contracts/{contract_id}/renew", status_code=201, summary="Renew a contract: a new Draft carries the terms forward and the old one becomes Renewed")
def renew(contract_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Contracts", "create")), db: Session = Depends(get_db)):
    return svc.renew_contract(db, p, contract_id, payload)


@router.post("/contracts/{contract_id}/status", summary="Move a contract along its lifecycle (reason / comments / date / sending method as the move requires)")
def contract_status(contract_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Contracts", "view")), db: Session = Depends(get_db)):
    return svc.change_contract_status(db, p, contract_id, payload)
