"""Invoices and payments.

Invoice: the stored lifecycle (Draft / Sent / Viewed / Cancelled / Void) plus the REAL payments and the due date decide the visible status - Paid only when received payments cover the
whole amount, Overdue when the due date has passed with a balance. Every figure is computed here from the line items. A completed payment's amount / date / reference / method / invoice are
frozen: corrections are cancel / reverse / refund, each with a reason and an audit event.
"""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import Activity, Company, Contact, Contract, Customer, Deal, Employee, Invoice, Payment, Project, Quotation, SalesOrder
from app.services import audit, pricing, timeline
from app.services.codec import to_json
from app.services.records import Ctx, Hooks

PAYMENT_METHODS = ("Cash", "Bank Transfer", "UPI", "Card", "Cheque", "NEFT", "RTGS", "IMPS", "Other")
PAYMENT_STATUSES = ("Pending", "Completed", "Failed", "Cancelled", "Refunded", "Partially Refunded")

ALL_CAPS = ("view", "create", "createManual", "edit", "send", "download", "print", "recordPayment", "cancelVoid", "deleteDraft", "viewFinancial", "export")
INVOICE_ROLE_CAPS = {
    "Admin": ALL_CAPS, "MD": ("view", "download", "print", "viewFinancial", "export"), "CEO": ("view", "download", "print", "viewFinancial", "export"),
    "Accounts": ("view", "create", "createManual", "edit", "send", "download", "print", "recordPayment", "cancelVoid", "deleteDraft", "viewFinancial", "export"),
    "Sales Manager": ("view", "create", "edit", "send", "download", "print", "viewFinancial", "export"), "Sales Executive": ("view", "download", "print"),
    "Project Manager": ("view", "download", "print", "viewFinancial"),
}
PAY_ALL = ("view", "create", "edit", "downloadReceipt", "printReceipt", "uploadProof", "refund", "cancel", "deleteDraft", "export", "viewFinancial")
PAYMENT_ROLE_CAPS = {
    "Admin": PAY_ALL, "Accounts": PAY_ALL, "MD": ("view", "downloadReceipt", "printReceipt", "export", "viewFinancial"), "CEO": ("view", "downloadReceipt", "printReceipt", "export", "viewFinancial"),
    "Sales Manager": ("view", "downloadReceipt", "printReceipt", "viewFinancial"), "Sales Executive": ("view", "downloadReceipt"), "Project Manager": ("view", "viewFinancial"),
}
DRAFT_EDIT = {"items", "issueDate", "dueDate", "paymentTerms", "billingAddress", "shippingAddress", "gstin", "taxType", "extraTaxes", "contactId", "projectId", "contractId", "notes", "terms", "ownerId", "roundOff"}
ISSUED_EDIT = {"dueDate", "notes", "shippingAddress", "ownerId", "projectId", "contractId"}
MONEY = ("amount", "paidAmount", "subtotal", "discountAmount", "taxableAmount", "tax", "cgst", "sgst", "igst", "otherTaxAmount", "roundOff", "balance")


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _config(db: Session) -> dict:
    from app.services import finance_extras

    return finance_extras.config(db)


def invoice_caps(p: Principal) -> set[str]:
    if p.is_super_admin:
        return set(ALL_CAPS)
    base = set(INVOICE_ROLE_CAPS["Admin" if p.level == "Admin" else p.user.job_role] if (p.level == "Admin" or p.user.job_role in INVOICE_ROLE_CAPS) else ("view",))
    # the module permission the Super Admin granted to this account narrows what the role would allow
    grant = p.permissions.get("Invoices", {})
    if not grant.get("view"):
        return set()
    if not grant.get("create"):
        base -= {"create", "createManual"}
    if not grant.get("edit"):
        base -= {"edit", "send", "recordPayment", "cancelVoid"}
    if not grant.get("delete"):
        base -= {"deleteDraft"}
    return base


def payment_caps(p: Principal) -> set[str]:
    if p.is_super_admin:
        return set(PAY_ALL)
    base = set(PAYMENT_ROLE_CAPS["Admin" if p.level == "Admin" else p.user.job_role] if (p.level == "Admin" or p.user.job_role in PAYMENT_ROLE_CAPS) else ("view",))
    grant = p.permissions.get("Payments", {})
    if not grant.get("view"):
        return set()
    if not grant.get("create"):
        base -= {"create"}
    if not grant.get("edit"):
        base -= {"edit", "refund", "cancel"}
    if not grant.get("delete"):
        base -= {"deleteDraft"}
    return base


def own_only(p: Principal) -> bool:
    return not p.is_super_admin and p.level != "Admin" and p.user.job_role not in ("MD", "CEO", "Accounts", "Sales Manager")


