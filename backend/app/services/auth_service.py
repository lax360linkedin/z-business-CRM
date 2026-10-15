"""Authentication: credential + account + branch validation, sessions with rotating refresh tokens, and the password flows.

Order of checks at sign-in (each failure is audited; none reveals which part was wrong beyond what the user needs):
  branch value valid -> account exists -> status (lockout auto-expires) -> password (failed attempts counted, account locks) -> role / branch / module access assigned and valid
  -> the picked branch (if any) equals the assigned one.
The role and branch always come from the stored account. A branch picked on the form is only compared with it; "automatic" (blank) means "use my assigned branch".
"""
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError, forbidden, invalid, unauthorized
from app.core.permissions import effective_permissions, has_any_view
from app.core.security import (create_access_token, decode_access_token, hash_password, new_token, password_problems, sha256,
                               verify_password)
from app.models.identity import ACCESS_LEVELS, AuthSession, Branch, PasswordReset, User
from app.services import audit
from app.services.audit import RequestInfo

log = logging.getLogger("app.auth")
ALL = "all"
_DUMMY_HASH = hash_password("not-a-real-password-Aa1!")  # verified against when the account does not exist, so timing does not reveal which part failed

STATUS_MESSAGES = {
    "Inactive": ("Your account is currently inactive. Please contact your administrator.", "ACCOUNT_INACTIVE"),
    "Pending": ("Your account is pending activation. Please contact your administrator.", "ACCOUNT_PENDING"),
    "Suspended": ("Your account has been suspended. Please contact your administrator.", "ACCOUNT_SUSPENDED"),
    "Locked": ("Your account has been temporarily locked due to multiple unsuccessful login attempts. Please try again later or contact your administrator.", "ACCOUNT_LOCKED"),
}
PROBLEMS = {
    "unassigned": ("Your account is not fully set up (role, branch or module access is missing). Please contact your Super Admin.", "ACCOUNT_NOT_CONFIGURED"),
    "branch-inactive": ("Your branch is currently inactive. Please contact your Super Admin.", "BRANCH_INACTIVE"),
    "branch-mismatch": ("The selected branch does not match the branch assigned to your account. Select your assigned branch and try again.", "BRANCH_MISMATCH"),
    "branch-invalid": ("Choose Salem, Mumbai, Bangalore, All Branches or leave the branch on Automatic.", "BRANCH_INVALID"),
}


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


# ---- who is this account allowed to be? --------------------------------------------------------------------------------
def permissions_of(user: User) -> dict:
    """What the account may do: its own permission set, else its role's template (the Super Admin can edit templates and add custom roles), then the hard locks."""
    stored = user.permissions
    if stored is None and user.access_level not in ("Super Admin", "Admin"):
        from sqlalchemy.orm import object_session

        db = object_session(user)
        if db is not None:
            from app.services import roles

            state = roles._row(db)  # cached
            if user.job_role in state["overrides"] or user.job_role in state["custom"]:
                stored = roles.template_for(db, user.job_role)
    return effective_permissions(user.access_level, user.job_role, stored)


def branch_statuses(db: Session) -> dict[str, str]:
    """branch name -> status, for every branch (a handful of rows, read on every request, so cached)."""
    from app.db.config_events import cached

    return cached(db, "branches", lambda: dict(db.execute(select(Branch.name, Branch.status)).all()))


def assignment_problem(db: Session, user: User, selected: str | None = None) -> str | None:
    """None when the stored account is fully and validly assigned (and `selected`, if given, matches); otherwise the key into PROBLEMS."""
    if user.access_level not in ACCESS_LEVELS or not has_any_view(permissions_of(user)):
        return "unassigned"
    if user.access_level == "Super Admin":
        if user.branch_access != ALL:
            return "unassigned"
    else:
        status = branch_statuses(db).get(user.branch) if user.branch else None
        if status is None:
            return "unassigned"
        if status != "Active":
            return "branch-inactive"
    if selected:
        if selected != ALL and selected not in branch_statuses(db):
            return "branch-invalid"
        if user.access_level != "Super Admin" and selected != user.branch:
            return "branch-mismatch"
    return None


