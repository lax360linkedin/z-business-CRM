"""Configurable option lists: the values behind the dropdowns and filters of the CRM (industries, cities, enquiry types, reasons, ticket categories ...), managed by the Super Admin in
Settings and read by every screen, so a new option never needs a code change.

Each list has built-in DEFAULTS (used until somebody edits it) and is stored as one `app_settings` row (`options:<key>`): no schema of its own. A list knows WHERE its values are kept on
records (`columns`, or `json_tables` for values that live inside a record's free-form attributes), which is what makes it safe to manage:

* usage - how many records carry each value;
* rename - carried to every record that has the old value (for values held in plain columns);
* delete - refused while any record uses the value (answer: 409, deactivate it instead); a deactivated value is no longer offered for NEW records but stays valid on existing ones.

Workflow states (lead statuses, deal stages, task / ticket / contract statuses, priorities, activity types ...) are deliberately NOT here: the server's rules and automations depend on their
exact values, so they are fixed workflows, not options."""
import json
import re
from dataclasses import dataclass

from sqlalchemy import String, cast, func, or_, select, update
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, invalid, not_found
from app.models import AppSetting, Campaign, Company, Customer, Deal, Enquiry, Lead, Product, Quotation, Ticket
from app.services import audit

PREFIX = "options:"
MAX_ITEMS = 200


@dataclass(frozen=True)
class OptionList:
    key: str
    label: str
    group: str
    help: str
    defaults: tuple[str, ...]
    columns: tuple = ()  # (Model, "column") pairs: where a value is stored in a plain column
    json_tables: tuple = ()  # models whose free-form attributes can hold the value (counted, never renamed automatically)