def invoice_scope(p: Principal):
    if own_only(p):
        return (Invoice.owner_id == p.actor_id) | (Invoice.created_by == p.actor_id)
    return None


def payment_scope(p: Principal):
    if own_only(p):
        return (Payment.received_by == p.actor_id) | (Payment.created_by == p.actor_id) | (Payment.recorded_by == p.actor_id)
    return None


def _timeline(inv, **entry) -> None:
    attrs = dict(inv.attributes or {})
    attrs["timeline"] = [*attrs.get("timeline", []), {"at": now_iso(), **entry}]
    inv.attributes = attrs


def _pay_timeline(pay, **entry) -> None:
    attrs = dict(pay.attributes or {})
    attrs["timeline"] = [*attrs.get("timeline", []), {"at": now_iso(), **entry}]
    pay.attributes = attrs


def get_invoice(db: Session, p: Principal, invoice_id: str) -> Invoice:
    stmt = select(Invoice).where(Invoice.id == invoice_id)
    scope = invoice_scope(p)
    if scope is not None:
        stmt = stmt.where(scope)
    inv = db.execute(stmt).scalar_one_or_none()
    if inv is None:
        raise not_found("Invoice not found.")
    return inv


def payments_of(db: Session, invoice_id: str) -> list[Payment]:
    return list(db.execute(select(Payment).where(Payment.invoice_id == invoice_id)).scalars())


def recompute(db: Session, inv: Invoice) -> None:
    """Paid amount and visible status from the real payments + due date (called after every payment change and by the overdue sweep)."""
    paid = pricing.round2(sum(pricing.payment_net(pay.status, pay.amount, pay.refunded_amount) for pay in payments_of(db, inv.id)))
    inv.paid_amount = paid
    state = pricing.derive_invoice_state(inv.lifecycle, inv.amount, inv.due_date, paid)
    inv.status = state["status"]


def refresh_overdue(db: Session) -> int:
    """Daily state change without a payment: an issued invoice past its due date with a balance becomes Overdue."""
    today = date.today()
    changed = 0
    for inv in db.execute(select(Invoice).where(Invoice.lifecycle.in_(("Sent", "Viewed")), Invoice.status != "Paid", Invoice.due_date.is_not(None), Invoice.due_date < today)).scalars().all():
        state = pricing.derive_invoice_state(inv.lifecycle, inv.amount, inv.due_date, inv.paid_amount)
        if inv.status != state["status"]:
            inv.status = state["status"]
            changed += 1
    return changed


def invoice_json(db: Session, p: Principal, inv: Invoice, detail: bool = False) -> dict:
    out = to_json(inv)
    state = pricing.derive_invoice_state(inv.lifecycle, inv.amount, inv.due_date, inv.paid_amount)
    out.update(balance=state["balance"], paymentStatus=state["paymentStatus"], overdueDays=state["overdueDays"], status=state["status"])
    if not detail:
        out.pop("timeline", None)
        out.pop("sends", None)
    caps = invoice_caps(p)
    who = [i for i in (inv.owner_id, inv.created_by) if i]
    names = dict(db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(who))).all()) if who else {}
    out.update(ownerName=names.get(inv.owner_id), createdByName=names.get(inv.created_by))
    unpaid = inv.paid_amount is None or float(inv.paid_amount) <= 0
    # what this person may do with THIS invoice right now (the buttons the screen shows); every action is checked again by the server when it is taken
    out["perms"] = {
        "edit": "edit" in caps and inv.status not in pricing.DEAD,
        "send": "send" in caps and (inv.lifecycle == "Draft" or (inv.status in pricing.ISSUED and inv.status != "Paid")),
        "markViewed": "send" in caps and inv.lifecycle == "Sent",
        "recordPayment": "recordPayment" in caps and inv.status in pricing.ISSUED and inv.status != "Paid" and state["balance"] > pricing.EPS,
        "cancel": "cancelVoid" in caps and (inv.lifecycle == "Draft" or (inv.status in ("Sent", "Viewed", "Overdue") and unpaid)),
        "void": "cancelVoid" in caps and inv.status in pricing.ISSUED and unpaid,
        "deleteDraft": "deleteDraft" in caps and inv.lifecycle == "Draft",
        "duplicate": {"create", "createManual"} <= caps,
        "refreshMaster": "edit" in caps and inv.lifecycle == "Draft",
        "print": "print" in caps, "download": "download" in caps,
        "createTasks": p.can("Tasks", "create"), "uploadDocuments": bool(caps & {"edit", "recordPayment", "send"}),
    }
    if "viewFinancial" not in caps:
        for key in MONEY:
            out[key] = None
        out["items"] = [{**i, "unitPrice": None, "discount": None, "taxRate": None} for i in out.get("items", [])]
        out["extraTaxes"], out["financialHidden"] = [], True
    if detail:
        pays = payments_of(db, inv.id)
        out["payments"] = [] if "viewFinancial" not in caps else [to_json(x) for x in sorted(pays, key=lambda x: str(x.date), reverse=True)]
    return out


