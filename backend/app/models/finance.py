"""Finance: invoices, payments, expenses (+ categories and vendors)."""
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, RecordMixin
from app.models.columns import count, day, money, person, plain_ref, rate, ref, stamp, text


class Invoice(RecordMixin, BranchedMixin, Base):
    __tablename__ = "invoices"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    legacy_number: Mapped[str] = text(40)
    customer_id: Mapped[str | None] = ref("customers", "RESTRICT")
    customer_name: Mapped[str] = text(200)
    company_id: Mapped[str | None] = ref("companies")
    company_name: Mapped[str] = text(200)
    contact_id: Mapped[str | None] = ref("contacts")
    contact_name: Mapped[str] = text(160)
    contact_email: Mapped[str] = text(254)
    contact_phone: Mapped[str] = text(30)
    project_id: Mapped[str | None] = ref("projects")
    sales_order_id: Mapped[str | None] = ref("sales_orders")
    sales_order_number: Mapped[str] = text(40)
    quotation_id: Mapped[str | None] = ref("quotations")
    quotation_number: Mapped[str] = text(40)
    deal_id: Mapped[str | None] = ref("deals")
    lead_id: Mapped[str | None] = ref("leads")
    enquiry_id: Mapped[str | None] = ref("enquiries")
    proposal_id: Mapped[str | None] = ref("proposals")
    contract_id: Mapped[str | None] = ref("contracts")
    owner_id: Mapped[str | None] = person()
    source: Mapped[str] = text(60)
    source_detail: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[float] = money()
    paid_amount: Mapped[float] = money()
    subtotal: Mapped[float] = money()
    discount_amount: Mapped[float] = money()
    taxable_amount: Mapped[float] = money()
    tax: Mapped[float] = money()
    cgst: Mapped[float] = money()
    sgst: Mapped[float] = money()
    igst: Mapped[float] = money()
    other_tax_amount: Mapped[float] = money()
    round_off: Mapped[float] = money()
    tax_type: Mapped[str] = text(10)
    issue_date: Mapped[date | None] = day()
    due_date: Mapped[date | None] = day()
    status: Mapped[str] = mapped_column(String(20), default="Draft", nullable=False, index=True)
    lifecycle: Mapped[str] = mapped_column(String(12), default="Draft", nullable=False)
    billing_address: Mapped[str] = text(400)
    shipping_address: Mapped[str] = text(400)
    gstin: Mapped[str] = text(20)
    payment_terms: Mapped[str] = text(300)
    notes: Mapped[str] = text(4000)
    terms: Mapped[str] = text(4000)
    finalized_at: Mapped[datetime | None] = stamp()
    __table_args__ = (
        CheckConstraint("paid_amount >= 0", name="paid_non_negative"),
        Index("ix_invoices_branch_status", "branch", "status"),
        Index("ix_invoices_customer_status", "customer_id", "status"),
    )


class Payment(RecordMixin, BranchedMixin, Base):
    __tablename__ = "payments"
    number: Mapped[str] = text(40)
    invoice_id: Mapped[str | None] = ref("invoices", "RESTRICT")
    invoice_number: Mapped[str] = text(40)
    customer_id: Mapped[str | None] = ref("customers")
    customer_name: Mapped[str] = text(200)
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    deal_id: Mapped[str | None] = ref("deals")
    sales_order_id: Mapped[str | None] = ref("sales_orders")
    quotation_id: Mapped[str | None] = ref("quotations")
    proposal_id: Mapped[str | None] = ref("proposals")
    project_id: Mapped[str | None] = ref("projects")
    contract_id: Mapped[str | None] = ref("contracts")
    enquiry_id: Mapped[str | None] = ref("enquiries")
    lead_id: Mapped[str | None] = ref("leads")
    amount: Mapped[float] = money()
    method: Mapped[str] = text(30)
    date: Mapped[date | None] = day()
    status: Mapped[str] = mapped_column(String(24), default="Completed", nullable=False, index=True)
    reference: Mapped[str] = text(120)
    bank_account: Mapped[str] = text(120)
    recorded_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    received_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    refunded_amount: Mapped[float] = money()
    cancel_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    cancelled_at: Mapped[datetime | None] = stamp()
    cancelled_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (CheckConstraint("amount >= 0", name="amount_non_negative"), Index("ix_payments_branch_date", "branch", "date"))


class ExpenseCategory(RecordMixin, Base):
    __tablename__ = "expense_categories"
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str] = text(20)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    description: Mapped[str] = text(400)
    __table_args__ = (Index("uq_expense_categories_name_lower", func.lower(name), unique=True),)


class Vendor(RecordMixin, Base):
    __tablename__ = "vendors"
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_name: Mapped[str] = text(160)
    email: Mapped[str] = text(254)
    phone: Mapped[str] = text(30)
    gstin: Mapped[str] = text(20)
    address: Mapped[str] = text(400)
    notes: Mapped[str] = text(2000)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    __table_args__ = (Index("uq_vendors_name_lower", func.lower(name), unique=True),)


class Expense(RecordMixin, BranchedMixin, Base):
    __tablename__ = "expenses"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(24), default="Draft", nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), default="Employee", nullable=False)
    date: Mapped[date | None] = day()
    category_id: Mapped[str | None] = ref("expense_categories")
    description: Mapped[str] = text(1000)
    amount: Mapped[float] = money()
    tax_rate: Mapped[float] = rate()
    tax: Mapped[float] = money()
    total: Mapped[float] = money()
    payment_method: Mapped[str] = text(30)
    paid_by: Mapped[str] = text(40)
    vendor_id: Mapped[str | None] = ref("vendors")
    vendor_bill_number: Mapped[str] = text(60)
    vendor_bill_date: Mapped[date | None] = day()
    due_date: Mapped[date | None] = day()
    employee_id: Mapped[str | None] = person()
    customer_id: Mapped[str | None] = ref("customers")
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    deal_id: Mapped[str | None] = ref("deals")
    invoice_id: Mapped[str | None] = ref("invoices")
    project_id: Mapped[str | None] = ref("projects")
    contract_id: Mapped[str | None] = ref("contracts")
    campaign_id: Mapped[str | None] = ref("campaigns")
    payment_reference: Mapped[str] = text(120)
    notes: Mapped[str] = text(2000)
    approved_amount: Mapped[float | None] = mapped_column(nullable=True)
    reimbursed_amount: Mapped[float] = money()
    reimbursed_date: Mapped[date | None] = day()
    cycle: Mapped[int] = count(1)
    submitted_at: Mapped[datetime | None] = stamp()
    submitted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (Index("ix_expenses_branch_status", "branch", "status"), Index("ix_expenses_employee_status", "employee_id", "status"))
