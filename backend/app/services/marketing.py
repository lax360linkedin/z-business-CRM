"""Marketing: campaigns (lifecycle, spend, attribution), the lead-source master and marketing analytics.

A campaign's results are NEVER stored: leads, deals, customers, invoiced and collected revenue are computed from the real CRM records through the attribution ids
(campaignId / leadSourceId) that travel Lead -> Deal -> Customer and, from there, to invoices and payments. Attribution is never overwritten (historical attribution stays).
Status changes happen only through their action; financial figures are removed for roles without the financial capability."""
import calendar
import csv
import io
import re
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db import ids
from app.models.crm import source_key
from app.models import Campaign, Company, Contact, Customer, Deal, Employee, Enquiry, Expense, Invoice, Lead, LeadSource, Payment, Product, User
from app.services import audit, lead_sources as ls, tasks as task_svc, timeline
from app.services.codec import to_json

CAMPAIGN_STATUSES = ["Draft", "Scheduled", "Active", "Paused", "Completed", "Cancelled"]
CAMPAIGN_TYPES = ["Email Marketing", "Social Media", "Paid Advertising", "Search Ads", "Webinar / Event", "Content Marketing", "Referral Program", "Outbound / Outreach", "Partner / Channel", "Offline / Print"]
SOURCE_ALIASES = ls.SOURCE_ALIASES

MARKETING_PERMISSIONS = [["viewCampaigns", "View campaigns"], ["createCampaign", "Create campaigns"], ["editCampaign", "Edit campaigns"], ["deleteDraft", "Delete draft campaigns"],
                         ["runCampaign", "Start / pause / complete campaigns"], ["viewSources", "View lead sources"], ["manageSources", "Manage lead sources"], ["viewAnalytics", "View marketing analytics"],
                         ["export", "Export marketing reports"], ["viewFinancial", "View financial marketing data"]]
_ALL = [k for k, _ in MARKETING_PERMISSIONS]
_OVERSIGHT = ["viewCampaigns", "viewSources", "viewAnalytics", "export", "viewFinancial"]
MARKETING_ROLE_CAPS = {"Super Admin": _ALL, "Admin": _ALL, "Marketing": _ALL, "MD": _OVERSIGHT, "CEO": _OVERSIGHT, "Accounts": _OVERSIGHT,
                       "Sales Manager": ["viewCampaigns", "viewSources", "viewAnalytics"], "Sales Executive": ["viewCampaigns", "viewSources"]}
FIN_KEYS = ("budget", "spend", "costPerLead", "costPerCustomer", "roi", "invoiced", "collected", "outstanding", "refunded", "dealValue", "wonValue", "revenue", "costs")
ISSUED = ("Sent", "Viewed", "Partially Paid", "Paid", "Overdue")
COUNTED_PAYMENT = ("Completed", "Partially Refunded")
COST_STATUSES = ("Approved", "Paid", "Reimbursed")
QUALIFIED = ("Qualified", "Converted")


def round2(n) -> float:
    return round((float(n) if n not in (None, "") else 0.0) * 100) / 100


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def today_key() -> str:
    return date.today().isoformat()


def day_of(v) -> str:
    return str(v or "")[:10]


def clean(v, limit: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(v if v is not None else "")).strip()[:limit]


def role_of(p: Principal) -> str:
    return "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)


def perms_of(p: Principal) -> dict:
    caps = set(MARKETING_ROLE_CAPS.get(role_of(p), []))
    return {
        "viewCampaigns": "viewCampaigns" in caps and p.can("Campaigns", "view"), "createCampaign": "createCampaign" in caps and p.can("Campaigns", "create"),
        "editCampaign": "editCampaign" in caps and p.can("Campaigns", "edit"), "deleteDraft": "deleteDraft" in caps and p.can("Campaigns", "delete"),
        "runCampaign": "runCampaign" in caps and p.can("Campaigns", "edit"), "viewSources": "viewSources" in caps and p.can("Lead Sources", "view"),
        "manageSources": "manageSources" in caps and p.can("Lead Sources", "edit"), "viewAnalytics": "viewAnalytics" in caps and p.can("Marketing Analytics", "view"),
        "export": "export" in caps and (p.can("Marketing Analytics", "export") or p.can("Campaigns", "export")), "viewFinancial": "viewFinancial" in caps,
    }


def campaign_actions(c: Campaign) -> dict:
    s = c.status
    return {"editAll": s == "Draft", "edit": s not in ("Completed", "Cancelled"), "schedule": s == "Draft", "start": s in ("Draft", "Scheduled"), "pause": s == "Active", "resume": s == "Paused",
            "complete": s in ("Active", "Paused"), "cancel": s in ("Draft", "Scheduled", "Active", "Paused"), "deleteDraft": s == "Draft", "recordSpend": s in ("Active", "Paused", "Completed")}


def denied(db: Session, p: Principal, action: str, why: str, record_id: str | None = None):
    audit.record(db, user=p.user, action=f"Denied: {action}", module="Marketing", record_id=record_id, result="Denied", details=why, info=p.info)
    db.commit()
    raise forbidden(why)


def log(db: Session, p: Principal, action: str, record_id: str | None, details: str = "") -> None:
    audit.record(db, user=p.user, action=action, module="Marketing", record_id=record_id, details=details, info=p.info)


# ---- attribution ---------------------------------------------------------------------------------------------------------
def _norm(s) -> str:
    return str(s or "").strip().lower()


def source_visible(db: Session):
    """SQL condition: the lead sources the current session may use - shared ones (no branch) plus those of its own branch. None = no restriction (a Super Admin looking at all branches)."""
    from app.db.branch import get_scope

    scope = get_scope(db)
    if scope is None or scope.read is None:
        return None
    return (LeadSource.branch.is_(None)) | (LeadSource.branch == scope.read)


def visible_sources(db: Session):
    stmt = select(LeadSource)
    cond = source_visible(db)
    return stmt.where(cond) if cond is not None else stmt


def find_source(db: Session, source_id: str | None = None, name: str | None = None) -> LeadSource | None:
    """One source the session may use, by id (authoritative) or, failing that, by name."""
    stmt = visible_sources(db)
    if source_id:
        return db.execute(stmt.where(LeadSource.id == source_id)).scalar_one_or_none()
    if name:
        for key in (source_key(name), source_key(SOURCE_ALIASES.get(name, name))):  # the exact name first; an older wording only when nothing carries it
            found = db.execute(stmt.where(LeadSource.name_key == key).order_by(LeadSource.branch.is_(None))).scalars().first()
            if found is not None:
                return found
    return None


