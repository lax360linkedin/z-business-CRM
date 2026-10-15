"""Aggregates for the Dashboard, Reports and AI Insights screens, computed from the real records inside the caller's branch scope (the session filters branched tables)."""
import calendar
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.models import AppSetting, Customer, Deal, Lead, Payment
from app.services import marketing, pricing


def _month_keys(count: int, today: date) -> list[str]:
    y, m = today.year, today.month
    keys: list[str] = []
    for _ in range(count):
        keys.insert(0, f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return keys


def monthly_performance(db: Session, p: Principal, months: int = 12) -> list[dict]:
    """One row per month for the last `months` months: revenue collected (net of refunds), the revenue target, deals won, leads created, customers in total."""
    months = max(1, min(int(months), 36))
    today = date.today()
    keys = _month_keys(months, today)
    first = date(int(keys[0][:4]), int(keys[0][5:]), 1)
    can_see_money = any(p.can(m, "view") for m in ("Payments", "Invoices", "Finance Reports", "Sales Reports"))
    revenue = {k: 0.0 for k in keys}
    if can_see_money:
        for pay in db.execute(select(Payment).where(Payment.date >= first)).scalars():
            if pay.status in marketing.COUNTED_PAYMENT and pay.date:
                key = pay.date.isoformat()[:7]
                if key in revenue:
                    revenue[key] += pricing.payment_net(pay.status, pay.amount, pay.refunded_amount)
    won = {k: 0 for k in keys}
    for (closed,) in db.execute(select(Deal.closed_at).where(Deal.stage == "Closed Won", Deal.closed_at.is_not(None), Deal.closed_at >= datetime(first.year, first.month, first.day, tzinfo=UTC))).all():
        key = closed.date().isoformat()[:7]
        if key in won:
            won[key] += 1
    leads = {k: 0 for k in keys}
    for (created,) in db.execute(select(Lead.created_date).where(Lead.created_date >= first)).all():
        key = created.isoformat()[:7] if created else None
        if key in leads:
            leads[key] += 1
    since = [s for (s,) in db.execute(select(Customer.since)).all() if s]
    row = db.get(AppSetting, "sales_targets")
    target = float((row.value or {}).get("monthlyRevenue") or 0) if row else 0.0
    out = []
    for k in keys:
        end = date(int(k[:4]), int(k[5:]), calendar.monthrange(int(k[:4]), int(k[5:]))[1])
        out.append({"key": k, "month": calendar.month_abbr[int(k[5:])], "revenue": round(revenue[k], 2) if can_see_money else None, "target": target or None, "deals": won[k], "leads": leads[k],
                    "customers": sum(1 for s in since if s <= end)})
    return out
