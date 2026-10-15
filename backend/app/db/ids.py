"""Gap-free counters for record ids (LD-0001) and yearly business numbers (INV-2026-0001); atomic on PostgreSQL and SQLite."""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.system import Counter


def next_value(db: Session, key: str) -> int:
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert(Counter).values(key=key, value=1).on_conflict_do_update(index_elements=[Counter.key], set_={"value": Counter.value + 1}).returning(Counter.value)
    return db.execute(stmt).scalar_one()


def org_year() -> int:
    return datetime.now(ZoneInfo(get_settings().org_timezone)).year


def new_id(db: Session, prefix: str, width: int = 4) -> str:
    return f"{prefix}-{next_value(db, f'id:{prefix}'):0{width}d}"


def new_number(db: Session, prefix: str, year: int | None = None, width: int = 4) -> str:
    year = year or org_year()
    return f"{prefix}-{year}-{next_value(db, f'no:{prefix}:{year}'):0{width}d}"