def find_user(db: Session, identifier: str) -> User | None:
    key = (identifier or "").strip().lower()
    if not key:
        return None
    return db.execute(select(User).where((func.lower(User.email) == key) | (func.lower(User.username) == key))).scalar_one_or_none()


def public_user(db: Session, user: User) -> dict:
    """What the signed-in app needs to know about itself: identity, role, branch, permissions. Never a credential."""
    employee = user.employee
    return {
        "id": employee.id, "accountId": user.id, "name": user.name, "email": user.email, "username": user.username, "phone": user.phone,
        "accessLevel": user.access_level, "role": user.job_role, "branch": user.branch, "allBranches": user.access_level == "Super Admin" and user.branch_access == ALL,
        "department": user.department, "designation": employee.designation or "", "joinDate": employee.join_date.isoformat() if employee.join_date else None,
        "initials": user.initials, "avatarColor": user.avatar_color, "forcePasswordChange": user.force_password_change, "accountStatus": user.status,
        "permissions": permissions_of(user), "idleTimeoutMinutes": idle_timeout_minutes(db),
    }


# ---- sessions ----------------------------------------------------------------------------------------------------------
MIN_IDLE, MAX_IDLE = 5, 480


def idle_timeout_minutes(db: Session) -> int:
    """Minutes of inactivity after which a session ends: the Super Admin's setting if there is one, else the environment default."""
    from app.models import AppSetting

    from app.db.config_events import cached

    def load():
        row = db.get(AppSetting, "workspace:security")
        return (row.value or {}).get("idleTimeoutMinutes") if row else None

    value = cached(db, "idle-timeout", load)  # read on every request: cached (see core/config_cache.py)
    try:
        minutes = int(value) if value is not None else get_settings().idle_timeout_minutes
    except (TypeError, ValueError):
        minutes = get_settings().idle_timeout_minutes
    return max(MIN_IDLE, min(MAX_IDLE, minutes))


def _end_if_idle(db: Session, session: AuthSession) -> None:
    """The person has done nothing for the configured time: end the session for good (a distinct code, so the screen can say why)."""
    limit = idle_timeout_minutes(db)
    if (_now() - _aware(session.last_activity_at)).total_seconds() > limit * 60:
        session.revoked_at, session.revoke_reason = _now(), "idle"
        db.commit()  # persisted before the error is raised, which would otherwise roll it back
        raise unauthorized(f"You were signed out after {limit} minutes of inactivity. Please sign in again.", "SESSION_IDLE")


def touch_activity(db: Session, session: AuthSession) -> dict:
    """The person is using the app (the browser says so when they type, click, scroll ...). Background polling never calls this, so a forgotten open tab still times out."""
    session.last_activity_at = _now()
    db.commit()
    return {"idleTimeoutMinutes": idle_timeout_minutes(db), "lastActivityAt": session.last_activity_at.isoformat()}


def _issue_tokens(db: Session, user: User, info: RequestInfo, session: AuthSession | None = None) -> dict:
    settings = get_settings()
    refresh = new_token(48)
    if session is None:
        session = AuthSession(id=uuid.uuid4().hex, user_id=user.id, device=info.device[:80], ip=info.ip[:64], user_agent=info.user_agent[:300],
                              refresh_hash=sha256(refresh), expires_at=_now() + timedelta(days=settings.session_days))
        db.add(session)
    else:
        session.prev_refresh_hash, session.refresh_hash = session.refresh_hash, sha256(refresh)
        session.last_used_at = _now()  # a renewal is the app's own housekeeping: it does NOT count as the person being active
    access, expires = create_access_token(user.id, session.id)
    return {"accessToken": access, "refreshToken": refresh, "expiresAt": expires.isoformat(), "sessionId": session.id}