class InvoiceHooks(Hooks):
    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        return invoice_json(ctx.db, ctx.principal, obj)

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        raise forbidden("Create invoices through the invoice form (POST /invoices) or from a sales order.")

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        raise forbidden("Edit invoices through the invoice actions.")

    def before_delete(self, ctx: Ctx, obj) -> None:
        raise forbidden("Delete a draft invoice through DELETE /invoices/{id}.")


# ---- create ------------------------------------------------------------------------------------------------------------------
def _party(db: Session, data: dict) -> dict:
    customer = db.execute(select(Customer).where(Customer.id == data.get("customerId"))).scalar_one_or_none()
    if customer is None:
        raise invalid("Choose the customer this invoice is for.", {"customerId": "Customer not found."})
    company = db.get(Company, customer.company_id) if customer.company_id else None
    contact = db.execute(select(Contact).where(Contact.id == data["contactId"])).scalar_one_or_none() if data.get("contactId") else None
    return {"customer": customer, "company": company, "contact": contact}


def _ref_ok(db: Session, model, record_id: str | None, field: str):
    if not record_id:
        return None
    rec = db.execute(select(model).where(model.id == record_id)).scalar_one_or_none()
    if rec is None:
        raise invalid("The linked record was not found.", {field: "Not found."})
    return rec


def build_invoice(db: Session, p: Principal, data: dict, *, sales_order: SalesOrder | None = None) -> Invoice:
    caps = invoice_caps(p)
    if "create" not in caps:
        raise forbidden("You do not have permission to create invoices.")
    if sales_order is None and "createManual" not in caps:
        raise forbidden("Invoices are created from a sales order; you do not have permission to create one manually.")
    parties = _party(db, data)
    customer, company, contact = parties["customer"], parties["company"], parties["contact"]
    items = pricing.validate_items(data.get("items"), "item")
    issue = date.fromisoformat(data["issueDate"][:10]) if data.get("issueDate") else date.today()
    terms_text = data.get("paymentTerms") or (customer.attributes or {}).get("paymentTerms") or ""
    due = date.fromisoformat(data["dueDate"][:10]) if data.get("dueDate") else pricing.due_date_from(terms_text, issue)
    errors = {}
    if due < issue:
        errors["dueDate"] = "The due date cannot be before the invoice date."
    billing = (data.get("billingAddress") or customer.billing_address or (company.billing_address if company else "") or "").strip()
    if not billing:
        errors["billingAddress"] = "Billing address is required."
    gstin = (data.get("gstin") if data.get("gstin") is not None else customer.gstin or "").strip()
    if gstin and not pricing.GSTIN.match(gstin):
        errors["gstin"] = "GSTIN must be 15 characters (e.g. 29AABCT1332L1ZV)."
    for index, tax in enumerate(data.get("extraTaxes") or []):
        if not str(tax.get("name") or "").strip():
            errors[f"tax-{index}-name"] = "Name required"
        if not 0 < pricing._num(tax.get("rate")) <= 100:
            errors[f"tax-{index}-rate"] = "0-100%"
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    tax_type = data.get("taxType") if data.get("taxType") in ("intra", "inter") else pricing.infer_tax_type(gstin)
    totals = pricing.compute_invoice(items, tax_type=tax_type, extra_taxes=data.get("extraTaxes"), round_off=data.get("roundOff", True) is not False)
    project = _ref_ok(db, Project, data.get("projectId"), "projectId")
    contract = _ref_ok(db, Contract, data.get("contractId"), "contractId")
    so = sales_order
    inv = Invoice(
        id=ids.new_id(db, "INV", 5), number=ids.new_number(db, _config(db)["prefix"], width=5), customer_id=customer.id, customer_name=customer.name, company_id=company.id if company else None,
        company_name=company.name if company else "", contact_id=contact.id if contact else None, contact_name=contact.name if contact else customer.contact_person, contact_email=(contact.email if contact else customer.email) or "",
        contact_phone=(contact.phone if contact else customer.phone) or "", project_id=project.id if project else None, contract_id=contract.id if contract else None,
        sales_order_id=so.id if so else None, sales_order_number=so.number if so else "", quotation_id=so.quotation_id if so else None, quotation_number=so.quotation_number if so else "",
        deal_id=so.deal_id if so else None, lead_id=so.lead_id if so else None, owner_id=data.get("ownerId") or (so.salesperson if so else None) or p.actor_id,
        source=(so.source if so else "Manual Entry"), source_detail=so.source_detail if so else None, amount=totals["amount"], paid_amount=0, subtotal=totals["subtotal"], discount_amount=totals["discountAmount"],
        taxable_amount=totals["taxableAmount"], tax=totals["tax"], cgst=totals["cgst"], sgst=totals["sgst"], igst=totals["igst"], other_tax_amount=totals["otherTaxAmount"], round_off=totals["roundOff"],
        tax_type=tax_type, issue_date=issue, due_date=due, status="Draft", lifecycle="Draft", billing_address=billing, shipping_address=(data.get("shippingAddress") or customer.shipping_address or "").strip(),
        gstin=gstin, payment_terms=terms_text[:300], notes=str(data.get("notes") or "")[:4000], terms=str(data.get("terms") or "")[:4000], created_by=p.actor_id,
        branch=customer.branch, attributes={"items": items, "extraTaxes": totals["extraTaxes"], "timeline": [], "sends": [], "roundOffEnabled": data.get("roundOff", True) is not False},
    )
    _timeline(inv, type="Created", by=p.actor_id, text="Invoice created" + (f" from sales order {so.number}" if so else ""))
    db.add(inv)
    db.flush()
    if so is not None:
        so.invoice_id = inv.id
        so.attributes = {**so.attributes, "invoiceIds": [*so.attributes.get("invoiceIds", []), inv.id]}
    timeline.log_activity(db, related_type="Invoice", related_id=inv.id, related_name=inv.number, type="Invoice", subject=f"Invoice {inv.number} created", by=p.actor_id, branch=inv.branch)
    audit.record(db, user=p.user, action="Create invoice", module="Invoices", record_id=inv.id, info=p.info)
    return inv


