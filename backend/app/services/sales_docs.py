"""Quotations, sales orders and proposals.

Quotation:   Draft -> Pending Approval -> Sent (approved) -> Viewed / Negotiation -> Accepted / Rejected / Expired. Totals are always computed here from the line items.
Sales order: only from an Accepted quotation. Draft -> Confirmed (manager) -> Processing -> Partially Fulfilled / Fulfilled; Cancelled needs a reason and no live invoice.
Proposal:    created from an open deal. Draft -> Internal Review -> Sent (manager approves) -> Viewed / Revision Requested -> Accepted / Rejected / Expired; a sent version is immutable (revise).
"""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import Company, Contact, Customer, Deal, Invoice, Product, Proposal, Quotation, SalesOrder
from app.services import audit, pricing, timeline
from app.services.codec import to_json
from app.services.records import Ctx, Hooks

QUOTATION_FLOW = {
    "Draft": ("Pending Approval", "Sent"), "Pending Approval": ("Draft", "Sent", "Rejected"), "Sent": ("Viewed", "Negotiation", "Accepted", "Rejected", "Expired"),
    "Viewed": ("Negotiation", "Accepted", "Rejected", "Expired"), "Negotiation": ("Accepted", "Rejected", "Expired"), "Accepted": (), "Rejected": (), "Expired": (),
}
QUOTATION_APPROVER_JOBS = ("MD", "Sales Manager")
QUOTATION_LOCKED = ("Accepted", "Rejected", "Expired")
SO_FLOW = {"Draft": ("Confirmed", "Cancelled"), "Confirmed": ("Processing", "Cancelled"), "Processing": ("Partially Fulfilled", "Fulfilled", "Cancelled"), "Partially Fulfilled": ("Fulfilled", "Cancelled"), "Fulfilled": (), "Cancelled": ()}
SO_LIGHT = {"expectedDeliveryDate", "deliveryTerms", "shippingAddress", "notes", "internalRemarks", "salesperson"}
SO_DRAFT = SO_LIGHT | {"orderDate", "paymentTerms", "billingAddress", "gstin", "taxType", "items", "contactId"}
CONFIRM_JOBS = ("Sales Manager",)
PROPOSAL_FLOW = {"Draft": ("Internal Review",), "Internal Review": ("Draft", "Sent"), "Sent": ("Viewed", "Revision Requested", "Accepted", "Rejected", "Expired"),
                 "Viewed": ("Revision Requested", "Accepted", "Rejected", "Expired"), "Revision Requested": ("Accepted", "Rejected", "Expired"), "Accepted": (), "Rejected": (), "Expired": ()}
PROPOSAL_EDITABLE = ("Draft", "Internal Review")
PROPOSAL_REVISABLE = ("Sent", "Viewed", "Revision Requested", "Rejected", "Expired")
PROPOSAL_OPEN = ("Draft", "Internal Review", "Sent", "Viewed", "Revision Requested")
CLOSED_DEAL = ("Closed Won", "Closed Lost", "Closed Lost – Competition")
VALIDITY_DAYS = 30


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def is_approver(p: Principal, jobs=QUOTATION_APPROVER_JOBS) -> bool:
    return p.level in ("Super Admin", "Admin") or p.user.job_role in jobs


def link_to_deal(db: Session, deal_id: str | None, key: str, record_id: str) -> None:
    if not deal_id:
        return
    deal = db.execute(select(Deal).where(Deal.id == deal_id)).scalar_one_or_none()
    if deal is not None:
        deal.attributes = {**deal.attributes, key: [*dict.fromkeys([*deal.attributes.get(key, []), record_id])]}


def deal_activity(db: Session, p: Principal, deal_id: str | None, **fields) -> None:
    deal = db.execute(select(Deal).where(Deal.id == deal_id)).scalar_one_or_none() if deal_id else None
    if deal is not None:
        timeline.log_activity(db, related_type="Deal", related_id=deal.id, related_name=deal.name, by=p.actor_id, branch=deal.branch, **fields)


# ================================ quotations ======================================================================================
class QuotationHooks(Hooks):
    def _apply_items(self, obj, items_raw) -> None:
        items = pricing.validate_items(items_raw, "item")
        totals = pricing.quotation_totals(items)
        obj.subtotal, obj.tax, obj.amount = totals["subtotal"], totals["tax"], totals["amount"]
        obj.attributes = {**obj.attributes, "items": items}

    def before_create(self, ctx: Ctx, obj: Quotation, payload: dict) -> None:
        if obj.status not in ("Draft", "Pending Approval") and not is_approver(ctx.principal):
            raise forbidden("A quotation starts as a Draft; a manager approves it before it is sent.")
        if obj.status not in QUOTATION_FLOW:
            raise invalid("Choose a valid status.", {"status": "Not an allowed value."})
        self._apply_items(obj, payload.get("items"))
        obj.valid_until = obj.valid_until or date.today() + timedelta(days=15)
        deal = ctx.db.execute(select(Deal).where(Deal.id == obj.deal_id)).scalar_one_or_none() if obj.deal_id else None
        if deal is not None and deal.stage in CLOSED_DEAL:
            raise conflict(f"This deal is {deal.stage}: a new quotation cannot be raised for it.")
        if obj.customer_id and not obj.customer_name:
            customer = ctx.db.execute(select(Customer).where(Customer.id == obj.customer_id)).scalar_one_or_none()
            obj.customer_name = customer.name if customer else ""
        contact = ctx.db.execute(select(Contact).where(Contact.id == obj.contact_id)).scalar_one_or_none() if obj.contact_id else None
        if contact is not None:  # the client's contact details come from the contact record, so a send always goes to a real, stored address
            obj.contact_name = obj.contact_name or contact.name
            obj.contact_email = obj.contact_email or contact.email or ""
            obj.contact_phone = obj.contact_phone or contact.phone or ""
        obj.assigned_to = obj.assigned_to or ctx.principal.actor_id

    def after_create(self, ctx: Ctx, obj: Quotation, payload: dict) -> None:
        link_to_deal(ctx.db, obj.deal_id, "quotationIds", obj.id)
        timeline.log_activity(ctx.db, related_type="Quotation", related_id=obj.id, related_name=obj.number, type="Created", subject=f"Quotation {obj.number} created for {obj.customer_name}", by=ctx.principal.actor_id, branch=obj.branch)
        deal_activity(ctx.db, ctx.principal, obj.deal_id, type="Quotation", subject=f"Quotation {obj.number} created")

    def before_update(self, ctx: Ctx, obj: Quotation, changes: dict, payload: dict) -> None:
        p = ctx.principal
        if obj.status in QUOTATION_LOCKED:
            commercial = set(changes) - {"nextFollowUp", "lastContactedDate", "notes"}
            if commercial:
                raise conflict(f"A {obj.status.lower()} quotation can no longer be changed ({', '.join(sorted(commercial))}).")
        if "status" in changes:
            target = changes["status"]
            if target not in QUOTATION_FLOW:
                raise invalid("Choose a valid status.", {"status": "Not an allowed value."})
            if target != obj.status and target not in QUOTATION_FLOW[obj.status]:
                raise invalid(f"A quotation cannot move from {obj.status} to {target}.", {"status": f"Not allowed from {obj.status}."})
            if target == "Sent" and not is_approver(p):
                raise forbidden("Only a manager can approve and send a quotation. Submit it for approval first.")
            ctx.state["old_status"] = obj.status
        if obj.status != "Draft" and "items" in changes and obj.status != "Pending Approval":
            raise conflict("The line items can only be changed while the quotation is a draft.")

    def after_update(self, ctx: Ctx, obj: Quotation, changes: dict, payload: dict) -> None:
        if "items" in changes:
            self._apply_items(obj, obj.attributes.get("items"))
        if "status" in changes and "old_status" in ctx.state:
            old, new = ctx.state["old_status"], obj.status
            if new == "Sent":
                obj.attributes = {**obj.attributes, "sentAt": now_iso()}
            timeline.log_activity(ctx.db, related_type="Quotation", related_id=obj.id, related_name=obj.number, type="StatusChange", subject=f"Status changed from {old} to {new}", by=ctx.principal.actor_id,
                                  branch=obj.branch, from_status=old, to_status=new)
            deal_activity(ctx.db, ctx.principal, obj.deal_id, type="Quotation", subject=f"Quotation {obj.number} is now {new}")
            if new in ("Accepted", "Rejected"):
                timeline.notify(ctx.db, user_id=obj.assigned_to, message=f"Quotation {obj.number} was {new.lower()} by {obj.customer_name}.", type="Quotation Update", related_type="Quotation", related_id=obj.id, branch=obj.branch)