def check_source(db: Session, obj, *, changed: bool = True, by_name: bool = False) -> None:
    """A lead / enquiry may only name a source that is configured, active and available in its branch; the id and the name are then kept in step. Untouched values are left alone.
    `by_name`: the person just changed the NAME, so it decides (otherwise the id, which is authoritative, does)."""
    if not changed or not (getattr(obj, "source", "") or getattr(obj, "lead_source_id", None)):
        return
    src = find_source(db, None if by_name else obj.lead_source_id, obj.source if (by_name or not obj.lead_source_id) else None)
    if src is None:
        raise invalid("Choose a lead source from the list: that one is not configured (or not available in this branch).", {"source": "Choose a configured lead source."})
    if not src.active:
        raise invalid(f"The lead source “{src.name}” is inactive.", {"source": "This source is inactive."})
    _snapshot_category(obj, src)
    obj.lead_source_id, obj.source = src.id, src.name


def _snapshot_category(obj, src: LeadSource) -> None:
    """The category the source had when it was attributed is kept on the record, so re-categorising a source later does not rewrite history."""
    if hasattr(obj, "source_category") and (getattr(obj, "lead_source_id", None) != src.id or not obj.source_category):
        obj.source_category = src.category


def apply_attribution(db: Session, obj) -> None:
    """Brings one lead / enquiry / deal / customer onto the attribution ids. Ids are authoritative; names are looked up only when an id is missing; an existing id is never replaced."""
    if not hasattr(obj, "lead_source_id") or not hasattr(obj, "campaign_id"):
        return
    src_name = SOURCE_ALIASES.get(getattr(obj, "source", ""), getattr(obj, "source", ""))
    src = find_source(db, obj.lead_source_id) if obj.lead_source_id else None
    if src is None and src_name:
        src = find_source(db, None, src_name)
    cmp = db.get(Campaign, obj.campaign_id) if obj.campaign_id else None
    campaign_name = getattr(obj, "campaign", "")
    if cmp is None and campaign_name:
        cmp = db.execute(select(Campaign).where(func.lower(Campaign.name) == _norm(campaign_name))).scalars().first()
    if src is None and cmp is not None and cmp.lead_source_id:
        src = db.get(LeadSource, cmp.lead_source_id)
    if src is not None:
        _snapshot_category(obj, src)
        if obj.lead_source_id != src.id:
            obj.lead_source_id = src.id
        if hasattr(obj, "source") and obj.source != src.name:
            obj.source = src.name
    if cmp is not None:
        if obj.campaign_id != cmp.id:
            obj.campaign_id = cmp.id
        if hasattr(obj, "campaign") and obj.campaign != cmp.name:
            obj.campaign = cmp.name


# ---- data & analytics ----------------------------------------------------------------------------------------------------
def dataset(db: Session) -> dict:
    """Every record the analytics need, through the caller's branch scope (the session filters branched tables)."""
    def rows(model):
        return [to_json(r) for r in db.execute(select(model)).scalars()]

    expenses = [{"id": e.id, "campaignId": e.campaign_id, "status": e.status, "cost": task_svc_payable(e)} for e in db.execute(select(Expense).where(Expense.campaign_id.is_not(None))).scalars()]
    users = [{"id": u.employee_id, "department": u.department} for u in db.execute(select(User)).scalars()]
    return {"campaigns": rows(Campaign), "leadSources": [to_json(s) for s in db.execute(visible_sources(db)).scalars()], "leads": rows(Lead), "enquiries": rows(Enquiry), "deals": rows(Deal), "customers": rows(Customer),
            "invoices": rows(Invoice), "payments": rows(Payment), "products": rows(Product), "users": users, "expenses": expenses}


def task_svc_payable(e: Expense) -> float:
    from app.services import expenses as expense_svc

    return expense_svc.payable_of(e) if e.status in COST_STATUSES else 0.0


def payment_net(p: dict) -> float:
    st = p.get("status")
    if st is None or st == "Completed":
        return float(p.get("amount") or 0)
    if st == "Partially Refunded":
        return max(0.0, round2(float(p.get("amount") or 0) - float(p.get("refundedAmount") or 0)))
    return 0.0


def counts_as_payment(p: dict) -> bool:
    return p.get("status") is None or p.get("status") in COUNTED_PAYMENT


def spend_of(c: dict, expenses: list[dict]) -> float:
    manual = sum(float(x.get("amount") or 0) for x in (c.get("costs") or []))
    return round2(manual + sum(float(e.get("cost") or 0) for e in expenses if e.get("campaignId") == c["id"] and e.get("status") in COST_STATUSES))


def _blank() -> dict:
    return {k: 0 for k in ("enquiries", "leads", "newLeads", "contactedLeads", "qualifiedLeads", "unqualifiedLeads", "lostLeads", "convertedLeads", "deals", "openDeals", "wonDeals", "lostDeals",
                           "dealValue", "wonValue", "customers", "invoiced", "collected", "outstanding", "refunded")}


def with_rates(m: dict, spend=None) -> dict:
    out = dict(m)
    out["conversionRate"] = round2(m["customers"] / m["leads"] * 100) if m["leads"] else 0
    out["qualificationRate"] = round2(m["qualifiedLeads"] / m["leads"] * 100) if m["leads"] else 0
    out["leadToDealRate"] = round2(m["deals"] / m["leads"] * 100) if m["leads"] else 0
    out["winRate"] = round2(m["wonDeals"] / m["deals"] * 100) if m["deals"] else 0
    out["spend"] = spend
    out["costPerLead"] = round2(spend / m["leads"]) if spend and m["leads"] else None
    out["costPerCustomer"] = round2(spend / m["customers"]) if spend and m["customers"] else None
    out["roi"] = round2((m["collected"] - spend) / spend * 100) if spend and spend > 0 else None
    return out


def _in_range(d, f: dict) -> bool:
    k = day_of(d)
    return not (f.get("from") and k < f["from"]) and not (f.get("to") and k > f["to"])


