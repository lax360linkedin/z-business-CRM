"""Global search: only what the caller may open - per-module permission, branch scope and each module's own row filter all apply (the generic list engine does the filtering)."""
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.models import Document, Expense
from app.services import documents, expenses, records
from app.services.modules import SPEC_BY_KEY

TYPES = (("leads", "Lead"), ("contacts", "Contact"), ("companies", "Company"), ("customers", "Customer"), ("deals", "Deal"), ("enquiries", "Enquiry"), ("projects", "Project"),
         ("quotations", "Quotation"), ("proposals", "Proposal"), ("salesOrders", "Sales Order"), ("invoices", "Invoice"), ("payments", "Payment"), ("contracts", "Contract"),
         ("campaigns", "Campaign"), ("tickets", "Ticket"), ("products", "Product"))
SUBTITLE = ("company", "companyName", "customerName", "email", "status")
TITLE = ("name", "title", "subject", "number")


def _pick(row: dict, keys: tuple[str, ...]) -> str:
    return next((str(row[k]) for k in keys if row.get(k)), "")


def search(db: Session, p: Principal, q: str, limit: int = 20) -> list[dict]:
    needle = (q or "").strip()
    if not needle:
        return []
    out: list[dict] = []
    for key, label in TYPES:
        spec = SPEC_BY_KEY[key]
        if not p.can(spec.label, "view"):
            continue
        page = records.list_records(db, spec, p, {"q": needle, "pageSize": "5"})
        for row in page["data"]:
            out.append({"type": label, "id": row["id"], "title": _pick(row, TITLE) or row["id"], "subtitle": _pick(row, SUBTITLE)})
    if p.can("Expenses", "view"):
        like = f"%{needle.lower()}%"
        for e in db.execute(select(Expense).where(or_(func.lower(Expense.number).like(like), func.lower(Expense.description).like(like))).order_by(Expense.created_at.desc()).limit(20)).scalars():
            if expenses.visible(db, p, e) and len([o for o in out if o["type"] == "Expense"]) < 5:
                out.append({"type": "Expense", "id": e.id, "title": e.number or e.id, "subtitle": e.description})
    like = f"%{needle.lower()}%"
    rc = documents.RC(db, p)
    hits = list(db.execute(select(Document).where(Document.status != "Deleted", or_(func.lower(Document.name).like(like), func.lower(Document.file_name).like(like), func.lower(Document.id).like(like)))
                           .order_by(Document.created_at.desc()).limit(40)).scalars())
    rc.preload_shares([d.id for d in hits])
    shown = 0
    for d in hits:
        if documents.evaluate(rc, d)["view"] and shown < 8:
            out.append({"type": "Document", "id": d.id, "title": d.name, "subtitle": f"{d.category} · {d.id}"})
            shown += 1
    return out[:limit]


def people_directory(db: Session, p: Principal) -> list[dict]:
    """Everyone the caller can see by name (owner pickers, assignee names, mentions): employees in their branch scope with the public facts about them - never contact secrets."""
    from app.models import Department, Employee, User

    # one round trip: employees with their account and department joined (the branch scope filters the employee rows as usual)
    rows = db.execute(select(Employee, User, Department.name).outerjoin(User, User.employee_id == Employee.id).outerjoin(Department, Department.id == Employee.department_id).order_by(Employee.full_name)).unique().all()
    out = []
    for e, u, dept_name in rows:
        depts = {e.department_id: dept_name}
        out.append({"id": e.id, "name": e.full_name, "email": e.official_email, "role": (u.job_role if u else "Employee"), "accessLevel": (u.access_level if u else "Employee"), "department": depts.get(e.department_id) or (u.department if u else ""),
                    "designation": e.designation, "branch": e.branch, "status": e.status, "hasAccount": u is not None, "accountStatus": u.status if u else None,
                    "initials": (u.initials if u else "".join(w[0] for w in e.full_name.split()[:2]).upper()), "avatarColor": (u.avatar_color if u else ""), "reportsTo": e.reports_to,
                    "departmentId": e.department_id, "teamId": e.team_id})
    return out
