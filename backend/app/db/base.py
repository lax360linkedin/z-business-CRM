"""Declarative base, shared column types and mixins.

* every constraint / index gets a stable name (keeps Alembic diffs deterministic);
* `RecordMixin`  - string business id (e.g. LD-1001), JSON `attributes` for the long tail of fields, audit timestamps;
* `BranchedMixin` - a `branch` column (FK to branches.name). Reads of any branched table are filtered to the caller's branch and new rows are stamped with it - see db/branch.py.
"""
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, MetaData, String, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes on every database (SQLite drops the zone; PostgreSQL keeps it)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


JsonType = JSON().with_variant(JSONB(), "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)


class RecordMixin(TimestampMixin):
    """A business record: string id, free-form `attributes` for fields that are not columns, who created it."""

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    attributes: Mapped[dict] = mapped_column(JsonType, default=dict, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)


class BranchedMixin:
    @declared_attr
    def branch(cls) -> Mapped[str | None]:  # noqa: N805
        return mapped_column(String(40), ForeignKey("branches.name", onupdate="CASCADE", ondelete="RESTRICT"), nullable=True, index=True)
