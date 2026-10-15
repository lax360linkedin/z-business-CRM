"""Products & Services: the one catalogue every module picks from.

CATEGORIES are data, not code: the standard four are only the starting list, and anyone who may edit products adds more (`POST /products/categories`). A product's category must be
one of them (or one an existing product already carries, so nothing stored becomes invalid).

CONNECTIONS. Leads, enquiries, deals, projects and tickets point at a product through `product_id` (a real foreign key) and also keep its name, so a RENAME is carried to those
records here. Quotations, proposals, sales orders and invoices keep their own snapshot of every line on purpose (an issued document never changes when the catalogue does), but they
still count as "in use": a product that any record or document refers to can be deactivated but never deleted - enforced here, not just in the browser."""
import re

from datetime import UTC, datetime

from sqlalchemy import String, case, cast, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, invalid, not_found
from app.db import ids
from app.services import audit
from app.models import AppSetting, Deal, Enquiry, Invoice, Lead, Product, Project, Proposal, Quotation, SalesOrder, Ticket

CATEGORIES_KEY = "product_categories"

# (category, item-code prefix, services). The standard starting catalogue: prices are NOT invented - they start at 0 and are set by whoever owns pricing.
CATALOGUE = [
    ("Software & IT Services", "SIT", ["Website Development", "Web Applications", "Mobile Apps", "Custom ERP", "CRM", "SaaS Software", "AI Agents & Automation"]),
    ("Digital Marketing", "DMK", ["SEO", "Google Ads", "Meta Ads", "Social Media Management", "Content Creation", "Branding"]),
    ("CAD Services", "CAD", ["Civil CAD", "Mechanical CAD", "2D Drafting", "3D Modelling", "Technical Drawings"]),
    ("AI & Automation", "AIA", ["AI Chatbots", "Business Workflow Automation", "n8n Integrations", "AI-Powered Business Solutions"]),
]
DEFAULT_CATEGORIES = [c for c, _, _ in CATALOGUE]


def key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").casefold())


def clean(v, limit: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(v if v is not None else "")).strip()[:limit]


# ---- categories ------------------------------------------------------------------------------------------------------------------------
def categories(db: Session) -> list[str]:
    """The configured categories, plus any category an existing product still carries (a product is never left with a category that is not offered)."""
    from app.db.config_events import cached

    def load():
        row = db.get(AppSetting, CATEGORIES_KEY)
        return list((row.value or {}).get("categories", [])) if row else list(DEFAULT_CATEGORIES)

    base = list(cached(db, "product-categories", load))
    seen = {key(c) for c in base}
    for (cat,) in db.execute(select(Product.category).distinct()).all():
        if cat and key(cat) not in seen:
            base.append(cat)
            seen.add(key(cat))
    return base


def _category_name(raw) -> str:
    name = clean(raw, 80)
    if len(name) < 2:
        raise invalid("Enter the category name (at least 2 characters).", {"name": "Enter a name."})
    if any(ch in name for ch in "/\\?#%"):
        raise invalid("A category name cannot contain any of these characters: / \\ ? # %", {"name": "Remove the special characters."})
    return name


def _canonical(db: Session, name: str) -> str:
    found = next((c for c in categories(db) if key(c) == key(name)), None)
    if found is None:
        raise not_found("Category not found.")
    return found


