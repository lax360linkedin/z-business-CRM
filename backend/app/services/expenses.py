"""Expenses: money the BUSINESS spends, kept completely apart from customer invoices and payments.

Kinds: Company (Draft -> Approved -> Paid), Vendor (Draft -> Submitted -> Approved -> Paid), Employee reimbursement (Draft -> Submitted -> Approved -> Reimbursed).
Approval has limits per role and (unless allowed) no self-approval; paid / reimbursed / cancelled / rejected expenses are a frozen financial record. Totals are computed here."""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import AppSetting, Campaign, Document, Employee, Expense, ExpenseCategory, User, Vendor
from app.services import audit, pricing, timeline
from app.services import tasks as task_svc
from app.services.codec import to_json
from app.services.records import Ctx, Hooks

KINDS = ("Company", "Vendor", "Employee")
TAX_RATES = (0, 5, 12, 18, 28)
COST_STATUSES = ("Approved", "Paid", "Reimbursed")
PENDING = ("Submitted", "Under Review")
METHODS = ("Cash", "Bank Transfer", "UPI", "Card", "Cheque", "NEFT", "RTGS", "IMPS", "Other")
LINK_FIELDS = {"customerId": "customer_id", "companyId": "company_id", "contactId": "contact_id", "dealId": "deal_id", "invoiceId": "invoice_id", "projectId": "project_id", "contractId": "contract_id", "campaignId": "campaign_id"}
ALL = ("view", "create", "edit", "submit", "approve", "reject", "markPaid", "reimburse", "deleteDraft", "export", "viewFinancial", "manageCategories", "manageVendors")
STAFF = ("view", "create", "edit", "submit", "deleteDraft", "viewFinancial")
MANAGER = ("view", "create", "edit", "submit", "approve", "reject", "deleteDraft", "viewFinancial")
ROLE_CAPS = {"Admin": ALL, "Accounts": ALL, "MD": ("view", "approve", "reject", "export", "viewFinancial"), "CEO": ("view", "export", "viewFinancial"), "Sales Manager": MANAGER, "Project Manager": MANAGER,
             "Sales Executive": STAFF, "Project Staff": STAFF, "Marketing": STAFF, "Support": STAFF, "HR": STAFF, "Employee": STAFF}
ORG_SCOPE_JOBS = ("MD", "CEO", "Accounts")
DEFAULT_CONFIG = {"prefix": "EXP", "allowSelfApproval": False, "approvalLimits": {"Sales Manager": 50000, "Project Manager": 50000}, "approvalDueDays": 2, "reimbursementDays": 7, "receiptRequiredAbove": 5000}


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def config(db: Session) -> dict:
    row = db.get(AppSetting, "expense_config")
    return {**DEFAULT_CONFIG, **(row.value if row else {})}


def caps_of(p: Principal) -> set[str]:
    grant = p.permissions.get("Expenses", {})
    if not grant.get("view"):
        return set()
    if p.is_super_admin:
        return set(ALL)
    base = set(ROLE_CAPS["Admin" if p.level == "Admin" else p.user.job_role] if (p.level == "Admin" or p.user.job_role in ROLE_CAPS) else STAFF)
    if not grant.get("create"):
        base -= {"create", "submit"}
    if not grant.get("edit"):
        base -= {"edit", "approve", "reject", "markPaid", "reimburse", "manageCategories", "manageVendors"}
    if not grant.get("delete"):
        base -= {"deleteDraft"}
    return base


def org_scope(p: Principal) -> bool:
    return p.level in ("Super Admin", "Admin") or p.user.job_role in ORG_SCOPE_JOBS


def payments_of(e: Expense) -> list[dict]:
    return [x for x in e.attributes.get("payments", []) if x.get("status") != "Void"]


def paid_of(e: Expense) -> float:
    return pricing.round2(sum(pricing._num(x.get("amount")) for x in payments_of(e)))


def payable_of(e: Expense) -> float:
    return pricing.round2(e.approved_amount) if e.approved_amount is not None and e.status in COST_STATUSES else pricing.round2(e.total)


def remaining_of(e: Expense) -> float:
    return max(0.0, pricing.round2(payable_of(e) - paid_of(e))) if e.status in COST_STATUSES else 0.0


def payment_status(e: Expense) -> str:
    emp = e.kind == "Employee"
    if e.status in ("Cancelled", "Rejected"):
        return "Not payable"
    if e.status not in COST_STATUSES:
        return "Not approved yet"
    paid, left = paid_of(e), remaining_of(e)
    if left <= pricing.EPS and paid > 0:
        return "Reimbursed" if emp else "Paid"
    if paid > 0:
        return "Partly reimbursed" if emp else "Partially Paid"
    return "Reimbursement pending" if emp else "Unpaid"


