"""Reference data every installation needs, and the first Super Admin. Idempotent: running it twice changes nothing.

Not demo data: no companies, leads, invoices ... are created. The Super Admin's email / name / password come from backend/.env (SUPERADMIN_*).
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, password_problems
from app.db import ids
from app.models import Branch, Department, Employee, ExpenseCategory, User
from app.services import auth_service, catalogue, lead_sources
from app.services.accounts import AVATARS, initials_of

BRANCHES = [("BR-SLM", "Salem", "SLM"), ("BR-MUM", "Mumbai", "MUM"), ("BR-BLR", "Bangalore", "BLR")]
DEPARTMENTS = [
    ("DEP-001", "Management", "MANA", "#6366f1"), ("DEP-002", "Sales", "SALE", "#0ea5e9"), ("DEP-003", "Projects", "PROJ", "#10b981"), ("DEP-004", "Finance", "FINA", "#f59e0b"),
    ("DEP-005", "Support", "SUPP", "#ec4899"), ("DEP-006", "Marketing", "MARK", "#8b5cf6"), ("DEP-007", "HR", "HR", "#14b8a6"), ("DEP-008", "IT / Tech Services", "ITTE", "#f43f5e"),
    ("DEP-009", "CAD Services", "CADS", "#64748b"), ("DEP-010", "Office Administration", "OFFI", "#84cc16"),
]
EXPENSE_CATEGORIES = [
    ("Office & Administration", "#6366f1"), ("Rent", "#8b5cf6"), ("Utilities", "#f59e0b"), ("Internet & Communication", "#0ea5e9"), ("Travel", "#10b981"), ("Transportation", "#14b8a6"),
    ("Marketing", "#ec4899"), ("Advertising", "#f43f5e"), ("Software & Subscriptions", "#3b82f6"), ("Equipment", "#64748b"), ("Maintenance", "#a16207"), ("Employee Expenses", "#22c55e"),
    ("Vendor Expenses", "#d946ef"), ("Project Expenses", "#06b6d4"), ("Client Expenses", "#f97316"), ("Professional Services", "#84cc16"), ("Taxes & Government Charges", "#ef4444"),
]


def seed_reference_data(db: Session) -> dict:
    created = {"branches": 0, "departments": 0, "leadSources": 0, "expenseCategories": 0, "products": 0}
    for bid, name, code in BRANCHES:
        if db.execute(select(Branch.id).where(Branch.name == name)).first() is None:
            db.add(Branch(id=bid, name=name, code=code, status="Active"))
            created["branches"] += 1
    for did, name, code, color in DEPARTMENTS:
        if db.get(Department, did) is None and db.execute(select(Department.id).where(func.lower(Department.name) == name.lower())).first() is None:
            db.add(Department(id=did, name=name, code=code, color=color, status="Active", attributes={"history": []}))
            created["departments"] += 1
    created["products"] = catalogue.seed_catalogue(db)  # the standard service categories and services (prices are left for the business to set)
    created["leadSources"] = lead_sources.seed_defaults(db)  # the standard list; an older database has its sources renamed / re-categorised in place, never deleted
    existing = {n.lower() for n in db.execute(select(ExpenseCategory.name)).scalars()}
    for index, (name, color) in enumerate(EXPENSE_CATEGORIES + [("Miscellaneous", "#94a3b8")], start=1):
        if name.lower() not in existing:
            db.add(ExpenseCategory(id=f"EXC-{index:03d}", name=name, color=color, active=True, system=name == "Miscellaneous", description="", attributes={}))
            created["expenseCategories"] += 1
    db.flush()
    return created


def seed_super_admin(db: Session, *, email: str, name: str, password: str, allow_weak_bootstrap: bool = False) -> User | None:
    """Create the one Super Admin (explicit all-branch authorisation, no branch of its own). Returns None when one already exists.

    `allow_weak_bootstrap` (an explicit opt-in on the seed command line) lets a password that does not yet meet the policy start the account, but ONLY together with a forced
    password change at the first sign-in: the new password must meet the policy, so the weak one never stays in use."""
    if db.execute(select(User.id).where(User.access_level == "Super Admin")).first():
        return None
    weak = bool(password_problems(password)) and allow_weak_bootstrap
    if not weak:
        auth_service.check_new_password(password)
    first, _, last = name.strip().partition(" ")
    employee = Employee(id=ids.new_id(db, "EMP", 3), full_name=name, official_email=email, designation="Super Admin", job_title="Super Admin", join_date=date.today(), status="Active",
                        department_id="DEP-001", branch=None, attributes={"timeline": []})
    db.add(employee)
    db.flush()
    user = User(id=ids.new_id(db, "USR", 4), employee_id=employee.id, first_name=first, last_name=last, name=name, email=email, username=email.split("@")[0], department="Management",
                password_hash=hash_password(password), access_level="Super Admin", job_role="Super Admin", branch=None, branch_access="all", permissions=None, status="Active",
                force_password_change=weak, initials=initials_of(name), avatar_color=AVATARS[0], password_changed_by="Seed")
    db.add(user)
    db.flush()
    return user