LISTS: tuple[OptionList, ...] = (
    OptionList("industries", "Industries", "CRM", "Offered on companies, customers, leads and enquiries.",
               ("Information Technology", "Manufacturing", "Healthcare", "Retail & E-commerce", "Real Estate", "Education", "Logistics & Supply Chain", "Financial Services", "Hospitality",
                "Media & Entertainment", "Construction", "Automotive", "Telecommunications", "Pharmaceuticals", "Agriculture"),
               columns=((Company, "industry"), (Customer, "industry"), (Lead, "industry"), (Enquiry, "category"))),
    OptionList("cities", "Cities / locations", "CRM", "Offered on companies, leads and enquiries, and in their location filters.",
               ("Chennai", "Bengaluru", "Mumbai", "Hyderabad", "Pune", "Delhi NCR", "Coimbatore", "Kochi", "Ahmedabad", "Kolkata", "New York", "London", "Singapore", "Dubai", "Toronto"),
               columns=((Company, "city"), (Lead, "location"), (Enquiry, "city"))),
    OptionList("enquiry_types", "Enquiry types", "CRM", "The kind of enquiry that came in.",
               ("Product Enquiry", "Service Enquiry", "Pricing Enquiry", "Support Enquiry", "Partnership Enquiry", "General Enquiry"), columns=((Enquiry, "enquiry_type"),)),
    OptionList("requirement_types", "Requirement types", "CRM", "What the enquirer needs.", ("New Requirement", "Upgrade", "Replacement", "Renewal", "Add-on", "Other"),
               columns=((Enquiry, "requirement_type"),)),
    OptionList("contact_methods", "Preferred contact methods", "CRM", "How an enquirer likes to be reached.", ("Phone", "Email", "WhatsApp", "Any"), columns=((Enquiry, "preferred_contact_method"),)),
    OptionList("assigned_teams", "Teams an enquiry is assigned to", "CRM", "Offered when an enquiry is assigned.", ("Sales", "Marketing", "Support"), columns=((Enquiry, "assigned_team"),)),
    OptionList("lead_unqualified_reasons", "Lead unqualified reasons", "CRM", "Why a lead was never a real opportunity.",
               ("Not a Target Customer", "No Relevant Requirement", "Invalid Requirement", "Budget Mismatch", "Service Not Applicable", "Duplicate/Irrelevant Lead", "Other"), columns=((Lead, "unqualified_reason"),)),
    OptionList("lead_lost_reasons", "Lead lost reasons", "CRM", "Why a genuine lead stopped before becoming a deal.",
               ("Customer Chose Competitor", "Customer Cancelled Requirement", "Budget Unavailable", "Price Objection", "Customer Postponed Decision", "No Response After Follow-ups", "Requirement No Longer Exists", "Other"),
               columns=((Lead, "lost_reason"),)),
    OptionList("company_sizes", "Company sizes", "CRM", "Offered when qualifying a lead.", ("1-10", "11-50", "51-200", "201-500", "500+"), json_tables=(Lead, Enquiry)),
    OptionList("business_needs", "Business needs", "CRM", "Offered when qualifying a lead or enquiry.",
               ("Sales Management", "Customer Management", "Lead Management", "Marketing Automation", "Billing & Invoicing", "Inventory Management", "Reporting & Analytics", "Communication Management",
                "Process Automation", "Other"), json_tables=(Lead, Enquiry, Deal)),
    OptionList("qualification_timelines", "Purchase timelines", "CRM", "Offered when qualifying a lead or enquiry.",
               ("Immediate (0-1 month)", "Short-term (1-3 months)", "Mid-term (3-6 months)", "Long-term (6+ months)"), json_tables=(Lead, Enquiry, Deal)),
    OptionList("purchase_intents", "Purchase intent levels", "CRM", "Offered when qualifying an enquiry.", ("Low", "Medium", "High", "Very High"), json_tables=(Enquiry,)),
    OptionList("deal_lost_reasons", "Deal lost reasons", "Sales", "Why a deal was lost.",
               ("Budget Issue", "Timing Issue", "No Response", "Requirement Changed", "Internal Decision", "Competitor Selected", "Price Issue", "Other"), columns=((Deal, "lost_reason"),)),
    OptionList("payment_terms", "Payment terms", "Sales", "Suggested payment terms on quotations and sales orders.",
               ("100% advance payment", "50% advance, 50% on delivery", "30% advance, 40% on delivery, 30% on completion", "Net 15 days from invoice date", "Net 30 days from invoice date"),
               columns=((Quotation, "payment_terms"),)),
    OptionList("product_types", "Product types", "Products & Services", "The type of a catalogue item.", ("Service", "Package", "Add-on", "Product"), columns=((Product, "type"),)),
    OptionList("product_units", "Units of sale", "Products & Services", "How a catalogue item is sold.",
               ("Project", "Nos", "Hour", "Day", "Month", "Year", "Licence", "User / Month", "Page", "Sq. ft."), columns=((Product, "unit"),)),
    OptionList("billing_cycles", "Billing cycles", "Products & Services", "How often a catalogue item is billed.", ("One-time", "Monthly", "Quarterly", "Annual"), columns=((Product, "billing_cycle"),)),
    OptionList("campaign_channels", "Campaign channels", "Marketing", "The channel a campaign runs on.",
               ("Google Ads", "Instagram", "Facebook", "LinkedIn", "Email", "WhatsApp", "Website", "YouTube", "Other"), columns=((Campaign, "channel"),)),
    OptionList("ticket_categories", "Ticket categories", "Support", "What a support ticket is about.",
               ("Technical Issue", "Software Bug", "Login / Access", "Billing", "Payment", "Product Issue", "Service Request", "Feature Request", "Installation", "Configuration", "Maintenance"),
               columns=((Ticket, "category"),)),
    OptionList("ticket_sources", "Ticket sources", "Support", "Where a support ticket came from.", ("Email", "WhatsApp", "Phone", "Website", "Manual Entry", "Referral", "Existing Customer", "Other"),
               columns=((Ticket, "source"),)),
)
BY_KEY = {spec.key: spec for spec in LISTS}


def _clean(raw) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", str(raw if raw is not None else ""))).strip()