def perms_for(db: Session, p: Principal, e: Expense | None) -> dict:
    caps = caps_of(p)
    cfg = config(db)
    base = {"view": "view" in caps, "create": "create" in caps, "export": "export" in caps, "viewFinancial": "viewFinancial" in caps, "manageCategories": "manageCategories" in caps, "manageVendors": "manageVendors" in caps}
    if e is None:
        return base
    mine = e.created_by == p.actor_id or e.employee_id == p.actor_id
    s = e.status
    direct = e.kind != "Employee"
    elevated = p.level in ("Super Admin", "Admin") or p.user.job_role == "Accounts"
    can_touch = mine or elevated
    approve_blocked = None
    can_approve = "approve" in caps and s in (*PENDING, *(("Draft",) if direct else ()))
    if can_approve and mine and not cfg["allowSelfApproval"] and not p.is_super_admin:
        can_approve, approve_blocked = False, "You cannot approve your own expense."
    return {**base, "edit": "edit" in caps and can_touch and s not in ("Cancelled", "Paid", "Reimbursed", "Rejected"), "editAll": "edit" in caps and can_touch and s == "Draft",
            "editLimited": "edit" in caps and s in ("Approved", *PENDING) and elevated, "editNotes": "edit" in caps and s != "Cancelled" and can_touch, "submit": "submit" in caps and can_touch and s == "Draft",
            "withdraw": "submit" in caps and mine and s in PENDING, "review": "approve" in caps and s == "Submitted" and (not mine or p.is_super_admin), "approve": can_approve, "approveBlockedReason": approve_blocked,
            "reject": "reject" in caps and s in PENDING and (not mine or p.is_super_admin), "pay": ("reimburse" if e.kind == "Employee" else "markPaid") in caps and s == "Approved" and remaining_of(e) > pricing.EPS,
            "revise": "edit" in caps and can_touch and s == "Rejected", "cancel": "edit" in caps and can_touch and s in ("Draft", *PENDING, "Approved") and paid_of(e) <= pricing.EPS,
            "deleteDraft": "deleteDraft" in caps and can_touch and s == "Draft"}


def _link_names(db: Session, e: Expense) -> dict:
    """Display names of the records an expense is tied to (project, customer, deal, invoice, contract, campaign)."""
    from app.models import Contract, Customer, Deal, Invoice, Project

    def name(model, rid, attr="name"):
        row = db.get(model, rid) if rid else None
        return getattr(row, attr, None) if row else None

    return {"projectName": name(Project, e.project_id), "customerName": name(Customer, e.customer_id), "dealName": name(Deal, e.deal_id), "invoiceNumber": name(Invoice, e.invoice_id, "number"),
            "contractNumber": name(Contract, e.contract_id, "number"), "campaignName": name(Campaign, e.campaign_id)}


def public(db: Session, p: Principal, e: Expense, detail: bool = False) -> dict:
    out = to_json(e)
    cat = db.get(ExpenseCategory, e.category_id) if e.category_id else None
    vendor = db.get(Vendor, e.vendor_id) if e.vendor_id else None
    names = task_svc.names_of(db, [e.employee_id, e.created_by])
    perms = perms_for(db, p, e)
    out.update(categoryName=cat.name if cat else None, **_link_names(db, e), categoryColor=cat.color if cat else None, vendorName=vendor.name if vendor else None, employeeName=names.get(e.employee_id), createdByName=names.get(e.created_by),
               payable=payable_of(e), paid=paid_of(e), remaining=remaining_of(e), cost=payable_of(e) if e.status in COST_STATUSES else 0, paymentStatus=payment_status(e), perms=perms)
    if not detail:
        out.pop("timeline", None)
    if not perms["viewFinancial"]:
        for key in ("amount", "tax", "total", "taxRate", "approvedAmount", "reimbursedAmount", "payable", "paid", "remaining", "cost"):
            out[key] = None
        out["payments"], out["financialHidden"] = [], True
    return out


def event(e: Expense, p: Principal, type: str, text: str, details: str = "", **extra) -> None:
    e.attributes = {**e.attributes, "timeline": [*e.attributes.get("timeline", []), {"at": now_iso(), "by": p.actor_id, "byName": p.name, "type": type, "text": text, "details": details, **extra}]}


def get_expense(db: Session, p: Principal, expense_id: str) -> Expense:
    e = db.execute(select(Expense).where(Expense.id == expense_id)).scalar_one_or_none()
    if e is None or not visible(db, p, e):
        raise not_found("Expense not found.")
    return e


def visible(db: Session, p: Principal, e: Expense) -> bool:
    if "view" not in caps_of(p):
        return False
    if org_scope(p):
        return True
    me = p.actor_id
    if e.created_by == me or e.employee_id == me or e.attributes.get("approverId") == me:
        return True
    if p.user.job_role in ("Sales Manager", "Project Manager"):
        depts = {r[0] for r in db.execute(select(User.department).where(User.employee_id.in_([x for x in (e.created_by, e.employee_id) if x]))).all()}
        return p.user.department in depts
    return False


