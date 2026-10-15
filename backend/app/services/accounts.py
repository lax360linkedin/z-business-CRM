"""Login accounts, managed by the Super Admin alone: create (with branch, role, module permissions, credentials), edit, lock, reset, terminate sessions.

Rules the server enforces here (the browser only reflects them): only Admin / Employee accounts can be created; nobody changes their own role, branch, status or
permissions; a Super Admin account is protected; every non-Super-Admin account belongs to exactly one existing, active branch; a password is never stored in clear and
is never returned - an admin reset returns a one-time temporary password.
"""
import re
from datetime import UTC, date, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.core.permissions import JOB_PROFILES, has_any_view, normalise_permissions
from app.core.security import hash_password, temp_password
from app.db import ids
from app.models.identity import Branch, Department, Employee, User
from app.services import audit, auth_service
from app.services.codec import serialise_value

EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$")
AVATARS = ("bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300", "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
           "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
           "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300")
EDITABLE_STATUSES = ("Active", "Pending", "Suspended", "Locked", "Inactive")


def initials_of(name: str) -> str:
    parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


def account_json(user: User) -> dict:
    return {
        "id": user.id, "employeeId": user.employee_id, "firstName": user.first_name, "lastName": user.last_name, "name": user.name, "email": user.email, "phone": user.phone,
        "username": user.username, "accessLevel": user.access_level, "role": user.job_role, "roles": [user.job_role], "department": user.department, "status": user.status,
        "forcePasswordChange": user.force_password_change, "failedAttempts": user.failed_attempts, "lockedUntil": serialise_value(user.locked_until),
        "passwordChangedAt": serialise_value(user.password_changed_at), "passwordChangedBy": user.password_changed_by, "lastLogin": serialise_value(user.last_login_at),
        "createdDate": user.created_at.date().isoformat(), "initials": user.initials, "avatarColor": user.avatar_color, "branch": user.branch, "branchAccess": user.branch_access,
        "permissions": user.permissions, "permissionsEffective": auth_service.permissions_of(user), "employeeBranch": user.employee.branch if user.employee else None,
    }


def get_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("Account not found.")
    return user


def list_accounts(db: Session, params: dict) -> dict | list:
    conds = []
    for key, column in (("status", User.status), ("accessLevel", User.access_level), ("branch", User.branch), ("role", User.job_role)):
        if params.get(key):
            conds.append(column.in_([v for v in str(params[key]).split(",") if v]))
    needle = (params.get("q") or params.get("search") or "").strip().lower()
    if needle:
        like = f"%{needle}%"
        conds.append(or_(func.lower(User.name).like(like), func.lower(User.email).like(like), func.lower(User.username).like(like), func.lower(User.department).like(like)))
    stmt = select(User).where(*conds).order_by(User.created_at.desc(), User.id.desc())
    if str(params.get("all", "")).lower() == "true":
        return [account_json(u) for u in db.execute(stmt.limit(5000)).scalars().unique()]
    page, size = max(1, int(params.get("page", 1) or 1)), min(200, max(1, int(params.get("pageSize", 10) or 10)))
    total = db.execute(select(func.count(User.id)).where(*conds)).scalar_one()
    rows = db.execute(stmt.offset((page - 1) * size).limit(size)).scalars().unique().all()
    return {"data": [account_json(u) for u in rows], "total": total, "page": page, "pageSize": size}


# ---- validation helpers --------------------------------------------------------------------------------------------------
ADMINS_MIN, ADMINS_MAX = 2, 3  # a branch is run by two or three admins


def branch_admins(db: Session, branch: str, exclude_id: str | None = None) -> list[User]:
    """The active Admin logins of one branch (Super Admin excluded: it belongs to no single branch)."""
    stmt = select(User).where(User.access_level == "Admin", User.branch == branch, User.status == "Active")
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return list(db.execute(stmt.order_by(User.name)).scalars().unique())


def admin_coverage(count: int) -> str:
    """none / low (below the usual two) / ok / high (above the usual three)."""
    return "none" if count == 0 else "low" if count < ADMINS_MIN else "ok" if count <= ADMINS_MAX else "high"


def _guard_admin_count(db: Session, branch: str, payload: dict, exclude_id: str | None = None) -> None:
    """Adding a fourth admin to a branch is allowed, but only on purpose: the Super Admin is asked to confirm (confirmExtraAdmin)."""
    have = len(branch_admins(db, branch, exclude_id))
    if have >= ADMINS_MAX and not payload.get("confirmExtraAdmin"):
        raise conflict(f"{branch} already has {have} admins (the usual number is {ADMINS_MIN} to {ADMINS_MAX}). Confirm to add another.", {"accessLevel": "Too many admins for this branch."}, code="ADMIN_LIMIT")