def _norm(value: str) -> str:
    return _clean(value).casefold()


def spec_of(key: str) -> OptionList:
    spec = BY_KEY.get(key)
    if spec is None:
        raise not_found("Unknown option list.")
    return spec


# ---- reading -----------------------------------------------------------------------------------------------------------------------------
def _stored(db: Session) -> dict[str, list[dict]]:
    from app.db.config_events import cached

    def load():
        rows = db.execute(select(AppSetting.key, AppSetting.value).where(AppSetting.key.like(f"{PREFIX}%"))).all()
        return {k[len(PREFIX):]: list((v or {}).get("items", [])) for k, v in rows}

    return cached(db, "option-lists", load)


def items_of(db: Session, spec: OptionList) -> list[dict]:
    stored = _stored(db).get(spec.key)
    if stored is None:
        return [{"value": v, "active": True} for v in spec.defaults]
    return [{"value": str(i["value"]), "active": bool(i.get("active", True))} for i in stored]


def public(db: Session) -> dict:
    """Every list as the screens need it. Readable by every signed-in person: these are plain labels."""
    return {s.key: {"key": s.key, "label": s.label, "group": s.group, "help": s.help, "items": items_of(db, s), "customised": s.key in _stored(db)} for s in LISTS}


# ---- usage -------------------------------------------------------------------------------------------------------------------------------
def _like_escape(text: str) -> str:
    esc = "\\"
    return text.replace(esc, esc * 2).replace("%", esc + "%").replace("_", esc + "_")


def _usage_single(db: Session, spec: OptionList) -> dict[str, int]:
    """How many records carry each value of one list. Core selects on purpose: usage counts every branch, not just the caller's."""
    counts: dict[str, int] = {}
    for model, column in spec.columns:
        t = model.__table__
        for value, n in db.execute(select(t.c[column], func.count()).where(t.c[column].is_not(None), t.c[column] != "").group_by(t.c[column])).all():
            counts[value] = counts.get(value, 0) + int(n)
    for model in spec.json_tables:  # values kept inside free-form attributes: counted by their quoted text (both JSON spellings of non-ASCII characters)
        t = model.__table__
        for item in items_of(db, spec):
            needles = {json.dumps(item["value"]), json.dumps(item["value"], ensure_ascii=False)}
            n = db.execute(select(func.count()).select_from(t).where(or_(*[cast(t.c.attributes, String).like(f"%{_like_escape(needle)}%", escape="\\") for needle in needles]))).scalar_one()
            if n:
                counts[item["value"]] = counts.get(item["value"], 0) + int(n)
    return counts


def usage(db: Session) -> dict[str, dict[str, int]]:
    return {spec.key: _usage_single(db, spec) for spec in LISTS}


