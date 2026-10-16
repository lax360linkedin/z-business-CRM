"""AI Insights: prioritised, explained findings computed from the live records the caller may see.

These are business rules over real data (follow-ups gone cold, stalled and slipping deals, the weighted pipeline, win-rate trend, channel conversion, overdue money, support deadlines,
contracts about to lapse) - not a language model, and the screen says so. Every number is computed here, inside the caller's branch (the session filters it) and record scope
(Own / Team / Organization, the same rules as the module screens), and only for modules the caller may open. An insight can name an n8n event (`automation`) so an administrator's
workflow can act on it; `run_insight` sends exactly what was computed here, never what a browser claims."""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.models import Contract, Deal, Invoice, Lead, Quotation, Task, Ticket
from app.services import billing, data_scope, flows, reports

# insight key -> label; these (and only these) can be handed to an n8n workflow as `insight.<key>`
AUTOMATABLE = {
    "hot_leads": "Hot leads to contact", "overdue_followups": "Overdue lead follow-ups", "stalled_deals": "Stalled deals", "slipping_deals": "Deals past their closing date",
    "overdue_invoices": "Overdue invoices", "quotes_waiting": "Quotations waiting for a reply", "sla_risk": "Support tickets at risk", "contracts_expiring": "Contracts expiring soon",
    "overdue_tasks": "Overdue tasks",
}
SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2, "positive": 3}
OPEN_LEAD = ("New", "Contacted", "Qualified")
OPEN_TICKET_DONE = ("Resolved", "Closed", "Cancelled")
TASK_DONE = ("Completed", "Cancelled")
STALE_DAYS = 14
QUOTE_WAIT_DAYS = 7
MAX_ITEMS = 5
OPEN_DEAL = tuple(s for s in flows.DEAL_STAGES if s not in flows.CLOSED_DEAL_STAGES)


def _where(condition, extra):
    return condition if extra is None else condition & extra


def _money(value) -> float:
    return round(float(value or 0), 2)


def _insight(key: str, category: str, severity: str, title: str, summary: str, *, metric=None, items=None, action=None, impact: float = 0, total: int | None = None) -> dict:
    return {"key": key, "category": category, "severity": severity, "title": title, "summary": summary, "metric": metric, "items": items or [], "total": total if total is not None else len(items or []),
            "action": action, "automation": f"insight.{key}" if key in AUTOMATABLE else None, "impact": impact}


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _pct(part: float, whole: float) -> float | None:
    return round(part * 100 / whole, 1) if whole else None