def create_invoice(db: Session, p: Principal, data: dict) -> dict:
    so = None
    if data.get("salesOrderId"):
        so = _ref_ok(db, SalesOrder, data["salesOrderId"], "salesOrderId")
    inv = build_invoice(db, p, data, sales_order=so)
    db.commit()
    return invoice_json(db, p, inv, detail=True)


def invoice_from_sales_order(db: Session, p: Principal, so_id: str, data: dict | None = None) -> dict:
    so = db.execute(select(SalesOrder).where(SalesOrder.id == so_id)).scalar_one_or_none()
    if so is None:
        raise not_found("Sales order not found.")
    if so.status not in ("Confirmed", "Processing", "Partially Fulfilled", "Fulfilled"):
        raise conflict(f"A {so.status} sales order cannot be invoiced yet - confirm it first.")
    live = db.execute(select(Invoice).where(Invoice.sales_order_id == so.id, Invoice.lifecycle.notin_(pricing.DEAD))).scalars().first()
    if live is not None and not (data or {}).get("allowAnother"):
        raise conflict(f"Sales order {so.number} already has invoice {live.number}.", code="ALREADY_INVOICED")
    body = {"customerId": so.customer_id, "items": so.attributes.get("items", []), "billingAddress": so.billing_address, "shippingAddress": so.shipping_address, "gstin": so.gstin,
            "taxType": so.tax_type, "paymentTerms": so.payment_terms, "contactId": so.contact_id, **(data or {})}
    inv = build_invoice(db, p, body, sales_order=so)
    db.commit()
    return invoice_json(db, p, inv, detail=True)


