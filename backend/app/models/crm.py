"""CRM core: companies, contacts, customers, products, enquiries, leads, deals, plus the marketing sources they are attributed to."""
from datetime import date, datetime

import re

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, event, func
from sqlalchemy import text as text_clause
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, RecordMixin
from app.models.columns import count, day, money, person, plain_ref, rate, ref, stamp, text


class LeadSource(RecordMixin, Base):
    """Where leads come from. `branch` empty = a SHARED source every branch can use; otherwise it exists for that branch only."""

    __tablename__ = "lead_sources"
    branch: Mapped[str | None] = mapped_column(String(40), ForeignKey("branches.name", onupdate="CASCADE", ondelete="RESTRICT"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(160), default="", nullable=False)  # the name with case, spacing and punctuation removed: "Walk-in" and "walk in" are the same source
    category: Mapped[str] = text(60)
    source_type: Mapped[str] = text(60)
    capture_method: Mapped[str] = text(30)  # how enquiries from it are expected to arrive (information only - it never means anything is connected)
    connected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # legacy flag, no longer read or written: connection status comes from lead_source_integrations
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str] = text(500)
    __table_args__ = (
        # one common source per name, and one source per name inside each branch (the same name may exist in two different branches)
        Index("uq_lead_sources_common_name", "name_key", unique=True, postgresql_where=text_clause("branch IS NULL"), sqlite_where=text_clause("branch IS NULL")),
        Index("uq_lead_sources_branch_name", "branch", "name_key", unique=True, postgresql_where=text_clause("branch IS NOT NULL"), sqlite_where=text_clause("branch IS NOT NULL")),
    )


def source_key(name: str) -> str:
    """Normalised form of a source name used for duplicate checks."""
    return re.sub(r"[^a-z0-9]+", "", str(name or "").casefold())


@event.listens_for(LeadSource, "before_insert")
@event.listens_for(LeadSource, "before_update")
def _keep_name_key(_mapper, _connection, target: LeadSource) -> None:
    target.name_key = source_key(target.name)