def quotation_send(db: Session, p: Principal, quotation_id: str, data: dict) -> dict:
    q = db.execute(select(Quotation).where(Quotation.id == quotation_id)).scalar_one_or_none()
    if q is None:
        raise not_found("Quotation not found.")
    if not p.can("Quotations", "edit"):
        raise forbidden("You do not have permission to send quotations.")
    if q.status in ("Accepted", "Rejected", "Expired"):
        raise conflict(f"A {q.status.lower()} quotation cannot be sent.")
    if q.status in ("Draft", "Pending Approval") and not is_approver(p):
        raise forbidden("This quotation is not approved yet. Submit it for approval first - a manager can then approve and send it.")
    to = (data.get("to") or q.contact_email or "").strip()
    if "@" not in to:
        raise invalid("This quotation's contact has no valid email address.", {"to": "Invalid email."})
    if q.status in ("Draft", "Pending Approval"):
        old = q.status
        q.status = "Sent"
        timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="StatusChange", subject=f"Status changed from {old} to Sent", by=p.actor_id, branch=q.branch, from_status=old, to_status="Sent")
    sends = [*q.attributes.get("sends", []), {"id": ids.new_id(db, "SND", 4), "at": now_iso(), "byId": p.actor_id, "byName": p.name, "to": to, "subject": str(data.get("subject") or f"Quotation {q.number}")[:200]}]
    q.attributes = {**q.attributes, "sends": sends, "sentAt": q.attributes.get("sentAt") or now_iso()}
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Email", subject=f"Quotation {q.number} sent to {to}", by=p.actor_id, branch=q.branch)
    audit.record(db, user=p.user, action="Send quotation", module="Quotations", record_id=q.id, details=to, info=p.info)
    db.commit()
    return to_json(q)


# ================================ sales orders ====================================================================================
def _customer_for(db: Session, p: Principal, q: Quotation) -> Customer | None:
    customer = db.get(Customer, q.customer_id) if q.customer_id else None
    if customer is None and q.company_id:
        customer = db.execute(select(Customer).where(Customer.company_id == q.company_id)).scalars().first()
    if customer is None and q.company_id:
        company = db.get(Company, q.company_id)
        if company is not None:
            customer = Customer(id=ids.new_id(db, "CUS", 4), company_id=company.id, name=company.name, industry=company.industry, contact_person=q.contact_name or company.contact_person, email=q.contact_email or company.email,
                                phone=q.contact_phone or company.phone, gstin=q.gstin or company.gstin, billing_address=q.billing_address or company.billing_address, shipping_address=q.shipping_address or company.shipping_address,
                                account_manager=q.assigned_to or p.actor_id, since=date.today(), status="Active", tier="Standard", branch=company.branch, created_by=p.actor_id, attributes={})
            db.add(customer)
            db.flush()
    return customer


def sales_order_draft(db: Session, q: Quotation) -> dict:
    company = db.get(Company, q.company_id) if q.company_id else None
    contact = db.get(Contact, q.contact_id) if q.contact_id else None
    customer = db.get(Customer, q.customer_id) if q.customer_id else (db.execute(select(Customer).where(Customer.company_id == q.company_id)).scalars().first() if q.company_id else None)
    deal = db.get(Deal, q.deal_id) if q.deal_id else None
    rate = round(q.tax / q.subtotal * 100) if float(q.subtotal or 0) > 0 else pricing.DEFAULT_TAX_RATE
    gstin = q.gstin or (customer.gstin if customer else "") or (company.gstin if company else "")
    items = [pricing.normalise_item({**it, "taxRate": it.get("taxRate", rate), "fulfilledQty": 0}) for it in q.attributes.get("items", [])]
    return {
        "quotationId": q.id, "quotationNumber": q.number, "quotationAmount": float(q.amount or 0), "dealId": q.deal_id, "dealName": deal.name if deal else None, "leadId": q.lead_id or (deal.lead_id if deal else None),
        "sourceEnquiryId": q.source_enquiry_id or (deal.source_enquiry_id if deal else None), "source": q.source or (deal.source if deal else None), "sourceDetail": q.source_detail or "",
        "customerId": customer.id if customer else None, "customerName": customer.name if customer else (company.name if company else q.customer_name), "customerWillBeCreated": customer is None,
        "companyId": company.id if company else q.company_id, "companyName": company.name if company else q.customer_name, "contactId": contact.id if contact else None,
        "contactName": contact.name if contact else q.contact_name, "contactEmail": (contact.email if contact else q.contact_email) or "", "contactPhone": (contact.phone if contact else q.contact_phone) or "",
        "orderDate": date.today().isoformat(), "expectedDeliveryDate": (date.today() + timedelta(days=14)).isoformat(), "salesperson": q.assigned_to or (deal.salesperson if deal else None),
        "billingAddress": q.billing_address or (customer.billing_address if customer else "") or (company.billing_address if company else ""), "shippingAddress": q.shipping_address or (customer.shipping_address if customer else "") or (company.shipping_address if company else ""),
        "gstin": gstin, "taxType": pricing.infer_tax_type(gstin), "paymentTerms": q.payment_terms,
        "deliveryTerms": "Delivery / go-live as per the expected delivery date, subject to receipt of the agreed advance payment.", "notes": "", "internalRemarks": "", "items": items,
    }


def get_quotation_for_so(db: Session, quotation_id: str) -> Quotation:
    q = db.execute(select(Quotation).where(Quotation.id == quotation_id)).scalar_one_or_none()
    if q is None:
        raise not_found("Quotation not found.")
    if q.status != "Accepted":
        raise conflict("A sales order can only be created from an Accepted quotation.")
    existing = db.execute(select(SalesOrder).where(SalesOrder.quotation_id == q.id, SalesOrder.status != "Cancelled")).scalars().first()
    if existing is not None:
        raise conflict(f"Sales order {existing.number} already exists for this quotation.", code="ALREADY_EXISTS")
    return q