def list_expenses(db: Session, p: Principal, params: dict) -> dict | list:
    stmt = select(Expense).order_by(Expense.created_at.desc(), Expense.id.desc())
    for key, attr in (("status", Expense.status), ("kind", Expense.kind), ("categoryId", Expense.category_id), ("employeeId", Expense.employee_id), ("vendorId", Expense.vendor_id), ("projectId", Expense.project_id)):
        if params.get(key):
            stmt = stmt.where(attr.in_(params[key].split(",")))
    rows = [e for e in db.execute(stmt).scalars() if visible(db, p, e)]
    needle = (params.get("q") or params.get("search") or "").lower().strip()
    if needle:
        rows = [e for e in rows if needle in f"{e.number} {e.description} {e.vendor_bill_number}".lower()]
    data = [public(db, p, e) for e in rows]
    if str(params.get("all", "")).lower() == "true":
        return data
    page, size = max(1, int(params.get("page", 1))), min(200, max(1, int(params.get("pageSize", 10))))
    return {"data": data[(page - 1) * size: page * size], "total": len(data), "page": page, "pageSize": size}


# ---- build / validate -------------------------------------------------------------------------------------------------------
def build_values(db: Session, p: Principal, req: dict, cur: Expense | None = None) -> dict:
    cfg = config(db)
    errors: dict = {}
    kind = req.get("kind", cur.kind if cur else "Company")
    if kind not in KINDS:
        errors["kind"] = "Choose the expense type."
    when = str(req.get("date", cur.date.isoformat() if cur and cur.date else ""))[:10]
    if not when:
        errors["date"] = "Enter the expense date."
    elif when > date.today().isoformat():
        errors["date"] = "The expense date cannot be in the future."
    elif when < f"{date.today().year - 2}-01-01":
        errors["date"] = "That date is too far in the past."
    description = str(req.get("description", cur.description if cur else "")).strip()
    if not description:
        errors["description"] = "Describe the expense."
    elif len(description) > 300:
        errors["description"] = "The description is limited to 300 characters."
    cat_id = req.get("categoryId", cur.category_id if cur else None)
    category = db.get(ExpenseCategory, cat_id) if cat_id else None
    if category is None:
        errors["categoryId"] = "Choose a category."
    elif not category.active and not (cur and cur.category_id == category.id):
        errors["categoryId"] = "That category is no longer in use."
    amount = pricing._num(req.get("amount", cur.amount if cur else 0))
    if not amount > 0:
        errors["amount"] = "Enter an amount greater than zero."
    elif amount > 100_000_000:
        errors["amount"] = "That amount is not allowed."
    rate = pricing._num(req.get("taxRate", cur.tax_rate if cur else 0))
    if rate not in TAX_RATES:
        errors["taxRate"] = f"Tax rate must be one of {', '.join(str(t) for t in TAX_RATES)}%."
    method = req.get("paymentMethod", cur.payment_method if cur else "")
    if method and method not in METHODS:
        errors["paymentMethod"] = "Choose a payment method from the list."
    base = pricing.round2(amount)
    tax = pricing.round2(base * rate / 100)
    v = {"kind": kind, "date": when, "description": description, "category_id": cat_id, "amount": base, "tax_rate": rate, "tax": tax, "total": pricing.round2(base + tax), "payment_method": method or "",
         "payment_reference": str(req.get("paymentReference", cur.payment_reference if cur else ""))[:120], "notes": str(req.get("notes", cur.notes if cur else ""))[:2000], "vendor_id": None,
         "vendor_bill_number": "", "vendor_bill_date": None, "due_date": None, "employee_id": req.get("employeeId", cur.employee_id if cur else None), "paid_by": "Company"}
    if kind == "Vendor":
        vendor_id = req.get("vendorId", cur.vendor_id if cur else None)
        vendor = db.get(Vendor, vendor_id) if vendor_id else None
        if vendor is None:
            errors["vendorId"] = "Choose a vendor."
        elif not vendor.active and not (cur and cur.vendor_id == vendor.id):
            errors["vendorId"] = "That vendor is inactive."
        v["vendor_id"] = vendor.id if vendor else None
        v["vendor_bill_number"] = str(req.get("vendorBillNumber", cur.vendor_bill_number if cur else "")).strip()[:60]
        if not v["vendor_bill_number"]:
            errors["vendorBillNumber"] = "Enter the vendor's bill / invoice number."
        bill = req.get("vendorBillDate", cur.vendor_bill_date.isoformat() if cur and cur.vendor_bill_date else None)
        due = req.get("dueDate", cur.due_date.isoformat() if cur and cur.due_date else None)
        if bill and str(bill)[:10] > date.today().isoformat():
            errors["vendorBillDate"] = "The bill date cannot be in the future."
        if due and bill and str(due)[:10] < str(bill)[:10]:
            errors["dueDate"] = "The due date cannot be before the bill date."
        v["vendor_bill_date"] = date.fromisoformat(str(bill)[:10]) if bill else None
        v["due_date"] = date.fromisoformat(str(due)[:10]) if due else None
    elif kind == "Employee":
        v["employee_id"] = v["employee_id"] or p.actor_id
        employee = db.get(Employee, v["employee_id"])
        if employee is None or employee.status not in ("Active", "Probation", "On Leave", "Remote"):
            errors["employeeId"] = "Choose an active employee."
        elif v["employee_id"] != p.actor_id and not org_scope(p) and p.user.job_role not in ("Sales Manager", "Project Manager"):
            errors["employeeId"] = "You can only claim your own expenses."
        v["paid_by"] = "Employee"
    for key, attr in LINK_FIELDS.items():
        value = req.get(key, getattr(cur, attr, None) if cur else None) or None
        v[attr] = value
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    del cfg
    return v


