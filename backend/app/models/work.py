"""Work: tasks (with their event log and saved filters), activities, tickets."""
from datetime import date, datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, JsonType, RecordMixin, UTCDateTime, utcnow
from app.models.columns import day, person, plain_ref, ref, stamp, text


class Task(RecordMixin, BranchedMixin, Base):
    __tablename__ = "tasks"
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = text(4000)
    task_type: Mapped[str] = text(40)
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="To Do", nullable=False, index=True)
    start_date: Mapped[date | None] = day()
    due_date: Mapped[date | None] = day()
    due_time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    reminder_minutes: Mapped[str] = text(12)
    reminder_at: Mapped[datetime | None] = stamp()
    reminded_at: Mapped[datetime | None] = stamp()
    assigned_to: Mapped[str | None] = person()
    department: Mapped[str] = text(120)
    visibility: Mapped[str] = text(20)
    related_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_id: Mapped[str | None] = plain_ref()
    related_name: Mapped[str] = text(240)
    parent_id: Mapped[str | None] = ref("tasks")
    source: Mapped[str] = text(20)
    automation_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    recurrence_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    activity_id: Mapped[str | None] = plain_ref()
    completed_at: Mapped[datetime | None] = stamp()
    completed_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (Index("ix_tasks_related", "related_type", "related_id"), Index("ix_tasks_assigned_status", "assigned_to", "status"), Index("ix_tasks_due", "due_date"))


class TaskEvent(Base):
    """History of a task (created, assigned, status changed, commented ...)."""

    __tablename__ = "task_events"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(40), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    from_value: Mapped[str | None] = mapped_column("from_value", String(300), nullable=True)
    to_value: Mapped[str | None] = mapped_column("to_value", String(300), nullable=True)
    data: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)  # field, reason, text, mentions, internal ...


class TaskPerson(Base):
    """Who a task belongs to (assignees) or who follows it (watchers): lets "my tasks" / visibility be answered in SQL, with real foreign keys."""

    __tablename__ = "task_people"
    task_id: Mapped[str] = mapped_column(String(40), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(40), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True, index=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)  # 'assignee' | 'watcher'


class SavedFilter(RecordMixin, Base):
    """A person's saved task filter."""

    __tablename__ = "saved_filters"
    owner_id: Mapped[str] = mapped_column(String(40), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(20), default="tasks", nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    definition: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)


class Activity(RecordMixin, BranchedMixin, Base):
    """Timeline entry: a call / meeting / note / follow-up, or a system event, attached to any record."""

    __tablename__ = "activities"
    related_type: Mapped[str] = text(30)
    related_id: Mapped[str] = mapped_column(String(60), default="", nullable=False, index=True)
    related_name: Mapped[str] = text(240)
    status: Mapped[str] = mapped_column(String(12), default="Completed", nullable=False, index=True)
    by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    type: Mapped[str] = text(30)
    subject: Mapped[str] = text(300)
    date: Mapped[datetime | None] = stamp()
    source: Mapped[str] = text(12)
    assigned_to: Mapped[str | None] = person()
    notes: Mapped[str] = text(4000)
    from_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    invoice_id: Mapped[str | None] = plain_ref()
    __table_args__ = (Index("ix_activities_related", "related_type", "related_id"), Index("ix_activities_date", "date"))


class Ticket(RecordMixin, BranchedMixin, Base):
    __tablename__ = "tickets"
    subject: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = text(4000)
    customer_id: Mapped[str | None] = ref("customers", "RESTRICT")
    customer_name: Mapped[str] = text(200)
    company_id: Mapped[str | None] = ref("companies")
    company_name: Mapped[str] = text(200)
    contact_id: Mapped[str | None] = ref("contacts")
    contact_name: Mapped[str] = text(160)
    contact_phone: Mapped[str] = text(30)
    contact_email: Mapped[str] = text(254)
    source: Mapped[str] = text(40)
    category: Mapped[str] = text(60)
    sub_category: Mapped[str] = text(60)
    product_id: Mapped[str | None] = ref("products")
    project_id: Mapped[str | None] = ref("projects")
    contract_id: Mapped[str | None] = ref("contracts")
    deal_id: Mapped[str | None] = ref("deals")
    priority: Mapped[str] = mapped_column(String(10), default="Medium", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="New", nullable=False, index=True)
    assigned_staff: Mapped[str | None] = person()
    support_team: Mapped[str] = text(80)
    due_date: Mapped[datetime | None] = stamp()
    sla_status: Mapped[str] = text(12)
    created_date: Mapped[date | None] = day()
    updated_date: Mapped[date | None] = day()
    __table_args__ = (Index("ix_tickets_branch_status", "branch", "status"), Index("ix_tickets_staff_status", "assigned_staff", "status"))