def _validate_order(m: dict) -> list[dict]:
    items = pricing.validate_items(m.get("items"), "item")
    errors = {}
    if not m.get("orderDate"):
        errors["orderDate"] = "Order date is required."
    if m.get("expectedDeliveryDate") and m.get("orderDate") and str(m["expectedDeliveryDate"]) < str(m["orderDate"]):
        errors["expectedDeliveryDate"] = "Delivery cannot be before the order date."
    if not str(m.get("billingAddress") or "").strip():
        errors["billingAddress"] = "Billing address is required."
    if m.get("gstin") and not pricing.GSTIN.match(str(m["gstin"]).strip()):
        errors["gstin"] = "GSTIN must be 15 characters."
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    return items


def create_sales_order(db: Session, p: Principal, data: dict) -> dict:
    if not p.can("Sales Orders", "create"):
        raise forbidden("You do not have permission to create sales orders.")
    q = get_quotation_for_so(db, data.get("quotationId"))
    draft = sales_order_draft(db, q)
    confirm = bool(data.get("confirm"))
    if confirm and not is_approver(p, CONFIRM_JOBS):
        raise forbidden("Only a Sales Manager or Admin can confirm an order. Save it as a draft for approval.")
    merged = {**draft, **{k: v for k, v in (data.get("order") or {}).items() if k in SO_DRAFT}}
    if merged.get("contactId") and merged["contactId"] != draft["contactId"]:
        contact = db.execute(select(Contact).where(Contact.id == merged["contactId"])).scalar_one_or_none()
        if contact is None or contact.company_id != draft["companyId"]:
            raise invalid("The chosen contact does not belong to this quotation's company.", {"contactId": "Wrong company."})
        merged.update(contactName=contact.name, contactEmail=contact.email or "", contactPhone=contact.phone or "")
    merged["taxType"] = "inter" if merged.get("taxType") == "inter" else "intra"
    items = _validate_order(merged)
    block = pricing.pricing_block(items, merged["taxType"])
    if confirm and block["amount"] <= 0:
        raise invalid("An order with a zero total cannot be confirmed.", {"items": "Zero total."})
    customer = _customer_for(db, p, q)
    so = SalesOrder(
        id=ids.new_id(db, "SO", 4), number=ids.new_number(db, "SO", width=5), quotation_id=q.id, quotation_number=q.number, deal_id=q.deal_id, lead_id=draft["leadId"], source_enquiry_id=draft["sourceEnquiryId"],
        customer_id=customer.id if customer else None, customer_name=draft["customerName"], company_id=draft["companyId"], company_name=draft["companyName"], contact_id=merged.get("contactId"),
        contact_name=merged.get("contactName") or "", contact_email=merged.get("contactEmail") or "", contact_phone=merged.get("contactPhone") or "", source=draft["source"] or "", source_detail=draft["sourceDetail"],
        order_date=date.fromisoformat(str(merged["orderDate"])[:10]), expected_delivery_date=date.fromisoformat(str(merged["expectedDeliveryDate"])[:10]) if merged.get("expectedDeliveryDate") else None,
        salesperson=merged.get("salesperson"), billing_address=merged.get("billingAddress") or "", shipping_address=merged.get("shippingAddress") or "", gstin=str(merged.get("gstin") or "").strip().upper(),
        payment_terms=merged.get("paymentTerms") or "", delivery_terms=merged.get("deliveryTerms") or "", notes=merged.get("notes") or "", internal_remarks=merged.get("internalRemarks") or "", tax_type=block["taxType"],
        subtotal=block["subtotal"], discount_amount=block["discountAmount"], taxable_amount=block["taxableAmount"], tax=block["tax"], cgst=block["cgst"], sgst=block["sgst"], igst=block["igst"], amount=block["amount"],
        status="Confirmed" if confirm else "Draft", revision=1, created_date=date.today(), created_by=p.actor_id, branch=q.branch,
        attributes={"items": items, "revisions": [], "documents": [], "invoiceIds": [], "paymentIds": [], "quotationSnapshot": {"amount": float(q.amount or 0), "itemCount": len(q.attributes.get("items", []))}, "dealName": draft["dealName"],
                    **({"confirmedAt": now_iso(), "confirmedBy": p.actor_id} if confirm else {})},
    )
    db.add(so)
    db.flush()
    q.sales_order_id = so.id
    if customer is not None and not q.customer_id:
        q.customer_id = customer.id
    deal = db.get(Deal, q.deal_id) if q.deal_id else None
    if deal is not None:
        if not deal.customer_id and customer is not None:
            deal.customer_id = customer.id
        link_to_deal(db, deal.id, "salesOrderIds", so.id)
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="Created", subject=f"Sales Order {so.number} created from quotation {q.number}", by=p.actor_id, branch=so.branch)
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Conversion", subject=f"Sales Order {so.number} created from this quotation", by=p.actor_id, branch=q.branch)
    deal_activity(db, p, so.deal_id, type="Created", subject=f"Sales Order {so.number} created")
    timeline.notify(db, user_id=so.salesperson, message=f"Sales Order {so.number} was {'confirmed' if confirm else 'created'} for {so.customer_name}.", type="Sales Order", related_type="Sales Order", related_id=so.id, branch=so.branch)
    audit.record(db, user=p.user, action="Create sales order", module="Sales Orders", record_id=so.id, details=q.number, info=p.info)
    db.commit()
    return to_json(so)


def _so(db: Session, so_id: str) -> SalesOrder:
    so = db.execute(select(SalesOrder).where(SalesOrder.id == so_id)).scalar_one_or_none()
    if so is None:
        raise not_found("Sales order not found.")
    return so


def _live_invoice(db: Session, so: SalesOrder) -> Invoice | None:
    return db.execute(select(Invoice).where(Invoice.sales_order_id == so.id, Invoice.lifecycle.notin_(pricing.DEAD))).scalars().first()


def edit_sales_order(db: Session, p: Principal, so_id: str, req: dict) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit"):
        raise forbidden("You do not have permission to edit sales orders.")
    if so.status == "Cancelled":
        raise conflict("A cancelled order cannot be edited.")
    allowed = SO_DRAFT if so.status == "Draft" else {"notes", "internalRemarks"} if so.status == "Fulfilled" else SO_LIGHT
    current = to_json(so)
    rejected = [k for k in req if k not in allowed and k in SO_DRAFT | {"amount", "status", "number", "quotationId", "customerId"} and req[k] != current.get(k)]
    if rejected:
        raise conflict(f"{', '.join(rejected)} cannot be changed on a {so.status.lower()} order. Use Revise Order for commercial changes." if so.status != "Draft" else f"These fields cannot be edited: {', '.join(rejected)}.")
    patch = {k: v for k, v in req.items() if k in allowed}
    if patch.get("contactId"):
        contact = db.execute(select(Contact).where(Contact.id == patch["contactId"])).scalar_one_or_none()
        if contact is None or contact.company_id != so.company_id:
            raise invalid("The chosen contact does not belong to this order's company.", {"contactId": "Wrong company."})
        so.contact_id, so.contact_name, so.contact_email, so.contact_phone = contact.id, contact.name, contact.email or "", contact.phone or ""
    merged = {**current, **patch, "orderDate": patch.get("orderDate", current.get("orderDate"))}
    items = _validate_order(merged)
    for key, attr in (("expectedDeliveryDate", "expected_delivery_date"), ("orderDate", "order_date")):
        if key in patch and patch[key]:
            setattr(so, attr, date.fromisoformat(str(patch[key])[:10]))
    for key, attr in (("deliveryTerms", "delivery_terms"), ("shippingAddress", "shipping_address"), ("billingAddress", "billing_address"), ("notes", "notes"), ("internalRemarks", "internal_remarks"), ("paymentTerms", "payment_terms")):
        if key in patch:
            setattr(so, attr, str(patch[key] or "")[:4000])
    if "salesperson" in patch:
        so.salesperson = patch["salesperson"] or None
    if "gstin" in patch:
        so.gstin = str(patch["gstin"] or "").strip().upper()
    if "items" in patch or "taxType" in patch:
        tax_type = "inter" if merged.get("taxType") == "inter" else "intra"
        block = pricing.pricing_block(items, tax_type)
        so.subtotal, so.discount_amount, so.taxable_amount, so.tax, so.cgst, so.sgst, so.igst, so.amount, so.tax_type = block["subtotal"], block["discountAmount"], block["taxableAmount"], block["tax"], block["cgst"], block["sgst"], block["igst"], block["amount"], tax_type
        so.attributes = {**so.attributes, "items": items}
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="Updated", subject="Sales order updated", by=p.actor_id, branch=so.branch)
    db.commit()
    return to_json(so)


