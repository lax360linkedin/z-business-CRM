from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, JsonType, RecordMixin, TimestampMixin, UTCDateTime, utcnow


class Counter(Base):
    """Gap-free counters behind record ids (LD-0001) and yearly numbers (INV-2026-0001)."""

    __tablename__ = "counters"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AuditLog(Base):
    """Append-only trail of who did what (sign-ins, denials, record changes). Rows are only ever inserted."""

    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    user_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    branch: Mapped[str | None] = mapped_column(String(40), nullable=True)
    action: Mapped[str] = mapped_column(String(160), nullable=False)
    module: Mapped[str] = mapped_column(String(60), default="", nullable=False, index=True)
    record_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    result: Mapped[str] = mapped_column(String(12), default="Success", nullable=False)
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)
    ip: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    __table_args__ = (CheckConstraint("result in ('Success','Denied','Failed')", name="result"), Index("ix_audit_logs_module_at", "module", "at"))


class Notification(RecordMixin, BranchedMixin, Base):
    """An in-app notification for one person (the employee id behind a login)."""

    __tablename__ = "notifications"
    BRANCH_OPTIONAL = True
    user_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("employees.id", ondelete="CASCADE"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(40), default="info", nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="bell", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    related_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    related_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)  # a reminder is created once per (event, person); re-running a sweep never repeats it
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read"),)


class AppSetting(TimestampMixin, Base):
    """Workspace settings stored as JSON documents (company profile, tax, task rules, ...). One row per key."""

    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(40), nullable=True)


class StoredFile(TimestampMixin, Base):
    """Bytes of an uploaded file when Supabase Storage is not configured (or for small files); documents point at it by id."""

    __tablename__ = "stored_files"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(120), default="application/octet-stream", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