class LeadSourceIntegration(RecordMixin, Base):
    """What is known about an integration feeding a source: which platform, which account / form, which branch it maps to, and how the last attempt went.

    This table is METADATA only. Credentials, tokens and webhook secrets never live here - they belong to the secure backend configuration of the Integrations module.
    `status` is written only by that module (through services.source_integrations); people can record a mapping and switch it on or off, but never mark it Connected."""

    __tablename__ = "lead_source_integrations"
    source_id: Mapped[str] = mapped_column(String(40), ForeignKey("lead_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(60), nullable=False)
    account_name: Mapped[str] = text(160)  # the connected account, page or form name
    mapped_branch: Mapped[str | None] = mapped_column(String(40), ForeignKey("branches.name", onupdate="CASCADE", ondelete="RESTRICT"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="Not Connected", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_sync_at: Mapped[datetime | None] = stamp()
    last_error: Mapped[str] = text(500)
    notes: Mapped[str] = text(500)
    __table_args__ = (CheckConstraint("status in ('Not Connected','Connected','Error','Inactive')", name="status"),)


class AttributionMixin:
    """Where an enquiry / lead came from, kept apart from who typed it in. Every field is optional: a valid enquiry never waits for campaign details.
    The source itself is `lead_source_id` (+ its name in `source`); `source_category` is the category at the time it was attributed, so a later re-categorising of the source
    does not rewrite history."""

    source_category: Mapped[str] = text(60)
    ad_name: Mapped[str] = text(160)
    ad_id: Mapped[str] = text(80)
    landing_page: Mapped[str] = text(200)  # landing page or form name
    utm_source: Mapped[str] = text(120)
    utm_medium: Mapped[str] = text(120)
    utm_campaign: Mapped[str] = text(160)
    utm_content: Mapped[str] = text(160)
    referring_employee_id: Mapped[str | None] = plain_ref()
    created_via: Mapped[str] = text(30)  # Manual | Import | Conversion | Integration - the channel that created the record (the person, if any, is `created_by`)


class Product(RecordMixin, Base):
    """Products and services catalogue (organisation-wide)."""

    __tablename__ = "products"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = text(40)
    category: Mapped[str] = text(80)
    type: Mapped[str] = text(30)
    description: Mapped[str] = text(2000)
    price: Mapped[float] = money()
    billing_cycle: Mapped[str] = text(30)
    unit: Mapped[str] = text(30)
    tax_rate: Mapped[float] = rate()
    default_discount: Mapped[float] = rate()
    status: Mapped[str] = mapped_column(String(10), default="Active", nullable=False, index=True)
    curated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    __table_args__ = (CheckConstraint("status in ('Active','Inactive')", name="status"), Index("uq_products_name_lower", func.lower(name), unique=True))


class Company(RecordMixin, BranchedMixin, Base):
    __tablename__ = "companies"
    assigned_to: Mapped[str | None] = person()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    industry: Mapped[str] = text(120)
    contact_person: Mapped[str] = text(160)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    website: Mapped[str] = text(200)
    city: Mapped[str] = text(80)
    address: Mapped[str] = text(400)
    billing_address: Mapped[str] = text(400)
    shipping_address: Mapped[str] = text(400)
    gstin: Mapped[str] = text(20)
    revenue: Mapped[float] = money()
    status: Mapped[str] = mapped_column(String(12), default="Active", nullable=False, index=True)
    created_date: Mapped[date | None] = day()
    __table_args__ = (CheckConstraint("status in ('Active','Inactive','Prospect')", name="status"), Index("uq_companies_branch_name", "branch", func.lower(name), unique=True))


class Contact(RecordMixin, BranchedMixin, Base):
    __tablename__ = "contacts"
    assigned_to: Mapped[str | None] = person()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    designation: Mapped[str] = text(120)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    whatsapp: Mapped[str] = text(30)
    company_id: Mapped[str | None] = ref("companies", "RESTRICT")
    company_name: Mapped[str] = text(200)
    next_follow_up: Mapped[date | None] = day()
    last_contacted_date: Mapped[date | None] = day()
    notes: Mapped[str] = text(4000)
    initials: Mapped[str] = text(4)
    avatar_color: Mapped[str] = text(120)
    created_date: Mapped[date | None] = day()


class Customer(RecordMixin, BranchedMixin, Base):
    __tablename__ = "customers"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    company_id: Mapped[str | None] = ref("companies", "RESTRICT")
    industry: Mapped[str] = text(120)
    contact_person: Mapped[str] = text(160)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    gstin: Mapped[str] = text(20)
    billing_address: Mapped[str] = text(400)
    shipping_address: Mapped[str] = text(400)
    account_manager: Mapped[str | None] = person()
    since: Mapped[date | None] = day()
    status: Mapped[str] = mapped_column(String(12), default="Active", nullable=False, index=True)
    tier: Mapped[str] = text(20)
    lifetime_value: Mapped[float] = money()
    source: Mapped[str] = text(60)
    campaign: Mapped[str] = text(160)
    lead_source_id: Mapped[str | None] = ref("lead_sources")
    campaign_id: Mapped[str | None] = ref("campaigns")
    attributed_deal_id: Mapped[str | None] = plain_ref()
    attributed_lead_id: Mapped[str | None] = plain_ref()
    __table_args__ = (CheckConstraint("status in ('Active','Inactive')", name="status"),)


class Enquiry(AttributionMixin, RecordMixin, BranchedMixin, Base):
    __tablename__ = "enquiries"
    status: Mapped[str] = mapped_column(String(20), default="New", nullable=False, index=True)
    date: Mapped[date | None] = day()
    source: Mapped[str] = text(60)
    campaign: Mapped[str] = text(160)
    enquiry_type: Mapped[str] = text(60)
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    assigned_team: Mapped[str | None] = mapped_column(String(80), nullable=True)
    assigned_user: Mapped[str | None] = person()
    assigned_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    assigned_at: Mapped[datetime | None] = stamp()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    company: Mapped[str] = text(200)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    alternate_phone: Mapped[str] = text(30)
    whatsapp: Mapped[str] = text(30)
    designation: Mapped[str] = text(120)
    country: Mapped[str] = text(60)
    state: Mapped[str] = text(60)
    city: Mapped[str] = text(80)
    area: Mapped[str] = text(80)
    address: Mapped[str] = text(400)
    pincode: Mapped[str] = text(12)
    interested_product: Mapped[str] = text(200)
    interested_service: Mapped[str] = text(200)
    category: Mapped[str] = text(80)
    requirement_type: Mapped[str] = text(60)
    requirement_description: Mapped[str] = text(4000)
    quantity: Mapped[int] = count()
    budget_range: Mapped[str] = text(60)
    expected_purchase_date: Mapped[date | None] = day()
    preferred_contact_method: Mapped[str] = text(30)
    next_follow_up: Mapped[date | None] = day()
    last_contacted_date: Mapped[date | None] = day()
    duplicate_of_id: Mapped[str | None] = plain_ref()
    existing_customer_id: Mapped[str | None] = ref("customers")
    company_id: Mapped[str | None] = ref("companies")
    close_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    closed_at: Mapped[datetime | None] = stamp()
    closed_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    converted_lead_id: Mapped[str | None] = plain_ref()
    converted_at: Mapped[datetime | None] = stamp()
    converted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_date: Mapped[date | None] = day()
    initials: Mapped[str] = text(4)
    avatar_color: Mapped[str] = text(120)
    product_id: Mapped[str | None] = ref("products")
    campaign_id: Mapped[str | None] = ref("campaigns")
    lead_source_id: Mapped[str | None] = ref("lead_sources")
    __table_args__ = (Index("ix_enquiries_branch_status", "branch", "status"),)


class Lead(AttributionMixin, RecordMixin, BranchedMixin, Base):
    __tablename__ = "leads"
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    company: Mapped[str] = text(200)
    designation: Mapped[str] = text(120)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    website: Mapped[str] = text(200)
    industry: Mapped[str] = text(120)
    location: Mapped[str] = text(120)
    source: Mapped[str] = text(60)
    source_detail: Mapped[str] = text(200)
    capture_method: Mapped[str] = text(30)
    captured_at: Mapped[datetime | None] = stamp()
    service: Mapped[str] = text(200)
    requirement: Mapped[str] = text(4000)
    budget: Mapped[float] = money()
    expected_purchase_date: Mapped[date | None] = day()
    campaign: Mapped[str] = text(160)
    assigned_to: Mapped[str | None] = person()
    assigned_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    assigned_at: Mapped[datetime | None] = stamp()
    status: Mapped[str] = mapped_column(String(16), default="New", nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    score: Mapped[int] = count()
    next_follow_up: Mapped[date | None] = day()
    last_contacted_date: Mapped[date | None] = day()
    notes: Mapped[str] = text(4000)
    created_date: Mapped[date | None] = day()
    converted_at: Mapped[datetime | None] = stamp()
    converted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deal_id: Mapped[str | None] = plain_ref()
    customer_id: Mapped[str | None] = ref("customers")
    contact_id: Mapped[str | None] = ref("contacts")
    company_id: Mapped[str | None] = ref("companies")
    source_enquiry_id: Mapped[str | None] = ref("enquiries")
    unqualified_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    unqualified_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    unqualified_date: Mapped[date | None] = day()
    unqualified_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    lost_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    lost_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    lost_date: Mapped[date | None] = day()
    lost_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    initials: Mapped[str] = text(4)
    avatar_color: Mapped[str] = text(120)
    product_id: Mapped[str | None] = ref("products")
    campaign_id: Mapped[str | None] = ref("campaigns")
    lead_source_id: Mapped[str | None] = ref("lead_sources")
    __table_args__ = (Index("ix_leads_branch_status", "branch", "status"), Index("ix_leads_assigned_status", "assigned_to", "status"))


class Deal(RecordMixin, BranchedMixin, Base):
    __tablename__ = "deals"
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    company_id: Mapped[str | None] = ref("companies", "RESTRICT")
    company_name: Mapped[str] = text(200)
    contact_id: Mapped[str | None] = ref("contacts")
    contact_name: Mapped[str] = text(160)
    service: Mapped[str] = text(200)
    requirement: Mapped[str] = text(4000)
    customer_need: Mapped[str] = text(2000)
    budget: Mapped[float] = money()
    expected_purchase_timeline: Mapped[str] = text(120)
    competitor: Mapped[str] = text(160)
    decision_maker: Mapped[str] = text(160)
    notes: Mapped[str] = text(4000)
    value: Mapped[float] = money()
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    probability: Mapped[int] = count()
    expected_closing_date: Mapped[date | None] = day()
    salesperson: Mapped[str | None] = person()
    stage: Mapped[str] = mapped_column(String(40), default="Deal Created", nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    created_date: Mapped[date | None] = day()
    next_follow_up: Mapped[date | None] = day()
    last_contacted_date: Mapped[date | None] = day()
    closed_at: Mapped[datetime | None] = stamp()
    closed_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    lost_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    lost_notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    lost_date: Mapped[date | None] = day()
    lost_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    lead_id: Mapped[str | None] = ref("leads")
    source_enquiry_id: Mapped[str | None] = ref("enquiries")
    customer_id: Mapped[str | None] = ref("customers")
    source: Mapped[str] = text(60)
    source_detail: Mapped[str] = text(200)
    campaign: Mapped[str] = text(160)
    product_id: Mapped[str | None] = ref("products")
    campaign_id: Mapped[str | None] = ref("campaigns")
    lead_source_id: Mapped[str | None] = ref("lead_sources")
    __table_args__ = (Index("ix_deals_branch_stage", "branch", "stage"), Index("ix_deals_salesperson_stage", "salesperson", "stage"))