def _leave_branch(db: Session, employee: Employee, old: str | None, new: str, p: Principal) -> None:
    """Moving someone to another branch ends their ties to the old one: their team and manager, the teams they led there and the people who reported to them."""
    from datetime import UTC, datetime

    from app.models.identity import Team

    employee.team_id = employee.sub_team_id = employee.reports_to = None
    for team in db.execute(select(Team).where((Team.leader_id == employee.id) | (Team.deputy_id == employee.id))).scalars():
        if team.leader_id == employee.id:
            team.leader_id = None
        if team.deputy_id == employee.id:
            team.deputy_id = None
    for report in db.execute(select(Employee).where(Employee.reports_to == employee.id)).scalars():
        report.reports_to = None
    attrs = dict(employee.attributes or {})
    attrs["timeline"] = [*attrs.get("timeline", []), {"at": datetime.now(UTC).isoformat().replace("+00:00", "Z"), "type": "BranchChanged", "text": f"Moved from {old or 'no branch'} to {new}", "from": old, "to": new, "by": p.actor_id}]
    employee.attributes = attrs


def _active_branch(db: Session, name: str | None) -> str:
    branch = db.execute(select(Branch).where(Branch.name == (name or ""))).scalar_one_or_none()
    if branch is None:
        raise invalid("Assign a branch (Salem, Mumbai or Bangalore).", {"branch": "Choose a branch."})
    if branch.status != "Active":
        raise invalid(f"The {branch.name} branch is inactive.", {"branch": "Branch is inactive."})
    return branch.name


def _check_identity(db: Session, email: str, username: str, exclude_id: str | None = None) -> None:
    if not EMAIL.match(email or ""):
        raise invalid("Enter a valid email address.", {"email": "Invalid email."})
    if not USERNAME.match(username or ""):
        raise invalid("Username must be 3-40 letters, numbers, . _ -", {"username": "Invalid username."})
    for column, value, label in ((User.email, email, "email"), (User.username, username, "username")):
        stmt = select(User.id).where(func.lower(column) == value.lower())
        if exclude_id:
            stmt = stmt.where(User.id != exclude_id)
        if db.execute(stmt).first():
            raise conflict(f"That {label} is already taken.", {label: "Already taken."})


def _check_permissions(raw) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise invalid("Permissions must be an object.", {"permissions": "Invalid."})
    perms = normalise_permissions(raw)
    if not has_any_view(perms):
        raise invalid("Give the account access to at least one module.", {"permissions": "Choose at least one module."})
    return perms


def _job_role(level: str, requested: str | None, db: Session | None = None) -> str:
    if level == "Admin":
        return "Admin"
    custom = []
    if db is not None:
        from app.services import roles

        custom = roles._row(db)["custom"]
    return requested if (requested in JOB_PROFILES and requested != "Admin") or requested in custom else "Employee"


def _new_employee_id(db: Session) -> str:
    for _ in range(50):
        candidate = ids.new_id(db, "EMP", 3)
        if db.get(Employee, candidate) is None:
            return candidate
    raise ApiError(500, "Could not allocate an employee id.", "ID_EXHAUSTED")


def _department_id(db: Session, name: str | None) -> str | None:
    if not name:
        return None
    return db.execute(select(Department.id).where(func.lower(Department.name) == name.strip().lower())).scalar_one_or_none()


