from fastapi import APIRouter, Body, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, request_info
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.identity import Branch
from app.services import audit, auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=254, description="Email address or username")
    password: str = Field(min_length=1, max_length=200)
    branch: str | None = Field(default=None, max_length=40, description="Optional. Blank / 'automatic' = the branch assigned to the account; otherwise it must equal it ('all' only for an all-branch Super Admin).")


class RefreshIn(BaseModel):
    refreshToken: str = Field(min_length=10, max_length=200)


class ChangePasswordIn(BaseModel):
    currentPassword: str = Field(default="", max_length=200)
    newPassword: str = Field(min_length=1, max_length=200)


class ForgotIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=254)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    newPassword: str = Field(min_length=1, max_length=200)


@router.get("/branches", summary="Branch names for the sign-in form (public, names only)")
def public_branches(db: Session = Depends(get_db)):
    return [{"name": b.name, "code": b.code} for b in db.execute(select(Branch).where(Branch.status == "Active").order_by(Branch.name)).scalars()]


@router.post("/login", summary="Sign in with email/username + password (+ optional branch)")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    selected = None if (body.branch or "").strip().lower() in ("", "auto", "automatic") else body.branch.strip()
    if selected and selected.lower() == "all":
        selected = "all"
    user, tokens = auth_service.login(db, body.identifier, body.password, selected, request_info(request))
    return {"user": auth_service.public_user(db, user), "tokens": tokens}


@router.post("/refresh", summary="Exchange a refresh token for a new access token (the refresh token rotates)")
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    user, tokens = auth_service.refresh(db, body.refreshToken, request_info(request))
    return {"user": auth_service.public_user(db, user), "tokens": tokens}


@router.post("/logout", summary="End the current session")
def logout(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    auth_service.revoke_session(db, p.session, "logout")
    audit.record(db, user=p.user, action="Logout", module="Authentication", info=p.info)
    db.commit()
    return {"success": True}


@router.post("/activity", summary="Heartbeat: the person is using the app (resets the inactivity clock; background polling must not call this)")
def activity(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return auth_service.touch_activity(db, p.session)


@router.get("/sessions", summary="Where I am signed in (this device and others)")
def my_sessions(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from app.services import accounts

    return [{**s, "current": s["id"] == p.session.id} for s in accounts.sessions_of(db, p.user.id)]


@router.delete("/sessions/{session_id}", summary="Sign one of my other devices out")
def end_session(session_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from sqlalchemy import select

    from app.core.errors import not_found
    from app.models.identity import AuthSession

    target = db.execute(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == p.user.id)).scalar_one_or_none()
    if target is None:
        raise not_found("Session not found.")
    auth_service.revoke_session(db, target, "signed-out-by-user")
    audit.record(db, user=p.user, action="Session ended", module="Authentication", details=f"{session_id}", info=p.info)
    db.commit()
    return {"success": True}


@router.post("/logout-all", summary="Sign out everywhere, this device included")
def logout_all(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    count = auth_service.revoke_all(db, p.user.id, "signed-out-everywhere")
    audit.record(db, user=p.user, action="Signed out everywhere", module="Authentication", details=f"{count} session(s)", info=p.info)
    db.commit()
    return {"ended": count}


@router.get("/me", summary="The signed-in user: identity, role, branch, effective permissions")
def me(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return auth_service.public_user(db, p.user)


@router.put("/me", summary="Update my own name and phone number")
def update_me(payload: dict = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    import re

    from app.core.errors import invalid
    from app.services.accounts import initials_of

    user, employee = p.user, p.user.employee
    name = str(payload.get("name", user.name) or "").strip()
    phone = str(payload.get("phone", user.phone) or "").strip()
    if len(name) < 2 or len(name) > 160:
        raise invalid("Enter your full name.", {"name": "Enter your full name."})
    if phone and not re.fullmatch(r"[+0-9()\-\s]{7,20}", phone):
        raise invalid("Enter a valid phone number.", {"phone": "Enter a valid phone number."})
    first, _, last = name.partition(" ")
    user.name, user.first_name, user.last_name, user.phone, user.initials = name, first, last, phone, initials_of(name)
    if employee is not None:
        employee.full_name, employee.mobile = name, phone
    audit.record(db, user=user, action="Profile updated", module="Authentication", info=p.info)
    db.commit()
    return auth_service.public_user(db, user)


@router.post("/change-password", summary="Change your own password (ends your other sessions)")
def change_password(body: ChangePasswordIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    auth_service.change_own_password(db, p.user, p.session, body.currentPassword, body.newPassword, p.info)
    return {"success": True}


@router.post("/forgot-password", status_code=202, summary="Start a password reset (always answers the same)")
def forgot_password(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    token = auth_service.request_password_reset(db, body.identifier, request_info(request))
    out = {"message": "If the account exists, a reset link has been prepared."}
    if token and get_settings().debug and not get_settings().is_production:
        out["devResetToken"] = token  # only while DEBUG: there is no mail server wired yet
    return out


@router.post("/reset-password", summary="Finish a password reset with the token")
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    auth_service.reset_password(db, body.token, body.newPassword, request_info(request))
    return {"success": True}