def so_status(db: Session, p: Principal, so_id: str, status: str, reason: str) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit"):
        raise forbidden("You do not have permission to change the order status.")
    if status not in SO_FLOW.get(so.status, ()):
        raise conflict(f"An order cannot move from {so.status} to {status}.")
    if status == "Partially Fulfilled":
        raise conflict("Record the delivered quantities (Record Fulfilment) to mark an order partially fulfilled.")
    if status == "Confirmed":
        if not is_approver(p, CONFIRM_JOBS):
            raise forbidden("Only a Sales Manager or Admin can confirm an order.")
        _validate_order({**to_json(so)})
        if float(so.amount or 0) <= 0:
            raise invalid("An order with a zero total cannot be confirmed.", {"items": "Zero total."})
    if status == "Cancelled":
        if not (reason or "").strip():
            raise invalid("Give a reason for cancelling this order.", {"reason": "Required."})
        live = _live_invoice(db, so)
        if live is not None:
            raise conflict(f"Invoice {live.number} exists for this order. Cancel the invoice first (only possible while no payment is recorded).")
    previous, attrs = so.status, dict(so.attributes)
    so.status = status
    if status == "Confirmed":
        attrs.update(confirmedAt=now_iso(), confirmedBy=p.actor_id)
    if status == "Fulfilled":
        attrs["items"] = [{**i, "fulfilledQty": i.get("qty", 0)} for i in attrs.get("items", [])]
        attrs["fulfilledAt"] = now_iso()
    if status == "Cancelled":
        attrs.update(cancelledAt=now_iso(), cancelledBy=p.actor_id, cancelReason=reason.strip())
        q = db.get(Quotation, so.quotation_id) if so.quotation_id else None
        if q is not None and q.sales_order_id == so.id:
            q.sales_order_id = None
    so.attributes = attrs
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="StatusChange", subject=f"Status changed from {previous} to {status}", notes=reason or None, by=p.actor_id, branch=so.branch,
                          from_status=previous, to_status=status)
    deal_activity(db, p, so.deal_id, type="StatusChange", subject=f"Sales Order {so.number} is now {status}")
    timeline.notify(db, user_id=so.salesperson, message=f"Sales Order {so.number} is now {status}.", type="Sales Order", related_type="Sales Order", related_id=so.id, branch=so.branch)
    db.commit()
    return to_json(so)


def so_fulfilment(db: Session, p: Principal, so_id: str, data: dict) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit"):
        raise forbidden("You do not have permission to record fulfilment.")
    if so.status not in ("Processing", "Partially Fulfilled"):
        raise conflict("Fulfilment can be recorded once the order is Processing.")
    items = [dict(i) for i in so.attributes.get("items", [])]
    for line in data.get("lines") or []:
        index = line.get("index")
        if not isinstance(index, int) or not 0 <= index < len(items):
            raise invalid("Unknown line item.")
        qty = pricing._num(line.get("fulfilledQty"))
        item = items[index]
        if qty < pricing._num(item.get("fulfilledQty")) or qty > pricing._num(item.get("qty")):
            raise invalid(f'"{item.get("name")}": delivered quantity must be between {item.get("fulfilledQty", 0)} and {item.get("qty")}.', {"lines": "Invalid quantity."})
        item["fulfilledQty"] = qty
    total, done = sum(pricing._num(i.get("qty")) for i in items), sum(pricing._num(i.get("fulfilledQty")) for i in items)
    new_status = "Fulfilled" if done >= total else "Partially Fulfilled" if done > 0 else so.status
    previous = so.status
    so.status = new_status
    so.attributes = {**so.attributes, "items": items, **({"fulfilledAt": now_iso()} if new_status == "Fulfilled" else {})}
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="StatusChange", subject=f"Fulfilment recorded - {round(done / total * 100) if total else 0}% delivered", by=p.actor_id,
                          branch=so.branch, from_status=previous, to_status=new_status, notes=str(data.get("note") or "")[:500] or None)
    db.commit()
    return to_json(so)


def so_revise(db: Session, p: Principal, so_id: str, data: dict) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit") or not is_approver(p, CONFIRM_JOBS):
        raise forbidden("Only a Sales Manager or Admin can revise a confirmed order.")
    if so.status not in ("Confirmed", "Processing", "Partially Fulfilled"):
        raise conflict(f"A {so.status.lower()} order cannot be revised.")
    if _live_invoice(db, so) is not None:
        raise conflict("This order has been invoiced. Cancel the invoice before revising the order.")
    if any(pricing._num(i.get("fulfilledQty")) > 0 for i in so.attributes.get("items", [])):
        raise conflict("Fulfilment has already started - the order lines can no longer be revised.")
    reason = str(data.get("reason") or "").strip()
    if not reason:
        raise invalid("Give a reason for the revision.", {"reason": "Required."})
    order = {k: v for k, v in (data.get("order") or {}).items() if k in ("items", "paymentTerms", "deliveryTerms", "taxType", "gstin", "billingAddress", "expectedDeliveryDate")}
    attrs = dict(so.attributes)
    snapshot = {"revision": so.revision, "status": so.status, "items": attrs.get("items"), "paymentTerms": so.payment_terms, "deliveryTerms": so.delivery_terms, "subtotal": float(so.subtotal), "discountAmount": float(so.discount_amount),
                "taxableAmount": float(so.taxable_amount), "tax": float(so.tax), "amount": float(so.amount), "taxType": so.tax_type, "at": now_iso(), "by": p.actor_id, "byName": p.name, "reason": reason}
    if data.get("fromQuotation"):
        q = db.get(Quotation, so.quotation_id)
        if q is None:
            raise not_found("The linked quotation no longer exists.")
        rate = round(q.tax / q.subtotal * 100) if float(q.subtotal or 0) > 0 else pricing.DEFAULT_TAX_RATE
        order["items"] = [pricing.normalise_item({**i, "taxRate": i.get("taxRate", rate)}) for i in q.attributes.get("items", [])]
        order["paymentTerms"] = q.payment_terms or so.payment_terms
    items = pricing.validate_items(order.get("items", attrs.get("items")), "item")
    tax_type = "inter" if order.get("taxType", so.tax_type) == "inter" else "intra"
    block = pricing.pricing_block(items, tax_type)
    so.subtotal, so.discount_amount, so.taxable_amount, so.tax, so.cgst, so.sgst, so.igst, so.amount, so.tax_type = block["subtotal"], block["discountAmount"], block["taxableAmount"], block["tax"], block["cgst"], block["sgst"], block["igst"], block["amount"], tax_type
    for key, attr in (("paymentTerms", "payment_terms"), ("deliveryTerms", "delivery_terms"), ("billingAddress", "billing_address"), ("gstin", "gstin")):
        if key in order:
            setattr(so, attr, str(order[key] or ""))
    if order.get("expectedDeliveryDate"):
        so.expected_delivery_date = date.fromisoformat(str(order["expectedDeliveryDate"])[:10])
    so.revision += 1
    so.attributes = {**attrs, "items": items, "revisions": [snapshot, *attrs.get("revisions", [])]}
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="Revision", subject=f"Order revised to revision {so.revision} - {reason}", by=p.actor_id, branch=so.branch)
    db.commit()
    return to_json(so)