# ---- edit & lifecycle --------------------------------------------------------------------------------------------------------
def edit_invoice(db: Session, p: Principal, invoice_id: str, data: dict) -> dict:
    inv = get_invoice(db, p, invoice_id)
    if "edit" not in invoice_caps(p):
        raise forbidden("You do not have permission to edit invoices.")
    allowed = DRAFT_EDIT if inv.status == "Draft" else () if inv.status in pricing.DEAD else {"notes"} if inv.status == "Paid" else ISSUED_EDIT
    refused = [k for k in data if k in DRAFT_EDIT | {"amount", "paidAmount", "status", "number", "customerId", "salesOrderId"} and k not in allowed]
    if refused:
        raise conflict(f"{', '.join(refused)} cannot be changed on a {inv.status.lower()} invoice.")
    if "items" in data or "taxType" in data or "extraTaxes" in data or "gstin" in data or "roundOff" in data:
        items = pricing.validate_items(data.get("items", inv.attributes.get("items")), "item")
        gstin = (data.get("gstin", inv.gstin) or "").strip()
        if gstin and not pricing.GSTIN.match(gstin):
            raise invalid("GSTIN must be 15 characters.", {"gstin": "Invalid GSTIN."})
        if data.get("taxType") in ("intra", "inter"):
            tax_type = data["taxType"]
        elif "gstin" in data:
            tax_type = pricing.infer_tax_type(gstin)
        else:
            tax_type = inv.tax_type
        totals = pricing.compute_invoice(items, tax_type=tax_type, extra_taxes=data.get("extraTaxes", inv.attributes.get("extraTaxes")), round_off=data.get("roundOff", inv.attributes.get("roundOffEnabled", True)) is not False)
        inv.amount, inv.subtotal, inv.discount_amount, inv.taxable_amount, inv.tax = totals["amount"], totals["subtotal"], totals["discountAmount"], totals["taxableAmount"], totals["tax"]
        inv.cgst, inv.sgst, inv.igst, inv.other_tax_amount, inv.round_off, inv.tax_type, inv.gstin = totals["cgst"], totals["sgst"], totals["igst"], totals["otherTaxAmount"], totals["roundOff"], tax_type, gstin
        inv.attributes = {**inv.attributes, "items": items, "extraTaxes": totals["extraTaxes"], "roundOffEnabled": data.get("roundOff", True) is not False}
    for key, attr in (("billingAddress", "billing_address"), ("shippingAddress", "shipping_address"), ("paymentTerms", "payment_terms"), ("notes", "notes"), ("terms", "terms")):
        if key in data:
            setattr(inv, attr, str(data[key] or "")[:4000])
    if "issueDate" in data and data["issueDate"]:
        inv.issue_date = date.fromisoformat(data["issueDate"][:10])
    if "dueDate" in data and data["dueDate"]:
        inv.due_date = date.fromisoformat(data["dueDate"][:10])
    if inv.due_date and inv.issue_date and inv.due_date < inv.issue_date:
        raise invalid("The due date cannot be before the invoice date.", {"dueDate": "Invalid."})
    for key, attr, model in (("projectId", "project_id", Project), ("contractId", "contract_id", Contract)):
        if key in data:
            _ref_ok(db, model, data[key], key)
            setattr(inv, attr, data[key] or None)
    if "ownerId" in data:
        inv.owner_id = data["ownerId"] or None
    recompute(db, inv)
    _timeline(inv, type="Updated", by=p.actor_id, text="Invoice edited")
    audit.record(db, user=p.user, action="Edit invoice", module="Invoices", record_id=inv.id, info=p.info)
    db.commit()
    return invoice_json(db, p, inv, detail=True)


def invoice_action(db: Session, p: Principal, invoice_id: str, action: str, data: dict) -> dict:
    inv = get_invoice(db, p, invoice_id)
    caps = invoice_caps(p)
    reason = str((data or {}).get("reason") or "").strip()
    if action == "send":
        if "send" not in caps:
            raise forbidden("You do not have permission to send invoices.")
        if inv.status in pricing.DEAD or inv.status == "Paid":
            raise conflict(f"A {inv.status.lower()} invoice cannot be sent.")
        if inv.lifecycle == "Draft":
            inv.lifecycle, inv.finalized_at = "Sent", datetime.now(UTC)
        sends = [*inv.attributes.get("sends", []), {"at": now_iso(), "by": p.actor_id, "to": (data or {}).get("to") or inv.contact_email, "channel": (data or {}).get("channel") or "Email"}]
        inv.attributes = {**inv.attributes, "sends": sends}
        _timeline(inv, type="Sent", by=p.actor_id, text=f"Invoice sent to {sends[-1]['to'] or 'the client'}")
        timeline.notify(db, user_id=inv.owner_id, message=f"Invoice {inv.number} was sent to {inv.customer_name}.", type="Invoice Sent", related_type="Invoice", related_id=inv.id, branch=inv.branch)
    elif action == "viewed":
        if inv.lifecycle != "Sent":
            raise conflict("Only a sent invoice can be marked as viewed.")
        inv.lifecycle = "Viewed"
        _timeline(inv, type="Viewed", by=p.actor_id, text="Marked as viewed by the client")
    elif action in ("cancel", "void"):
        if "cancelVoid" not in caps:
            raise forbidden("You do not have permission to cancel or void invoices.")
        pays = [x for x in payments_of(db, inv.id) if x.status in pricing.COUNTED_PAYMENT or x.status == "Pending"]
        if action == "cancel":
            if inv.lifecycle == "Draft":
                pass
            elif inv.status not in ("Sent", "Viewed", "Overdue") or pays or inv.paid_amount > 0:
                raise conflict("Only an unpaid invoice can be cancelled. Reverse its payments first, or void it.")
        elif inv.status not in pricing.ISSUED or pays:
            raise conflict("Only an issued invoice with no active payments can be voided.")
        if len(reason) < 3:
            raise invalid("Give a reason.", {"reason": "Give a reason."})
        inv.lifecycle = "Cancelled" if action == "cancel" else "Void"
        inv.attributes = {**inv.attributes, "cancelReason": reason, "cancelledBy": p.actor_id, "cancelledAt": now_iso()}
        _timeline(inv, type=inv.lifecycle, by=p.actor_id, text=f"Invoice {action}led - {reason}" if action == "cancel" else f"Invoice voided - {reason}")
    elif action == "duplicate":
        if "create" not in caps or "createManual" not in caps:
            raise forbidden("You do not have permission to create invoices manually.")
        copy = build_invoice(db, p, {"customerId": inv.customer_id, "items": inv.attributes.get("items", []), "billingAddress": inv.billing_address, "shippingAddress": inv.shipping_address, "gstin": inv.gstin,
                                     "taxType": inv.tax_type, "paymentTerms": inv.payment_terms, "contactId": inv.contact_id, "projectId": inv.project_id, "contractId": inv.contract_id,
                                     "extraTaxes": inv.attributes.get("extraTaxes"), "notes": inv.notes, "terms": inv.terms})
        db.commit()
        return invoice_json(db, p, copy, detail=True)
    elif action == "refresh":
        if inv.lifecycle != "Draft":
            raise conflict("Only a draft invoice can be refreshed from the customer record.")
        customer = db.get(Customer, inv.customer_id)
        inv.customer_name, inv.gstin, inv.billing_address = customer.name, customer.gstin or inv.gstin, customer.billing_address or inv.billing_address
        _timeline(inv, type="Refreshed", by=p.actor_id, text="Customer details refreshed from the master record")
    else:
        raise not_found("Unknown invoice action.")
    recompute(db, inv)
    audit.record(db, user=p.user, action=f"Invoice {action}", module="Invoices", record_id=inv.id, details=reason, info=p.info)
    db.commit()
    return invoice_json(db, p, inv, detail=True)