def compute_marketing(data: dict, f: dict | None = None) -> dict:
    f = f or {}
    campaigns, sources = data["campaigns"], data["leadSources"]
    cmp_by_id = {c["id"]: c for c in campaigns}
    user_dept = {u["id"]: u.get("department", "") for u in data["users"]}
    prod_name = {p["id"]: p.get("name") for p in data["products"]}
    cust_by_id = {c["id"]: c for c in data["customers"]}
    deal_by_id = {d["id"]: d for d in data["deals"]}
    team_of = lambda uid: user_dept.get(uid, "")  # noqa: E731

    def campaign_ok(r: dict) -> bool:
        if f.get("campaignId") and r.get("campaignId") != f["campaignId"]:
            return False
        if f.get("leadSourceId") and r.get("leadSourceId") != f["leadSourceId"]:
            return False
        c = cmp_by_id.get(r.get("campaignId")) if r.get("campaignId") else None
        if f.get("channel") and (c or {}).get("channel") != f["channel"]:
            return False
        if f.get("campaignStatus") and (c or {}).get("status") != f["campaignStatus"]:
            return False
        return True

    def prod_ok(r: dict) -> bool:
        if not f.get("product"):
            return True
        return r.get("productId") == f["product"] or bool(r.get("service") and r.get("service") == prod_name.get(f["product"])) or f["product"] in (r.get("productIds") or [])

    def owner_ok(uid) -> bool:
        return (not f.get("owner") or uid == f["owner"]) and (not f.get("team") or team_of(uid) == f["team"])

    leads_f = [lead for lead in data["leads"] if campaign_ok(lead) and _in_range(lead.get("createdDate"), f) and (not f.get("leadStatus") or lead.get("status") == f["leadStatus"]) and owner_ok(lead.get("assignedTo"))
               and prod_ok(lead) and (not f.get("customerId") or lead.get("customerId") == f["customerId"]) and (not f.get("companyId") or lead.get("companyId") == f["companyId"])]
    enq_f = [e for e in data["enquiries"] if campaign_ok(e) and _in_range(e.get("date"), f) and owner_ok(e.get("assignedUser")) and not f.get("leadStatus")]
    deals_f = [d for d in data["deals"] if campaign_ok(d) and _in_range(d.get("createdDate"), f) and (not f.get("dealStage") or d.get("stage") == f["dealStage"]) and owner_ok(d.get("salesperson")) and prod_ok(d)
               and (not f.get("customerId") or d.get("customerId") == f["customerId"]) and (not f.get("companyId") or d.get("companyId") == f["companyId"])]
    cust_f = [c for c in data["customers"] if campaign_ok(c) and (c.get("campaignId") or c.get("leadSourceId")) and _in_range(c.get("since"), f) and (not f.get("customerId") or c["id"] == f["customerId"])
              and (not f.get("companyId") or c.get("companyId") == f["companyId"]) and owner_ok(c.get("accountManager"))]

    def attr_of_invoice(inv: dict):
        d = deal_by_id.get(inv.get("dealId")) if inv.get("dealId") else None
        if d and (d.get("campaignId") or d.get("leadSourceId")):
            return d
        c = cust_by_id.get(inv.get("customerId"))
        return c if c and (c.get("campaignId") or c.get("leadSourceId")) else None

    inv_f = []
    for i in data["invoices"]:
        if i.get("status") not in ISSUED:
            continue
        a = attr_of_invoice(i)
        if a and campaign_ok(a) and (not f.get("customerId") or i.get("customerId") == f["customerId"]) and (not f.get("companyId") or i.get("companyId") == f["companyId"]) and _in_range(i.get("issueDate"), f) \
                and (not f.get("product") or any(x.get("productId") == f["product"] for x in (i.get("items") or []))):
            inv_f.append((i, a))
    inv_ids = {i["id"] for i, _ in inv_f}
    pay_f = [p for p in data["payments"] if p.get("invoiceId") in inv_ids and counts_as_payment(p) and _in_range(p.get("date"), f)]

    groups: dict = {"c": {}, "s": {}, "all": _blank()}

    def bump(rec: dict, fn) -> None:
        fn(groups["all"])
        if rec.get("campaignId"):
            fn(groups["c"].setdefault(rec["campaignId"], _blank()))
        if rec.get("leadSourceId"):
            fn(groups["s"].setdefault(rec["leadSourceId"], _blank()))

    for e in enq_f:
        bump(e, lambda m: m.__setitem__("enquiries", m["enquiries"] + 1))

    def lead_fn(lead):
        def fn(m):
            m["leads"] += 1
            st = lead.get("status")
            m["newLeads"] += st == "New"
            m["contactedLeads"] += st == "Contacted"
            m["qualifiedLeads"] += st in QUALIFIED
            m["unqualifiedLeads"] += st == "Unqualified"
            m["lostLeads"] += st == "Lost"
            m["convertedLeads"] += st == "Converted"
        return fn

    for lead in leads_f:
        bump(lead, lead_fn(lead))

    def deal_fn(d):
        def fn(m):
            m["deals"] += 1
            m["dealValue"] += float(d.get("value") or 0)
            if d.get("stage") == "Closed Won":
                m["wonDeals"] += 1
                m["wonValue"] += float(d.get("value") or 0)
            elif str(d.get("stage") or "").startswith("Closed Lost"):
                m["lostDeals"] += 1
            else:
                m["openDeals"] += 1
        return fn

    for d in deals_f:
        bump(d, deal_fn(d))
    for c in cust_f:
        bump(c, lambda m: m.__setitem__("customers", m["customers"] + 1))
    paid_by: dict = {}
    for p in pay_f:
        paid_by[p["invoiceId"]] = round2(paid_by.get(p["invoiceId"], 0) + payment_net(p))
    for i, a in inv_f:
        paid = paid_by.get(i["id"], 0)

        def inv_fn(m, i=i, paid=paid):
            m["invoiced"] += float(i.get("amount") or 0)
            m["collected"] += paid
            m["outstanding"] += max(0.0, float(i.get("amount") or 0) - float(i.get("paidAmount") or 0))
        bump(a, inv_fn)
    for p in pay_f:
        if p.get("refundedAmount"):
            a = next((a for i, a in inv_f if i["id"] == p["invoiceId"]), None)
            if a:
                bump(a, lambda m, p=p: m.__setitem__("refunded", m["refunded"] + float(p["refundedAmount"])))

    def tidy(m: dict) -> dict:
        return {k: (round2(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v) for k, v in m.items()}

    rows = []
    for c in campaigns:
        if f.get("campaignId") and c["id"] != f["campaignId"]:
            continue
        if f.get("leadSourceId") and c.get("leadSourceId") != f["leadSourceId"]:
            continue
        if f.get("channel") and c.get("channel") != f["channel"]:
            continue
        if f.get("campaignStatus") and c.get("status") != f["campaignStatus"]:
            continue
        if f.get("owner") and c.get("ownerId") != f["owner"]:
            continue
        if f.get("team") and team_of(c.get("ownerId")) != f["team"]:
            continue
        if f.get("product") and f["product"] not in (c.get("productIds") or []):
            continue
        spend = spend_of(c, data["expenses"])
        rows.append({"id": c["id"], "number": c.get("number"), "name": c.get("name"), "status": c.get("status"), "channel": c.get("channel"), "type": c.get("type"), "ownerId": c.get("ownerId"),
                     "leadSourceId": c.get("leadSourceId"), "budget": float(c.get("budget") or 0), "targetLeads": c.get("targetLeads") or 0, "startDate": c.get("startDate"), "endDate": c.get("endDate"),
                     **with_rates(tidy(groups["c"].get(c["id"], _blank())), spend)})
    spend_by_source: dict = {}
    costed: dict = {}
    for c in rows:
        if c["leadSourceId"]:
            spend_by_source[c["leadSourceId"]] = round2(spend_by_source.get(c["leadSourceId"], 0) + c["spend"])
            costed[c["leadSourceId"]] = costed.get(c["leadSourceId"], 0) + c["leads"]
    source_rows = []
    for s in sources:
        if f.get("leadSourceId") and s["id"] != f["leadSourceId"]:
            continue
        spend = spend_by_source.get(s["id"]) or None
        m = with_rates(tidy(groups["s"].get(s["id"], _blank())), spend)
        source_rows.append({"id": s["id"], "name": s.get("name"), "category": s.get("category"), "active": s.get("active"), **m, "costPerLead": round2(spend / costed[s["id"]]) if spend and costed.get(s["id"]) else None})
    total_spend = round2(sum(c["spend"] for c in rows))
    total_budget = round2(sum(c["budget"] for c in rows))
    totals = {**with_rates(tidy(groups["all"]), total_spend or None), "budget": total_budget, "spend": total_spend, "totalCampaigns": len(rows),
              "activeCampaigns": sum(1 for c in rows if c["status"] == "Active"), "completedCampaigns": sum(1 for c in rows if c["status"] == "Completed")}

    # monthly trend: the last 12 months, or the filtered range
    end_key = f["to"][:7] if f.get("to") else today_key()[:7]
    y, m = (int(x) for x in end_key.split("-"))
    start_key = f["from"][:7] if f.get("from") else None
    months: list[str] = []
    for _ in range(12):
        key = f"{y}-{m:02d}"
        if start_key and key < start_key:
            break
        months.insert(0, key)
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    trend = []
    for key in months:
        ls = [x for x in leads_f if day_of(x.get("createdDate"))[:7] == key]
        cs = [x for x in cust_f if day_of(x.get("since"))[:7] == key]
        rev = sum(payment_net(x) for x in pay_f if day_of(x.get("date"))[:7] == key)
        trend.append({"key": key, "label": calendar.month_abbr[int(key[5:])], "leads": len(ls), "qualified": sum(1 for x in ls if x.get("status") in QUALIFIED), "customers": len(cs),
                      "revenue": round2(rev), "conversionRate": round2(len(cs) / len(ls) * 100) if ls else 0})
    funnel = [{"name": n, "value": v} for n, v in (("Enquiries", totals["enquiries"]), ("Leads", totals["leads"]), ("Qualified", totals["qualifiedLeads"]), ("Deals", totals["deals"]), ("Won deals", totals["wonDeals"]),
                                                    ("Customers", totals["customers"]), ("Invoiced (₹)", totals["invoiced"]), ("Collected (₹)", totals["collected"]))]
    return {"totals": totals, "campaigns": rows, "sources": source_rows, "trend": trend, "funnel": funnel, "unattributedLeads": sum(1 for x in data["leads"] if not x.get("campaignId") and not x.get("leadSourceId"))}


def hide_money(o: dict) -> dict:
    x = dict(o)
    for k in FIN_KEYS:
        if k in x:
            x[k] = None
    x["financialHidden"] = True
    return x


def config_payload(db: Session, p: Principal) -> dict:
    perm = perms_of(p)
    if not (perm["viewCampaigns"] or perm["viewSources"] or perm["viewAnalytics"]):
        denied(db, p, "Marketing config", "You do not have access to marketing data.")
    channels = sorted({c for c in db.execute(select(Campaign.channel).distinct()).scalars() if c})
    return {"perms": perm, "user": {"id": p.actor_id, "name": p.name, "role": role_of(p), "department": p.user.department}, "statuses": CAMPAIGN_STATUSES, "types": CAMPAIGN_TYPES,
            "categories": ls.categories(db), "sources": [to_json(s) for s in db.execute(visible_sources(db).order_by(LeadSource.id)).scalars()],
            "matrix": {"roles": MARKETING_ROLE_CAPS, "permissions": MARKETING_PERMISSIONS}, "channels": channels}


FILTER_KEYS = ("from", "to", "campaignId", "leadSourceId", "channel", "campaignStatus", "leadStatus", "dealStage", "owner", "team", "product", "customerId", "companyId")


def _filters(params: dict) -> dict:
    return {k: v for k, v in params.items() if k in FILTER_KEYS and v not in ("", None, "all")}


def analytics(db: Session, p: Principal, params: dict) -> dict:
    perm = perms_of(p)
    if not perm["viewAnalytics"]:
        denied(db, p, "Analytics view", "You do not have access to marketing analytics.")
    out = compute_marketing(dataset(db), _filters(params))
    if not perm["viewFinancial"]:
        return {**out, "totals": hide_money(out["totals"]), "campaigns": [hide_money(c) for c in out["campaigns"]], "sources": [hide_money(s) for s in out["sources"]],
                "trend": [{**t, "revenue": None} for t in out["trend"]], "funnel": [x for x in out["funnel"] if "₹" not in x["name"]], "financialHidden": True, "perms": perm}
    return {**out, "perms": perm}


def export_csv(db: Session, p: Principal, params: dict) -> str:
    perm = perms_of(p)
    if not perm["export"] or not perm["viewAnalytics"]:
        denied(db, p, "Marketing export", "You do not have permission to export marketing reports.")
    is_src = params.get("type") == "sources"
    if is_src:  # the source register: one row per source the caller can see, with the same numbers the Lead Sources page shows
        rows = ls.list_sources(db, p, params)
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["Source", "Category", "Scope", "Branch", "Status", "Integration status", "Enquiries", "Converted leads", "Enquiry to lead rate %", "Created by", "Created", "Last updated"])
        for r in rows:
            w.writerow([_csv_safe(r["name"]), _csv_safe(r["category"]), r["scope"], r["branch"] or "All branches", "Active" if r["active"] else "Inactive", r["integrationStatus"], r["enquiryCount"],
                        r["convertedLeadCount"], r["enquiryConversionRate"], _csv_safe(r.get("createdByName") or ""), str(r.get("createdAt") or "")[:10], str(r.get("updatedAt") or "")[:10]])
        log(db, p, "Marketing export", None, "sources")
        db.commit()
        return "﻿" + buf.getvalue()
    out = compute_marketing(dataset(db), _filters({k: v for k, v in params.items() if k != "type"}))
    cols = [("Name", "name"), ("Leads", "leads"), ("Qualified", "qualifiedLeads"), ("Deals", "deals"), ("Won deals", "wonDeals"), ("Customers", "customers"), ("Invoiced", "invoiced"),
            ("Revenue collected", "collected"), ("Spend", "spend"), ("Conversion %", "conversionRate"), ("Cost per lead", "costPerLead"), ("ROI %", "roi")]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow([c[0] for c in cols])
    for r in out["sources" if is_src else "campaigns"]:
        w.writerow([("" if r.get(k) is None else _csv_safe(r.get(k))) for _, k in cols])
    log(db, p, "Marketing export", None, "sources" if is_src else "campaigns")
    db.commit()
    return "﻿" + buf.getvalue()


