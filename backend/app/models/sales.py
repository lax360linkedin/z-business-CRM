"""Sales documents: quotations, sales orders, proposals (+ their templates)."""
from datetime import date, datetime

from sqlalchemy import Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, JsonType, RecordMixin
from app.models.columns import count, day, money, person, plain_ref, ref, stamp, text


class Quotation(RecordMixin, BranchedMixin, Base):
    __tablename__ = "quotations"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    company_id: Mapped[str | None] = ref("companies", "RESTRICT")
    contact_id: Mapped[str | None] = ref("contacts")
    customer_id: Mapped[str | None] = ref("customers")
    customer_name: Mapped[str] = text(200)
    contact_name: Mapped[str] = text(160)
    contact_phone: Mapped[str] = text(30)
    contact_email: Mapped[str] = text(254)
    billing_address: Mapped[str] = text(400)
    shipping_address: Mapped[str] = text(400)
    gstin: Mapped[str] = text(20)
    deal_id: Mapped[str | None] = ref("deals")
    lead_id: Mapped[str | None] = ref("leads")
    source_enquiry_id: Mapped[str | None] = ref("enquiries")
    source: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source_detail: Mapped[str | None] = mapped_column(String(200), nullable=True)
    requirement: Mapped[str] = text(4000)
    subtotal: Mapped[float] = money()
    tax: Mapped[float] = money()
    amount: Mapped[float] = money()
    created_date: Mapped[date | None] = day()
    valid_until: Mapped[date | None] = day()
    status: Mapped[str] = mapped_column(String(20), default="Draft", nullable=False, index=True)
    assigned_to: Mapped[str | None] = person()
    payment_terms: Mapped[str] = text(300)
    terms: Mapped[str] = text(4000)
    template_id: Mapped[str | None] = plain_ref()
    sales_order_id: Mapped[str | None] = plain_ref()
    __table_args__ = (Index("ix_quotations_branch_status", "branch", "status"),)


class SalesOrder(RecordMixin, BranchedMixin, Base):
    __tablename__ = "sales_orders"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    quotation_id: Mapped[str | None] = ref("quotations", "RESTRICT")
    quotation_number: Mapped[str] = text(40)
    deal_id: Mapped[str | None] = ref("deals")
    lead_id: Mapped[str | None] = ref("leads")
    source_enquiry_id: Mapped[str | None] = ref("enquiries")
    customer_id: Mapped[str | None] = ref("customers", "RESTRICT")
    customer_name: Mapped[str] = text(200)
    company_id: Mapped[str | None] = ref("companies")
    company_name: Mapped[str] = text(200)
    contact_id: Mapped[str | None] = ref("contacts")
    contact_name: Mapped[str] = text(160)
    contact_email: Mapped[str] = text(254)
    contact_phone: Mapped[str] = text(30)
    source: Mapped[str] = text(60)
    source_detail: Mapped[str] = text(200)
    order_date: Mapped[date | None] = day()
    expected_delivery_date: Mapped[date | None] = day()
    salesperson: Mapped[str | None] = person()
    billing_address: Mapped[str] = text(400)
    shipping_address: Mapped[str] = text(400)
    gstin: Mapped[str] = text(20)
    payment_terms: Mapped[str] = text(300)
    delivery_terms: Mapped[str] = text(300)
    notes: Mapped[str] = text(4000)
    internal_remarks: Mapped[str] = text(4000)
    tax_type: Mapped[str] = text(10)
    subtotal: Mapped[float] = money()
    discount_amount: Mapped[float] = money()
    taxable_amount: Mapped[float] = money()
    tax: Mapped[float] = money()
    cgst: Mapped[float] = money()
    sgst: Mapped[float] = money()
    igst: Mapped[float] = money()
    amount: Mapped[float] = money()
    status: Mapped[str] = mapped_column(String(24), default="Draft", nullable=False, index=True)
    invoice_id: Mapped[str | None] = plain_ref()
    revision: Mapped[int] = count()
    created_date: Mapped[date | None] = day()
    __table_args__ = (Index("ix_sales_orders_branch_status", "branch", "status"),)


class Proposal(RecordMixin, BranchedMixin, Base):
    __tablename__ = "proposals"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    version: Mapped[int] = count(1)
    title: Mapped[str] = text(240)
    status: Mapped[str] = mapped_column(String(24), default="Draft", nullable=False, index=True)
    deal_id: Mapped[str | None] = ref("deals")
    deal_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    enquiry_id: Mapped[str | None] = ref("enquiries")
    lead_id: Mapped[str | None] = ref("leads")
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    customer_id: Mapped[str | None] = ref("customers")
    customer_name: Mapped[str] = text(200)
    service: Mapped[str] = text(200)
    value: Mapped[float] = money()
    owner_id: Mapped[str | None] = person()
    assigned_to: Mapped[str | None] = person()
    source: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source_detail: Mapped[str] = text(200)
    created_date: Mapped[date | None] = day()
    valid_until: Mapped[date | None] = day()
    sent_at: Mapped[datetime | None] = stamp()
    notes: Mapped[str] = text(4000)
    next_follow_up: Mapped[date | None] = day()
    __table_args__ = (Index("ix_proposals_branch_status", "branch", "status"),)


class DocumentTemplate(RecordMixin, Base):
    """Quotation / proposal templates (organisation-wide). `kind` is 'quotation' or 'proposal'; the layout lives in `content`."""

    __tablename__ = "document_templates"
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_default: Mapped[bool] = mapped_column(default=False, nullable=False)
    content: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)
    __table_args__ = (Index("uq_document_templates_kind_name", "kind", "name", unique=True),)