def _apply(e: Expense, v: dict) -> None:
    for key, value in v.items():
        if key == "date":
            value = date.fromisoformat(value)
        setattr(e, key, value)


def create_expense(db: Session, p: Principal, req: dict) -> dict:
    if "create" not in caps_of(p):
        audit.record(db, user=p.user, action="Expense create", module="Expenses", result="Denied", info=p.info)
        db.commit()
        raise forbidden("You do not have permission to create expenses.")
    v = build_values(db, p, req)
    from app.services.records import validate_links

    validate_links(db, Expense, {k: x for k, x in v.items() if k in LINK_FIELDS.values() or k in ("category_id", "vendor_id", "employee_id")})
    live = db.execute(select(Expense).where(Expense.status.notin_(("Cancelled", "Rejected")))).scalars().all()
    if v["kind"] == "Vendor" and v["vendor_bill_number"] and any(x.vendor_id == v["vendor_id"] and x.vendor_bill_number.lower() == v["vendor_bill_number"].lower() for x in live):
        raise conflict(f"Bill {v['vendor_bill_number']} from this vendor is already recorded.", {"vendorBillNumber": "This bill was already recorded."})
    payee = v["vendor_id"] or v["employee_id"] or p.actor_id
    if not req.get("confirmDuplicate") and any(x.kind == v["kind"] and (x.vendor_id or x.employee_id or x.created_by) == payee and x.date.isoformat() == v["date"] and float(x.total) == v["total"] and x.category_id == v["category_id"] for x in live):
        raise ApiError409("An expense with the same date, amount, category and payee already exists. If this is a genuine second expense, confirm it.")
    e = Expense(id=ids.new_id(db, "EXP", 5), number=ids.new_number(db, config(db)["prefix"], width=5), status="Draft", reimbursed_amount=0, cycle=0, created_by=p.actor_id, branch=None, attributes={"payments": [], "approvals": [], "timeline": []})
    _apply(e, v)
    anchor = db.get(Employee, e.employee_id or p.actor_id)
    e.branch = anchor.branch if anchor is not None and anchor.branch else None
    db.add(e)
    db.flush()
    event(e, p, "Created", "Expense created as a draft", f"{e.total} · {e.kind}")
    audit.record(db, user=p.user, action="Expense created", module="Expenses", record_id=e.id, details=f"{e.number} {e.total}", info=p.info)
    db.commit()
    return public(db, p, e, detail=True)


def ApiError409(message: str):
    from app.core.errors import ApiError

    return ApiError(409, message, "DUPLICATE", {"duplicate": True})


EDITABLE_DRAFT = {"kind", "date", "categoryId", "description", "amount", "taxRate", "paymentMethod", "vendorId", "vendorBillNumber", "vendorBillDate", "dueDate", "employeeId", "paymentReference", "notes", *LINK_FIELDS}
RELINK = {"categoryId", *LINK_FIELDS, "notes"}