def so_note(db: Session, p: Principal, so_id: str, text: str) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit"):
        raise forbidden("You do not have permission to add notes.")
    text = (text or "").strip()
    if not text:
        raise invalid("Write a note first.", {"text": "Required."})
    if len(text) > 2000:
        raise invalid("Notes are limited to 2000 characters.", {"text": "Too long."})
    timeline.log_activity(db, related_type="Sales Order", related_id=so.id, related_name=so.number, type="Note", subject="Note added", notes=text, by=p.actor_id, branch=so.branch, source="manual")
    db.commit()
    return {"success": True}


def so_followup(db: Session, p: Principal, so_id: str, data: dict) -> dict:
    from app.services import activities as act_svc

    so = _so(db, so_id)
    if not p.can("Sales Orders", "edit"):
        raise forbidden("You do not have permission to add follow-ups.")
    day = str(data.get("date") or "")
    if len(day) != 10 or day < date.today().isoformat():
        raise invalid("Choose a follow-up date that is today or later.", {"date": "Invalid date."})
    act_svc.log_manual(db, p, {"type": "Follow-up", "subject": f"{data.get('type') or 'Call'} follow-up - {so.number}", "date": day, "time": data.get("time"), "followUpType": data.get("type") or "Call",
                               "relatedType": "Sales Order", "relatedId": so.id, "assignedTo": data.get("assignedTo") or so.salesperson or p.actor_id, "description": str(data.get("notes") or "")[:1000]})
    so = _so(db, so_id)
    so.attributes = {**so.attributes, "nextFollowUp": day}
    db.commit()
    return to_json(so)


def delete_sales_order(db: Session, p: Principal, so_id: str) -> dict:
    so = _so(db, so_id)
    if not p.can("Sales Orders", "delete"):
        raise forbidden("You do not have permission to delete sales orders.")
    if so.status != "Draft" or so.invoice_id:
        raise conflict("Only a draft order that has never been invoiced can be deleted. Cancel it instead.")
    q = db.get(Quotation, so.quotation_id) if so.quotation_id else None
    if q is not None and q.sales_order_id == so.id:
        q.sales_order_id = None
    deal = db.get(Deal, so.deal_id) if so.deal_id else None
    if deal is not None:
        deal.attributes = {**deal.attributes, "salesOrderIds": [i for i in deal.attributes.get("salesOrderIds", []) if i != so.id]}
    db.delete(so)
    db.commit()
    return {"success": True}


class SalesOrderHooks(Hooks):
    def before_create(self, ctx, obj, payload):
        raise forbidden("Sales orders are created from an Accepted quotation (POST /salesOrders/from-quotation).")

    def before_update(self, ctx, obj, changes, payload):
        raise forbidden("Edit a sales order through its own endpoint.")

    def before_delete(self, ctx, obj):
        raise forbidden("Delete a draft order through DELETE /salesOrders/{id}.")


# ================================ proposals =======================================================================================
def commercial(items: list[dict]) -> dict:
    lines = []
    for raw in items or []:
        it = pricing.normalise_item(raw)
        gross = it["qty"] * it["unitPrice"]
        net = gross * (1 - it["discount"] / 100)
        lines.append((gross, net, net * it["taxRate"] / 100))
    value = pricing.round2(sum(l[1] for l in lines))
    return {"subtotal": pricing.round2(sum(l[0] for l in lines)), "value": value, "estimatedTax": pricing.round2(sum(l[2] for l in lines))}


def client_snapshot(company: Company | None, contact: Contact | None, customer: Customer | None) -> dict:
    return {"companyName": company.name if company else "", "contactName": (contact.name if contact else (company.contact_person if company else "")) or "", "designation": contact.designation if contact else "",
            "phone": (contact.phone if contact else (company.phone if company else "")) or "", "email": (contact.email if contact else (company.email if company else "")) or "",
            "billingAddress": (company.billing_address or company.address) if company else "", "shippingAddress": (company.shipping_address or company.address) if company else "",
            "gstin": (company.gstin if company else "") or (customer.gstin if customer else ""), "website": company.website if company else "", "industry": company.industry if company else ""}


def diff_client(snapshot: dict, master: dict) -> list[dict]:
    labels = {"companyName": "Company", "contactName": "Contact person", "designation": "Designation", "phone": "Phone", "email": "Email", "billingAddress": "Billing address",
              "shippingAddress": "Shipping / service address", "gstin": "GSTIN", "website": "Website", "industry": "Industry"}
    return [{"key": k, "label": v, "from": snapshot.get(k) or "", "to": master.get(k) or ""} for k, v in labels.items() if str(snapshot.get(k) or "") != str(master.get(k) or "")]


def default_content(requirement: str, company_name: str, service: str, items: list) -> dict:
    return {"executiveSummary": f"{company_name} is looking for {service or 'a solution'}{' - ' + requirement if requirement else ''}. This proposal sets out our recommended approach, scope and commercial summary.",
            "requirement": requirement, "proposedSolution": "", "objectives": "", "scopeOfWork": requirement, "implementationApproach": "", "technology": "", "assumptions": "", "exclusions": "",
            "support": "Post go-live support is provided for 30 days at no additional cost. Extended maintenance and support plans are available on request.", "paymentTerms": "50% advance, 50% on delivery",
            "termsConditions": "This proposal is valid until the expiry date shown. Commercial figures are indicative and excl. applicable taxes; the binding price offer is issued as a separate Quotation. Scope changes after acceptance are handled through a change request.",
            "modules": [], "deliverables": [], "timeline": [], "responsibilities": {"company": "", "client": ""}, "items": items}


