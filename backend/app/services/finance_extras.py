"""Invoice / payment settings (numbering, seller details, terms, extra taxes, bank accounts), the list of orders that can still be invoiced, and the CSV exports of invoices,
payments and expenses. Exports respect the caller's own visibility (the same rows as their lists) and are only for roles holding the export capability."""
import csv
import io
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import forbidden, invalid
from app.models import AppSetting, Deal, Invoice, Payment, SalesOrder
from app.services import audit, billing, expenses as expense_svc, pricing, records
from app.services.modules import SPEC_BY_KEY

KEY = "invoice_config"
DEFAULT_CONFIG = {
    "prefix": "INV", "paymentPrefix": "PAY", "defaultTermsDays": 15, "roundOff": True, "extraTaxes": [],
    "paymentMethods": ["Cash", "Bank Transfer", "UPI", "Card", "Cheque", "NEFT", "RTGS", "IMPS", "Other"], "bankAccounts": ["Cash in hand"],
    "footer": "Thank you for your business. Payment is due within the agreed terms.",
    "terms": "Payment is due by the due date shown. Late payments may attract interest as per the agreed terms.", "bankDetails": "",
    "org": {"name": "", "address": "", "gstin": "", "email": "", "phone": "", "pan": ""},
}
PAYMENT_STATUS_OPTIONS = ["Pending", "Completed", "Failed", "Cancelled", "Refunded", "Partially Refunded"]
ADMINS = ("Super Admin", "Admin", "Accounts")
BOM = "﻿"


def config(db: Session) -> dict:
    row = db.get(AppSetting, KEY)
    stored = dict(row.value) if row else {}
    return {**DEFAULT_CONFIG, **stored, "org": {**DEFAULT_CONFIG["org"], **(stored.get("org") or {})}, "extraTaxes": stored.get("extraTaxes") if isinstance(stored.get("extraTaxes"), list) else []}


def _role(p: Principal) -> str:
    return "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)


def invoice_config_payload(db: Session, p: Principal) -> dict:
    caps = billing.invoice_caps(p)
    cfg = config(db)
    return {"config": cfg, "caps": sorted(caps), "perms": {c: True for c in caps}, "user": {"id": p.actor_id, "name": p.name, "role": _role(p), "department": p.user.department}, "paymentMethods": cfg["paymentMethods"]}


def payment_config_payload(db: Session, p: Principal) -> dict:
    caps = billing.payment_caps(p)
    cfg = config(db)
    return {"methods": cfg["paymentMethods"], "accounts": cfg["bankAccounts"], "statuses": PAYMENT_STATUS_OPTIONS, "caps": sorted(caps), "user": {"id": p.actor_id, "name": p.name, "role": _role(p)},
            "matrix": {"create": p.can("Payments", "create"), "view": p.can("Payments", "view")}}


