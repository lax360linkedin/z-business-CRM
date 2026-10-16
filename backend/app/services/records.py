"""The record engine: validated CRUD for every business module, defined once and configured per module by a `ModuleSpec`.

What it enforces for every module, so no module can forget it: the caller's permission (done by the router dependency), the caller's branch (db/branch.py), field
validation (types, lengths, required, allowed values), that every linked record exists *and is visible to the caller*, unique business rules, server-owned fields
(ids, numbers, timestamps, creator), and an audit entry per change. Module-specific business rules plug in through `Hooks`.
"""
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db import ids
from app.db.base import Base
from app.services import audit, automation
from app.services.codec import check_attributes_size, columns_of, coerce, model_for_table, split_payload, to_json

ID_PATTERN = re.compile(r"^[A-Za-z]{2,6}-[A-Za-z0-9-]{1,40}$")
RESERVED_PARAMS = {"page", "pageSize", "all", "q", "search", "sort", "order", "limit"}
MAX_ALL = 5000


@dataclass
class Ctx:
    db: Session
    principal: Principal
    spec: "ModuleSpec"
    state: dict = field(default_factory=dict)  # scratch space shared by the hooks of one operation (e.g. the value a field had before an update)


class Hooks:
    """Module business rules. Every method is optional; raise ApiError to refuse."""

    def authorize(self, ctx: Ctx, action: str) -> None:
        """Runs FIRST for create / update / delete - before validation and uniqueness checks - so a refusal never leaks what exists."""

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None: ...
    def after_create(self, ctx: Ctx, obj, payload: dict) -> None: ...
    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None: ...
    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None: ...
    def before_delete(self, ctx: Ctx, obj) -> None: ...
    def after_delete(self, ctx: Ctx, obj) -> None: ...
    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        """Last chance to shape the JSON of one record (add derived fields, hide fields)."""
        return data


@dataclass
class ModuleSpec:
    key: str  # URL segment and collection name (the React app's names: leads, salesOrders ...)
    model: type[Base]
    label: str  # the permission module label (Leads, Sales Orders ...)
    id_prefix: str
    id_width: int = 4
    number_prefix: str | None = None  # records with a human number (INV-2026-0001) get it server-side
    required: tuple[str, ...] = ()
    enums: dict[str, tuple[str, ...]] = field(default_factory=dict)
    search: tuple[str, ...] = ()
    unique: tuple[tuple[tuple[str, ...], str], ...] = ()  # ((fields...), message) - case-insensitive within the caller's branch
    protected: frozenset[str] = frozenset()  # keys a client may never write (server / workflow owned)
    default_sort: str = "created_at"
    row_filter: Callable[[Principal], Any] | None = None  # extra WHERE for the caller (e.g. an employee's own records)
    hooks: Hooks = field(default_factory=Hooks)
    protected_update: frozenset[str] = frozenset()  # keys that may be set on create but never changed afterwards
    client_ids: bool = False  # may the client choose the id of a new record? (no for business records: the server numbers them)
    open_actions: tuple[str, ...] = ()  # actions any signed-in user may take without the module permission (the rows are already limited to their own by row_filter)


# ---- helpers -----------------------------------------------------------------------------------------------------------
def _visible(spec: ModuleSpec, p: Principal):
    return spec.row_filter(p) if spec.row_filter else None


def get_or_404(db: Session, spec: ModuleSpec, p: Principal, record_id: str):
    stmt = select(spec.model).where(spec.model.id == record_id)
    extra = _visible(spec, p)
    if extra is not None:
        stmt = stmt.where(extra)
    obj = db.execute(stmt).scalar_one_or_none()
    if obj is None:
        raise not_found(f"{spec.label.rstrip('s')} not found.")
    return obj


def _validate_enums(spec: ModuleSpec, values: dict) -> None:
    cols = columns_of(spec.model)
    for key, allowed in spec.enums.items():
        column = cols.get(key)
        if column is not None and column.key in values and values[column.key] not in (None, "") and values[column.key] not in allowed:
            raise invalid(f"{key} must be one of: {', '.join(allowed)}.", {key: "Not an allowed value."})