def proposal_draft(db: Session, deal: Deal) -> dict:
    company = db.execute(select(Company).where(Company.id == deal.company_id)).scalar_one_or_none() if deal.company_id else None
    contact = db.execute(select(Contact).where(Contact.id == deal.contact_id)).scalar_one_or_none() if deal.contact_id else None
    customer = db.execute(select(Customer).where(Customer.id == deal.customer_id)).scalar_one_or_none() if deal.customer_id else (
        db.execute(select(Customer).where(Customer.company_id == company.id)).scalars().first() if company else None)
    requirement = deal.requirement or deal.customer_need or ""
    product = db.get(Product, deal.product_id) if deal.product_id else None
    items = []
    if deal.service and float(deal.value or 0):
        items = [{"productId": product.id if product else None, "name": product.name if product else deal.service, "description": requirement or (product.description if product else ""), "qty": 1,
                  "unitPrice": float(deal.value), "discount": 0, "taxRate": float(product.tax_rate) if product else pricing.DEFAULT_TAX_RATE, "unit": product.unit if product else None}]
    return {"dealId": deal.id, "dealName": deal.name, "dealStage": deal.stage, "dealValue": float(deal.value or 0), "budget": float(deal.budget or 0),
            "expectedCloseDate": deal.expected_closing_date.isoformat() if deal.expected_closing_date else None, "enquiryId": deal.source_enquiry_id, "leadId": deal.lead_id,
            "companyId": company.id if company else deal.company_id, "contactId": contact.id if contact else None, "customerId": customer.id if customer else deal.customer_id,
            "clientSnapshot": client_snapshot(company, contact, customer), "title": f"{deal.service or 'Solution'} Proposal - {company.name if company else deal.company_name}", "service": deal.service or "",
            "ownerId": deal.salesperson, "source": deal.source or None, "sourceDetail": deal.source_detail or "", "createdDate": date.today().isoformat(),
            "validUntil": (date.today() + timedelta(days=VALIDITY_DAYS)).isoformat(), "notes": deal.attributes.get("notes", ""),
            "content": default_content(requirement, company.name if company else deal.company_name, deal.service, items)}


def validate_proposal(m: dict) -> None:
    errors = {}
    if not str(m.get("title") or "").strip():
        errors["title"] = "Give the proposal a title."
    elif len(m["title"]) > 160:
        errors["title"] = "Title is too long (max 160 characters)."
    if not m.get("validUntil"):
        errors["validUntil"] = "Set an expiry date."
    elif m.get("createdDate") and str(m["validUntil"]) < str(m["createdDate"]):
        errors["validUntil"] = "Expiry cannot be before the created date."
    if not m.get("ownerId"):
        errors["ownerId"] = "Choose an owner."
    c = m.get("content") or {}
    if not str(c.get("requirement") or "").strip():
        errors["requirement"] = "Describe the client requirement."
    if not str(c.get("scopeOfWork") or "").strip():
        errors["scopeOfWork"] = "Describe the scope of work."
    if not c.get("items"):
        errors["items"] = "Add at least one product or service to the commercial summary."
    for index, raw in enumerate(c.get("items") or []):
        it = pricing.normalise_item(raw)
        if not it["name"]:
            errors[f"item-{index}-name"] = "Name required"
        if not it["qty"] > 0:
            errors[f"item-{index}-qty"] = "Qty > 0"
        if it["unitPrice"] < 0:
            errors[f"item-{index}-unitPrice"] = "Invalid"
        if not 0 <= it["discount"] <= 100:
            errors[f"item-{index}-discount"] = "0-100"
    if errors:
        raise invalid("Please fix the highlighted fields.", errors)


def _prop(db: Session, proposal_id: str) -> Proposal:
    pr = db.execute(select(Proposal).where(Proposal.id == proposal_id)).scalar_one_or_none()
    if pr is None:
        raise not_found("Proposal not found.")
    return pr


def _pro_log(db: Session, p: Principal, pr: Proposal, type: str, subject: str, mirror: bool = False, **extra) -> None:
    timeline.log_activity(db, related_type="Proposal", related_id=pr.id, related_name=pr.number, type=type, subject=subject, by=p.actor_id, branch=pr.branch, **{k: v for k, v in extra.items() if k in ("from_status", "to_status", "notes")})
    if mirror:
        deal_activity(db, p, pr.deal_id, type=type, subject=f"{subject} ({pr.number})" if pr.number not in subject else subject)


def _new_content(old: dict, patch: dict) -> dict:
    content = {**old, **{k: v for k, v in (patch or {}).items()}}
    content["items"] = [pricing.normalise_item(i) for i in content.get("items") or []]
    return content


def create_proposal_from_deal(db: Session, p: Principal, data: dict) -> dict:
    if not p.can("Proposals", "create"):
        raise forbidden("You do not have permission to create proposals.")
    deal = db.execute(select(Deal).where(Deal.id == data.get("dealId"))).scalar_one_or_none()
    if deal is None:
        raise not_found("Deal not found.")
    if deal.stage in CLOSED_DEAL:
        raise conflict(f"This deal is {deal.stage}.")
    open_one = db.execute(select(Proposal).where(Proposal.deal_id == deal.id, Proposal.status.in_(PROPOSAL_OPEN))).scalars().first()
    if open_one is not None:
        raise conflict(f"{open_one.number} - Version {open_one.version} is still open for this deal.", code="ALREADY_OPEN")
    draft = proposal_draft(db, deal)
    given = data.get("proposal") or {}
    merged = {**draft, "title": given.get("title", draft["title"]), "validUntil": given.get("validUntil", draft["validUntil"]), "ownerId": given.get("ownerId", draft["ownerId"]),
              "notes": given.get("notes", draft["notes"]), "templateId": given.get("templateId"), "content": _new_content(draft["content"], given.get("content"))}
    if given.get("contactId") and given["contactId"] != draft["contactId"]:
        contact = db.execute(select(Contact).where(Contact.id == given["contactId"])).scalar_one_or_none()
        if contact is None or contact.company_id != draft["companyId"]:
            raise invalid("The chosen contact does not belong to this deal's company.", {"contactId": "Wrong company."})
        company = db.get(Company, draft["companyId"])
        customer = db.get(Customer, draft["customerId"]) if draft["customerId"] else None
        merged["contactId"], merged["clientSnapshot"] = contact.id, client_snapshot(company, contact, customer)
    merged["ownerId"] = merged.get("ownerId") or p.actor_id  # a deal without a salesperson: whoever raises the proposal owns it
    validate_proposal(merged)
    pr = Proposal(
        id=ids.new_id(db, "PRP", 4), number=ids.new_number(db, "PROP"), version=1, title=merged["title"].strip()[:240], status="Draft", deal_id=deal.id, deal_name=deal.name, enquiry_id=draft["enquiryId"], lead_id=draft["leadId"],
        company_id=draft["companyId"], contact_id=merged["contactId"], customer_id=draft["customerId"], customer_name=merged["clientSnapshot"]["companyName"], service=draft["service"],
        value=commercial(merged["content"]["items"])["value"], owner_id=merged["ownerId"], assigned_to=merged["ownerId"], source=draft["source"], source_detail=draft["sourceDetail"],
        created_date=date.today(), valid_until=date.fromisoformat(str(merged["validUntil"])[:10]), notes=str(merged["notes"] or "")[:4000], created_by=p.actor_id, branch=deal.branch,
        attributes={"clientSnapshot": merged["clientSnapshot"], "content": merged["content"], "templateId": merged["templateId"], "budget": draft["budget"], "expectedCloseDate": draft["expectedCloseDate"],
                    "versions": [], "sends": [], "documents": [], "quotationIds": [], "versionCreatedAt": now_iso()},
    )
    db.add(pr)
    db.flush()
    link_to_deal(db, deal.id, "proposalIds", pr.id)
    _pro_log(db, p, pr, "Created", f"Proposal {pr.number} - Version 1 created from deal {deal.name}", mirror=True)
    timeline.notify(db, user_id=pr.owner_id, message=f"Proposal {pr.number} was created for {pr.customer_name}.", type="Proposal Created", related_type="Proposal", related_id=pr.id, branch=pr.branch)
    db.commit()
    return to_json(pr)


