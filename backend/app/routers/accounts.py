"""User accounts - the Super Admin's tool for creating logins and deciding role, branch and module permissions."""
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_super_admin
from app.core.permissions import JOB_PROFILES, MODULES, default_permissions_for
from app.db.session import get_db
from app.services import accounts

router = APIRouter(prefix="/userAccounts", tags=["User Management (Super Admin)"], dependencies=[Depends(require_super_admin)])


@router.get("", summary="List accounts (q, status, branch, accessLevel, role, page, pageSize, all)")
def list_(request: Request, db: Session = Depends(get_db)):
    return accounts.list_accounts(db, dict(request.query_params))


@router.get("/permission-templates", summary="Starting permission sets per job profile, and the module list")
def templates(db: Session = Depends(get_db)):
    from app.services import roles

    state = roles.payload(db)
    return {"modules": MODULES, "profiles": state["permissions"], "roles": state["roles"]}


@router.get("/{user_id}", summary="One account")
def get_(user_id: str, db: Session = Depends(get_db)):
    return accounts.account_json(accounts.get_user(db, user_id))


@router.post("", status_code=201, summary="Create an Admin / Employee login with branch, role, permissions and credentials")
def create_(payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.create_account(db, p, payload)


@router.put("/{user_id}", summary="Edit an account (role, branch, permissions, status, identity)")
def update_(user_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.update_account(db, p, user_id, payload)


@router.get("/{user_id}/sessions", summary="Where this account is signed in")
def account_sessions(user_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.sessions_of(db, user_id)


@router.get("/{user_id}/activity", summary="The account's security trail")
def account_activity(user_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.activity_of(db, user_id)


@router.post("/{user_id}/reset-password", summary="Issue a one-time temporary password")
def reset_(user_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.admin_reset_password(db, p, user_id)


@router.post("/{user_id}/password", summary="Set a specific password for an account")
def set_password_(user_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.admin_set_password(db, p, user_id, payload.get("newPassword", ""), bool(payload.get("forcePasswordChange", True)))


@router.post("/{user_id}/terminate-sessions", summary="Sign the user out everywhere")
def terminate_(user_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.terminate_sessions(db, p, user_id)


@router.get("/{user_id}/delete-impact", summary="What deleting this person would touch, and whether it is allowed")
def delete_impact(user_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.deletion_impact(db, p, accounts.get_user(db, user_id).employee_id)


@router.delete("/{user_id}", summary="Delete a person: their login and their employee record together (reassignTo = who inherits their work)")
def delete_(user_id: str, reassignTo: str | None = None, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.delete_account(db, p, user_id, reassignTo)