def login(db: Session, identifier: str, password: str, selected_branch: str | None, info: RequestInfo) -> tuple[User, dict]:
    settings = get_settings()
    selected = (selected_branch or "").strip()
    if selected and selected != ALL and db.execute(select(Branch.id).where(Branch.name == selected)).first() is None:
        raise ApiError(422, PROBLEMS["branch-invalid"][0], PROBLEMS["branch-invalid"][1])

    user = find_user(db, identifier)
    if user is None:
        verify_password(password or "", _DUMMY_HASH)
        audit.record(db, action="Login Attempt", module="Authentication", result="Failed", details="No account found for this email or username.", name=(identifier or "")[:80], info=info)
        db.commit()
        raise unauthorized("Invalid email/username or password.", "INVALID_CREDENTIALS")

    # a lock that has run its course is lifted the moment the account is looked up
    if user.status == "Locked" and _aware(user.locked_until) and _now() >= _aware(user.locked_until):
        user.status, user.failed_attempts, user.locked_until = "Active", 0, None
    if user.status != "Active":
        message, code = STATUS_MESSAGES.get(user.status, ("Your account cannot sign in right now. Please contact your administrator.", "ACCOUNT_UNAVAILABLE"))
        audit.record(db, user=user, action="Login Attempt", module="Authentication", result="Denied", details=f"Account status: {user.status}.", info=info)
        db.commit()
        raise ApiError(403, message, code)

    if not verify_password(password or "", user.password_hash):
        user.failed_attempts += 1
        locked = user.failed_attempts >= settings.max_failed_logins
        if locked:
            user.status, user.locked_until = "Locked", _now() + timedelta(minutes=settings.lockout_minutes)
            audit.record(db, user=user, action="Account Locked", module="Authentication", result="Denied", details=f"Locked after {user.failed_attempts} failed attempts.", info=info)
        audit.record(db, user=user, action="Login Attempt", module="Authentication", result="Failed", details=f"Invalid password (attempt {user.failed_attempts}/{settings.max_failed_logins}).", info=info)
        db.commit()
        if locked:
            raise ApiError(403, STATUS_MESSAGES["Locked"][0], "ACCOUNT_LOCKED")
        raise unauthorized("Invalid email/username or password.", "INVALID_CREDENTIALS")

    problem = assignment_problem(db, user, selected)
    if problem:
        audit.record(db, user=user, action="Login Attempt", module="Authentication", result="Denied", details=f"Sign-in refused: {problem} (selected branch: {selected or 'automatic'}).", info=info)
        db.commit()
        raise ApiError(403, PROBLEMS[problem][0], PROBLEMS[problem][1])

    user.failed_attempts, user.locked_until = 0, None
    user.last_login_at, user.last_login_ip = _now(), info.ip[:64]
    tokens = _issue_tokens(db, user, info)
    audit.record(db, user=user, action="Login", module="Authentication", details=f"Signed in as {user.access_level}.", info=info)
    db.commit()
    return user, tokens


def validate_access(db: Session, token: str) -> tuple[User, AuthSession]:
    """Resolve an access token to its live user + session, or raise 401. The account is re-checked on EVERY request (deactivation / unassignment takes effect at once)."""
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise unauthorized("Your session has expired. Please sign in again.", "SESSION_EXPIRED") from None
    except jwt.PyJWTError:
        raise unauthorized("Not signed in.", "UNAUTHENTICATED") from None
    found = db.execute(select(AuthSession, User).join(User, User.id == AuthSession.user_id).where(AuthSession.id == payload["sid"])).first()  # session and account in ONE round trip
    session, user = (found[0], found[1]) if found else (None, None)
    if session is None or session.user_id != payload["sub"]:
        raise unauthorized("Not signed in.", "UNAUTHENTICATED")
    if session.revoked_at is not None or _now() >= _aware(session.expires_at):
        raise unauthorized("Your session has expired. Please sign in again.", "SESSION_IDLE" if session.revoke_reason == "idle" else "SESSION_EXPIRED")
    _end_if_idle(db, session)
    if user.status != "Active" or assignment_problem(db, user) is not None:
        raise unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED")
    if (_now() - _aware(session.last_used_at)).total_seconds() > 60:  # not a write per request
        session.last_used_at = _now()
        db.commit()
    return user, session