def delete_draft(db: Session, p: Principal, invoice_id: str) -> dict:
    inv = get_invoice(db, p, invoice_id)
    if "deleteDraft" not in invoice_caps(p):
        raise forbidden("You do not have permission to delete invoices.")
    if inv.lifecycle != "Draft" or payments_of(db, inv.id):
        raise conflict("Only a draft invoice without payments can be deleted. Cancel or void it instead.")
    if inv.sales_order_id and (so := db.get(SalesOrder, inv.sales_order_id)) is not None:
        so.invoice_id = None
        so.attributes = {**so.attributes, "invoiceIds": [i for i in so.attributes.get("invoiceIds", []) if i != inv.id]}
    db.delete(inv)
    audit.record(db, user=p.user, action="Delete draft invoice", module="Invoices", record_id=invoice_id, info=p.info)
    db.commit()
    return {"success": True}


# ---- payments ----------------------------------------------------------------------------------------------------------------
class PaymentHooks(Hooks):
    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        raise forbidden("Record payments against an invoice (POST /payments with invoiceId).")

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        raise forbidden("Use the payment actions.")

    def before_delete(self, ctx: Ctx, obj) -> None:
        raise forbidden("Delete a pending payment through DELETE /payments/{id}.")

    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        return payment_view(ctx.principal, obj, data)


def payment_view(p: Principal, obj, data: dict) -> dict:
    caps = payment_caps(p)
    data["netAmount"] = pricing.payment_net(obj.status, obj.amount, obj.refunded_amount)
    pending = obj.status == "Pending"
    data["perms"] = {
        "edit": "edit" in caps and pending, "complete": "edit" in caps and pending, "fail": "edit" in caps and pending,
        "cancel": "cancel" in caps and obj.status in ("Pending", "Completed") and not pricing._num(obj.refunded_amount) > 0,
        "refund": "refund" in caps and obj.status in ("Completed", "Partially Refunded"), "deleteDraft": "deleteDraft" in caps and pending,
        "printReceipt": "printReceipt" in caps and obj.status != "Pending", "downloadReceipt": "downloadReceipt" in caps and obj.status != "Pending", "uploadProof": "uploadProof" in caps,
    }
    if "viewFinancial" not in caps:
        for key in ("amount", "netAmount", "refundedAmount"):
            data[key] = None
        data["financialHidden"] = True
    return data


