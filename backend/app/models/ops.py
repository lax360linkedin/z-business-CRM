"""Operations: projects, contracts, documents (+ folders)."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, RecordMixin, UTCDateTime, utcnow
from app.models.columns import count, day, money, person, plain_ref, ref, stamp, text


class Project(RecordMixin, BranchedMixin, Base):
    __tablename__ = "projects"
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    customer_id: Mapped[str | None] = ref("customers", "RESTRICT")
    customer_name: Mapped[str] = text(200)
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    deal_id: Mapped[str | None] = ref("deals")
    proposal_id: Mapped[str | None] = ref("proposals")
    quotation_id: Mapped[str | None] = ref("quotations")
    sales_order_id: Mapped[str | None] = ref("sales_orders")
    product_id: Mapped[str | None] = ref("products")
    manager: Mapped[str | None] = person()
    start_date: Mapped[date | None] = day()
    deadline: Mapped[date | None] = day()
    expected_end_date: Mapped[date | None] = day()
    actual_end_date: Mapped[date | None] = day()
    progress: Mapped[int] = count()
    status: Mapped[str] = mapped_column(String(16), default="Planned", nullable=False, index=True)
    budget: Mapped[float] = money()
    value: Mapped[float] = money()
    project_type: Mapped[str] = text(60)
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    progress_mode: Mapped[str] = mapped_column(String(10), default="auto", nullable=False)
    description: Mapped[str] = text(4000)
    notes: Mapped[str] = text(4000)
    __table_args__ = (Index("ix_projects_branch_status", "branch", "status"),)


class Contract(RecordMixin, BranchedMixin, Base):
    __tablename__ = "contracts"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    title: Mapped[str] = text(240)
    contract_type: Mapped[str] = text(80)
    customer_id: Mapped[str | None] = ref("customers", "RESTRICT")
    customer_name: Mapped[str] = text(200)
    project_id: Mapped[str | None] = ref("projects")
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    deal_id: Mapped[str | None] = ref("deals")
    proposal_id: Mapped[str | None] = ref("proposals")
    quotation_id: Mapped[str | None] = ref("quotations")
    sales_order_id: Mapped[str | None] = ref("sales_orders")
    owner: Mapped[str | None] = person()
    value: Mapped[float] = money()
    start_date: Mapped[date | None] = day()
    end_date: Mapped[date | None] = day()
    renewal_date: Mapped[date | None] = day()
    status: Mapped[str] = mapped_column(String(20), default="Draft", nullable=False, index=True)
    billing_frequency: Mapped[str] = text(30)
    payment_terms: Mapped[str] = text(300)
    notice_period_days: Mapped[int] = count()
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    renewal_terms: Mapped[str] = text(2000)
    scope: Mapped[str] = text(4000)
    terms: Mapped[str] = text(8000)
    notes: Mapped[str] = text(4000)
    signed_at: Mapped[datetime | None] = stamp()
    renewed_from_id: Mapped[str | None] = plain_ref()
    renewed_to_id: Mapped[str | None] = plain_ref()
    __table_args__ = (Index("ix_contracts_branch_status", "branch", "status"),)


class DocumentFolder(RecordMixin, Base):
    __tablename__ = "document_folders"
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_id: Mapped[str | None] = ref("document_folders")
    owner_id: Mapped[str | None] = person()


class Document(RecordMixin, BranchedMixin, Base):
    """Document metadata. The bytes live in Supabase Storage (`storage_path`) or, when Storage is not configured, in `stored_files` (`stored_file_id`)."""

    __tablename__ = "documents"
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = text(60)
    sub_category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    file_type: Mapped[str] = text(20)
    file_name: Mapped[str] = text(255)
    mime: Mapped[str] = text(120)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    related_to: Mapped[str] = text(200)
    visibility: Mapped[str] = text(40)
    status: Mapped[str] = mapped_column(String(16), default="Active", nullable=False, index=True)
    version: Mapped[int] = count(1)
    description: Mapped[str] = text(2000)
    owner_id: Mapped[str | None] = person()
    uploaded_by: Mapped[str | None] = person()
    uploaded_date: Mapped[date | None] = day()
    updated_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    assigned_to: Mapped[str | None] = person()
    folder_id: Mapped[str | None] = ref("document_folders")
    stored_file_id: Mapped[str | None] = ref("stored_files", "SET NULL")
    storage_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    # what the document belongs to (open-ended: any module may attach files)
    company_id: Mapped[str | None] = ref("companies")
    contact_id: Mapped[str | None] = ref("contacts")
    customer_id: Mapped[str | None] = ref("customers")
    related_customer_id: Mapped[str | None] = plain_ref()
    deal_id: Mapped[str | None] = ref("deals")
    lead_id: Mapped[str | None] = ref("leads")
    enquiry_id: Mapped[str | None] = ref("enquiries")
    quotation_id: Mapped[str | None] = ref("quotations")
    proposal_id: Mapped[str | None] = ref("proposals")
    sales_order_id: Mapped[str | None] = ref("sales_orders")
    project_id: Mapped[str | None] = ref("projects")
    contract_id: Mapped[str | None] = ref("contracts")
    invoice_id: Mapped[str | None] = ref("invoices")
    payment_id: Mapped[str | None] = ref("payments")
    expense_id: Mapped[str | None] = ref("expenses")
    task_id: Mapped[str | None] = plain_ref()
    activity_id: Mapped[str | None] = plain_ref()
    employee_id: Mapped[str | None] = plain_ref()
    ticket_id: Mapped[str | None] = plain_ref()
    campaign_id: Mapped[str | None] = ref("campaigns")
    # the record the file was uploaded from (the most specific link); drives who may open it
    primary_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    primary_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    managed_by: Mapped[str | None] = mapped_column(String(40), nullable=True)  # a module that files its own documents (e.g. quotation attachments) owns them
    review_by: Mapped[date | None] = day()
    deleted_at: Mapped[datetime | None] = stamp()
    deleted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    purge_after: Mapped[datetime | None] = stamp()
    __table_args__ = (
        Index("ix_documents_branch_category", "branch", "category"),
        Index("ix_documents_primary", "primary_type", "primary_id"),
        CheckConstraint("status in ('Active','Archived','Deleted')", name="status"),
    )


class DocumentVersion(Base):
    """One stored file of a document. Restoring an old version adds a new row that points at the same stored bytes."""

    __tablename__ = "document_versions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(40), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mime: Mapped[str] = text(120)
    sha256: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    uploaded_by: Mapped[str | None] = person()
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    note: Mapped[str] = text(300)
    source: Mapped[str] = text(30)
    stored_file_id: Mapped[str | None] = ref("stored_files", "SET NULL")
    storage_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    previous_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __table_args__ = (UniqueConstraint("document_id", "version", name="document_version"), Index("ix_document_versions_hash", "document_id", "sha256"))


class DocumentShare(Base):
    """Explicit access to one document for a person or a team, with an expiry; revoked rows stay as history."""

    __tablename__ = "document_shares"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(40), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(8), nullable=False)
    target_id: Mapped[str] = mapped_column(String(120), nullable=False)  # an employee id, or a department name for a team
    access: Mapped[str] = mapped_column(String(10), nullable=False)
    expires_at: Mapped[datetime | None] = stamp()
    shared_by: Mapped[str | None] = person()
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    note: Mapped[str] = text(200)
    revoked_at: Mapped[datetime | None] = stamp()
    revoked_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (
        CheckConstraint("target_type in ('user','team')", name="target_type"),
        CheckConstraint("access in ('view','download','edit')", name="access"),
        Index("ix_document_shares_target", "target_type", "target_id"),
    )


class DocumentAudit(Base):
    """Append-only trail of everything done to (or refused on) documents. No document foreign key: the history outlives a permanent delete."""

    __tablename__ = "document_audit"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    document_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    user_name: Mapped[str] = text(160)
    role: Mapped[str] = text(40)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str] = mapped_column(String(10), default="Success", nullable=False)
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)
    related_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    __table_args__ = (CheckConstraint("result in ('Success','Denied','Rejected','Failed')", name="result"),)