def validate_links(db: Session, model, values: dict) -> None:
    """Every foreign key that is set must point at a record that exists and that the caller can see (a record in another branch looks like it does not exist)."""
    for fk in model.__table__.foreign_keys:
        key = fk.parent.key
        if key not in values or values[key] in (None, ""):
            continue
        if fk.parent.name == "branch":
            continue
        target = model_for_table(Base, fk.column.table.name)
        if target is None:
            continue
        exists = db.execute(select(fk.column.table.c[fk.column.name]).select_from(target).where(getattr(target, fk.column.key) == values[key]).limit(1)).first()
        if exists is None:
            label = re.sub(r"_id$", "", key).replace("_", " ")
            raise invalid(f"The linked {label} was not found.", {camel_key(key): f"Linked {label} not found."})


def camel_key(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(w.capitalize() for w in rest)


def _unique_check(db: Session, spec: ModuleSpec, values: dict, exclude_id: str | None) -> None:
    for fields, message in spec.unique:
        cols = [getattr(spec.model, f) for f in fields]
        if any(values.get(f) in (None, "") for f in fields):
            continue
        conds = [func.lower(c) == str(values[f]).strip().lower() if isinstance(values[f], str) else c == values[f] for c, f in zip(cols, fields)]
        if exclude_id:
            conds.append(spec.model.id != exclude_id)
        if db.execute(select(spec.model.id).where(*conds).limit(1)).first():
            raise conflict(message, {camel_key(fields[-1]): message})


def _check_required(spec: ModuleSpec, payload: dict, values: dict) -> None:
    cols = columns_of(spec.model)
    missing = {}
    for key in spec.required:
        column = cols.get(key)
        value = values.get(column.key) if column is not None and column.key in values else payload.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing[key] = "Required."
    if missing:
        raise invalid("Please fill in the required fields: " + ", ".join(missing) + ".", missing)


def _new_record_id(db: Session, spec: ModuleSpec, requested: Any) -> str:
    """Ids are allocated here, in sequence. A client-chosen id is honoured only by the few modules that opt in (templates whose starter ids are well known)."""
    if spec.client_ids and isinstance(requested, str) and ID_PATTERN.match(requested):
        if db.get(spec.model, requested) is None and db.execute(select(spec.model.id).where(spec.model.id == requested)).first() is None:
            return requested
        raise conflict("A record with this id already exists.", {"id": "Already exists."})
    for _ in range(20):
        candidate = ids.new_id(db, spec.id_prefix, spec.id_width)
        if db.execute(select(spec.model.id).where(spec.model.id == candidate)).first() is None:
            return candidate
    raise ApiError(500, "Could not allocate an id.", "ID_EXHAUSTED")


def _log(db: Session, p: Principal, spec: ModuleSpec, action: str, record_id: str, details: str = "") -> None:
    audit.record(db, user=p.user, action=f"{action} {spec.label.rstrip('s') if spec.label.endswith('s') and not spec.label.endswith('ss') else spec.label}", module=spec.label, record_id=record_id, details=details, info=p.info)


# ---- list --------------------------------------------------------------------------------------------------------------
def list_records(db: Session, spec: ModuleSpec, p: Principal, params: dict) -> dict | list:
    cols = columns_of(spec.model)
    conds = []
    extra = _visible(spec, p)
    if extra is not None:
        conds.append(extra)
    for key, raw in params.items():
        if key in RESERVED_PARAMS or key not in cols:
            continue
        column = cols[key]
        parts = [part for part in str(raw).split(",") if part != ""]
        if not parts:
            continue
        coerced = [coerce(column, key, part) for part in parts]
        conds.append(column.in_(coerced) if len(coerced) > 1 else (column.is_(None) if coerced[0] is None else column == coerced[0]))
    needle = (params.get("q") or params.get("search") or "").strip()
    if needle:
        like = f"%{needle.lower()}%"
        conds.append(or_(func.lower(spec.model.id).like(like), *[func.lower(cols[f]).like(like) for f in spec.search if f in cols]))

    sort_key = params.get("sort") or ""
    sort_col = cols.get(sort_key) if sort_key in cols else getattr(spec.model, spec.default_sort)
    ordering = [sort_col.asc() if str(params.get("order", "desc")).lower() == "asc" else sort_col.desc(), spec.model.id.desc()]

    if str(params.get("all", "")).lower() == "true":
        rows = db.execute(select(spec.model).where(*conds).order_by(*ordering).limit(MAX_ALL)).scalars().all()
        ctx = Ctx(db, p, spec)
        return [spec.hooks.present(ctx, r, to_json(r)) for r in rows]

    try:
        page, size = max(1, int(params.get("page", 1))), int(params.get("pageSize", 10))
    except ValueError:
        raise invalid("Invalid pagination.", {"page": "Must be a number."}) from None
    if not 1 <= size <= 200:
        raise invalid("pageSize must be between 1 and 200.", {"pageSize": "Between 1 and 200."})
    total = db.execute(select(func.count(spec.model.id)).where(*conds)).scalar_one()
    rows = db.execute(select(spec.model).where(*conds).order_by(*ordering).offset((page - 1) * size).limit(size)).scalars().all()
    ctx = Ctx(db, p, spec)
    return {"data": [spec.hooks.present(ctx, r, to_json(r)) for r in rows], "total": total, "page": page, "pageSize": size}


# ---- create / read / update / delete -----------------------------------------------------------------------------------
def build_record(db: Session, spec: ModuleSpec, p: Principal, payload: dict) -> Any:
    """Validate a create body and return the (unsaved) model instance - modules with their own create paths reuse this."""
    values, attrs = split_payload(spec.model, payload, protected=set(spec.protected))
    check_attributes_size(attrs)
    _check_required(spec, payload, values)
    _validate_enums(spec, values)
    if "branch" in values and not p.scope.all_access:
        values.pop("branch")  # a branch user's record always goes to their own branch (the scope enforces it; an attempt to name another is refused there)
    validate_links(db, spec.model, values)
    _unique_check(db, spec, {**values, "branch": values.get("branch") or p.scope.write}, None)
    obj = spec.model(**values, attributes=attrs)
    for column in spec.model.__table__.columns:  # apply scalar column defaults now, so module rules see the real starting values (status "New", stage "Deal Created" ...)
        if getattr(obj, column.key, None) is None and column.default is not None and getattr(column.default, "is_scalar", False):
            setattr(obj, column.key, column.default.arg)
    obj.id = _new_record_id(db, spec, payload.get("id"))
    if spec.number_prefix and hasattr(spec.model, "number"):
        obj.number = ids.new_number(db, spec.number_prefix)
    if hasattr(spec.model, "created_date") and getattr(obj, "created_date", None) is None:
        obj.created_date = date.today()
    obj.created_by = p.actor_id
    return obj


LINK_NAME = {"company": ("companies", "name"), "contact": ("contacts", "name"), "customer": ("customers", "name"), "deal": ("deals", "name")}


def sync_link_names(db: Session, obj, only_if_changed_from: dict | None = None) -> None:
    """The display name stored next to a link (companyName beside companyId ...) is server-owned: it always follows the linked record, never what the browser typed."""
    from sqlalchemy import select as _select

    cols = set(obj.__table__.c.keys())
    for prefix, (table, attr) in LINK_NAME.items():
        id_col, name_col = f"{prefix}_id", f"{prefix}_name"
        if id_col not in cols or name_col not in cols:
            continue
        link_id = getattr(obj, id_col)
        if not link_id:
            continue
        if only_if_changed_from is not None and only_if_changed_from.get(id_col) == link_id and getattr(obj, name_col):
            continue
        model = model_for_table(Base, table)
        value = db.execute(_select(getattr(model, attr)).where(model.id == link_id)).scalar_one_or_none()
        if value is not None:
            setattr(obj, name_col, value)


def create_record(db: Session, spec: ModuleSpec, p: Principal, payload: dict) -> dict:
    ctx = Ctx(db, p, spec)
    spec.hooks.authorize(ctx, "create")
    obj = build_record(db, spec, p, payload)
    sync_link_names(db, obj)
    spec.hooks.before_create(ctx, obj, payload)
    db.add(obj)
    db.flush()  # branch stamping and every constraint run here
    spec.hooks.after_create(ctx, obj, payload)
    _log(db, p, spec, "Created", obj.id)
    runs = automation.capture(db, p, spec.key, "created", obj)  # n8n workflows listening to this event (queued in this same transaction)
    db.commit()
    automation.fire(runs)
    return spec.hooks.present(ctx, obj, to_json(obj))


def get_record(db: Session, spec: ModuleSpec, p: Principal, record_id: str) -> dict:
    obj = get_or_404(db, spec, p, record_id)
    return spec.hooks.present(Ctx(db, p, spec), obj, to_json(obj))


def apply_update(db: Session, spec: ModuleSpec, p: Principal, obj, payload: dict, ctx: Ctx | None = None) -> dict:
    """Merge a (partial) body into an existing record. Returns the changes by JSON key."""
    ctx = ctx or Ctx(db, p, spec)
    protected = set(spec.protected) | set(spec.protected_update) | {"branch"}  # a record never changes branch through the API
    values, attrs = split_payload(spec.model, payload, protected=protected)
    check_attributes_size(attrs)
    cols = {c.key: k for k, c in columns_of(spec.model).items()}
    changes: dict[str, Any] = {}
    _validate_enums(spec, values)
    for key, value in values.items():
        if getattr(obj, key) != value:
            changes[cols.get(key, key)] = value
    for key in spec.required:  # a required field cannot be blanked
        column = columns_of(spec.model).get(key)
        if column is not None and column.key in values and (values[column.key] is None or (isinstance(values[column.key], str) and not values[column.key].strip())):
            raise invalid(f"{key} is required.", {key: "Required."})
    changed_cols = {k: v for k, v in values.items() if getattr(obj, k) != v}
    validate_links(db, spec.model, changed_cols)
    if changed_cols:
        _unique_check(db, spec, {**{c.key: getattr(obj, c.key) for c in spec.model.__table__.columns if c.key in {f for fs, _ in spec.unique for f in fs}}, **changed_cols}, obj.id)
    new_attrs = {**(obj.attributes or {}), **attrs}
    if new_attrs != (obj.attributes or {}):
        for key in attrs:
            if (obj.attributes or {}).get(key) != attrs[key]:
                changes[key] = attrs[key]
    spec.hooks.before_update(ctx, obj, changes, payload)
    for key, value in changed_cols.items():
        setattr(obj, key, value)
    if new_attrs != (obj.attributes or {}):
        obj.attributes = new_attrs
    return changes


def update_record(db: Session, spec: ModuleSpec, p: Principal, record_id: str, payload: dict) -> dict:
    ctx = Ctx(db, p, spec)
    spec.hooks.authorize(ctx, "update")
    obj = get_or_404(db, spec, p, record_id)
    before = {c: getattr(obj, c) for c in obj.__table__.c.keys() if c.endswith("_id")}
    changes = apply_update(db, spec, p, obj, payload, ctx)
    sync_link_names(db, obj, before)
    db.flush()
    spec.hooks.after_update(ctx, obj, changes, payload)
    if changes:
        _log(db, p, spec, "Updated", obj.id, "Changed: " + ", ".join(sorted(changes)))
    runs = automation.capture(db, p, spec.key, "updated", obj, changes) if changes else []
    db.commit()
    automation.fire(runs)
    return spec.hooks.present(ctx, obj, to_json(obj))


def delete_record(db: Session, spec: ModuleSpec, p: Principal, record_id: str) -> dict:
    ctx = Ctx(db, p, spec)
    spec.hooks.authorize(ctx, "delete")
    obj = get_or_404(db, spec, p, record_id)
    spec.hooks.before_delete(ctx, obj)
    try:
        db.delete(obj)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict(f"This {spec.label.rstrip('s').lower()} is linked to other records and cannot be deleted. Remove or reassign them first.", code="IN_USE") from None
    spec.hooks.after_delete(ctx, obj)
    _log(db, p, spec, "Deleted", record_id)
    db.commit()
    return {"success": True}