def update_expense(db: Session, p: Principal, expense_id: str, req: dict) -> dict:
    e = get_expense(db, p, expense_id)
    perm = perms_for(db, p, e)
    notes_only = set(req) <= {"notes", "requestId", "reason"}
    if not (perm["edit"] or (notes_only and perm["editNotes"])):
        raise forbidden("A cancelled expense cannot be edited." if e.status == "Cancelled" else "You do not have permission to edit this expense.")
    current = to_json(e)
    if not perm["editAll"]:
        allowed = RELINK if e.status == "Approved" and perm["editLimited"] else {"notes"}
        touched = [k for k in req if k in EDITABLE_DRAFT and req[k] != current.get(k)]
        rejected = [k for k in touched if k not in allowed]
        if rejected:
            raise conflict(f"{', '.join(rejected)} cannot be changed on {'an approved' if e.status == 'Approved' else 'a ' + e.status.lower()} expense - amounts, vendor, employee and dates are a financial record.")
        if any(k in LINK_FIELDS or k == "categoryId" for k in touched) and len(str(req.get("reason") or "").strip()) < 5:
            raise invalid("Give a reason for changing the linked records on an approved expense.", {"reason": "Give a reason."})
    v = build_values(db, p, req, e)
    if e.kind == "Vendor" and v["vendor_bill_number"]:
        dup = db.execute(select(Expense).where(Expense.id != e.id, Expense.status.notin_(("Cancelled", "Rejected")), Expense.vendor_id == v["vendor_id"], func.lower(Expense.vendor_bill_number) == v["vendor_bill_number"].lower())).scalars().first()
        if dup is not None:
            raise conflict(f"Bill {v['vendor_bill_number']} from this vendor is already recorded on {dup.number}.", {"vendorBillNumber": "This bill was already recorded."})
    fields = (EDITABLE_DRAFT | {"amount", "taxRate"}) if perm["editAll"] else RELINK if e.status == "Approved" and perm["editLimited"] else {"notes"}
    attr_names = {"categoryId": "category_id", "taxRate": "tax_rate", "paymentMethod": "payment_method", "vendorId": "vendor_id", "vendorBillNumber": "vendor_bill_number", "vendorBillDate": "vendor_bill_date",
                  "dueDate": "due_date", "employeeId": "employee_id", "paymentReference": "payment_reference", **LINK_FIELDS}
    changed = []
    for key in fields - {"amount", "taxRate"}:
        attr = attr_names.get(key, key)
        if attr not in v:
            continue
        new = date.fromisoformat(v[attr]) if attr == "date" and v[attr] else v[attr]
        if getattr(e, attr) != new:
            setattr(e, attr, new)
            changed.append(key)
    if perm["editAll"] and (float(e.amount) != v["amount"] or float(e.tax_rate) != v["tax_rate"]):
        e.amount, e.tax_rate, e.tax, e.total = v["amount"], v["tax_rate"], v["tax"], v["total"]
        changed.append("amount")
    if not changed:
        return public(db, p, e, detail=True)
    reason = str(req.get("reason") or "").strip()[:300]
    for key in changed:
        event(e, p, "Updated", f"{key} changed", reason if e.status != "Draft" else "", field=key)
    audit.record(db, user=p.user, action="Expense updated", module="Expenses", record_id=e.id, details=", ".join(changed)[:400], info=p.info)
    db.commit()
    return public(db, p, e, detail=True)


# ---- workflow ---------------------------------------------------------------------------------------------------------------
def pick_approver(db: Session, e: Expense, cfg: dict) -> str | None:
    rows = db.execute(select(User).where(User.status == "Active")).scalars().unique().all()
    submitter = e.created_by
    for user in rows:
        if user.employee_id == submitter and not cfg["allowSelfApproval"]:
            continue
        if user.branch and e.branch and user.branch != e.branch and user.access_level != "Super Admin":
            continue
        if user.access_level == "Admin" or user.job_role in ("Accounts", "MD"):
            return user.employee_id
    return None


def finance_user(db: Session, e: Expense) -> str | None:
    for user in db.execute(select(User).where(User.status == "Active", User.job_role == "Accounts")).scalars().unique():
        if not e.branch or user.branch == e.branch:
            return user.employee_id
    return None


def _raise_task(db: Session, p: Principal, e: Expense, key: str, data: dict) -> None:
    try:
        task_svc.create_task(db, task_svc.Actor(id=p.actor_id, name=p.name, level="System", system=True), task_svc._ALL, {**data, "relatedType": None, "visibility": "Team"}, branch=e.branch, automation_key=key, source="expense")
    except Exception:  # an alert must never block the money workflow
        pass


def _close_tasks(db: Session, e: Expense, prefix: str, status: str, note: str) -> None:
    from app.models import Task

    for t in db.execute(select(Task).where(Task.automation_key.like(f"{prefix}{e.id}%"), Task.status.in_(task_svc.OPEN))).scalars().all():
        t.status = status
        t.attributes = {**t.attributes, "completionNote" if status == "Completed" else "cancelReason": note}


