"""Role templates: the starting permission set of each job profile, editable by the Super Admin, plus custom roles she adds. An account with no permission set of its own follows
its role's template, so editing a template changes what those accounts may do on their next request. The Super Admin role is fixed, the Super-Admin-only modules can never be
granted through a template, and the Employees "create" right stays with the Super Admin."""
import copy

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, invalid, not_found
from app.core.permissions import JOB_PROFILES, MODULES, NONE, SUPER_ADMIN_ONLY_MODULES, default_permissions_for, has_any_view, normalise_permissions
from app.models import AppSetting, User
from app.services import audit

KEY = "role_templates"
PROTECTED_ROLES = ("Super Admin", "Admin")  # Admin is "everything except the Super-Admin-only modules": its template is fixed too


def _row(db: Session) -> dict:
    """The stored role templates. Read on every request (permissions of non-admins), so cached; callers get their own copy and may modify it."""
    from app.db.config_events import cached

    def load():
        row = db.get(AppSetting, KEY)
        value = dict(row.value) if row else {}
        return {"overrides": dict(value.get("overrides") or {}), "custom": list(value.get("custom") or [])}

    return copy.deepcopy(cached(db, "roles", load))


def _save(db: Session, p: Principal, value: dict) -> None:
    row = db.get(AppSetting, KEY)
    if row is None:
        db.add(AppSetting(key=KEY, value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id


def all_roles(db: Session) -> list[str]:
    return [*[r for r in JOB_PROFILES if r != "Employee" or True], *_row(db)["custom"]]


def template_for(db: Session, role: str) -> dict:
    """The permission set a role starts from: the Super Admin's edit if there is one, else the built-in default (a custom role starts from a plain employee's)."""
    state = _row(db)
    if role in state["overrides"]:
        return normalise_permissions(state["overrides"][role])
    return default_permissions_for(role if role in JOB_PROFILES else "Employee")


def clean(perms: dict) -> dict:
    out = normalise_permissions(perms)
    for module in SUPER_ADMIN_ONLY_MODULES:
        out[module] = dict(NONE)
    out["Employees"] = {**out["Employees"], "create": False}
    return out


def payload(db: Session) -> dict:
    state = _row(db)
    roles = [*JOB_PROFILES, *state["custom"]]
    return {"roles": roles, "custom": state["custom"], "builtIn": list(JOB_PROFILES), "modules": MODULES, "customized": sorted(state["overrides"]),
            "permissions": {r: template_for(db, r) for r in roles}, "usage": {r: db.execute(select(User.id).where(User.job_role == r)).all().__len__() for r in roles}}


def set_template(db: Session, p: Principal, role: str, perms: dict) -> dict:
    state = _row(db)
    if role in PROTECTED_ROLES:
        raise conflict(f"The {role} role is fixed and cannot be edited.")
    if role not in JOB_PROFILES and role not in state["custom"]:
        raise not_found("Role not found.")
    cleaned = clean(perms or {})
    if not has_any_view(cleaned):
        raise invalid("A role needs access to at least one module.", {"permissions": "Choose at least one module."})
    state["overrides"][role] = cleaned
    _save(db, p, state)
    audit.record(db, user=p.user, action="Role template changed", module="Roles & Permissions", record_id=role, info=p.info)
    db.commit()
    return payload(db)


def reset_template(db: Session, p: Principal, role: str) -> dict:
    state = _row(db)
    state["overrides"].pop(role, None)
    _save(db, p, state)
    audit.record(db, user=p.user, action="Role template reset", module="Roles & Permissions", record_id=role, info=p.info)
    db.commit()
    return payload(db)


def create_role(db: Session, p: Principal, name: str, copy_from: str | None) -> dict:
    name = (name or "").strip()
    state = _row(db)
    if len(name) < 2 or len(name) > 40:
        raise invalid("Give the role a name (2 to 40 characters).", {"name": "Give the role a name."})
    if name.lower() in {r.lower() for r in [*JOB_PROFILES, "Super Admin", *state["custom"]]}:
        raise conflict("A role with this name already exists.", {"name": "Already exists."})
    state["custom"].append(name)
    state["overrides"][name] = clean(template_for(db, copy_from) if copy_from else default_permissions_for("Employee"))
    _save(db, p, state)
    audit.record(db, user=p.user, action="Role created", module="Roles & Permissions", record_id=name, info=p.info)
    db.commit()
    return payload(db)


def delete_role(db: Session, p: Principal, name: str) -> dict:
    state = _row(db)
    if name not in state["custom"]:
        raise conflict("Only a custom role can be deleted.")
    if db.execute(select(User.id).where(User.job_role == name).limit(1)).first():
        raise conflict("Accounts still use this role. Move them to another role first.", code="IN_USE")
    state["custom"].remove(name)
    state["overrides"].pop(name, None)
    _save(db, p, state)
    audit.record(db, user=p.user, action="Role deleted", module="Roles & Permissions", record_id=name, info=p.info)
    db.commit()
    return payload(db)