def _csv_safe(v):
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not re.fullmatch(r"-?\d+(\.\d+)?", s) else v  # a spreadsheet must never run a cell as a formula


# ---- lead sources --------------------------------------------------------------------------------------------------------
def _can_manage(p: Principal, s: LeadSource | None, perm: dict) -> bool:
    """Shared sources (no branch) are the Super Admin's to manage; a branch's own sources belong to that branch's marketing users."""
    return bool(perm["manageSources"] and (s is None or s.branch is not None or p.is_super_admin))


def source_public(p: Principal, s: LeadSource, row: dict | None, perm: dict) -> dict:
    o = {**to_json(s), **(row or {}), "id": s.id, "name": s.name, "category": s.category, "active": s.active, "branch": s.branch, "shared": s.branch is None, "perms": {"edit": _can_manage(p, s, perm)}}
    o.pop("connected", None)  # the old self-declared flag: connection state comes only from integration mappings
    return o if perm["viewFinancial"] else hide_money(o)


def list_sources(db: Session, p: Principal, params: dict | None = None) -> list[dict]:
    return ls.list_sources(db, p, params or {})


def source_options(db: Session, p: Principal) -> list[dict]:
    return ls.source_options(db, p)


_SCOPE_KEYS = {"Leads": "leads", "Deals": "deals", "Customers": "customers"}