def transition(db: Session, p: Principal, expense_id: str, kind: str, req: dict) -> dict:
    e = get_expense(db, p, expense_id)
    perm = perms_for(db, p, e)
    cfg = config(db)
    reason = str(req.get("reason") or req.get("comments") or "").strip()[:500]
    money = lambda x: f"{pricing.round2(x):.2f}"  # noqa: E731

    def deny(why: str):
        audit.record(db, user=p.user, action=f"Expense {kind}", module="Expenses", record_id=e.id, result="Denied", details=why, info=p.info)
        db.commit()
        raise forbidden(why)

    if kind == "submit":
        if not perm["submit"]:
            deny("You cannot submit this expense.")
        need = cfg["receiptRequiredAbove"]
        if need and float(e.total) > need and not db.execute(select(Document.id).where(Document.expense_id == e.id, Document.status != "Deleted").limit(1)).first():
            raise conflict(f"Attach the bill or receipt first - one is required above {need}.", {"documents": "A receipt or bill is required."})
        e.status, e.cycle = "Submitted", (e.cycle or 0) + 1
        e.attributes = {**e.attributes, "submittedAt": now_iso(), "submittedBy": p.actor_id}
        e.submitted_at, e.submitted_by = datetime.now(UTC), p.actor_id
        event(e, p, "Submitted", "Submitted for approval", f"{money(e.total)} - cycle {e.cycle}")
        approver = pick_approver(db, e, cfg)
        if approver:
            e.attributes = {**e.attributes, "approverId": approver}
            _raise_task(db, p, e, f"expenseApproval:{e.id}:{e.cycle}", {"title": f"Approve expense {e.number} - {money(e.total)}", "taskType": "Review", "description": f"{e.description} submitted by {p.name}.",
                                                                             "dueDate": (date.today() + timedelta(days=cfg["approvalDueDays"])).isoformat(), "assignees": [approver], "priority": "High" if e.total >= 50000 else "Medium"})
            timeline.notify(db, user_id=approver, message=f"{p.name} submitted expense {e.number} ({money(e.total)}) for your approval.", type="Expense", related_type="Expense", related_id=e.id, branch=e.branch)
    elif kind == "withdraw":
        if not perm["withdraw"]:
            deny("You cannot withdraw this expense.")
        e.status = "Draft"
        e.attributes = {**e.attributes, "approverId": None}
        event(e, p, "Updated", "Withdrawn from approval", "Returned to draft so it can be edited.")
        _close_tasks(db, e, "expenseApproval:", "Cancelled", "Expense withdrawn by the submitter")
    elif kind == "review":
        if not perm["review"]:
            deny("You cannot review this expense.")
        e.status = "Under Review"
        e.attributes = {**e.attributes, "approvals": [*e.attributes.get("approvals", []), {"decision": "Under Review", "by": p.actor_id, "at": now_iso(), "comments": reason, "cycle": e.cycle}]}
        event(e, p, "Reviewed", "Review started", reason)
    elif kind == "approve":
        if not perm["approve"]:
            deny(perm["approveBlockedReason"] or "You cannot approve this expense.")
        approved = pricing.round2(req["approvedAmount"]) if req.get("approvedAmount") not in (None, "") else float(e.total)
        if not 0 < approved <= float(e.total) + pricing.EPS:
            raise invalid(f"The approved amount must be between 0 and the claim ({e.total}).", {"approvedAmount": "Invalid amount."})
        if approved < float(e.total) - pricing.EPS and len(reason) < 5:
            raise invalid("Say why you are approving less than the claim.", {"comments": "Give a reason."})
        limit = cfg["approvalLimits"].get("Admin" if p.level == "Admin" else p.user.job_role) if not p.is_super_admin else None
        if limit is not None and approved > limit:
            deny(f"This is above your approval limit of {limit}.")
        at = now_iso()
        e.status, e.approved_amount = "Approved", approved
        e.attributes = {**e.attributes, "approvedBy": p.actor_id, "approvedAt": at, "approvals": [*e.attributes.get("approvals", []), {"decision": "Approved", "by": p.actor_id, "at": at, "comments": reason, "amount": approved, "cycle": e.cycle}],
                        "reimbursementDueDate": (date.today() + timedelta(days=cfg["reimbursementDays"])).isoformat() if e.kind == "Employee" else None}
        event(e, p, "Approved", f"Approved{' for ' + money(approved) + ' of ' + money(e.total) if approved < float(e.total) else ''}", reason)
        _close_tasks(db, e, "expenseApproval:", "Completed", f"Approved by {p.name}")
        finance = finance_user(db, e)
        if finance:
            _raise_task(db, p, e, f"expensePayment:{e.id}", {"title": f"{'Reimburse' if e.kind == 'Employee' else 'Pay'} - {e.number} ({money(approved)})", "taskType": "Payment Follow-up", "description": f"Settle the approved expense {e.number}.",
                                                              "dueDate": (e.due_date or date.today() + timedelta(days=cfg["reimbursementDays"] if e.kind == 'Employee' else 3)).isoformat(), "assignees": [finance]})
        for who in {e.created_by, e.employee_id}:
            timeline.notify(db, user_id=who, message=f"Expense {e.number} was approved by {p.name}{' for ' + money(approved) if approved < float(e.total) else ''}.", type="Expense", related_type="Expense", related_id=e.id, branch=e.branch)
    elif kind == "reject":
        if not perm["reject"]:
            deny("You cannot reject this expense.")
        if len(reason) < 5:
            raise invalid("Give a reason for rejecting (at least 5 characters).", {"reason": "Give a reason."})
        e.status = "Rejected"
        e.attributes = {**e.attributes, "rejectedBy": p.actor_id, "rejectedAt": now_iso(), "rejectReason": reason, "approvals": [*e.attributes.get("approvals", []), {"decision": "Rejected", "by": p.actor_id, "at": now_iso(), "comments": reason, "cycle": e.cycle}]}
        event(e, p, "Rejected", "Rejected", reason)
        _close_tasks(db, e, "expenseApproval:", "Completed", f"Rejected by {p.name}")
        for who in {e.created_by, e.employee_id}:
            timeline.notify(db, user_id=who, message=f"Expense {e.number} was rejected by {p.name}: {reason}", type="Expense", related_type="Expense", related_id=e.id, branch=e.branch)
    elif kind == "revise":
        if not perm["revise"]:
            deny("You cannot reopen this expense.")
        e.status = "Draft"
        e.attributes = {**e.attributes, "approverId": None}
        event(e, p, "Updated", "Reopened as a draft for revision", f"Previously rejected: {e.attributes.get('rejectReason', '')}")
    elif kind == "cancel":
        if not perm["cancel"]:
            deny("A payment has been recorded, so this expense cannot be cancelled." if paid_of(e) > 0 else "You cannot cancel this expense.")
        if len(reason) < 5:
            raise invalid("Give a reason for cancelling (at least 5 characters).", {"reason": "Give a reason."})
        e.status = "Cancelled"
        e.attributes = {**e.attributes, "cancelReason": reason, "cancelledAt": now_iso(), "cancelledBy": p.actor_id}
        event(e, p, "Cancelled", "Cancelled", reason)
        _close_tasks(db, e, "expense", "Cancelled", f"Expense cancelled - {reason}")
    else:
        raise not_found("Unknown expense action.")
    audit.record(db, user=p.user, action=f"Expense {kind}", module="Expenses", record_id=e.id, details=reason, info=p.info)
    db.commit()
    return public(db, p, e, detail=True)