def _store(db: Session, p: Principal, names: list[str]) -> None:
    row = db.get(AppSetting, CATEGORIES_KEY)
    if row is None:
        db.add(AppSetting(key=CATEGORIES_KEY, value={"categories": names}, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = {"categories": names}, p.actor_id


def _audit(db: Session, p: Principal, action: str, details: str) -> None:
    audit.record(db, user=p.user, action=action, module="Products & Services", details=details, info=p.info)


def _move_products(db: Session, old: str, new: str) -> int:
    t = Product.__table__
    return db.execute(update(t).where(t.c.category == old).values(category=new, updated_at=datetime.now(UTC))).rowcount or 0


def rename_category(db: Session, p: Principal, name: str, new_name: str) -> list[str]:
    """Renames a category everywhere at once: the configured list and every product that carries it (documents keep their own snapshot)."""
    old = _canonical(db, name)
    new = _category_name(new_name)
    if key(new) != key(old) and key(new) in {key(c) for c in categories(db)}:
        raise invalid("A category with this name already exists.", {"name": "Already exists."})
    if new == old:
        return categories(db)
    stored = [new if c == old else c for c in categories(db)]  # a category that only existed through its products joins the configured list under its new name
    moved = _move_products(db, old, new)
    _store(db, p, stored)
    _audit(db, p, "Product category renamed", f"{old} -> {new} ({moved} product(s))")
    db.commit()
    return categories(db)


def delete_category(db: Session, p: Principal, name: str, move_to: str | None = None) -> list[str]:
    """Removes a category. One that products still use can only go if they are moved to another category in the same step (a product is never left without its category)."""
    old = _canonical(db, name)
    used = db.execute(select(func.count()).select_from(Product).where(Product.category == old)).scalar_one()
    if used:
        if not move_to:
            raise conflict(f"{used} product(s) and service(s) use “{old}”. Choose a category to move them to, then delete it.", code="IN_USE")
        target = _canonical(db, move_to)
        if key(target) == key(old):
            raise invalid("Choose a different category to move them to.", {"moveTo": "Choose another category."})
        _move_products(db, old, target)
    stored = [c for c in categories(db) if c != old]
    _store(db, p, stored)
    _audit(db, p, "Product category deleted", f"{old} ({used} product(s) moved to {move_to or '-'})")
    db.commit()
    return categories(db)


def add_category(db: Session, p: Principal, name: str) -> list[str]:
    name = _category_name(name)
    current = categories(db)
    if key(name) in {key(c) for c in current}:
        raise invalid("That category already exists.", {"name": "Already exists."})
    _store(db, p, [*current, name])
    _audit(db, p, "Product category added", name)
    db.commit()
    return categories(db)


def check_category(db: Session, category: str) -> None:
    if category and key(category) not in {key(c) for c in categories(db)}:
        raise invalid("Choose a category from the list, or add a new one.", {"category": "Not an available category."})


# ---- seeding the standard catalogue (idempotent; never overwrites what someone has edited) ------------------------------------------------
def seed_catalogue(db: Session) -> int:
    """Brings in the standard categories and services that are not there yet. Matching is by normalised name, so a service someone already added (or renamed to) is left alone."""
    if db.get(AppSetting, CATEGORIES_KEY) is None:
        db.add(AppSetting(key=CATEGORIES_KEY, value={"categories": list(DEFAULT_CATEGORIES)}, updated_by=None))
    existing = {key(n) for (n,) in db.execute(select(Product.name)).all()}
    codes = {str(c).upper() for (c,) in db.execute(select(Product.code)).all() if c}
    created = 0
    for category, prefix, services in CATALOGUE:
        n = 0
        for name in services:
            if key(name) in existing:
                continue
            n += 1
            code = f"{prefix}-{n:03d}"
            while code in codes:
                n += 1
                code = f"{prefix}-{n:03d}"
            codes.add(code)
            db.add(Product(id=ids.new_id(db, "PRD", 4), name=name, code=code, category=category, type="Service", description="", price=0, billing_cycle="One-time", unit="Project",
                           tax_rate=18, default_discount=0, status="Active", curated=False,
                           attributes={"priceHistory": [{"price": 0.0, "at": datetime.now(UTC).isoformat(), "by": None, "note": "Standard catalogue entry - price to be set"}]}))
            existing.add(key(name))
            created += 1
    db.flush()
    return created


# ---- who uses a product ----------------------------------------------------------------------------------------------------------------
# records that point at a product through a real foreign key, with the column that carries the readable name
LINKED = ((Lead, ("service",)), (Enquiry, ("interested_service", "interested_product")), (Deal, ("service",)), (Project, ()), (Ticket, ()))
# documents whose lines (kept as snapshots) mention the product by id
DOCUMENTS = (Quotation, SalesOrder, Proposal, Invoice)


def usage(db: Session, product_id: str) -> dict:
    """How many records and documents refer to the product. Counts every branch (core selects are not branch-filtered), because deleting a product affects all of them."""
    counts = {}
    for model, _names in LINKED:
        t = model.__table__
        counts[model.__tablename__] = db.execute(select(func.count()).select_from(t).where(t.c.product_id == product_id)).scalar_one()
    like = f'%"{product_id}"%'
    for model in DOCUMENTS:
        t = model.__table__
        counts[model.__tablename__] = db.execute(select(func.count()).select_from(t).where(cast(t.c.attributes, String).like(like))).scalar_one()
    return counts


def guard_delete(db: Session, product: Product) -> None:
    used = {k: v for k, v in usage(db, product.id).items() if v}
    if used:
        what = ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in used.items())
        raise conflict(f"“{product.name}” is used by {what}, so it cannot be deleted. Deactivate it instead: it stops being offered, and everything that already uses it keeps it.", code="IN_USE")


def carry_rename(db: Session, product: Product, old_name: str) -> None:
    """A renamed product is renamed on the leads, enquiries and deals that point at it (their readable name follows the id). Documents keep their own snapshot lines."""
    for model, names in LINKED:
        t = model.__table__
        values = {}
        for column in names:
            values[column] = case_when_old(t.c[column], old_name, product.name)
        if values:
            db.execute(update(t).where(t.c.product_id == product.id).values(**values))


def case_when_old(column, old_name: str, new_name: str):
    """Only a field that still holds the old name is changed (a person may have typed something else in the other field)."""
    return case((func.lower(column) == old_name.lower(), new_name), else_=column)