def _scoped(db: Session, p: Principal, module: str, rows: list[dict]) -> list[dict]:
    """The rows of a related list the caller may open: needs the module permission, then the module's own record scope."""
    if not p.can(module, "view") or not rows:
        return []
    from app.services.modules import SPEC_BY_KEY  # imported here: modules.py imports this file

    spec = SPEC_BY_KEY[_SCOPE_KEYS[module]]
    extra = spec.row_filter(p) if spec.row_filter else None
    if extra is None:
        return rows
    allowed = set(db.execute(select(spec.model.id).where(spec.model.id.in_([r["id"] for r in rows]), extra)).scalars())
    return [r for r in rows if r["id"] in allowed]


def get_source(db: Session, p: Principal, source_id: str) -> dict:
    perm = perms_of(p)
    if not perm["viewSources"]:
        denied(db, p, "Lead source view", "You do not have access to lead sources.")
    s = find_source(db, source_id)
    if s is None:
        raise not_found("Lead source not found.")
    d = dataset(db)
    all_ = compute_marketing(d, {})
    f = compute_marketing(d, {"leadSourceId": s.id})
    out = source_public(p, s, next((x for x in all_["sources"] if x["id"] == s.id), None), perm)
    mine = lambda r: r.get("leadSourceId") == s.id  # noqa: E731
    out["trend"] = f["trend"]
    out["campaigns"] = [c if perm["viewFinancial"] else hide_money(c) for c in all_["campaigns"] if c.get("leadSourceId") == s.id]
    names = {u["id"]: None for u in d["users"]}
    del names
    out["leadsList"] = [{"id": r["id"], "name": r.get("name"), "company": r.get("company"), "status": r.get("status"), "campaign": r.get("campaign"), "campaignId": r.get("campaignId"),
                         "createdDate": r.get("createdDate"), "assignedTo": r.get("assignedTo")} for r in _scoped(db, p, "Leads", [x for x in d["leads"] if mine(x)])[:100]]
    out["dealsList"] = [{"id": r["id"], "name": r.get("name"), "stage": r.get("stage"), "value": r.get("value") if perm["viewFinancial"] else None, "campaignId": r.get("campaignId"), "customerId": r.get("customerId")}
                        for r in _scoped(db, p, "Deals", [x for x in d["deals"] if mine(x)])[:100]]
    out["customersList"] = [{"id": r["id"], "name": r.get("name"), "campaignId": r.get("campaignId"), "attributedDealId": r.get("attributedDealId")} for r in _scoped(db, p, "Customers", [x for x in d["customers"] if mine(x)])[:100]]
    out["usage"] = {"leads": sum(1 for k in ("leads", "enquiries", "deals") for x in d[k] if mine(x)), "campaigns": sum(1 for c in d["campaigns"] if c.get("leadSourceId") == s.id)}
    extras = ls.detail_extras(db, p, s)
    extras["perms"] = {**out["perms"], "manageIntegrations": extras["perms"]["manageIntegrations"]}
    out.update(extras)
    return out


def create_source(db: Session, p: Principal, req: dict) -> dict:
    return ls.create_source(db, p, req)


def update_source(db: Session, p: Principal, source_id: str, req: dict) -> dict:
    return ls.update_source(db, p, source_id, req)


def delete_source(db: Session, p: Principal, source_id: str) -> dict:
    return ls.delete_source(db, p, source_id)


# ---- campaigns -----------------------------------------------------------------------------------------------------------
def _attr(c: Campaign, key: str, default=None):
    return (c.attributes or {}).get(key, default)


def _set(c: Campaign, **values) -> None:
    c.attributes = {**(c.attributes or {}), **values}


def names_of(db: Session, employee_ids: list[str]) -> dict:
    wanted = [i for i in employee_ids if i]
    if not wanted:
        return {}
    return dict(db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(wanted))).all())


def public_campaign(db: Session, c: Campaign, stats: dict | None, perm: dict) -> dict:
    base = to_json(c)
    s = stats or with_rates(_blank(), 0)
    act = campaign_actions(c)
    team = _attr(c, "team", [])
    prods = _attr(c, "productIds", [])
    names = names_of(db, [c.owner_id, *team])
    src = db.get(LeadSource, c.lead_source_id) if c.lead_source_id else None
    out = {**base, **s, "id": c.id, "number": c.number, "name": c.name, "status": c.status, "ownerName": names.get(c.owner_id), "leadSourceName": src.name if src else None,
           "teamNames": [names[t] for t in team if t in names], "actualLeads": s["leads"], "leadsGenerated": s["leads"], "customersWon": s["customers"], "revenue": s["collected"], "costs": _attr(c, "costs", []),
           "team": team, "productIds": prods,
           "productNames": [r for r in db.execute(select(Product.name).where(Product.id.in_(prods))).scalars()] if prods else [],
           "actions": {**act, "edit": perm["editCampaign"] and act["edit"], "editAll": perm["editCampaign"] and act["editAll"], "schedule": perm["runCampaign"] and act["schedule"], "start": perm["runCampaign"] and act["start"],
                       "pause": perm["runCampaign"] and act["pause"], "resume": perm["runCampaign"] and act["resume"], "complete": perm["runCampaign"] and act["complete"], "cancel": perm["runCampaign"] and act["cancel"],
                       "deleteDraft": perm["deleteDraft"] and act["deleteDraft"], "recordSpend": perm["editCampaign"] and act["recordSpend"]}}
    return out if perm["viewFinancial"] else hide_money(out)


def _stats_by_campaign(db: Session) -> dict:
    return {r["id"]: r for r in compute_marketing(dataset(db), {})["campaigns"]}