def edit_proposal(db: Session, p: Principal, proposal_id: str, req: dict) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "edit"):
        raise forbidden("You do not have permission to edit proposals.")
    if set(req) <= {"nextFollowUp", "lastContactedDate"}:
        if "nextFollowUp" in req:
            pr.next_follow_up = date.fromisoformat(req["nextFollowUp"][:10]) if req["nextFollowUp"] else None
        db.commit()
        return to_json(pr)
    if pr.status not in PROPOSAL_EDITABLE:
        raise conflict(f"A {pr.status.lower()} proposal cannot be edited. Use Create Revision to make changes - the sent version is preserved.")
    attrs, current = dict(pr.attributes), to_json(pr)
    merged = {**current, "content": attrs.get("content", {}), "clientSnapshot": attrs.get("clientSnapshot", {})}
    for key in ("title", "validUntil", "ownerId", "notes"):
        if key in req:
            merged[key] = req[key]
    if "content" in req:
        merged["content"] = _new_content(merged["content"], req["content"])
    if req.get("contactId") and req["contactId"] != pr.contact_id:
        contact = db.execute(select(Contact).where(Contact.id == req["contactId"])).scalar_one_or_none()
        if contact is None or contact.company_id != pr.company_id:
            raise invalid("The chosen contact does not belong to this proposal's company.", {"contactId": "Wrong company."})
        merged["clientSnapshot"] = client_snapshot(db.get(Company, pr.company_id), contact, db.get(Customer, pr.customer_id) if pr.customer_id else None)
        pr.contact_id = contact.id
    validate_proposal(merged)
    pr.title, pr.notes = str(merged["title"]).strip()[:240], str(merged.get("notes") or "")[:4000]
    pr.valid_until = date.fromisoformat(str(merged["validUntil"])[:10])
    if merged.get("ownerId"):
        pr.owner_id = pr.assigned_to = merged["ownerId"]
    pr.value = commercial(merged["content"]["items"])["value"]
    pr.customer_name = merged["clientSnapshot"].get("companyName", pr.customer_name)
    pr.attributes = {**attrs, "content": merged["content"], "clientSnapshot": merged["clientSnapshot"], **({"templateId": req["templateId"]} if "templateId" in req else {})}
    _pro_log(db, p, pr, "Updated", "Proposal updated")
    db.commit()
    return to_json(pr)


def proposal_status(db: Session, p: Principal, proposal_id: str, status: str, reason: str) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "edit"):
        raise forbidden("You do not have permission to edit proposals.")
    if status not in PROPOSAL_FLOW.get(pr.status, ()):
        raise conflict(f"A proposal cannot move from {pr.status} to {status}.")
    if status == "Sent":
        raise conflict("Use Send Proposal - it records exactly which document was sent to the client.")
    if status == "Internal Review":
        validate_proposal({**to_json(pr), "content": pr.attributes.get("content", {})})
    reason = (reason or "").strip()
    if status in ("Rejected", "Revision Requested") and not reason:
        raise invalid("Record why the client rejected the proposal." if status == "Rejected" else "Record what changes the client asked for.", {"reason": "Required."})
    previous, stamp, attrs = pr.status, now_iso(), dict(pr.attributes)
    pr.status = status
    key = {"Viewed": "viewedAt", "Accepted": "acceptedAt", "Rejected": "rejectedAt", "Revision Requested": "revisionRequestedAt", "Expired": "expiredAt"}.get(status)
    if key:
        attrs[key] = stamp
    if status == "Rejected":
        attrs["rejectReason"] = reason
    if status == "Revision Requested":
        attrs["revisionRequest"] = reason
    pr.attributes = attrs
    _pro_log(db, p, pr, "StatusChange", f"Proposal {status.lower()}" if status in ("Accepted", "Rejected", "Expired") else f"Status changed to {status}", mirror=True, from_status=previous, to_status=status, notes=reason or None)
    timeline.notify(db, user_id=pr.owner_id, message=f"{pr.number} is now {status}.", type="Proposal Update", related_type="Proposal", related_id=pr.id, branch=pr.branch)
    db.commit()
    return to_json(pr)


def proposal_send(db: Session, p: Principal, proposal_id: str, data: dict) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "edit"):
        raise forbidden("You do not have permission to edit proposals.")
    if pr.status != "Internal Review":
        raise conflict("Submit the proposal for internal review first." if pr.status == "Draft" else f"A {pr.status.lower()} proposal cannot be sent again - create a revision to send an updated version.")
    if not is_approver(p, ("Sales Manager",)):
        raise forbidden("Only a Sales Manager or Admin can approve and send a proposal after internal review.")
    to = (pr.attributes.get("clientSnapshot") or {}).get("email", "")
    if "@" not in to:
        raise invalid("This proposal's contact has no valid email address.", {"to": "Invalid email."})
    subject = str(data.get("subject") or "").strip()[:200]
    if not subject:
        raise invalid("Add an email subject.", {"subject": "Required."})
    doc = data.get("document") or {}
    if not doc.get("dataUrl") and not doc.get("fileName"):
        raise invalid("The proposal PDF is missing.", {"document": "Required."})
    stamp = now_iso()
    sent_document = {"fileName": str(doc.get("fileName") or f"{pr.number}-v{pr.version}.pdf")[:150], "sentAt": stamp, "version": pr.version, "size": len(doc.get("dataUrl") or "") * 3 // 4}
    send = {"id": ids.new_id(db, "SND", 4), "at": stamp, "byId": p.actor_id, "byName": p.name, "to": to, "subject": subject, "message": str(data.get("message") or "")[:4000], "version": pr.version}
    pr.status, pr.sent_at = "Sent", datetime.now(UTC)
    pr.attributes = {**pr.attributes, "sentDocument": sent_document, "sends": [send, *pr.attributes.get("sends", [])], "lastContactedDate": stamp}
    _pro_log(db, p, pr, "Email", f"{pr.number} - Version {pr.version} sent to {to}", mirror=True)
    _pro_log(db, p, pr, "StatusChange", "Proposal sent", from_status="Internal Review", to_status="Sent")
    db.commit()
    return {"proposal": to_json(pr), "send": send}


def proposal_revise(db: Session, p: Principal, proposal_id: str, reason: str) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "edit"):
        raise forbidden("You do not have permission to edit proposals.")
    if pr.status not in PROPOSAL_REVISABLE:
        raise conflict("An accepted proposal is final - create a new proposal from the deal if the scope changes." if pr.status == "Accepted" else f"A {pr.status.lower()} proposal is still editable - no revision is needed.")
    reason = (reason or "").strip()
    if not reason:
        raise invalid("Record why a new version is needed.", {"reason": "Required."})
    attrs = dict(pr.attributes)
    snapshot = {"version": pr.version, "status": pr.status, "title": pr.title, "validUntil": pr.valid_until.isoformat(), "value": float(pr.value), "content": attrs.get("content"), "clientSnapshot": attrs.get("clientSnapshot"),
                "sentAt": pr.sent_at.isoformat() if pr.sent_at else None, "sentDocument": attrs.get("sentDocument"), "closedAt": now_iso(), "revisedBy": p.actor_id, "revisedByName": p.name, "reason": reason, "quotationIds": attrs.get("quotationIds", [])}
    pr.version += 1
    pr.status, pr.sent_at = "Draft", None
    if pr.valid_until < date.today():
        pr.valid_until = date.today() + timedelta(days=VALIDITY_DAYS)
    for key in ("sentDocument", "viewedAt", "acceptedAt", "rejectedAt", "expiredAt", "revisionRequest"):
        attrs.pop(key, None)
    pr.attributes = {**attrs, "versions": [snapshot, *attrs.get("versions", [])], "versionCreatedAt": now_iso()}
    _pro_log(db, p, pr, "Revision", f"{pr.number} - Version {pr.version} created - {reason}", mirror=True)
    db.commit()
    return to_json(pr)