def pay(db: Session, p: Principal, expense_id: str, reimburse: bool, req: dict) -> dict:
    e = get_expense(db, p, expense_id)
    perm = perms_for(db, p, e)
    employee_kind = e.kind == "Employee"
    if reimburse != employee_kind:
        raise conflict("Employee claims are reimbursed, not paid." if employee_kind else "Vendor and company expenses are paid, not reimbursed.")
    if not perm["pay"]:
        raise forbidden("Only an approved expense can be paid." if e.status != "Approved" else "You cannot record a payment for this expense.")
    left = remaining_of(e)
    amount = pricing.round2(req["amount"]) if req.get("amount") not in (None, "") else left
    if not 0 < amount <= left + pricing.EPS:
        raise invalid(f"Enter an amount up to the {'reimbursement' if employee_kind else 'balance'} due ({left}).", {"amount": "Invalid amount."})
    method = req.get("method")
    if method not in METHODS:
        raise invalid("Choose a payment method.", {"method": "Choose a payment method."})
    floor = (e.vendor_bill_date if e.vendor_bill_date and not employee_kind else e.date)
    when = str(req.get("date") or "")[:10]
    if not when or when > date.today().isoformat() or when < floor.isoformat():
        raise invalid(f"Use a payment date between {floor} and today.", {"date": "Invalid date."})
    reference = str(req.get("reference") or "").strip()[:80]
    if method != "Cash" and not reference:
        raise invalid("Enter the transaction reference.", {"reference": "Enter the transaction reference."})
    if reference and any(x.get("reference") == reference and x.get("method") == method for other in db.execute(select(Expense)).scalars() for x in payments_of(other)):
        raise conflict(f"The reference “{reference}” was already used for another payment.", {"reference": "Already used."})
    n = len(e.attributes.get("payments", [])) + 1
    entry = {"id": ids.new_id(db, "EPAY", 5), "number": f"{e.number}-P{n}", "kind": "Reimbursement" if employee_kind else "Payment", "amount": amount, "date": when, "method": method, "reference": reference,
             "note": str(req.get("note") or "")[:300], "status": "Completed", "by": p.actor_id, "at": now_iso(), "balanceAfter": pricing.round2(left - amount)}
    settled = left - amount <= pricing.EPS
    e.attributes = {**e.attributes, "payments": [*e.attributes.get("payments", []), entry], **({"paidBy": p.actor_id, "paidAt": now_iso()} if settled else {})}
    if employee_kind:
        e.reimbursed_amount = pricing.round2(float(e.reimbursed_amount or 0) + amount)
        e.reimbursed_date = date.fromisoformat(when)
    if settled:
        e.status = "Reimbursed" if employee_kind else "Paid"
        _close_tasks(db, e, "expensePayment:", "Completed", f"{'Reimbursed' if employee_kind else 'Paid'} by {p.name}")
    event(e, p, "Reimbursed" if employee_kind else "PaymentRecorded", f"{'Reimbursement' if employee_kind else 'Payment'} of {amount:.2f} recorded{' - settled' if settled else ''}", f"{method}{' - ref ' + reference if reference else ''} - {when}")
    for who in {e.created_by, e.employee_id}:
        timeline.notify(db, user_id=who, message=f"{'Reimbursement' if employee_kind else 'Payment'} of {amount:.2f} recorded for {e.number}.", type="Expense", related_type="Expense", related_id=e.id, branch=e.branch)
    audit.record(db, user=p.user, action="Expense payment", module="Expenses", record_id=e.id, details=f"{amount:.2f} {method}", info=p.info)
    db.commit()
    return public(db, p, e, detail=True)