def list_campaigns(db: Session, p: Principal, params: dict):
    perm = perms_of(p)
    if not perm["viewCampaigns"]:
        denied(db, p, "Campaign list", "You do not have access to campaigns.")
    stats = _stats_by_campaign(db)
    items = [public_campaign(db, c, stats.get(c.id), perm) for c in db.execute(select(Campaign).order_by(Campaign.created_at.desc(), Campaign.id.desc())).scalars()]
    needle = str(params.get("q") or params.get("search") or "").strip().lower()
    if needle:
        items = [c for c in items if needle in f"{c.get('number')} {c.get('name')} {c.get('type')} {c.get('channel')}".lower()]
    for key in ("status", "type", "channel", "ownerId", "leadSourceId"):
        if params.get(key):
            items = [c for c in items if str(c.get(key)) in str(params[key]).split(",")]
    if str(params.get("all", "")).lower() == "true":
        return items
    try:
        page, size = max(1, int(params.get("page", 1))), min(200, max(1, int(params.get("pageSize", 10))))
    except ValueError:
        raise invalid("Invalid pagination.") from None
    return {"data": items[(page - 1) * size: page * size], "total": len(items), "page": page, "pageSize": size}


def get_campaign_row(db: Session, campaign_id: str) -> Campaign:
    c = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if c is None:
        raise not_found("Campaign not found.")
    return c


def get_campaign(db: Session, p: Principal, campaign_id: str) -> dict:
    perm = perms_of(p)
    if not perm["viewCampaigns"]:
        denied(db, p, "Campaign view", "You do not have access to campaigns.")
    c = get_campaign_row(db, campaign_id)
    d = dataset(db)
    all_ = compute_marketing(d, {})
    one = compute_marketing(d, {"campaignId": c.id})
    out = public_campaign(db, c, next((x for x in all_["campaigns"] if x["id"] == c.id), None), perm)
    money = perm["viewFinancial"]
    mine = lambda r: r.get("campaignId") == c.id  # noqa: E731
    leads = _scoped(db, p, "Leads", [x for x in d["leads"] if mine(x)])
    deals = _scoped(db, p, "Deals", [x for x in d["deals"] if mine(x)])
    customers = _scoped(db, p, "Customers", [x for x in d["customers"] if mine(x)])
    names = names_of(db, [x.get("assignedTo") for x in leads])
    out["trend"] = one["trend"]
    out["funnel"] = one["funnel"] if money else [x for x in one["funnel"] if "₹" not in x["name"]]
    out["leadsList"] = [{"id": x["id"], "name": x.get("name"), "company": x.get("company"), "status": x.get("status"), "source": x.get("source"), "createdDate": x.get("createdDate"), "assignedTo": x.get("assignedTo"),
                         "ownerName": names.get(x.get("assignedTo")), "dealId": x.get("dealId"), "customerId": x.get("customerId")} for x in leads[:200]]
    out["dealsList"] = [{"id": x["id"], "name": x.get("name"), "stage": x.get("stage"), "value": x.get("value") if money else None, "companyId": x.get("companyId"), "customerId": x.get("customerId"),
                         "leadId": x.get("leadId")} for x in deals[:200]]
    out["customersList"] = [{"id": x["id"], "name": x.get("name"), "companyId": x.get("companyId")} for x in customers[:200]]
    company_ids = {i for i in [*(x.get("companyId") for x in deals), *(x.get("companyId") for x in leads), *(x.get("companyId") for x in customers)] if i}
    contact_ids = {i for i in [*(x.get("contactId") for x in deals), *(x.get("contactId") for x in leads)] if i}
    out["companiesList"] = [{"id": r.id, "name": r.name} for r in db.execute(select(Company).where(Company.id.in_(company_ids))).scalars()] if company_ids and p.can("Companies", "view") else []
    out["contactsList"] = [{"id": r.id, "name": r.name} for r in db.execute(select(Contact).where(Contact.id.in_(contact_ids))).scalars()] if contact_ids and p.can("Contacts", "view") else []
    out["enquiriesList"] = [{"id": x["id"], "name": x.get("name") or x.get("contactName") or x["id"], "status": x.get("status")} for x in d["enquiries"] if mine(x)][:100] if p.can("Enquiries", "view") else []
    real = []
    for x in [r for r in d["leads"] if mine(r)]:
        real.append({"id": f"L-{x['id']}", "at": f"{day_of(x.get('createdDate'))}T{str(x.get('capturedAt') or '')[11:19] or '09:00:00'}.000Z", "type": "LeadGenerated",
                     "text": f"Lead generated: {x.get('name')}{f' ({x.get('company')})' if x.get('company') else ''}", "details": f"Source {x.get('source') or '—'}", "href": f"/leads/{x['id']}" if p.can("Leads", "view") else None})
    for x in [r for r in d["deals"] if mine(r)]:
        real.append({"id": f"D-{x['id']}", "at": f"{day_of(x.get('createdDate'))}T10:00:00.000Z", "type": "DealCreated", "text": f"Deal created: {x.get('name')}", "details": x.get("stage"), "href": f"/deals/{x['id']}" if p.can("Deals", "view") else None})
    for x in [r for r in d["customers"] if mine(r)]:
        real.append({"id": f"C-{x['id']}", "at": f"{day_of(x.get('since'))}T11:00:00.000Z", "type": "CustomerConverted", "text": f"Customer converted: {x.get('name')}", "details": "", "href": f"/customers/{x['id']}" if p.can("Customers", "view") else None})
    out["timeline"] = sorted([*_attr(c, "timeline", []), *real], key=lambda e: str(e.get("at")), reverse=True)[:300]
    out["perms"] = perm
    return out


