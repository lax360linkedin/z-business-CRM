from datetime import date

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BranchedMixin, RecordMixin
from app.models.columns import count, day, money, person, ref, text


class Campaign(RecordMixin, BranchedMixin, Base):
    __tablename__ = "campaigns"
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = text(60)
    channel: Mapped[str] = text(60)
    status: Mapped[str] = mapped_column(String(12), default="Draft", nullable=False, index=True)
    start_date: Mapped[date | None] = day()
    end_date: Mapped[date | None] = day()
    budget: Mapped[float] = money()
    target_audience: Mapped[str] = text(400)
    description: Mapped[str] = text(4000)
    owner_id: Mapped[str | None] = person()
    lead_source_id: Mapped[str | None] = ref("lead_sources")
    target_leads: Mapped[int] = count()