def compute(db: Session, p: Principal, limit: int = MAX_ITEMS) -> dict:
    today = date.today()
    now = datetime.now(UTC)
    insights: list[dict] = []
    kpis: list[dict] = []
    charts: dict = {"scoreBuckets": [], "pipelineByStage": [], "sources": [], "revenue": []}
    scope = {"branch": p.branch if not p.is_super_admin else None, "records": data_scope.scope_for(p, "Leads")}

    # ---- leads ------------------------------------------------------------------------------------------------------------
    if p.can("Leads", "view"):
        mine = data_scope.owner_filter(p, "Leads", Lead.assigned_to, Lead.created_by)
        open_ = Lead.status.in_(OPEN_LEAD)
        open_count = db.execute(select(func.count()).select_from(Lead).where(_where(open_, mine))).scalar_one()
        # hot leads: high score, still open, not contacted in the last 3 days
        hot_cond = open_ & (Lead.score >= 70) & ((Lead.last_contacted_date.is_(None)) | (Lead.last_contacted_date <= today - timedelta(days=3)))
        hot_total = db.execute(select(func.count()).select_from(Lead).where(_where(hot_cond, mine))).scalar_one()
        hot = db.execute(select(Lead).where(_where(hot_cond, mine)).order_by(Lead.score.desc(), Lead.created_at).limit(limit)).scalars().all()
        if hot_total:
            insights.append(_insight("hot_leads", "Sales", "warning", "High-scoring leads are waiting", f"{_plural(hot_total, 'open lead')} scored 70+ and none contacted in the last 3 days. Warm leads cool quickly - reach out first to these.",
                                     metric={"label": "Hot leads", "value": hot_total}, total=hot_total, impact=hot_total * 3,
                                     items=[{"id": l.id, "type": "lead", "label": l.name, "detail": f"{l.company or 'No company'} · score {l.score}" + (f" · last contact {l.last_contacted_date.isoformat()}" if l.last_contacted_date else " · never contacted"), "to": f"/leads/{l.id}"} for l in hot],
                                     action={"label": "Open leads", "to": "/leads"}))
        overdue_cond = open_ & Lead.next_follow_up.is_not(None) & (Lead.next_follow_up < today)
        overdue_total = db.execute(select(func.count()).select_from(Lead).where(_where(overdue_cond, mine))).scalar_one()
        overdue = db.execute(select(Lead).where(_where(overdue_cond, mine)).order_by(Lead.next_follow_up).limit(limit)).scalars().all()
        if overdue_total:
            oldest = (today - overdue[0].next_follow_up).days if overdue else 0
            insights.append(_insight("overdue_followups", "Sales", "critical" if overdue_total >= 10 or oldest >= 14 else "warning", "Lead follow-ups are overdue",
                                     f"{_plural(overdue_total, 'lead has', 'leads have')} a follow-up date that has passed; the oldest is {_plural(oldest, 'day')} late. Missed follow-ups are the most common reason leads go cold.",
                                     metric={"label": "Overdue", "value": overdue_total}, total=overdue_total, impact=overdue_total * 4 + oldest,
                                     items=[{"id": l.id, "type": "lead", "label": l.name, "detail": f"due {l.next_follow_up.isoformat()} · {(today - l.next_follow_up).days} days late", "to": f"/leads/{l.id}"} for l in overdue],
                                     action={"label": "Review follow-ups", "to": "/leads"}))
        week = today - timedelta(days=7)
        new_now = db.execute(select(func.count()).select_from(Lead).where(_where(Lead.created_date > week, mine))).scalar_one()
        new_prev = db.execute(select(func.count()).select_from(Lead).where(_where((Lead.created_date > week - timedelta(days=7)) & (Lead.created_date <= week), mine))).scalar_one()
        if new_now + new_prev >= 4 and new_prev:
            change = round((new_now - new_prev) * 100 / new_prev)
            if change <= -30:
                insights.append(_insight("lead_inflow_down", "Marketing", "warning", "New lead inflow is slowing", f"{_plural(new_now, 'lead')} arrived in the last 7 days against {new_prev} the week before ({change}%). Check campaigns and lead sources.",
                                         metric={"label": "vs last week", "value": f"{change}%"}, impact=abs(change) / 4, action={"label": "Open lead sources", "to": "/lead-sources"}))
            elif change >= 30:
                insights.append(_insight("lead_inflow_up", "Marketing", "positive", "New lead inflow is up", f"{_plural(new_now, 'lead')} arrived in the last 7 days against {new_prev} the week before (+{change}%). Make sure they are assigned and contacted quickly.",
                                         metric={"label": "vs last week", "value": f"+{change}%"}, impact=change / 6, action={"label": "Open leads", "to": "/leads"}))
        # channel performance
        rows = db.execute(select(Lead.source, func.count(), func.sum(case((Lead.status == "Converted", 1), else_=0))).where(_where(Lead.source != "", mine)).group_by(Lead.source)).all()
        sources = [{"source": s, "leads": n, "converted": int(c or 0), "rate": _pct(int(c or 0), n) or 0.0} for s, n, c in rows if s]
        charts["sources"] = sorted(sources, key=lambda r: -r["leads"])[:8]
        solid = [s for s in sources if s["leads"] >= 5]
        if len(solid) >= 2:
            best, worst = max(solid, key=lambda s: s["rate"]), min(solid, key=lambda s: s["rate"])
            if best["rate"] > 0 and best["source"] != worst["source"]:
                insights.append(_insight("best_source", "Marketing", "info", "Your strongest lead channel", f"{best['source']} converts {best['rate']:.0f}% of its {best['leads']} leads" + (f", while {worst['source']} converts {worst['rate']:.0f}% of {worst['leads']}" if worst["rate"] < best["rate"] else "") + ". Shift effort towards what converts.",
                                         metric={"label": best["source"], "value": f"{best['rate']:.0f}%"}, impact=best["rate"] / 5, action={"label": "View lead sources", "to": "/lead-sources"}))
        buckets = [0] * 5
        for (score,) in db.execute(select(Lead.score).where(_where(open_, mine))).all():
            buckets[min(4, max(0, (int(score or 0) - 1) // 20))] += 1
        charts["scoreBuckets"] = [{"range": r, "count": c} for r, c in zip(("0-20", "21-40", "41-60", "61-80", "81-100"), buckets, strict=True)]
        kpis.append({"key": "open_leads", "label": "Open leads", "value": open_count, "format": "number", "hint": f"{overdue_total} overdue follow-up{'s' if overdue_total != 1 else ''}", "tone": "rose" if overdue_total else "emerald", "to": "/leads"})

    # ---- deals ------------------------------------------------------------------------------------------------------------
    if p.can("Deals", "view"):
        mine = data_scope.owner_filter(p, "Deals", Deal.salesperson, Deal.created_by)
        open_ = Deal.stage.in_(OPEN_DEAL)
        stage_rows = db.execute(select(Deal.stage, func.count(), func.coalesce(func.sum(Deal.value), 0), func.coalesce(func.sum(Deal.value * Deal.probability / 100.0), 0)).where(_where(open_, mine)).group_by(Deal.stage)).all()
        by_stage = {s: (n, _money(v), _money(w)) for s, n, v, w in stage_rows}
        charts["pipelineByStage"] = [{"stage": s, "count": by_stage[s][0], "value": by_stage[s][1], "weighted": by_stage[s][2]} for s in OPEN_DEAL if s in by_stage]
        pipe_count, pipe_value, weighted = sum(v[0] for v in by_stage.values()), sum(v[1] for v in by_stage.values()), sum(v[2] for v in by_stage.values())
        kpis.append({"key": "pipeline", "label": "Open pipeline", "value": _money(pipe_value), "format": "currency", "hint": f"{_plural(pipe_count, 'open deal')}", "tone": "brand", "to": "/pipeline"})
        kpis.append({"key": "forecast", "label": "Weighted forecast", "value": _money(weighted), "format": "currency", "hint": "value × stage probability", "tone": "violet", "to": "/pipeline"})
        stale_cond = open_ & (Deal.updated_at < now - timedelta(days=STALE_DAYS))
        stale_total, stale_value = db.execute(select(func.count(), func.coalesce(func.sum(Deal.value), 0)).where(_where(stale_cond, mine))).one()
        stale = db.execute(select(Deal).where(_where(stale_cond, mine)).order_by(Deal.value.desc()).limit(limit)).scalars().all()
        if stale_total:
            insights.append(_insight("stalled_deals", "Sales", "warning", "Deals with no recent activity", f"{_plural(stale_total, 'open deal has', 'open deals have')} not been touched for {STALE_DAYS}+ days, together worth ₹{_money(stale_value):,.0f}. Stalled deals rarely close without a push.",
                                     metric={"label": "Value at stake", "value": _money(stale_value), "format": "currency"}, total=stale_total, impact=float(stale_value) / 10000 + stale_total,
                                     items=[{"id": d.id, "type": "deal", "label": d.name, "detail": f"{d.stage} · ₹{_money(d.value):,.0f} · last change {d.updated_at.date().isoformat()}", "to": f"/deals/{d.id}"} for d in stale], action={"label": "Open pipeline", "to": "/pipeline"}))
        late_cond = open_ & Deal.expected_closing_date.is_not(None) & (Deal.expected_closing_date < today)
        late_total, late_value = db.execute(select(func.count(), func.coalesce(func.sum(Deal.value), 0)).where(_where(late_cond, mine))).one()
        late = db.execute(select(Deal).where(_where(late_cond, mine)).order_by(Deal.expected_closing_date).limit(limit)).scalars().all()
        if late_total:
            insights.append(_insight("slipping_deals", "Sales", "critical" if late_total >= 3 else "warning", "Deals are past their expected closing date",
                                     f"{_plural(late_total, 'open deal is', 'open deals are')} past the expected closing date (₹{_money(late_value):,.0f} in total). Update the date or move the stage so the forecast stays honest.",
                                     metric={"label": "Past due", "value": late_total}, total=late_total, impact=float(late_value) / 8000 + late_total * 2,
                                     items=[{"id": d.id, "type": "deal", "label": d.name, "detail": f"{d.stage} · expected {d.expected_closing_date.isoformat()} · ₹{_money(d.value):,.0f}", "to": f"/deals/{d.id}"} for d in late], action={"label": "Open deals", "to": "/deals"}))
        # win rate: the last 90 days against the 90 before
        def won_lost(start, end):
            r = db.execute(select(func.sum(case((Deal.stage == "Closed Won", 1), else_=0)), func.sum(case((Deal.stage.in_(flows.LOST_DEAL_STAGES), 1), else_=0))).where(_where(Deal.closed_at >= start, mine), Deal.closed_at < end)).one()
            return int(r[0] or 0), int(r[1] or 0)
        w1, l1 = won_lost(now - timedelta(days=90), now + timedelta(days=1))
        w0, l0 = won_lost(now - timedelta(days=180), now - timedelta(days=90))
        rate = _pct(w1, w1 + l1)
        prev = _pct(w0, w0 + l0)
        kpis.append({"key": "win_rate", "label": "Win rate (90 days)", "value": rate, "format": "percent", "hint": f"{w1} won · {l1} lost" + (f" · was {prev:.0f}%" if prev is not None else ""), "tone": "emerald", "to": "/deals"})
        if rate is not None and w1 + l1 >= 5 and prev is not None and w0 + l0 >= 5:
            if rate <= prev - 10:
                insights.append(_insight("win_rate_down", "Sales", "warning", "Win rate has dropped", f"You won {rate:.0f}% of closed deals in the last 90 days, down from {prev:.0f}% before. Review recent lost reasons.", metric={"label": "Win rate", "value": f"{rate:.0f}%"}, impact=prev - rate, action={"label": "See sales reports", "to": "/reports"}))
            elif rate >= prev + 10:
                insights.append(_insight("win_rate_up", "Sales", "positive", "Win rate is improving", f"You won {rate:.0f}% of closed deals in the last 90 days, up from {prev:.0f}% before. Keep doing what changed.", metric={"label": "Win rate", "value": f"{rate:.0f}%"}, impact=rate - prev, action={"label": "See sales reports", "to": "/reports"}))
        # closing this month
        month_end = (today.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        soon = db.execute(select(func.count(), func.coalesce(func.sum(Deal.value), 0)).where(_where(open_ & (Deal.expected_closing_date >= today) & (Deal.expected_closing_date <= month_end), mine))).one()
        if soon[0]:
            insights.append(_insight("closing_this_month", "Sales", "info", "Deals due to close this month", f"{_plural(soon[0], 'open deal')} (₹{_money(soon[1]):,.0f}) {'is' if soon[0] == 1 else 'are'} expected to close by {month_end.isoformat()}. Confirm next steps with each owner.", metric={"label": "Expected", "value": _money(soon[1]), "format": "currency"}, impact=float(soon[1]) / 20000, action={"label": "Open pipeline", "to": "/pipeline"}))

    # ---- quotations -------------------------------------------------------------------------------------------------------
    if p.can("Quotations", "view"):
        mine = data_scope.owner_filter(p, "Quotations", Quotation.assigned_to, Quotation.created_by)
        wait_cond = Quotation.status.in_(("Sent", "Viewed", "Negotiation")) & (Quotation.created_date <= today - timedelta(days=QUOTE_WAIT_DAYS))
        total, value = db.execute(select(func.count(), func.coalesce(func.sum(Quotation.amount), 0)).where(_where(wait_cond, mine))).one()
        rows = db.execute(select(Quotation).where(_where(wait_cond, mine)).order_by(Quotation.amount.desc()).limit(limit)).scalars().all()
        if total:
            insights.append(_insight("quotes_waiting", "Sales", "warning", "Quotations are waiting for a reply", f"{_plural(total, 'quotation')} worth ₹{_money(value):,.0f} {'was' if total == 1 else 'were'} sent over {QUOTE_WAIT_DAYS} days ago without a decision. A friendly nudge often unblocks them.",
                                     metric={"label": "Waiting", "value": _money(value), "format": "currency"}, total=total, impact=float(value) / 10000 + total,
                                     items=[{"id": q.id, "type": "quotation", "label": q.number or q.id, "detail": f"{q.customer_name or 'Customer'} · {q.status} · ₹{_money(q.amount):,.0f}", "to": f"/quotations/{q.id}"} for q in rows], action={"label": "Open quotations", "to": "/quotations"}))

    # ---- finance ----------------------------------------------------------------------------------------------------------
    if p.can("Invoices", "view"):
        mine = billing.invoice_scope(p)
        due = Invoice.status == "Overdue"
        total, outstanding = db.execute(select(func.count(), func.coalesce(func.sum(Invoice.amount - Invoice.paid_amount), 0)).where(_where(due, mine))).one()
        rows = db.execute(select(Invoice).where(_where(due, mine)).order_by(Invoice.due_date).limit(limit)).scalars().all()
        kpis.append({"key": "overdue_money", "label": "Overdue invoices", "value": _money(outstanding), "format": "currency", "hint": _plural(total, "invoice") + " overdue", "tone": "rose" if total else "emerald", "to": "/invoices"})
        if total:
            oldest = (today - rows[0].due_date).days if rows and rows[0].due_date else 0
            insights.append(_insight("overdue_invoices", "Finance", "critical", "Money is overdue", f"{_plural(total, 'invoice is', 'invoices are')} overdue with ₹{_money(outstanding):,.0f} outstanding; the oldest by {_plural(oldest, 'day')}. Chase the largest first.",
                                     metric={"label": "Outstanding", "value": _money(outstanding), "format": "currency"}, total=total, impact=float(outstanding) / 5000 + oldest,
                                     items=[{"id": i.id, "type": "invoice", "label": i.number, "detail": f"{i.customer_name or 'Customer'} · ₹{_money(i.amount - i.paid_amount):,.0f} due {i.due_date.isoformat() if i.due_date else '—'}", "to": f"/invoices/{i.id}"} for i in rows], action={"label": "Open invoices", "to": "/invoices"}))
        soon_cond = Invoice.status.in_(("Sent", "Viewed", "Partially Paid")) & (Invoice.due_date >= today) & (Invoice.due_date <= today + timedelta(days=7))
        n, value = db.execute(select(func.count(), func.coalesce(func.sum(Invoice.amount - Invoice.paid_amount), 0)).where(_where(soon_cond, mine))).one()
        if n:
            insights.append(_insight("invoices_due_soon", "Finance", "info", "Invoices fall due this week", f"{_plural(n, 'invoice')} (₹{_money(value):,.0f}) {'falls' if n == 1 else 'fall'} due in the next 7 days. A reminder now avoids chasing later.", metric={"label": "Due in 7 days", "value": _money(value), "format": "currency"}, impact=float(value) / 15000, action={"label": "Open invoices", "to": "/invoices"}))
    if any(p.can(m, "view") for m in ("Payments", "Invoices", "Finance Reports", "Sales Reports")):
        series = reports.monthly_performance(db, p, 7)
        charts["revenue"] = [{"month": r["month"], "revenue": r["revenue"] or 0, "target": r["target"]} for r in series]
        last, prev = series[-1], series[-2]
        if last["revenue"] is not None and prev["revenue"]:
            change = (last["revenue"] - prev["revenue"]) * 100 / prev["revenue"]
            if abs(change) >= 10:
                insights.append(_insight("revenue_trend", "Finance", "positive" if change > 0 else "warning", f"Revenue is {'up' if change > 0 else 'down'} {abs(change):.0f}% on last month", f"{last['month']} collections are ₹{_money(last['revenue']):,.0f} against ₹{_money(prev['revenue']):,.0f} in {prev['month']}." + (" Understand what drove it so it can repeat." if change > 0 else " Look at overdue invoices and the deals due to close."),
                                         metric={"label": last["month"], "value": _money(last["revenue"]), "format": "currency"}, impact=abs(change) / 3, action={"label": "Finance reports", "to": "/reports"}))

    # ---- support ----------------------------------------------------------------------------------------------------------
    if p.can("Helpdesk / Tickets", "view"):
        mine = data_scope.owner_filter(p, "Tickets", Ticket.assigned_staff, Ticket.created_by)
        open_ = Ticket.status.notin_(OPEN_TICKET_DONE)
        open_n = db.execute(select(func.count()).select_from(Ticket).where(_where(open_, mine))).scalar_one()
        risk_cond = open_ & Ticket.due_date.is_not(None) & (Ticket.due_date < now + timedelta(hours=8))
        total = db.execute(select(func.count()).select_from(Ticket).where(_where(risk_cond, mine))).scalar_one()
        rows = db.execute(select(Ticket).where(_where(risk_cond, mine)).order_by(Ticket.due_date).limit(limit)).scalars().all()
        kpis.append({"key": "open_tickets", "label": "Open tickets", "value": open_n, "format": "number", "hint": f"{total} at or past SLA", "tone": "rose" if total else "sky", "to": "/tickets"})
        if total:
            breached = sum(1 for t in rows if (t.due_date if t.due_date.tzinfo else t.due_date.replace(tzinfo=UTC)) < now)
            insights.append(_insight("sla_risk", "Support", "critical" if breached else "warning", "Support tickets need attention", f"{_plural(total, 'open ticket')} {'has' if total == 1 else 'have'} breached or will breach the service deadline within 8 hours. Breached SLAs hurt customer trust.",
                                     metric={"label": "At risk", "value": total}, total=total, impact=total * 3 + breached * 3,
                                     items=[{"id": t.id, "type": "ticket", "label": t.subject, "detail": f"{t.customer_name or 'Customer'} · {t.priority} · due {t.due_date.strftime('%d %b %H:%M')}", "to": f"/tickets/{t.id}"} for t in rows], action={"label": "Open tickets", "to": "/tickets"}))

    # ---- operations -------------------------------------------------------------------------------------------------------
    if p.can("Contracts", "view"):
        end_cond = Contract.status.in_(("Active", "Signed", "Expiring Soon")) & Contract.end_date.is_not(None) & (Contract.end_date >= today) & (Contract.end_date <= today + timedelta(days=30))
        total, value = db.execute(select(func.count(), func.coalesce(func.sum(Contract.value), 0)).where(end_cond)).one()
        rows = db.execute(select(Contract).where(end_cond).order_by(Contract.end_date).limit(limit)).scalars().all()
        if total:
            insights.append(_insight("contracts_expiring", "Operations", "warning", "Contracts expire within 30 days", f"{_plural(total, 'contract')} worth ₹{_money(value):,.0f} {'ends' if total == 1 else 'end'} in the next 30 days. Start renewals now to avoid a gap.",
                                     metric={"label": "Contract value", "value": _money(value), "format": "currency"}, total=total, impact=float(value) / 10000 + total * 2,
                                     items=[{"id": c.id, "type": "contract", "label": c.title or c.number, "detail": f"{c.customer_name or 'Customer'} · ends {c.end_date.isoformat()} · ₹{_money(c.value):,.0f}", "to": f"/contracts/{c.id}"} for c in rows], action={"label": "Open contracts", "to": "/contracts"}))
    if p.can("Tasks", "view"):
        mine = data_scope.owner_filter(p, "Tasks", Task.assigned_to, Task.created_by)
        cond = Task.status.notin_(TASK_DONE) & Task.due_date.is_not(None) & (Task.due_date < today)
        total = db.execute(select(func.count()).select_from(Task).where(_where(cond, mine))).scalar_one()
        rows = db.execute(select(Task).where(_where(cond, mine)).order_by(Task.due_date).limit(limit)).scalars().all()
        if total:
            insights.append(_insight("overdue_tasks", "Operations", "warning" if total < 10 else "critical", "Tasks are overdue", f"{_plural(total, 'task is', 'tasks are')} past due. Reassign or reschedule so nothing is silently dropped.", metric={"label": "Overdue", "value": total}, total=total, impact=total * 1.5,
                                     items=[{"id": t.id, "type": "task", "label": t.title, "detail": f"due {t.due_date.isoformat()} · {t.priority}", "to": f"/tasks/{t.id}"} for t in rows], action={"label": "Open tasks", "to": "/tasks"}))

    insights.sort(key=lambda i: (SEVERITY_RANK[i["severity"]], -i["impact"]))
    counts = {s: sum(1 for i in insights if i["severity"] == s) for s in SEVERITY_RANK}
    return {"generatedAt": datetime.now(UTC).isoformat(), "scope": scope, "method": "Business rules over your live CRM data (no external AI service).", "kpis": kpis, "insights": insights, "charts": charts, "counts": counts}


def find(db: Session, p: Principal, key: str, limit: int = 25) -> dict | None:
    """One insight with up to `limit` items (used when an insight is handed to an n8n workflow)."""
    return next((i for i in compute(db, p, limit)["insights"] if i["key"] == key), None)
