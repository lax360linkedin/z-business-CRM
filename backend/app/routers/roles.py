from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_super_admin
from app.db.session import get_db
from app.services import roles

router = APIRouter(prefix="/roles", tags=["Roles & Permissions (Super Admin)"], dependencies=[Depends(require_super_admin)])


@router.get("", summary="Every role with its permission template")
def list_roles(db: Session = Depends(get_db)):
    return roles.payload(db)


@router.post("", status_code=201, summary="Add a custom role (optionally copying another role's template)")
def create_role(payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return roles.create_role(db, p, payload.get("name", ""), payload.get("copyFrom"))


@router.put("/{name}/permissions", summary="Change a role's permission template")
def set_permissions(name: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return roles.set_template(db, p, name, payload.get("permissions") or {})


@router.post("/{name}/reset", summary="Return a role to its built-in template")
def reset(name: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return roles.reset_template(db, p, name)


@router.delete("/{name}", summary="Delete a custom role that no account uses")
def delete(name: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return roles.delete_role(db, p, name)