def delete_draft(db: Session, p: Principal, expense_id: str) -> dict:
    e = get_expense(db, p, expense_id)
    if not perms_for(db, p, e)["deleteDraft"]:
        raise forbidden("Only a draft can be deleted. Cancel the expense instead - its record is kept." if e.status != "Draft" else "You do not have permission to delete expenses.")
    db.delete(e)
    audit.record(db, user=p.user, action="Deleted draft expense", module="Expenses", record_id=expense_id, details=e.number, info=p.info)
    db.commit()
    return {"success": True}


def get_config_payload(db: Session, p: Principal) -> dict:
    caps = caps_of(p)
    if "view" not in caps:
        raise forbidden("You do not have access to expenses.")
    return {"config": config(db), "methods": list(METHODS), "categories": [to_json(c) for c in db.execute(select(ExpenseCategory).order_by(ExpenseCategory.name)).scalars()], "taxRates": list(TAX_RATES),
            "perms": perms_for(db, p, None), "caps": sorted(caps), "user": {"id": p.actor_id, "name": p.name, "role": p.user.job_role, "department": p.user.department}, "scope": "Organization" if org_scope(p) else "Own"}


def put_config(db: Session, p: Principal, req: dict) -> dict:
    if not (p.level in ("Super Admin", "Admin") or p.user.job_role == "Accounts"):
        raise forbidden("Only finance administrators can change expense settings.")
    cfg = config(db)
    if "prefix" in req:
        prefix = str(req["prefix"]).strip().upper()
        if not (2 <= len(prefix) <= 6 and prefix.isalpha()):
            raise invalid("The expense prefix must be 2-6 letters.", {"prefix": "Use 2-6 letters."})
        cfg["prefix"] = prefix
    if "allowSelfApproval" in req:
        cfg["allowSelfApproval"] = bool(req["allowSelfApproval"])
    for key in ("approvalDueDays", "reimbursementDays"):
        if key in req and isinstance(req[key], int) and 0 <= req[key] <= 90:
            cfg[key] = req[key]
    if "receiptRequiredAbove" in req:
        if not pricing._num(req["receiptRequiredAbove"]) >= 0:
            raise invalid("Enter 0 or more.", {"receiptRequiredAbove": "Enter 0 or more."})
        cfg["receiptRequiredAbove"] = pricing._num(req["receiptRequiredAbove"])
    if isinstance(req.get("approvalLimits"), dict):
        cfg["approvalLimits"] = {role: pricing._num(v) for role, v in req["approvalLimits"].items() if pricing._num(v) > 0}
    row = db.get(AppSetting, "expense_config")
    if row is None:
        db.add(AppSetting(key="expense_config", value=cfg, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = cfg, p.actor_id
    audit.record(db, user=p.user, action="Expense settings changed", module="Expenses", details=str(sorted(req))[:300], info=p.info)
    db.commit()
    return config(db)


class ExpenseHooks(Hooks):
    def before_create(self, ctx, obj, payload):
        raise forbidden("Create expenses through POST /expenses.")

    def before_update(self, ctx, obj, changes, payload):
        raise forbidden("Edit expenses through PUT /expenses/{id}.")

    def before_delete(self, ctx, obj):
        raise forbidden("Delete a draft expense through DELETE /expenses/{id}.")


class CatalogHooks(Hooks):
    """Categories and vendors: managed by people holding the manageCategories / manageVendors capability."""

    def __init__(self, cap: str):
        self.cap = cap

    def _check(self, ctx):
        if self.cap not in caps_of(ctx.principal):
            raise forbidden("You do not have permission to manage this list.")

    def authorize(self, ctx, action):
        self._check(ctx)

    def before_create(self, ctx, obj, payload):
        self._check(ctx)

    def before_update(self, ctx, obj, changes, payload):
        self._check(ctx)
        if getattr(obj, "system", False) and set(changes) - {"color", "description"}:
            raise conflict("A system category can only change its colour and description.")

    def before_delete(self, ctx, obj):
        self._check(ctx)
        if getattr(obj, "system", False):
            raise conflict("A system category cannot be deleted.")
        used = ctx.db.execute(select(Expense.id).where((Expense.category_id == obj.id) | (Expense.vendor_id == obj.id)).limit(1)).first()
        if used:
            raise conflict("It is used by expenses. Deactivate it instead.", code="IN_USE")