# ---- create ------------------------------------------------------------------------------------------------------------
def create_account(db: Session, p: Principal, payload: dict) -> dict:
    level = payload.get("accessLevel") or "Employee"
    if level == "Super Admin":
        raise forbidden("A Super Admin account cannot be created here.")
    if level not in ("Admin", "Employee"):
        raise invalid("Choose Admin or Employee.", {"accessLevel": "Choose Admin or Employee."})
    branch = _active_branch(db, payload.get("branch"))
    if level == "Admin":
        _guard_admin_count(db, branch, payload)
    email = (payload.get("email") or "").strip()
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    _check_identity(db, email, username)
    auth_service.check_new_password(password)
    permissions = _check_permissions(payload.get("permissions"))
    first, last = (payload.get("firstName") or "").strip(), (payload.get("lastName") or "").strip()
    if not first:
        raise invalid("First name is required.", {"firstName": "Required."})
    name = f"{first} {last}".strip()

    employee = None
    if payload.get("employeeId"):
        employee = db.get(Employee, payload["employeeId"])
        if employee is None:
            raise not_found("The linked employee was not found.")
        if db.execute(select(User.id).where(User.employee_id == employee.id)).first():
            raise conflict("This employee already has a CRM account.", {"employeeId": "Already has an account."})
        employee.branch = branch
    else:
        department = (payload.get("department") or "").strip()
        employee = Employee(
            id=_new_employee_id(db), full_name=name, official_email=email, mobile=(payload.get("phone") or "")[:30], designation=(payload.get("designation") or _job_role(level, payload.get("role")))[:120],
            job_title=(payload.get("designation") or "")[:120], join_date=date.today(), department_id=_department_id(db, department), status="Active", branch=branch, created_by=p.actor_id,
            attributes={"timeline": [{"at": datetime.now(UTC).isoformat().replace("+00:00", "Z"), "type": "Created", "text": "Employee record created with a CRM login", "by": p.actor_id}]},
        )
        db.add(employee)
    db.flush()

    user = User(
        id=ids.new_id(db, "USR", 4), employee_id=employee.id, first_name=first, last_name=last, name=name, email=email, username=username, phone=(payload.get("phone") or "")[:30],
        department=(payload.get("department") or "")[:120], password_hash=hash_password(password), access_level=level, job_role=_job_role(level, payload.get("role"), db), branch=branch,
        permissions=permissions, status="Active", force_password_change=payload.get("forcePasswordChange", True) is not False, initials=initials_of(name),
        avatar_color=AVATARS[sum(map(ord, name)) % len(AVATARS)], password_changed_by=p.name, created_by=p.actor_id,
    )
    db.add(user)
    db.flush()
    if auth_service.assignment_problem(db, user):
        raise invalid("The account would not be able to sign in (no module access).", {"permissions": "Choose at least one module."})
    audit.record(db, user=p.user, action="Create account", module="User Management", record_id=user.id, details=f"{level} · {branch} · {user.job_role}", info=p.info)
    db.commit()
    return account_json(user)


# ---- update ------------------------------------------------------------------------------------------------------------
def update_account(db: Session, p: Principal, user_id: str, payload: dict) -> dict:
    user = get_user(db, user_id)
    is_self, is_super = user.id == p.user.id, user.access_level == "Super Admin"
    touches_access = any(k in payload for k in ("accessLevel", "role", "branch", "permissions", "status", "branchAccess"))
    if "branchAccess" in payload and payload["branchAccess"] != user.branch_access:
        raise forbidden("All-branch access is a fixed setting of the Super Admin account.")
    if touches_access and (is_self or is_super):
        changed = (payload.get("accessLevel", user.access_level) != user.access_level or payload.get("status", user.status) != user.status or payload.get("branch", user.branch) != user.branch
                   or ("role" in payload and payload["role"] != user.job_role) or ("permissions" in payload and payload["permissions"] != user.permissions))
        if changed:
            raise forbidden("You cannot change your own role, branch, permissions or status." if is_self else "The Super Admin account is protected.")
    changes = []
    target_branch = payload["branch"] if "branch" in payload and payload["branch"] else user.branch
    target_level = payload.get("accessLevel", user.access_level)
    if not is_super and target_level == "Admin" and (target_level != user.access_level or target_branch != user.branch) and target_branch:
        _guard_admin_count(db, _active_branch(db, target_branch), payload, exclude_id=user.id)

    if "accessLevel" in payload and payload["accessLevel"] != user.access_level:
        if payload["accessLevel"] not in ("Admin", "Employee"):
            raise invalid("Choose Admin or Employee.", {"accessLevel": "Choose Admin or Employee."})
        user.access_level = payload["accessLevel"]
        user.job_role = _job_role(user.access_level, payload.get("role", user.job_role), db)
        changes.append("accessLevel")
    if "role" in payload and not is_super:
        role = _job_role(user.access_level, payload["role"], db)
        if role != user.job_role:
            user.job_role = role
            changes.append("role")
    if "branch" in payload and not is_super and payload["branch"] != user.branch:
        old_branch = user.branch
        user.branch = _active_branch(db, payload["branch"])
        user.employee.branch = user.branch  # one source of truth: the account decides the branch of the person
        _leave_branch(db, user.employee, old_branch, user.branch, p)
        changes.append("branch")
    if "permissions" in payload and not is_super:
        user.permissions = _check_permissions(payload["permissions"])
        changes.append("permissions")
    if "status" in payload and payload["status"] != user.status:
        if payload["status"] not in EDITABLE_STATUSES:
            raise invalid("Unknown status.", {"status": "Unknown status."})
        user.status, user.failed_attempts = payload["status"], 0 if payload["status"] == "Active" else user.failed_attempts
        user.locked_until = None
        changes.append("status")

    for field, attr in (("firstName", "first_name"), ("lastName", "last_name"), ("phone", "phone"), ("department", "department")):
        if field in payload and payload[field] != getattr(user, attr):
            setattr(user, attr, str(payload[field] or "")[:120])
            changes.append(field)
    if "email" in payload or "username" in payload:
        email, username = (payload.get("email", user.email) or "").strip(), (payload.get("username", user.username) or "").strip()
        if email != user.email or username != user.username:
            _check_identity(db, email, username, exclude_id=user.id)
            user.email, user.username = email, username
            user.employee.official_email = email
            changes.append("email/username")
    if "forcePasswordChange" in payload:
        user.force_password_change = bool(payload["forcePasswordChange"])
        changes.append("forcePasswordChange")
    if {"firstName", "lastName"} & set(payload):
        user.name = f"{user.first_name} {user.last_name}".strip()
        user.initials = initials_of(user.name)
        user.employee.full_name = user.name
    if auth_service.assignment_problem(db, user) not in (None, "branch-inactive") and not is_super:
        raise invalid("That change would leave the account unable to sign in (no module access).", {"permissions": "Choose at least one module."})
    if changes:
        audit.record(db, user=p.user, action="Update account", module="User Management", record_id=user.id, details="Changed: " + ", ".join(changes), info=p.info)
    db.commit()
    return account_json(user)