def create_payment(db: Session, p: Principal, data: dict, invoice_id: str | None = None) -> dict:
    caps = payment_caps(p)
    if "create" not in caps:
        raise forbidden("You do not have permission to record payments.")
    inv = db.execute(select(Invoice).where(Invoice.id == (invoice_id or data.get("invoiceId")))).scalar_one_or_none()
    if inv is None:
        raise invalid("Choose the invoice this payment is for.", {"invoiceId": "Invoice not found."})
    if inv.status not in pricing.ISSUED or inv.status == "Paid":
        raise conflict(f"A payment cannot be recorded on a {inv.status.lower()} invoice.")
    amount = pricing.round2(pricing._num(data.get("amount")))
    state = pricing.derive_invoice_state(inv.lifecycle, inv.amount, inv.due_date, inv.paid_amount)
    if not amount > 0:
        raise invalid("Enter the amount received.", {"amount": "Must be greater than 0."})
    if amount > state["balance"] + pricing.EPS:
        raise invalid(f"The amount is more than the balance due ({state['balance']}).", {"amount": "More than the balance due."})
    method = data.get("method") or "Bank Transfer"
    if method not in PAYMENT_METHODS:
        raise invalid("Choose a payment method.", {"method": "Not an allowed method."})
    paid_on = date.fromisoformat(str(data.get("date") or date.today())[:10])
    if paid_on > date.today():
        raise invalid("The payment date cannot be in the future.", {"date": "Invalid date."})
    status = data.get("status") if data.get("status") in ("Pending", "Completed") else "Completed"
    pay = Payment(
        id=ids.new_id(db, "PAY", 5), number=ids.new_number(db, _config(db)["paymentPrefix"], width=5), invoice_id=inv.id, invoice_number=inv.number, customer_id=inv.customer_id, customer_name=inv.customer_name, company_id=inv.company_id,
        contact_id=inv.contact_id, deal_id=inv.deal_id, sales_order_id=inv.sales_order_id, quotation_id=inv.quotation_id, project_id=inv.project_id, contract_id=inv.contract_id, lead_id=inv.lead_id,
        amount=amount, method=method, date=paid_on, status=status, reference=str(data.get("reference") or "")[:120], bank_account=str(data.get("bankAccount") or "")[:120], received_by=data.get("receivedBy") or p.actor_id,
        recorded_by=p.actor_id, created_by=p.actor_id, branch=inv.branch, attributes={"refunds": [], "timeline": [], "balanceAfter": pricing.round2(state["balance"] - amount) if status == "Completed" else state["balance"],
                                                                                    "previousBalance": state["balance"], "notes": str(data.get("notes") or "")[:2000]},
    )
    db.add(pay)
    db.flush()
    _pay_timeline(pay, type="Recorded", by=p.actor_id, text=f"Payment {pay.number} recorded ({status})")
    recompute(db, inv)
    _timeline(inv, type="Payment", by=p.actor_id, text=f"Payment {pay.number} of {amount} {status.lower()}")
    inv.attributes = {**inv.attributes, "paymentIds": [*inv.attributes.get("paymentIds", []), pay.id]}
    timeline.log_activity(db, related_type="Invoice", related_id=inv.id, related_name=inv.number, type="Payment", subject=f"Payment {pay.number} of {amount} recorded", by=p.actor_id, branch=inv.branch, extra={"invoiceId": inv.id})
    timeline.notify(db, user_id=inv.owner_id, message=f"Payment of {amount} received for invoice {inv.number} ({inv.customer_name}).", type="Payment Received", related_type="Invoice", related_id=inv.id, branch=inv.branch)
    audit.record(db, user=p.user, action="Record payment", module="Payments", record_id=pay.id, details=f"{inv.number} {amount}", info=p.info)
    db.commit()
    return {**payment_view(p, pay, to_json(pay)), "invoice": invoice_json(db, p, inv)}