def put_invoice_config(db: Session, p: Principal, b: dict) -> dict:
    if _role(p) not in ADMINS:
        audit.record(db, user=p.user, action="Denied: invoice settings", module="Invoices", result="Denied", info=p.info)
        db.commit()
        raise forbidden("Only finance administrators can change invoice settings.")
    cur = config(db)
    nxt = dict(cur)

    def prefix(key: str, label: str) -> None:
        if key in b:
            v = str(b[key]).strip().upper()
            if not re.fullmatch(r"[A-Z]{2,6}", v):
                raise invalid(f"The {label} must be 2–6 letters.", {key: "2–6 letters."})
            nxt[key] = v

    prefix("prefix", "prefix")
    prefix("paymentPrefix", "payment prefix")
    if "defaultTermsDays" in b:
        try:
            n = round(float(b["defaultTermsDays"]))
        except (TypeError, ValueError):
            n = -1
        if not 0 <= n <= 180:
            raise invalid("Payment terms must be 0–180 days.", {"defaultTermsDays": "0–180."})
        nxt["defaultTermsDays"] = n
    if "roundOff" in b:
        nxt["roundOff"] = bool(b["roundOff"])
    if "paymentMethods" in b:
        methods = list(dict.fromkeys(str(x).strip() for x in (b["paymentMethods"] or []) if str(x).strip()))
        if not methods or any(len(x) > 30 for x in methods):
            raise invalid("Keep at least one payment method (up to 30 characters each).", {"paymentMethods": "Check the methods."})
        nxt["paymentMethods"] = methods
    if "bankAccounts" in b:
        nxt["bankAccounts"] = list(dict.fromkeys(str(x).strip()[:80] for x in (b["bankAccounts"] or []) if str(x).strip()))
    for key in ("footer", "terms", "bankDetails"):
        if key in b:
            nxt[key] = str(b[key])[:2000]
    if "extraTaxes" in b:
        taxes = []
        for x in b["extraTaxes"] or []:
            name = str(x.get("name") or "").strip()[:30]
            try:
                rate = float(x.get("rate"))
            except (TypeError, ValueError):
                rate = 0
            if name or rate:
                taxes.append({"name": name, "rate": rate})
        if any(not t["name"] or not 0 < t["rate"] <= 100 for t in taxes):
            raise invalid("Each additional tax needs a name and a rate between 0 and 100.", {"extraTaxes": "Check the additional taxes."})
        nxt["extraTaxes"] = taxes
    if isinstance(b.get("org"), dict):
        org = {**cur["org"], **{k: str(v)[:300] for k, v in b["org"].items() if k in DEFAULT_CONFIG["org"]}}
        org["gstin"] = org["gstin"].strip().upper()
        if org["gstin"] and not re.fullmatch(r"\d{2}[A-Z0-9]{13}", org["gstin"]):
            raise invalid("GSTIN must be 15 characters.", {"gstin": "Invalid GSTIN."})
        nxt["org"] = org
    row = db.get(AppSetting, KEY)
    if row is None:
        db.add(AppSetting(key=KEY, value=nxt, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = nxt, p.actor_id
    audit.record(db, user=p.user, action="Invoice settings changed", module="Invoices", details=", ".join(sorted(b)), info=p.info)
    db.commit()
    return nxt


def eligible_orders(db: Session, p: Principal) -> list[dict]:
    if "create" not in billing.invoice_caps(p):
        raise forbidden("You do not have permission to create invoices.")
    live = {x for (x,) in db.execute(select(Invoice.sales_order_id).where(Invoice.status.notin_(("Cancelled", "Void")), Invoice.sales_order_id.is_not(None))).all()}
    out = []
    spec = SPEC_BY_KEY["salesOrders"]
    for so in db.execute(select(SalesOrder).where(SalesOrder.status.in_(("Confirmed", "Processing", "Partially Fulfilled", "Fulfilled"))).order_by(SalesOrder.created_at.desc())).scalars():
        if so.id in live:
            continue
        deal = db.get(Deal, so.deal_id) if so.deal_id else None
        out.append({"id": so.id, "number": so.number, "customerName": so.customer_name, "companyName": so.company_name, "dealName": deal.name if deal else None,
                    "amount": float(so.amount) if "viewFinancial" in billing.invoice_caps(p) else None, "status": so.status, "orderDate": so.order_date.isoformat() if so.order_date else None, "paymentTerms": so.payment_terms})
    del spec
    return out


def _csv(head: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(head)
    for r in rows:
        w.writerow(["" if v is None else _safe(v) for v in r])
    return BOM + buf.getvalue()


def _safe(v):
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "@") or (s[:1] == "-" and not re.fullmatch(r"-?\d+(\.\d+)?", s)) else v  # a spreadsheet must never run a cell as a formula


def export_invoices(db: Session, p: Principal, params: dict) -> str:
    caps = billing.invoice_caps(p)
    if "export" not in caps:
        audit.record(db, user=p.user, action="Denied: invoice export", module="Invoices", result="Denied", info=p.info)
        db.commit()
        raise forbidden("You do not have permission to export invoice data.")
    rows = records.list_records(db, SPEC_BY_KEY["invoices"], p, {**params, "all": "true"})
    audit.record(db, user=p.user, action="Export", module="Invoices", details=f"{len(rows)} invoice(s) exported", info=p.info)
    db.commit()
    head = ["Invoice number", "Status", "Payment status", "Customer", "Company", "Sales order", "Deal", "Project", "Owner", "Invoice date", "Due date", "Taxable amount", "GST", "Round off", "Grand total", "Paid", "Balance"]
    return _csv(head, [[i.get("number"), i.get("status"), i.get("paymentStatus"), i.get("customerName"), i.get("companyName"), i.get("salesOrderNumber"), i.get("dealName"), i.get("projectName"),
                        i.get("ownerName"), i.get("issueDate"), i.get("dueDate"), i.get("taxableAmount"), i.get("tax"), i.get("roundOff"), i.get("amount"), i.get("paidAmount"), i.get("balance")] for i in rows])


def export_payments(db: Session, p: Principal, params: dict) -> str:
    if "export" not in billing.payment_caps(p) or not p.can("Payments", "export"):
        audit.record(db, user=p.user, action="Denied: payment export", module="Payments", result="Denied", info=p.info)
        db.commit()
        raise forbidden("You do not have permission to export payment data.")
    rows = records.list_records(db, SPEC_BY_KEY["payments"], p, {**params, "all": "true"})
    audit.record(db, user=p.user, action="Export", module="Payments", details=f"{len(rows)} payment(s)", info=p.info)
    db.commit()
    head = ["Payment number", "Status", "Date", "Invoice", "Customer", "Company", "Sales order", "Deal", "Project", "Method", "Reference", "Amount", "Refunded", "Net received"]
    return _csv(head, [[x.get("number"), x.get("status"), x.get("date"), x.get("invoiceNumber"), x.get("customerName"), x.get("companyName"), x.get("salesOrderNumber"), x.get("dealName"),
                        x.get("projectName"), x.get("method"), x.get("reference"), x.get("amount"), x.get("refundedAmount"), x.get("netAmount")] for x in rows])


def export_expenses(db: Session, p: Principal, params: dict) -> str:
    perms = expense_svc.perms_for(db, p, None)
    if not perms.get("export"):
        audit.record(db, user=p.user, action="Denied: expense export", module="Expenses", result="Denied", info=p.info)
        db.commit()
        raise forbidden("You do not have permission to export expense data.")
    rows = expense_svc.list_expenses(db, p, {**params, "all": "true"})
    audit.record(db, user=p.user, action="Expense export", module="Expenses", details=f"{len(rows)} expense(s)", info=p.info)
    db.commit()
    head = ["Expense number", "Date", "Type", "Category", "Description", "Vendor", "Employee", "Project", "Customer", "Deal", "Amount", "Tax", "Total", "Approved amount", "Paid / reimbursed", "Status", "Payment status", "Created by"]
    kind = {"Employee": "Employee claim", "Vendor": "Vendor bill", "Direct": "Direct payment"}
    return _csv(head, [[e.get("number"), e.get("date"), kind.get(e.get("kind"), e.get("kind")), e.get("categoryName"), e.get("description"), e.get("vendorName"), e.get("employeeName"), e.get("projectName"),
                        e.get("customerName"), e.get("dealName"), e.get("amount"), e.get("tax"), e.get("total"), e.get("approvedAmount"), e.get("paid"), e.get("status"), e.get("paymentStatus"),
                        e.get("createdByName")] for e in rows])


__all__ = ["pricing", "Payment"]
