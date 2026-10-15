from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require_super_admin
from app.db.session import get_db
from app.services import option_lists

router = APIRouter(tags=["Settings"])


@router.get("/options", summary="Every configurable option list (plain labels: any signed-in person)")
def all_options(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"lists": option_lists.public(db)}


@router.get("/options/usage", summary="How many records use each option (Super Admin)")
def option_usage(p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return {"usage": option_lists.usage(db)}


@router.post("/options/{key}/items", status_code=201, summary="Add an option (Super Admin)")
def add_option(key: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return option_lists.add_item(db, p, key, payload.get("value"))


@router.put("/options/{key}/items/{value:path}", summary="Rename and / or enable / disable an option (Super Admin)")
def update_option(key: str, value: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return option_lists.update_item(db, p, key, value, payload)


@router.delete("/options/{key}/items/{value:path}", summary="Delete an option nothing uses (Super Admin)")
def delete_option(key: str, value: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return option_lists.delete_item(db, p, key, value)


@router.put("/options/{key}/order", summary="Reorder a list (Super Admin)")
def reorder_options(key: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return option_lists.reorder(db, p, key, payload.get("values"))


@router.post("/options/{key}/reset", summary="Back to the built-in options (Super Admin)")
def reset_options(key: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return option_lists.reset(db, p, key)
