"""CRM conversion chain, owned by the server and run in ONE transaction:  Enquiry -> Lead -> (Company, Contact, Customer) + Deal -> Closed Won.

Every record created along the way inherits the branch of the record it came from, nothing is duplicated (an existing company / contact / customer is found and linked), and the
source record keeps its history (it is marked Converted, never deleted).
"""
import re
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, conflict, invalid, not_found
from app.db import ids
from app.models import Company, Contact, Customer, Deal, Enquiry, Lead
from app.services import audit, flows, lead_sources, timeline
from app.services.codec import to_json
from app.services.timeline import now

PRIORITY_FOR_LEAD = {"Critical": "Urgent", "High": "High", "Medium": "Medium", "Low": "Low"}


def _digits(value: str | None, keep: int = 10) -> str:
    return re.sub(r"\D", "", value or "")[-keep:]


def _initials(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


def _get(db: Session, model, record_id: str, label: str):
    obj = db.execute(select(model).where(model.id == record_id)).scalar_one_or_none()
    if obj is None:
        raise not_found(f"{label} not found.")
    return obj


def find_or_create_company(db: Session, p: Principal, *, branch: str, name: str, defaults: dict) -> tuple[Company, bool]:
    match = db.execute(select(Company).where(Company.branch == branch, func.lower(Company.name) == name.strip().lower())).scalar_one_or_none()
    if match is not None:
        return match, False
    company = Company(id=ids.new_id(db, "CMP", 4), name=name.strip()[:200], branch=branch, status="Prospect", created_date=date.today(), created_by=p.actor_id, assigned_to=p.actor_id, attributes={"tags": []}, **defaults)
    db.add(company)
    db.flush()
    return company, True


def find_or_create_contact(db: Session, p: Principal, *, company: Company, name: str, email: str, phone: str, designation: str = "") -> Contact:
    email_l, phone_d = (email or "").strip().lower(), _digits(phone)
    for contact in db.execute(select(Contact).where(Contact.company_id == company.id)).scalars():
        if (email_l and (contact.email or "").lower() == email_l) or (phone_d and _digits(contact.phone) == phone_d):
            return contact
    contact = Contact(id=ids.new_id(db, "CT", 4), name=name[:160], designation=designation[:120], email=email or "", phone=phone or "", whatsapp=phone or "", company_id=company.id,
                      company_name=company.name, branch=company.branch, created_date=date.today(), initials=_initials(name), created_by=p.actor_id, assigned_to=p.actor_id, attributes={"groups": ["Primary Contact"]})
    db.add(contact)
    db.flush()
    return contact


def find_or_create_customer(db: Session, p: Principal, *, company: Company, contact_name: str, email: str, phone: str, account_manager: str | None, attribution: dict) -> tuple[Customer, bool]:
    match = db.execute(select(Customer).where(Customer.company_id == company.id)).scalars().first()
    if match is not None:
        return match, False
    customer = Customer(id=ids.new_id(db, "CUS", 4), company_id=company.id, name=company.name, industry=company.industry, contact_person=contact_name, email=email or company.email, phone=phone or company.phone,
                        gstin=company.gstin, billing_address=company.billing_address or company.address, shipping_address=company.shipping_address or company.address, account_manager=account_manager,
                        since=date.today(), status="Active", tier="Standard", lifetime_value=0, branch=company.branch, created_by=p.actor_id, attributes={}, **attribution)
    db.add(customer)
    db.flush()
    return customer, True


# ---- Enquiry -> Lead ---------------------------------------------------------------------------------------------------
def convert_enquiry(db: Session, p: Principal, enquiry_id: str) -> dict:
    enquiry = _get(db, Enquiry, enquiry_id, "Enquiry")
    if enquiry.status != "Qualified":
        raise conflict(f'An enquiry must be Qualified before it can be converted to a Lead (currently "{enquiry.status}").')
    q = (enquiry.attributes or {}).get("qualification") or {}
    company, _ = find_or_create_company(db, p, branch=enquiry.branch, name=enquiry.company or f"{enquiry.name}'s Company", defaults=dict(
        industry=enquiry.category[:120], contact_person=enquiry.name[:160], email=enquiry.email, phone=enquiry.phone, city=enquiry.city, address=enquiry.address, billing_address=enquiry.address, shipping_address=enquiry.address))
    contact = find_or_create_contact(db, p, company=company, name=enquiry.name, email=enquiry.email, phone=enquiry.phone, designation=enquiry.designation)
    budget_digits = re.sub(r"[^\d]", "", str(q.get("budget") or ""))
    lead = Lead(
        id=ids.new_id(db, "LD", 4), name=enquiry.name, company=enquiry.company or company.name, designation=enquiry.designation, email=enquiry.email, phone=enquiry.phone, industry=enquiry.category[:120],
        location=enquiry.city, source=enquiry.source, service=(q.get("productInterest") or enquiry.interested_service or enquiry.interested_product or "")[:200], product_id=enquiry.product_id,
        requirement=(q.get("requirementDetailed") or enquiry.requirement_description or "")[:4000], budget=int(budget_digits) if budget_digits else 0, expected_purchase_date=enquiry.expected_purchase_date,
        campaign=enquiry.campaign, campaign_id=enquiry.campaign_id, lead_source_id=enquiry.lead_source_id, assigned_to=enquiry.assigned_user or p.actor_id, assigned_by=p.actor_id, assigned_at=now(),
        status="New", priority=PRIORITY_FOR_LEAD.get(enquiry.priority, "Medium"), score=45, next_follow_up=enquiry.next_follow_up, last_contacted_date=enquiry.last_contacted_date, notes=enquiry.attributes.get("notes", "") if enquiry.attributes else "",
        created_date=date.today(), created_by=p.actor_id, source_enquiry_id=enquiry.id, customer_id=enquiry.existing_customer_id, contact_id=contact.id, company_id=company.id, branch=enquiry.branch,
        initials=enquiry.initials, avatar_color=enquiry.avatar_color, attributes={"qualification": None, "enquiryReceivedDate": enquiry.date.isoformat() if enquiry.date else None},
        created_via="Conversion", **{column: getattr(enquiry, column) for column in lead_sources.CARRIED},  # the original attribution travels with the record, untouched
    )
    db.add(lead)
    db.flush()
    enquiry.status, enquiry.converted_lead_id, enquiry.converted_at, enquiry.converted_by = "Converted", lead.id, now(), p.actor_id
    enquiry.company_id = enquiry.company_id or company.id
    timeline.log_activity(db, related_type="Lead", related_id=lead.id, related_name=lead.name, type="Created", subject=f"Lead created from Enquiry {enquiry.id}", by=p.actor_id, branch=lead.branch)
    timeline.log_activity(db, related_type="Enquiry", related_id=enquiry.id, related_name=enquiry.name, type="StatusChange", subject="Status changed from Qualified to Converted", notes=f"Converted to Lead {lead.id}.",
                          by=p.actor_id, branch=enquiry.branch, from_status="Qualified", to_status="Converted")
    timeline.log_activity(db, related_type="Enquiry", related_id=enquiry.id, related_name=enquiry.name, type="Conversion", subject=f"Converted by {p.name} - created Lead {lead.id}", by=p.actor_id, branch=enquiry.branch)
    timeline.notify(db, user_id=lead.assigned_to, message=f"{enquiry.name} ({enquiry.company}) was converted to a lead.", type="Enquiry Converted", related_type="Lead", related_id=lead.id, branch=lead.branch)
    audit.record(db, user=p.user, action="Convert enquiry to lead", module="Enquiries", record_id=enquiry.id, details=f"Lead {lead.id}", info=p.info)
    db.commit()
    return {"enquiry": to_json(enquiry), "lead": to_json(lead), "company": to_json(company), "contact": to_json(contact)}


# ---- Lead -> Deal ------------------------------------------------------------------------------------------------------
def convert_lead(db: Session, p: Principal, lead_id: str) -> dict:
    lead = _get(db, Lead, lead_id, "Lead")
    if lead.status != "Qualified":
        raise conflict(f'A lead must be Qualified before it can be converted to a Deal (currently "{lead.status}").')
    company = db.get(Company, lead.company_id) if lead.company_id else None
    if company is None:
        company, _ = find_or_create_company(db, p, branch=lead.branch, name=lead.company or f"{lead.name}'s Company", defaults=dict(
            industry=lead.industry[:120], contact_person=lead.name[:160], email=lead.email, phone=lead.phone, website=lead.website, city=lead.location))
    contact = db.get(Contact, lead.contact_id) if lead.contact_id else None
    if contact is None:
        contact = find_or_create_contact(db, p, company=company, name=lead.name, email=lead.email, phone=lead.phone, designation=lead.designation)
    customer = db.get(Customer, lead.customer_id) if lead.customer_id else None
    if customer is None:
        customer, _ = find_or_create_customer(db, p, company=company, contact_name=lead.name, email=lead.email, phone=lead.phone, account_manager=lead.assigned_to,
                                              attribution=dict(lead_source_id=lead.lead_source_id, campaign_id=lead.campaign_id, source=lead.source, campaign=lead.campaign, attributed_lead_id=lead.id))
    deal = Deal(
        id=ids.new_id(db, "DL", 4), name=f"{lead.company or company.name} - {lead.service}"[:240], company_id=company.id, company_name=company.name, contact_id=contact.id, contact_name=contact.name, service=lead.service,
        product_id=lead.product_id, requirement=lead.requirement, budget=lead.budget, value=lead.budget, currency="INR", probability=flows.DEAL_PROBABILITY["Deal Created"],
        expected_closing_date=lead.expected_purchase_date or (date.today() + timedelta(days=30)), salesperson=lead.assigned_to, stage="Deal Created", priority=lead.priority, created_date=date.today(),
        lead_id=lead.id, source_enquiry_id=lead.source_enquiry_id, customer_id=customer.id, source=lead.source, source_detail=lead.source_detail, campaign=lead.campaign, campaign_id=lead.campaign_id,
        lead_source_id=lead.lead_source_id, branch=lead.branch, created_by=p.actor_id,
        attributes={"notes": lead.notes, "stageHistory": [{"stage": "Deal Created", "changedAt": now().isoformat().replace("+00:00", "Z"), "changedBy": p.actor_id, "note": f"Converted from Lead {lead.id}."}],
                    "quotationIds": [], "salesOrderIds": [], "invoiceIds": [], "paymentIds": []},
    )
    db.add(deal)
    db.flush()
    lead.status, lead.converted_at, lead.converted_by = "Converted", now(), p.actor_id
    lead.deal_id, lead.customer_id, lead.contact_id, lead.company_id = deal.id, customer.id, contact.id, company.id
    timeline.log_activity(db, related_type="Lead", related_id=lead.id, related_name=lead.name, type="StatusChange", subject="Status changed from Qualified to Converted",
                          notes=f"Converted to Deal {deal.id} - Customer {customer.id} - Contact {contact.id}.", by=p.actor_id, branch=lead.branch, from_status="Qualified", to_status="Converted")
    timeline.log_activity(db, related_type="Lead", related_id=lead.id, related_name=lead.name, type="Conversion", subject=f"Converted by {p.name} - created Deal, Customer and Contact records", by=p.actor_id, branch=lead.branch)
    timeline.log_activity(db, related_type="Deal", related_id=deal.id, related_name=deal.name, type="Created", subject=f"Deal created from Lead {lead.id}", by=p.actor_id, branch=deal.branch)
    timeline.notify(db, user_id=deal.salesperson, message=f"{lead.name} ({lead.company}) was converted to a deal.", type="Deal Update", related_type="Deal", related_id=deal.id, branch=deal.branch)
    audit.record(db, user=p.user, action="Convert lead to deal", module="Leads", record_id=lead.id, details=f"Deal {deal.id}", info=p.info)
    db.commit()
    return {"lead": to_json(lead), "deal": to_json(deal), "customer": to_json(customer), "contact": to_json(contact), "company": to_json(company)}


# ---- Deal closed won -> customer ---------------------------------------------------------------------------------------
def link_customer_for_won_deal(db: Session, p: Principal, deal: Deal) -> None:
    """Closed Won guarantees the deal is linked to a Customer (and a Contact): existing ones are found by company, never duplicated."""
    if deal.customer_id or not deal.company_id:
        return
    company = db.get(Company, deal.company_id)
    if company is None:
        return
    contact = db.get(Contact, deal.contact_id) if deal.contact_id else db.execute(select(Contact).where(Contact.company_id == company.id)).scalars().first()
    if contact is None:
        contact = find_or_create_contact(db, p, company=company, name=deal.contact_name or company.contact_person or company.name, email=company.email, phone=company.phone)
    customer, created = find_or_create_customer(db, p, company=company, contact_name=contact.name, email=company.email, phone=company.phone, account_manager=deal.salesperson,
                                                attribution=dict(lead_source_id=deal.lead_source_id, campaign_id=deal.campaign_id, source=deal.source, campaign=deal.campaign, attributed_deal_id=deal.id, attributed_lead_id=deal.lead_id))
    deal.customer_id, deal.contact_id = customer.id, contact.id
    timeline.log_activity(db, related_type="Deal", related_id=deal.id, related_name=deal.name, type="Conversion", subject=f"Closed Won -> Customer {customer.id} created" if created else f"Linked to existing Customer {customer.id}",
                          by=p.actor_id, branch=deal.branch)
    timeline.notify(db, user_id=deal.salesperson, message=f"{deal.name} is now linked to Customer {customer.name}.", type="Deal Won", related_type="Customer", related_id=customer.id, branch=deal.branch)
