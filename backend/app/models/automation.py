from datetime import datetime

from sqlalchemy import CheckConstraint, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JsonType, TimestampMixin, UTCDateTime


class AutomationRun(TimestampMixin, Base):
    """One attempt-series to hand something to an n8n workflow: what triggered it, what was sent, and what came back. Rows are history: they are never edited by the screens, only by the
    dispatcher (status, attempts, outcome) and by n8n's callback. `branch` is plain text (no foreign key) so the history outlives a branch; visibility is filtered by it in the service."""

    __tablename__ = "automation_runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    workflow_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    event: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    trigger: Mapped[str] = mapped_column(String(12), default="event", nullable=False)  # event | manual | insight | retry
    record_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    record_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    record_label: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    branch: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="Queued", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    response_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (
        CheckConstraint("status in ('Queued','Running','Success','Failed')", name="status"),
        Index("ix_automation_runs_status_created", "status", "created_at"),
    )