def _build(db: Session, p: Principal, req: dict, cur: Campaign | None) -> dict:
    errors: dict = {}
    v: dict = {}
    v["name"] = clean(req.get("name", cur.name if cur else ""), 120)
    if len(v["name"]) < 3:
        errors["name"] = "Enter a campaign name (at least 3 characters)."
    elif db.execute(select(Campaign.id).where(func.lower(Campaign.name) == v["name"].lower(), Campaign.id != (cur.id if cur else ""))).first():
        errors["name"] = "A campaign with this name already exists."
    v["type"] = req.get("type", cur.type if cur else None)
    if v["type"] not in CAMPAIGN_TYPES:
        errors["type"] = "Choose a campaign type."
    v["channel"] = clean(req.get("channel", cur.channel if cur else ""), 40)
    if not v["channel"]:
        errors["channel"] = "Choose a marketing channel."
    start, end = req.get("startDate", day_of(cur.start_date) if cur else None), req.get("endDate", day_of(cur.end_date) if cur else None)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(start or "")):
        errors["startDate"] = "Enter the start date."
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(end or "")):
        errors["endDate"] = "Enter the end date."
    elif "startDate" not in errors and end < start:
        errors["endDate"] = "The end date cannot be before the start date."
    try:
        v["budget"] = float(req.get("budget", cur.budget if cur else 0) or 0)
        if not 0 <= v["budget"] <= 1e9:
            raise ValueError
    except (TypeError, ValueError):
        v["budget"] = 0.0
        errors["budget"] = "Enter a valid budget."
    try:
        v["target_leads"] = max(0, round(float(req.get("targetLeads", cur.target_leads if cur else 0) or 0)))
    except (TypeError, ValueError):
        v["target_leads"] = 0
    v["target_audience"] = clean(req.get("targetAudience", cur.target_audience if cur else ""), 200)
    v["description"] = clean(req.get("description", cur.description if cur else ""), 1000)
    owner = req.get("ownerId", (cur.owner_id if cur else None) or p.actor_id)
    live = {"Active", "Probation", "On Leave", "Remote"}
    emp = db.get(Employee, owner) if owner else None
    if emp is None or emp.status not in live:
        errors["ownerId"] = "Choose an active owner."
    v["owner_id"] = owner
    team_in = req.get("team", _attr(cur, "team", []) if cur else [])
    team = [t for t in (team_in or []) if (e := db.get(Employee, t)) is not None and e.status in live]
    src_id = req.get("leadSourceId", cur.lead_source_id if cur else None)
    src = db.get(LeadSource, src_id) if src_id else None
    if src is None:
        errors["leadSourceId"] = "Choose a lead source."
    elif not src.active and src.id != (cur.lead_source_id if cur else None):
        errors["leadSourceId"] = "That source is inactive."
    v["lead_source_id"] = src_id
    prod_in = req.get("productIds", _attr(cur, "productIds", []) if cur else [])
    prods = [i for i in (prod_in or []) if db.get(Product, i) is not None]
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    v["start_date"], v["end_date"] = date.fromisoformat(start), date.fromisoformat(end)
    return {"cols": v, "attrs": {"team": team, "productIds": prods}}


def _event(p: Principal, type: str, text: str, details: str = "", **extra) -> dict:
    return {"id": f"CEV-{uuid.uuid4().hex[:8].upper()}", "at": now_iso(), "by": p.actor_id, "byName": p.name, "type": type, "text": text, "details": details, **extra}


def add_event(c: Campaign, p: Principal, type: str, text: str, details: str = "", **extra) -> None:
    _set(c, timeline=[*_attr(c, "timeline", []), _event(p, type, text, details, **extra)])


def _activity(db: Session, c: Campaign, p: Principal, subject: str) -> None:
    timeline.log_activity(db, related_type="Campaign", related_id=c.id, related_name=c.number, type="Campaign", subject=subject, by=p.actor_id, branch=c.branch, extra={"campaignEvent": True, "campaignId": c.id, "links": {"campaignId": c.id}})


def _raise_task(db: Session, p: Principal, c: Campaign, key: str, data: dict) -> None:
    if not data.get("assignees"):
        return
    try:
        task_svc.create_task(db, task_svc.Actor(id=p.actor_id, name="Automation", level="System", system=True), task_svc._ALL,
                             {"priority": "Medium", "visibility": "Team", "relatedType": "Campaign", "relatedId": c.id, **data}, branch=c.branch, automation_key=key, source="automation",
                             message="Created automatically by the campaign workflow")
    except ApiError:
        pass  # an automatic reminder must never block the campaign workflow


def _due_in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def create_campaign(db: Session, p: Principal, req: dict) -> dict:
    perm = perms_of(p)
    if not perm["createCampaign"]:
        denied(db, p, "Campaign create", "You do not have permission to create campaigns.")
    built = _build(db, p, req, None)
    request_id = req.get("requestId")
    if request_id and any((c.attributes or {}).get("requestId") == request_id for c in db.execute(select(Campaign)).scalars()):
        raise conflict("This campaign was already created.")
    c = Campaign(id=ids.new_id(db, "CMPG", 4), number=ids.new_number(db, "CMP"), status="Draft", created_by=p.actor_id, **built["cols"],
                 attributes={**built["attrs"], "costs": [], "requestId": request_id or None})
    add_event(c, p, "Created", "Campaign created as a draft", f"{c.channel} · {c.type}")
    db.add(c)
    db.flush()
    start = date.fromisoformat(day_of(c.start_date))
    due = (start - timedelta(days=3)).isoformat() if start > date.today() else _due_in(2)
    _raise_task(db, p, c, f"campaignPlan:{c.id}", {"title": f"Plan campaign {c.number} — {c.name}", "taskType": "General", "description": "Finalise audience, creatives, budget and launch checklist.",
                                                    "dueDate": due, "assignees": [c.owner_id]})
    _activity(db, c, p, f"Campaign {c.number} “{c.name}” created by {p.name}.")
    log(db, p, "Campaign created", c.id, c.number)
    db.commit()
    return public_campaign(db, c, None, perm)


def update_campaign(db: Session, p: Principal, campaign_id: str, req: dict) -> dict:
    perm = perms_of(p)
    c = get_campaign_row(db, campaign_id)
    if not perm["viewCampaigns"]:
        denied(db, p, "Campaign edit", "You do not have access to campaigns.", c.id)
    act = campaign_actions(c)
    if not perm["editCampaign"] or not act["edit"]:
        denied(db, p, "Campaign edit", "You do not have permission to edit campaigns." if act["edit"] else f"A {c.status.lower()} campaign cannot be edited.", c.id)
    current = {"type": c.type, "channel": c.channel, "startDate": day_of(c.start_date), "leadSourceId": c.lead_source_id}
    if not act["editAll"]:
        frozen = [k for k in current if k in req and req[k] != current[k]]
        if frozen:
            raise conflict(f"{', '.join(frozen)} cannot be changed once a campaign is scheduled or running — attribution depends on it.")
    built = _build(db, p, req, c)
    changes = []
    for k, v in built["cols"].items():
        if getattr(c, k) != v:
            changes.append(re.sub(r"_(\w)", lambda m: m.group(1).upper(), k))
            setattr(c, k, v)
    for k, v in built["attrs"].items():
        if _attr(c, k, []) != v:
            changes.append(k)
    if not changes:
        return public_campaign(db, c, _stats_by_campaign(db).get(c.id), perm)
    _set(c, **built["attrs"])
    for k in changes:
        add_event(c, p, "Updated", f"{k} changed", "", field=k)
    c.updated_at = datetime.now(UTC)
    if "name" in changes:
        for model in (Lead, Enquiry, Deal, Customer):
            for r in db.execute(select(model).where(model.campaign_id == c.id)).scalars():
                r.campaign = c.name
    log(db, p, "Campaign updated", c.id, ", ".join(changes))
    db.commit()
    return public_campaign(db, c, _stats_by_campaign(db).get(c.id), perm)


def delete_campaign(db: Session, p: Principal, campaign_id: str) -> dict:
    perm = perms_of(p)
    c = get_campaign_row(db, campaign_id)
    if not perm["viewCampaigns"]:
        denied(db, p, "Campaign delete", "You do not have access to campaigns.", c.id)
    if not perm["deleteDraft"] or not campaign_actions(c)["deleteDraft"]:
        denied(db, p, "Campaign delete", "You do not have permission to delete campaigns." if c.status == "Draft" else "Only a draft campaign can be deleted. Cancel it instead — its record and attribution are kept.", c.id)
    if any(db.execute(select(m.id).where(m.campaign_id == c.id).limit(1)).first() for m in (Lead, Enquiry, Deal, Customer)):
        raise conflict("Records are already attributed to this campaign. Cancel it instead.")
    db.delete(c)
    log(db, p, "Draft campaign deleted", c.id, c.number)
    db.commit()
    return {"success": True}