def payment_action(db: Session, p: Principal, payment_id: str, kind: str, data: dict) -> dict:
    stmt = select(Payment).where(Payment.id == payment_id)
    scope = payment_scope(p)
    if scope is not None:
        stmt = stmt.where(scope)
    pay = db.execute(stmt).scalar_one_or_none()
    if pay is None:
        raise not_found("Payment not found.")
    inv = db.get(Invoice, pay.invoice_id)
    caps = payment_caps(p)
    reason = str(data.get("reason") or "").strip()
    previous = pay.status
    if kind == "complete":
        if "edit" not in caps:
            raise forbidden("You do not have permission to complete payments.")
        if pay.status != "Pending":
            raise conflict("Only a pending payment can be completed.")
        pay.status = "Completed"
    elif kind == "fail":
        if "edit" not in caps or pay.status != "Pending":
            raise conflict("Only a pending payment can be marked as failed.")
        pay.status = "Failed"
    elif kind in ("cancel", "reverse"):
        if "cancel" not in caps:
            raise forbidden("You do not have permission to cancel this payment.")
        if pay.status not in ("Pending", "Completed") or pricing._num(pay.refunded_amount) > 0:
            raise conflict("A payment that has been refunded or already cancelled cannot be cancelled.")
        if len(reason) < 5:
            raise invalid("Give a reason (at least 5 characters).", {"reason": "Give a reason."})
        pay.status, pay.cancel_reason, pay.cancelled_at, pay.cancelled_by = "Cancelled", reason[:300], datetime.now(UTC), p.actor_id
    elif kind == "refund":
        if "refund" not in caps:
            raise forbidden("This payment cannot be refunded.")
        if pay.status not in ("Completed", "Partially Refunded"):
            raise conflict("Only a completed payment can be refunded.")
        left = pricing.round2(pricing._num(pay.amount) - pricing._num(pay.refunded_amount))
        amount = pricing.round2(pricing._num(data.get("amount")))
        if not amount > 0 or amount > left + pricing.EPS:
            raise invalid(f"Refund between 0 and {left} (what is left of this payment).", {"amount": "Invalid refund amount."})
        if len(reason) < 5:
            raise invalid("Give a reason for the refund (at least 5 characters).", {"reason": "Give a reason."})
        day = date.fromisoformat(str(data.get("date") or date.today())[:10])
        if day > date.today() or day < pay.date:
            raise invalid("The refund date must be between the payment date and today.", {"date": "Invalid date."})
        total = pricing.round2(pricing._num(pay.refunded_amount) + amount)
        pay.refunded_amount = total
        pay.status = "Refunded" if total >= pricing._num(pay.amount) - pricing.EPS else "Partially Refunded"
        pay.attributes = {**pay.attributes, "refunds": [*pay.attributes.get("refunds", []), {"id": ids.new_id(db, "RFD", 4), "amount": amount, "date": day.isoformat(), "reason": reason, "status": "Completed", "by": p.actor_id,
                                                                                                "at": now_iso(), "method": data.get("method") or pay.method}]}
    else:
        raise not_found("Unknown payment action.")
    _pay_timeline(pay, type=kind.capitalize(), by=p.actor_id, text=f"{previous} -> {pay.status}", reason=reason or None)
    db.flush()
    if inv is not None:
        recompute(db, inv)
        _timeline(inv, type="Payment", by=p.actor_id, text=f"Payment {pay.number}: {previous} -> {pay.status}")
        timeline.notify(db, user_id=inv.owner_id, message=f"Payment {pay.number} on invoice {inv.number} is now {pay.status}.", type="Payment Received", related_type="Invoice", related_id=inv.id, branch=inv.branch)
    audit.record(db, user=p.user, action=f"Payment {kind}", module="Payments", record_id=pay.id, details=reason, info=p.info)
    db.commit()
    return {**payment_view(p, pay, to_json(pay)), "invoice": invoice_json(db, p, inv) if inv is not None else None}


def delete_payment(db: Session, p: Principal, payment_id: str) -> dict:
    pay = db.execute(select(Payment).where(Payment.id == payment_id)).scalar_one_or_none()
    if pay is None:
        raise not_found("Payment not found.")
    if "deleteDraft" not in payment_caps(p):
        raise forbidden("You do not have permission to delete payments.")
    if pay.status != "Pending":
        raise conflict("Only a pending payment can be deleted. Cancel or refund it instead.")
    inv = db.get(Invoice, pay.invoice_id)
    db.delete(pay)
    db.flush()
    if inv is not None:
        recompute(db, inv)
    db.commit()
    return {"success": True}


def update_payment(db: Session, p: Principal, payment_id: str, data: dict) -> dict:
    pay = db.execute(select(Payment).where(Payment.id == payment_id)).scalar_one_or_none()
    if pay is None:
        raise not_found("Payment not found.")
    if "edit" not in payment_caps(p):
        raise forbidden("You do not have permission to edit payments.")
    frozen = {"amount", "date", "reference", "method", "invoiceId"}
    if pay.status != "Pending":
        rejected = [k for k in data if k in frozen and str(data[k]) != str(to_json(pay).get(k))]
        if rejected:
            raise conflict(f"{', '.join(rejected)} cannot be changed on a {pay.status.lower()} payment - it is a financial record. Cancel it or record a refund, with a reason, instead.")
    else:
        if "amount" in data:
            inv = db.get(Invoice, pay.invoice_id)
            state = pricing.derive_invoice_state(inv.lifecycle, inv.amount, inv.due_date, inv.paid_amount)
            amount = pricing.round2(pricing._num(data["amount"]))
            if not amount > 0 or amount > state["balance"] + pricing.EPS:
                raise invalid("The amount must be above 0 and not more than the balance due.", {"amount": "Invalid amount."})
            pay.amount = amount
        if "method" in data:
            if data["method"] not in PAYMENT_METHODS:
                raise invalid("Choose a payment method.", {"method": "Not an allowed method."})
            pay.method = data["method"]
        if "date" in data and data["date"]:
            pay.date = date.fromisoformat(str(data["date"])[:10])
        if "reference" in data:
            pay.reference = str(data["reference"] or "")[:120]
    if "bankAccount" in data:
        pay.bank_account = str(data["bankAccount"] or "")[:120]
    if "notes" in data:
        pay.attributes = {**pay.attributes, "notes": str(data["notes"] or "")[:2000]}
    _pay_timeline(pay, type="Updated", by=p.actor_id, text="Payment details updated")
    db.commit()
    return payment_view(p, pay, to_json(pay))