def refresh(db: Session, refresh_token: str, info: RequestInfo) -> tuple[User, dict]:
    h = sha256(refresh_token or "")
    session = db.execute(select(AuthSession).where(AuthSession.refresh_hash == h)).scalar_one_or_none()
    if session is None:
        stale = db.execute(select(AuthSession).where(AuthSession.prev_refresh_hash == h)).scalar_one_or_none()
        if stale is not None and stale.revoked_at is None:  # an already-rotated token came back: assume it leaked and end the session
            stale.revoked_at, stale.revoke_reason = _now(), "refresh-reuse"
            audit.record(db, user=db.get(User, stale.user_id), action="Refresh token reuse", module="Authentication", result="Denied", info=info)
            db.commit()
        raise unauthorized("Your session has expired. Please sign in again.", "SESSION_EXPIRED")
    if session.revoked_at is not None or _now() >= _aware(session.expires_at):
        raise unauthorized("Your session has expired. Please sign in again.", "SESSION_IDLE" if session.revoke_reason == "idle" else "SESSION_EXPIRED")
    _end_if_idle(db, session)
    user = db.get(User, session.user_id)
    if user is None or user.status != "Active" or assignment_problem(db, user) is not None:
        session.revoked_at, session.revoke_reason = _now(), "account-changed"
        db.commit()
        raise unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED")
    tokens = _issue_tokens(db, user, info, session)
    db.commit()
    return user, tokens


def revoke_session(db: Session, session: AuthSession, reason: str) -> None:
    if session.revoked_at is None:
        session.revoked_at, session.revoke_reason = _now(), reason


def revoke_all(db: Session, user_id: str, reason: str, except_session: str | None = None) -> int:
    count = 0
    for session in db.execute(select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))).scalars():
        if session.id != except_session:
            revoke_session(db, session, reason)
            count += 1
    return count


# ---- password flows ----------------------------------------------------------------------------------------------------
def check_new_password(password: str) -> None:
    missing = password_problems(password)
    if missing:
        raise invalid("The password needs " + ", ".join(missing) + ".", {"newPassword": "Needs " + ", ".join(missing) + "."})


def set_password(user: User, new_password: str, changed_by: str, force_change: bool = False) -> None:
    user.password_hash = hash_password(new_password)
    user.password_changed_at, user.password_changed_by = _now(), changed_by[:80]
    user.force_password_change = force_change
    user.failed_attempts, user.locked_until = 0, None
    if user.status == "Locked":
        user.status = "Active"


def change_own_password(db: Session, user: User, session: AuthSession, current: str, new: str, info: RequestInfo) -> None:
    if not user.force_password_change and not verify_password(current or "", user.password_hash):
        audit.record(db, user=user, action="Password change refused", module="Authentication", result="Failed", details="Current password incorrect.", info=info)
        db.commit()
        raise ApiError(422, "Current password is incorrect.", "VALIDATION_ERROR", {"currentPassword": "Current password is incorrect."})
    check_new_password(new)
    if verify_password(new, user.password_hash):
        raise invalid("Choose a password you have not used just now.", {"newPassword": "Same as the current password."})
    set_password(user, new, user.username or user.name)
    revoke_all(db, user.id, "password-changed", except_session=session.id)
    audit.record(db, user=user, action="Password Changed", module="Authentication", details="User changed their own password.", info=info)
    db.commit()


def request_password_reset(db: Session, identifier: str, info: RequestInfo) -> str | None:
    """Always answers the same to the caller. Returns the raw token only so a non-production environment can show it (there is no mail server wired here)."""
    user = find_user(db, identifier)
    if user is None or user.status in ("Inactive", "Suspended"):
        return None
    token = new_token(32)
    db.add(PasswordReset(id=uuid.uuid4().hex, user_id=user.id, token_hash=sha256(token), expires_at=_now() + timedelta(minutes=get_settings().password_reset_minutes)))
    audit.record(db, user=user, action="Password reset requested", module="Authentication", info=info)
    db.commit()
    log.info("password reset requested for account %s (no mail server configured: token not sent)", user.id)
    return token


def reset_password(db: Session, token: str, new: str, info: RequestInfo) -> None:
    reset = db.execute(select(PasswordReset).where(PasswordReset.token_hash == sha256(token or ""))).scalar_one_or_none()
    if reset is None or reset.used_at is not None or _now() >= _aware(reset.expires_at):
        raise ApiError(400, "This reset link is invalid or has expired.", "RESET_INVALID")
    check_new_password(new)
    user = db.get(User, reset.user_id)
    set_password(user, new, "Self (reset link)")
    reset.used_at = _now()
    revoke_all(db, user.id, "password-reset")
    audit.record(db, user=user, action="Password Reset", module="Authentication", info=info)
    db.commit()


def random_secret() -> str:
    return secrets.token_urlsafe(24)