def transition(db: Session, p: Principal, campaign_id: str, kind: str, req: dict) -> dict:
    perm = perms_of(p)
    c = get_campaign_row(db, campaign_id)
    if not perm["viewCampaigns"]:
        denied(db, p, f"Campaign {kind}", "You do not have access to campaigns.", c.id)
    act = campaign_actions(c)
    reason = clean(req.get("reason"), 400)
    if not perm["runCampaign"] or not act[kind]:
        verb = "started" if kind == "start" else "scheduled" if kind == "schedule" else f"{kind}d"
        denied(db, p, f"Campaign {kind}", f"A {c.status.lower()} campaign cannot be {verb}." if perm["runCampaign"] else "You do not have permission to run campaigns.", c.id)
    at = datetime.now(UTC)
    notify_to = [x for x in [c.owner_id, *_attr(c, "team", [])] if x and x != p.actor_id]
    previous = c.status
    if kind == "schedule":
        if day_of(c.start_date) <= today_key():
            raise conflict("The start date has already arrived — start the campaign instead.")
        c.status = "Scheduled"
        add_event(c, p, "Scheduled", "Campaign scheduled", f"Starts {day_of(c.start_date)}")
    elif kind == "start":
        c.status = "Active"
        _set(c, startedAt=now_iso(), startedBy=p.actor_id)
        add_event(c, p, "Started", "Campaign started", "Launched from schedule" if previous == "Scheduled" else "Launched")
        db.flush()
        _raise_task(db, p, c, f"campaignReview:{c.id}", {"title": f"Review campaign {c.number} performance", "taskType": "Review", "description": "Check leads, quality and spend against the target.",
                                                          "dueDate": _due_in(7), "assignees": [c.owner_id]})
        follow = ([*_attr(c, "team", [])[:1], c.owner_id] or [c.owner_id])[:1]
        _raise_task(db, p, c, f"campaignFollowUp:{c.id}", {"title": f"Follow up leads from {c.number}", "taskType": "Follow-up", "description": "Contact new leads generated by this campaign within 24 hours.",
                                                            "dueDate": _due_in(2), "assignees": [f for f in follow if f]})
    elif kind == "pause":
        if len(reason) < 3:
            raise invalid("Say why you are pausing the campaign.", {"reason": "Give a reason."})
        c.status = "Paused"
        _set(c, pausedAt=now_iso())
        add_event(c, p, "Paused", "Campaign paused", reason)
    elif kind == "resume":
        c.status = "Active"
        add_event(c, p, "Resumed", "Campaign resumed", "")
    elif kind == "complete":
        c.status = "Completed"
        _set(c, completedAt=now_iso(), completedBy=p.actor_id)
        add_event(c, p, "Completed", "Campaign completed", reason)
    elif kind == "cancel":
        if len(reason) < 5:
            raise invalid("Give a reason for cancelling (at least 5 characters).", {"reason": "Give a reason."})
        c.status = "Cancelled"
        _set(c, cancelReason=reason, cancelledAt=now_iso(), cancelledBy=p.actor_id)
        add_event(c, p, "Cancelled", "Campaign cancelled", reason)
    c.updated_at = at
    for uid in notify_to:
        timeline.notify(db, user_id=uid, message=f"Campaign {c.number} “{c.name}” is now {c.status} ({p.name}).", type="Campaign", related_type="Campaign", related_id=c.id, branch=c.branch)
    word = "resumed" if kind == "resume" else c.status.lower()
    _activity(db, c, p, f"Campaign {c.number} {word} by {p.name}{f' — {reason}' if reason else ''}.")
    log(db, p, f"Campaign {kind}", c.id, reason)
    db.commit()
    return public_campaign(db, c, _stats_by_campaign(db).get(c.id), perm)


def record_spend(db: Session, p: Principal, campaign_id: str, req: dict) -> dict:
    perm = perms_of(p)
    c = get_campaign_row(db, campaign_id)
    if not perm["viewCampaigns"]:
        denied(db, p, "Campaign spend", "You do not have access to campaigns.", c.id)
    if not perm["editCampaign"] or not perm["viewFinancial"] or not campaign_actions(c)["recordSpend"]:
        denied(db, p, "Campaign spend", "You cannot record spend for this campaign.", c.id)
    amount = round2(req.get("amount"))
    if not amount > 0:
        raise invalid("Enter an amount greater than zero.", {"amount": "Enter an amount greater than zero."})
    when = str(req.get("date") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", when) or when > today_key() or when < day_of(c.start_date):
        raise invalid("The date must be between the campaign start and today.", {"date": "Invalid date."})
    note = clean(req.get("note"), 200)
    if len(note) < 3:
        raise invalid("Say what the spend was for.", {"note": "Describe the spend."})
    line = {"id": f"CST-{uuid.uuid4().hex[:8].upper()}", "date": when, "amount": amount, "note": note, "by": p.actor_id, "at": now_iso()}
    _set(c, costs=[*_attr(c, "costs", []), line])
    add_event(c, p, "SpendRecorded", f"Spend of ₹{amount:,.2f} recorded", note)
    log(db, p, "Campaign spend", c.id, f"{amount} {note}")
    db.commit()
    return public_campaign(db, c, _stats_by_campaign(db).get(c.id), perm)


def attach_lead(db: Session, p: Principal, campaign_id: str, req: dict) -> dict:
    perm = perms_of(p)
    c = get_campaign_row(db, campaign_id)
    if not perm["editCampaign"] or not p.can("Leads", "edit"):
        denied(db, p, "Campaign attach lead", "You do not have permission to attribute leads to campaigns.", c.id)
    lead = db.execute(select(Lead).where(Lead.id == req.get("leadId"))).scalar_one_or_none()
    if lead is None:
        raise not_found("Lead not found.")
    if lead.campaign_id:
        raise conflict("This lead is already part of the campaign." if lead.campaign_id == c.id else "This lead already has its original campaign — historical attribution is kept.")
    if c.status not in ("Active", "Paused", "Completed"):
        raise conflict("Only a campaign that has started can take leads.")
    lead.campaign_id, lead.campaign = c.id, c.name
    lead.lead_source_id = lead.lead_source_id or c.lead_source_id
    apply_attribution(db, lead)
    add_event(c, p, "LeadAttached", f"Existing lead {lead.name} attributed", f"Lead {lead.id}")
    log(db, p, "Campaign attach lead", c.id, lead.id)
    db.commit()
    return {"success": True, "leadId": lead.id}