# ---- writing (Super Admin) ----------------------------------------------------------------------------------------------------------------
def _save(db: Session, p: Principal, spec: OptionList, items: list[dict]) -> None:
    row = db.get(AppSetting, PREFIX + spec.key)
    value = {"items": items}
    if row is None:
        db.add(AppSetting(key=PREFIX + spec.key, value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id


def _log(db: Session, p: Principal, spec: OptionList, action: str, details: str) -> None:
    audit.record(db, user=p.user, action=action, module="Settings", record_id=spec.key, details=details, info=p.info)


def _value(raw) -> str:
    value = _clean(raw)
    if not value:
        raise invalid("Enter the option.", {"value": "Enter a value."})
    if len(value) > 120:
        raise invalid("An option can be at most 120 characters.", {"value": "At most 120 characters."})
    return value


def _find(items: list[dict], value: str) -> int:
    key = _norm(value)
    for i, item in enumerate(items):
        if _norm(item["value"]) == key:
            return i
    return -1


def add_item(db: Session, p: Principal, key: str, raw) -> dict:
    spec = spec_of(key)
    items = items_of(db, spec)
    value = _value(raw)
    if _find(items, value) >= 0:
        raise invalid(f"“{value}” is already in this list.", {"value": "Already in the list."})
    if len(items) >= MAX_ITEMS:
        raise invalid(f"A list can hold at most {MAX_ITEMS} options.", {"value": "The list is full."})
    items.append({"value": value, "active": True})
    _save(db, p, spec, items)
    _log(db, p, spec, "Option added", f"{spec.label}: {value}")
    db.commit()
    return public(db)[key]


def update_item(db: Session, p: Principal, key: str, old: str, body: dict) -> dict:
    """Rename and / or switch an option on or off. A rename is carried to every record that has it (plain-column lists); a value held inside free-form attributes cannot be carried, so such a
    value can only be renamed while no record uses it."""
    spec = spec_of(key)
    items = items_of(db, spec)
    at = _find(items, old)
    if at < 0:
        raise not_found("Option not found.")
    current = items[at]["value"]
    if "value" in body and _clean(body["value"]) != current:
        new = _value(body["value"])
        clash = _find(items, new)
        if clash >= 0 and clash != at:
            raise invalid(f"“{new}” is already in this list.", {"value": "Already in the list."})
        used = _usage_single(db, spec).get(current, 0)
        carried = 0
        if used:
            if spec.json_tables and not spec.columns:
                raise conflict(f"{used} record(s) use “{current}” and it is kept inside their details, so it cannot be renamed. Deactivate it and add the new wording instead.", code="IN_USE")
            for model, column in spec.columns:
                t = model.__table__
                carried += db.execute(update(t).where(t.c[column] == current).values({column: new})).rowcount or 0
        items[at]["value"] = new
        _log(db, p, spec, "Option renamed", f"{spec.label}: {current} -> {new} ({carried} record(s) updated)")
    if "active" in body:
        items[at]["active"] = bool(body["active"])
        _log(db, p, spec, "Option enabled" if items[at]["active"] else "Option disabled", f"{spec.label}: {items[at]['value']}")
    _save(db, p, spec, items)
    db.commit()
    return public(db)[key]


def delete_item(db: Session, p: Principal, key: str, value: str) -> dict:
    spec = spec_of(key)
    items = items_of(db, spec)
    at = _find(items, value)
    if at < 0:
        raise not_found("Option not found.")
    current = items[at]["value"]
    used = _usage_single(db, spec).get(current, 0)
    if used:
        raise conflict(f"“{current}” is used by {used} record(s), so it cannot be deleted. Deactivate it instead: it stops being offered, and everything that already uses it keeps it.", code="IN_USE")
    del items[at]
    _save(db, p, spec, items)
    _log(db, p, spec, "Option deleted", f"{spec.label}: {current}")
    db.commit()
    return public(db)[key]


def reorder(db: Session, p: Principal, key: str, values: list) -> dict:
    spec = spec_of(key)
    items = items_of(db, spec)
    if not isinstance(values, list) or sorted(_norm(v) for v in values) != sorted(_norm(i["value"]) for i in items):
        raise invalid("Send every option of the list, once each, in the new order.", {"values": "Not the same options."})
    by = {_norm(i["value"]): i for i in items}
    _save(db, p, spec, [by[_norm(v)] for v in values])
    _log(db, p, spec, "Options reordered", spec.label)
    db.commit()
    return public(db)[key]


def reset(db: Session, p: Principal, key: str) -> dict:
    """Back to the built-in options. A value that records still use but the defaults do not have stays in the list as a deactivated option, so nothing becomes orphaned."""
    spec = spec_of(key)
    used = _usage_single(db, spec)
    items = [{"value": v, "active": True} for v in spec.defaults]
    known = {_norm(v) for v in spec.defaults}
    items += [{"value": v, "active": False} for v, n in sorted(used.items()) if n and _norm(v) not in known]
    _save(db, p, spec, items)
    _log(db, p, spec, "Options reset to defaults", spec.label)
    db.commit()
    return public(db)[key]