def proposal_client_diff(db: Session, proposal_id: str) -> dict:
    pr = _prop(db, proposal_id)
    master = client_snapshot(db.get(Company, pr.company_id) if pr.company_id else None, db.get(Contact, pr.contact_id) if pr.contact_id else None, db.get(Customer, pr.customer_id) if pr.customer_id else None)
    return {"changes": diff_client(pr.attributes.get("clientSnapshot") or {}, master), "editable": pr.status in PROPOSAL_EDITABLE}


def proposal_refresh_client(db: Session, p: Principal, proposal_id: str) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "edit"):
        raise forbidden("You do not have permission to edit proposals.")
    if pr.status not in PROPOSAL_EDITABLE:
        raise conflict("Only a draft version can pick up master-record changes. Create a revision - the sent version keeps its original client details.")
    master = client_snapshot(db.get(Company, pr.company_id) if pr.company_id else None, db.get(Contact, pr.contact_id) if pr.contact_id else None, db.get(Customer, pr.customer_id) if pr.customer_id else None)
    changes = diff_client(pr.attributes.get("clientSnapshot") or {}, master)
    if changes:
        pr.attributes = {**pr.attributes, "clientSnapshot": master}
        pr.customer_name = master["companyName"]
        _pro_log(db, p, pr, "Updated", f"Client details refreshed from the master record ({', '.join(c['label'] for c in changes)})")
        db.commit()
    return to_json(pr)


def proposal_create_quotation(db: Session, p: Principal, proposal_id: str, data: dict) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Quotations", "create"):
        raise forbidden("You do not have permission to create quotations.")
    if pr.status in ("Rejected", "Expired"):
        raise conflict(f"A {pr.status.lower()} proposal cannot be quoted - create a revision first.")
    attrs = pr.attributes
    existing = db.execute(select(Quotation).where(Quotation.id.in_(attrs.get("quotationIds", [])), Quotation.status.notin_(("Rejected", "Expired")))).scalars().first() if attrs.get("quotationIds") else None
    if existing is not None and not data.get("allowAnother"):
        raise conflict(f"Quotation {existing.number} is already open for this proposal.", code="ALREADY_OPEN")
    items = [pricing.normalise_item(i) for i in (attrs.get("content") or {}).get("items", []) if i.get("name")]
    if not items:
        raise invalid("Add products / services to the proposal before creating a quotation.", {"items": "Required."})
    client = attrs.get("clientSnapshot") or {}
    customer = db.get(Customer, pr.customer_id) if pr.customer_id else (db.execute(select(Customer).where(Customer.company_id == pr.company_id)).scalars().first() if pr.company_id else None)
    totals = pricing.quotation_totals(items)
    q = Quotation(
        id=ids.new_id(db, "QT", 4), number=ids.new_number(db, "QUO"), company_id=pr.company_id, contact_id=pr.contact_id, customer_id=customer.id if customer else None, customer_name=customer.name if customer else client.get("companyName", ""),
        contact_name=client.get("contactName", ""), contact_phone=client.get("phone", ""), contact_email=client.get("email", ""), billing_address=client.get("billingAddress", ""), shipping_address=client.get("shippingAddress", ""),
        gstin=client.get("gstin", ""), deal_id=pr.deal_id, lead_id=pr.lead_id, source_enquiry_id=pr.enquiry_id, source=pr.source, source_detail=pr.source_detail, requirement=(attrs.get("content") or {}).get("requirement", "")[:4000],
        subtotal=totals["subtotal"], tax=totals["tax"], amount=totals["amount"], created_date=date.today(), valid_until=date.today() + timedelta(days=15), status="Draft", assigned_to=pr.owner_id,
        payment_terms=(attrs.get("content") or {}).get("paymentTerms") or "50% advance, 50% on delivery", created_by=p.actor_id, branch=pr.branch,
        attributes={"items": items, "proposalId": pr.id, "proposalNumber": pr.number, "proposalVersion": pr.version, "scopeOfWork": (attrs.get("content") or {}).get("scopeOfWork", "")},
    )
    db.add(q)
    db.flush()
    pr.attributes = {**attrs, "quotationIds": [*attrs.get("quotationIds", []), q.id]}
    link_to_deal(db, pr.deal_id, "quotationIds", q.id)
    _pro_log(db, p, pr, "Quotation", f"Quotation {q.number} created from {pr.number} - Version {pr.version}", mirror=True)
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Created", subject=f"Quotation {q.number} created from proposal {pr.number} for {q.customer_name}", by=p.actor_id, branch=q.branch)
    db.commit()
    return {"quotation": to_json(q), "proposal": to_json(pr)}


def proposal_expire_sweep(db: Session, p: Principal | None = None) -> dict:
    due = db.execute(select(Proposal).where(Proposal.status.in_(("Sent", "Viewed", "Revision Requested")), Proposal.valid_until < date.today())).scalars().all()
    for pr in due:
        previous = pr.status
        pr.status = "Expired"
        pr.attributes = {**pr.attributes, "expiredAt": now_iso()}
        timeline.log_activity(db, related_type="Proposal", related_id=pr.id, related_name=pr.number, type="StatusChange", subject=f"Proposal expired - validity ended {pr.valid_until}", by=None, branch=pr.branch, from_status=previous, to_status="Expired")
    db.commit()
    return {"expired": [pr.id for pr in due]}


def delete_proposal(db: Session, p: Principal, proposal_id: str) -> dict:
    pr = _prop(db, proposal_id)
    if not p.can("Proposals", "delete"):
        raise forbidden("You do not have permission to delete proposals.")
    if pr.status != "Draft" or pr.version > 1 or pr.attributes.get("quotationIds") or pr.sent_at:
        raise conflict("Only a first-version draft that was never sent and has no quotation can be deleted.")
    deal = db.get(Deal, pr.deal_id) if pr.deal_id else None
    if deal is not None:
        deal.attributes = {**deal.attributes, "proposalIds": [i for i in deal.attributes.get("proposalIds", []) if i != pr.id]}
    db.delete(pr)
    db.commit()
    return {"success": True}


class ProposalHooks(Hooks):
    def before_create(self, ctx, obj, payload):
        raise invalid("Proposals are created from a Deal - open the deal and choose Create Proposal.")

    def before_update(self, ctx, obj, changes, payload):
        raise forbidden("Edit a proposal through its own endpoint.")

    def before_delete(self, ctx, obj):
        raise forbidden("Delete a draft proposal through DELETE /proposals/{id}.")