def admin_reset_password(db: Session, p: Principal, user_id: str) -> dict:
    user = get_user(db, user_id)
    if user.access_level == "Super Admin" and user.id != p.user.id:
        raise forbidden("The Super Admin account is protected.")
    new = temp_password()
    auth_service.set_password(user, new, p.name, force_change=True)
    auth_service.revoke_all(db, user.id, "admin-reset")
    audit.record(db, user=p.user, action="Reset password", module="User Management", record_id=user.id, details=f"Temporary password issued to {user.name}.", info=p.info)
    db.commit()
    return {"temporaryPassword": new, "account": account_json(user)}  # shown once; only its hash is kept


def admin_set_password(db: Session, p: Principal, user_id: str, new_password: str, force_change: bool) -> dict:
    user = get_user(db, user_id)
    if user.access_level == "Super Admin" and user.id != p.user.id:
        raise forbidden("The Super Admin account is protected.")
    auth_service.check_new_password(new_password)
    auth_service.set_password(user, new_password, p.name, force_change=force_change)
    auth_service.revoke_all(db, user.id, "admin-set-password")
    audit.record(db, user=p.user, action="Set password", module="User Management", record_id=user.id, info=p.info)
    db.commit()
    return account_json(user)


def terminate_sessions(db: Session, p: Principal, user_id: str) -> dict:
    user = get_user(db, user_id)
    count = auth_service.revoke_all(db, user.id, "admin-terminated")
    audit.record(db, user=p.user, action="Terminate sessions", module="User Management", record_id=user.id, details=f"{count} session(s) ended.", info=p.info)
    db.commit()
    return {"terminated": count}


def delete_account(db: Session, p: Principal, user_id: str) -> dict:
    user = get_user(db, user_id)
    if user.access_level == "Super Admin" or user.id == p.user.id:
        raise forbidden("Super Admin accounts and your own account cannot be deleted.")
    db.delete(user)
    audit.record(db, user=p.user, action="Delete account", module="User Management", record_id=user_id, details=user.name, info=p.info)
    db.commit()
    return {"success": True}


def sessions_of(db: Session, user_id: str) -> list[dict]:
    """Where an account is (or recently was) signed in: device, address, times, and whether it can still be used."""
    from app.models.identity import AuthSession

    get_user(db, user_id)
    now = datetime.now(UTC)
    rows = db.execute(select(AuthSession).where(AuthSession.user_id == user_id).order_by(AuthSession.created_at.desc()).limit(30)).scalars()
    return [{"id": s.id, "device": s.device or "Browser", "ip": s.ip, "userAgent": s.user_agent, "createdAt": serialise_value(s.created_at), "lastUsedAt": serialise_value(s.last_used_at),
             "expiresAt": serialise_value(s.expires_at), "revokedAt": serialise_value(s.revoked_at), "revokeReason": s.revoke_reason,
             "active": s.revoked_at is None and s.expires_at > now} for s in rows]


def activity_of(db: Session, user_id: str, limit: int = 50) -> list[dict]:
    """The account's security trail (sign-ins, refusals, password and permission changes), newest first."""
    from app.models import AuditLog

    get_user(db, user_id)
    rows = db.execute(select(AuditLog).where(AuditLog.user_id == user_id).order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(limit)).scalars()
    return [{"id": r.id, "at": serialise_value(r.at), "action": r.action, "module": r.module, "result": r.result, "details": r.details, "ip": r.ip} for r in rows]
