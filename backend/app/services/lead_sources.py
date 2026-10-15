"""Lead Sources: the catalogue of where enquiries come from, who may use / manage each source, and what is known about the integrations feeding it.

SCOPE.  A source is COMMON (no branch: every branch can choose it) or BRANCH-SPECIFIC (one branch). The branch of an enquiry is never derived from its source - the same common
source (Meta Ads, say) serves several branches, each through its own campaigns, forms or integration mappings. A branch user sees the common sources plus their branch's own, manages
only their branch's, and counts only their branch's enquiries; only the Super Admin manages common sources and looks across branches.

NAMES.  Names are compared in a normalised form (case, spacing and punctuation ignored): one common source per name, one source per name inside a branch, and a branch cannot reuse
the name of a common source. A source that is already used by CRM records can be renamed (the records keep pointing at it) or deactivated, never deleted, and cannot move scope.

INTEGRATIONS.  `lead_source_integrations` holds metadata only (platform, account / form, mapped branch, last sync, last error). No credentials live here. A status of Connected or
Error is written only by the Integrations module through `record_sync_success` / `record_sync_error`; people can record a mapping and switch it on or off, never mark it Connected."""
from datetime import UTC, date, datetime

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import AppSetting, Branch, Campaign, Customer, Deal, Employee, Enquiry, Lead, LeadSource, LeadSourceIntegration
from app.models.crm import source_key

CATEGORIES_KEY = "lead_source_categories"
DEFAULT_CATEGORIES = ["Paid Advertising", "Website", "Social Media and Messaging", "Offline", "Referral and Internal"]

# (category, name, source type, expected capture method, description). The standard starting list - not a fixed one: people add more in the CRM.
DEFAULT_SOURCES = [
    ("Paid Advertising", "Meta Ads (Facebook and Instagram)", "Digital", "API", "Enquiries from paid Facebook and Instagram campaigns and lead forms."),
    ("Paid Advertising", "Google Ads", "Digital", "API", "Enquiries from Google search, display and lead-form ads."),
    ("Paid Advertising", "Other Paid Campaigns", "Digital", "Manual", "Paid advertising on any other platform."),
    ("Website", "Website Contact Form", "Digital", "Form", "The contact form on the company website."),
    ("Website", "Website Enquiry Form", "Digital", "Form", "Product or service enquiry forms on the website."),
    ("Website", "Landing Page", "Digital", "Form", "A campaign landing page."),
    ("Social Media and Messaging", "Instagram Organic", "Digital", "Manual", "Unpaid Instagram posts, messages and comments."),
    ("Social Media and Messaging", "Facebook Organic", "Digital", "Manual", "Unpaid Facebook posts, messages and comments."),
    ("Social Media and Messaging", "LinkedIn", "Digital", "Manual", "LinkedIn messages, posts and lead generation forms."),
    ("Social Media and Messaging", "WhatsApp", "Digital", "Webhook", "Enquiries that arrive on WhatsApp."),
    ("Social Media and Messaging", "Other Social Media", "Digital", "Manual", "Any other social media platform."),
    ("Offline", "Direct Visit", "Offline", "Manual", "Someone who visited the office or showroom."),
    ("Offline", "Phone Call", "Offline", "Manual", "An incoming or outgoing phone enquiry."),
    ("Offline", "Walk-in", "Offline", "Manual", "A person who walked in without an appointment."),
    ("Offline", "Event or Exhibition", "Offline", "Manual", "Met at an event, trade show or exhibition."),
    ("Referral and Internal", "Customer Referral", "Offline", "Manual", "Referred by an existing customer."),
    ("Referral and Internal", "Employee Referral", "Offline", "Manual", "Referred or brought in by an employee."),
    ("Referral and Internal", "Partner Referral", "Offline", "Manual", "Referred by a business partner."),
    ("Referral and Internal", "Other", "Offline", "Manual", "Any source not listed."),
    # internal sources the CRM itself uses when records are imported or entered in bulk
    ("Referral and Internal", "Import", "Offline", "Manual", "Records brought in from a file."),
    ("Referral and Internal", "Manual Entry", "Offline", "Manual", "Typed in by an employee with no other source known."),
    ("Referral and Internal", "API / Integration", "Digital", "API", "Created by a connected system."),
]
# an older name means the same thing as a current one: rename the existing source (same id, so nothing that points at it changes)
RENAMES = {"Contact Form": "Website Contact Form", "Google": "Google Ads", "Phone": "Phone Call", "Partner": "Partner Referral", "Existing Customer Referral": "Customer Referral"}
# older sources the new list replaces: switched off when nothing uses them (never when records do)
SUPERSEDED = ("Facebook", "Instagram", "Advertisement", "Referral", "Campaign", "Email", "Website")
# older wording still accepted from files, scripts and old clients
SOURCE_ALIASES = {"Existing Customer": "Customer Referral", "Existing Customer Referral": "Customer Referral", "Contact Form": "Website Contact Form", "Google": "Google Ads", "Phone": "Phone Call",
                  "Partner": "Partner Referral", "Website": "Website Enquiry Form", "Referral": "Customer Referral", "Facebook": "Meta Ads (Facebook and Instagram)",
                  "Instagram": "Meta Ads (Facebook and Instagram)", "Advertisement": "Other Paid Campaigns", "Campaign": "Other Paid Campaigns", "Email": "Other"}
LEGACY_CATEGORY = {"Website": "Website", "Contact Form": "Website", "Google": "Paid Advertising", "Facebook": "Paid Advertising", "Instagram": "Paid Advertising", "Advertisement": "Paid Advertising",
                   "Campaign": "Paid Advertising", "LinkedIn": "Social Media and Messaging", "WhatsApp": "Social Media and Messaging", "Phone": "Offline", "Walk-in": "Offline",
                   "Referral": "Referral and Internal", "Existing Customer Referral": "Referral and Internal", "Partner": "Referral and Internal", "Email": "Referral and Internal"}

PROVIDERS = ["Meta Lead Ads", "Google Ads lead forms", "Website contact / enquiry form", "Instagram messaging", "Facebook messaging", "WhatsApp Business", "LinkedIn Lead Gen Forms", "Other platform"]
INTEGRATION_STATUSES = ("Not Connected", "Connected", "Error", "Inactive")


def clean(v, limit: int) -> str:
    import re

    return re.sub(r"[\x00-\x1f\x7f]", " ", str(v if v is not None else "")).strip()[:limit]


# ---- categories --------------------------------------------------------------------------------------------------------------------
def categories(db: Session) -> list[str]:
    """The categories a source can have: the configured list, plus any category an existing source already carries (so nothing already stored becomes invalid)."""
    row = db.get(AppSetting, CATEGORIES_KEY)
    base = list((row.value or {}).get("categories", [])) if row else list(DEFAULT_CATEGORIES)
    seen = {source_key(c) for c in base}
    for (cat,) in db.execute(select(LeadSource.category).distinct()).all():
        if cat and source_key(cat) not in seen:
            base.append(cat)
            seen.add(source_key(cat))
    return base


def add_category(db: Session, p: Principal, name: str) -> list[str]:
    from app.services import marketing

    if not marketing.perms_of(p)["manageSources"]:
        marketing.denied(db, p, "Lead source category", "You do not have permission to manage lead sources.")
    name = clean(name, 40)
    if len(name) < 2:
        raise invalid("Enter the category name (at least 2 characters).", {"name": "Enter a name."})
    current = categories(db)
    if source_key(name) in {source_key(c) for c in current}:
        raise invalid("That category already exists.", {"name": "Already exists."})
    row = db.get(AppSetting, CATEGORIES_KEY)
    value = {"categories": [*current, name]}
    if row is None:
        db.add(AppSetting(key=CATEGORIES_KEY, value=value, updated_by=p.actor_id))
    else:
        row.value, row.updated_by = value, p.actor_id
    marketing.log(db, p, "Lead source category added", None, name)
    db.commit()
    return value["categories"]


# ---- seeding the standard list (idempotent; safe on a database that already has the older 18) ------------------------------------------
def _uses(db: Session, source_id: str) -> bool:
    return any(db.execute(select(m.id).where(m.lead_source_id == source_id).limit(1)).first() for m in (Lead, Enquiry, Deal, Customer, Campaign))


def seed_defaults(db: Session) -> int:
    """Brings the standard sources in. Returns how many were created. Nothing existing is deleted: older sources are renamed in place, re-categorised, or - only if unused and replaced - deactivated."""
    created = 0
    sources = {s.name_key: s for s in db.execute(select(LeadSource).where(LeadSource.branch.is_(None))).scalars()}
    for old, new in RENAMES.items():
        src = sources.get(source_key(old))
        if src is not None and source_key(new) not in sources:
            src.name = new
            sources.pop(source_key(old))
            sources[source_key(new)] = src
            for model in (Lead, Enquiry, Deal, Customer):  # the readable name travels with the source; the records still point at the same source
                for rec in db.execute(select(model).where(model.lead_source_id == src.id)).scalars():
                    rec.source = new
    for category, name, source_type, method, description in DEFAULT_SOURCES:
        src = sources.get(source_key(name))
        if src is None:
            number = len(db.execute(select(LeadSource.id)).all()) + 1
            new_id = f"LS-{number:03d}"
            while db.get(LeadSource, new_id) is not None:
                number += 1
                new_id = f"LS-{number:03d}"
            db.add(LeadSource(id=new_id, name=name, category=category, source_type=source_type, capture_method=method, connected=False, active=True, system=True, description=description, attributes={}))
            db.flush()
            created += 1
        elif src.system and src.category != category:
            src.category = category
    for name, category in LEGACY_CATEGORY.items():  # older system sources that stay: place them in the new category scheme
        src = sources.get(source_key(RENAMES.get(name, name)))
        if src is not None and src.system and src.category not in DEFAULT_CATEGORIES:
            src.category = category
    for name in SUPERSEDED:
        src = sources.get(source_key(name))
        if src is not None and src.system and src.active and not _uses(db, src.id):
            src.active = False
    db.flush()
    return created


# ---- integrations (metadata only) ------------------------------------------------------------------------------------------------------
def integration_status(items: list[LeadSourceIntegration]) -> str:
    """One word for the source: Error if any mapping is failing, else Connected if any is working, else Inactive if all are switched off, else Not Connected (including no mapping at all)."""
    if any(i.status == "Error" and i.active for i in items):
        return "Error"
    if any(i.status == "Connected" and i.active for i in items):
        return "Connected"
    if items and not any(i.active for i in items):
        return "Inactive"
    return "Not Connected"


def integration_json(i: LeadSourceIntegration) -> dict:
    return {"id": i.id, "sourceId": i.source_id, "provider": i.provider, "accountName": i.account_name, "mappedBranch": i.mapped_branch, "status": i.status, "active": i.active,
            "lastSyncAt": i.last_sync_at.isoformat() if i.last_sync_at else None, "lastError": i.last_error or None, "notes": i.notes, "createdAt": i.created_at.isoformat()}


def integrations_of(db: Session, source_id: str) -> list[LeadSourceIntegration]:
    return list(db.execute(select(LeadSourceIntegration).where(LeadSourceIntegration.source_id == source_id).order_by(LeadSourceIntegration.created_at)).scalars())


def _mapping_input(db: Session, src: LeadSource, req: dict, cur: LeadSourceIntegration | None) -> dict:
    errors: dict = {}
    provider = clean(req.get("provider", cur.provider if cur else ""), 60)
    if provider not in PROVIDERS:
        errors["provider"] = "Choose the platform."
    branch = clean(req.get("mappedBranch", cur.mapped_branch if cur else ""), 40) or None
    if branch is not None:
        found = db.execute(select(Branch).where(Branch.name == branch)).scalar_one_or_none()
        if found is None or found.status != "Active":
            errors["mappedBranch"] = "Choose an active branch."
        elif src.branch is not None and src.branch != branch:
            errors["mappedBranch"] = f"This source belongs to {src.branch}; its mapping can only point there."
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    return {"provider": provider, "account_name": clean(req.get("accountName", cur.account_name if cur else ""), 160), "mapped_branch": branch if branch else src.branch,
            "notes": clean(req.get("notes", cur.notes if cur else ""), 500)}


def _only_super_admin(db: Session, p: Principal, what: str) -> None:
    from app.services import marketing

    if not p.is_super_admin:
        marketing.denied(db, p, what, "Only the Super Admin can manage integration mappings.")


def add_mapping(db: Session, p: Principal, source_id: str, req: dict) -> dict:
    from app.services import marketing

    _only_super_admin(db, p, "Lead source integration")
    src = marketing.find_source(db, source_id)
    if src is None:
        raise not_found("Lead source not found.")
    v = _mapping_input(db, src, req, None)
    row = LeadSourceIntegration(id=ids.new_id(db, "INT", 3), source_id=src.id, status="Not Connected", active=True, last_error="", created_by=p.actor_id, attributes={}, **v)
    db.add(row)
    marketing.log(db, p, "Lead source integration recorded", src.id, f"{row.provider} / {row.account_name}")
    db.commit()
    return integration_json(row)


def update_mapping(db: Session, p: Principal, source_id: str, mapping_id: str, req: dict) -> dict:
    from app.services import marketing

    _only_super_admin(db, p, "Lead source integration")
    src = marketing.find_source(db, source_id)
    row = db.get(LeadSourceIntegration, mapping_id)
    if src is None or row is None or row.source_id != src.id:
        raise not_found("Integration mapping not found.")
    for key, value in _mapping_input(db, src, req, row).items():
        setattr(row, key, value)
    if "active" in req:  # switching a mapping off or on never claims a connection: it returns to "Not Connected" until the Integrations module reports otherwise
        row.active = bool(req["active"])
        row.status = "Not Connected" if row.active else "Inactive"
    marketing.log(db, p, "Lead source integration updated", src.id, f"{row.provider} / {row.account_name}")
    db.commit()
    return integration_json(row)


def remove_mapping(db: Session, p: Principal, source_id: str, mapping_id: str) -> dict:
    from app.services import marketing

    _only_super_admin(db, p, "Lead source integration")
    src = marketing.find_source(db, source_id)
    row = db.get(LeadSourceIntegration, mapping_id)
    if src is None or row is None or row.source_id != src.id:
        raise not_found("Integration mapping not found.")
    db.delete(row)
    marketing.log(db, p, "Lead source integration removed", src.id, f"{row.provider} / {row.account_name}")
    db.commit()
    return {"success": True}


def record_sync_success(db: Session, mapping_id: str, when: datetime | None = None) -> None:
    """Called by the Integrations module after a successful sync - the ONLY way a mapping becomes Connected. (Not reachable over HTTP from the CRM screens.)"""
    row = db.get(LeadSourceIntegration, mapping_id)
    if row is not None and row.active:
        row.status, row.last_sync_at, row.last_error = "Connected", when or datetime.now(UTC), ""
        db.flush()


def record_sync_error(db: Session, mapping_id: str, message: str) -> None:
    """Called by the Integrations module when a sync fails: the mapping shows Error with a short summary (never a secret)."""
    row = db.get(LeadSourceIntegration, mapping_id)
    if row is not None and row.active:
        row.status, row.last_error = "Error", clean(message, 500)
        db.flush()


# ---- listing, detail extras ----------------------------------------------------------------------------------------------------------------
def _parse_day(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


class _BranchView:
    """Lets the Super Admin look at one branch's numbers while the request itself spans all branches (and restores the scope afterwards)."""

    def __init__(self, db: Session, branch: str | None):
        self.db, self.branch, self.saved = db, branch, None

    def __enter__(self):
        from app.db.branch import BranchScope, get_scope, set_scope

        self.saved = get_scope(self.db)
        if self.branch:
            set_scope(self.db, BranchScope(read=self.branch, write=self.saved.write if self.saved else None, all_access=bool(self.saved and self.saved.all_access)))
        return self

    def __exit__(self, *exc):
        from app.db.branch import set_scope

        set_scope(self.db, self.saved)


def enquiry_counts(db: Session, start: date | None, end: date | None) -> dict[str, tuple[int, int]]:
    """source id -> (enquiries received, enquiries converted into a lead), inside the session's branch scope and the date range."""
    stmt = select(Enquiry.lead_source_id, func.count(), func.coalesce(func.sum(case((Enquiry.converted_lead_id.is_not(None), 1), else_=0)), 0)).where(Enquiry.lead_source_id.is_not(None))
    if start:
        stmt = stmt.where(Enquiry.date >= start)
    if end:
        stmt = stmt.where(Enquiry.date <= end)
    return {sid: (int(n), int(c)) for sid, n, c in db.execute(stmt.group_by(Enquiry.lead_source_id)).all()}


def rate(converted: int, received: int) -> float:
    return round(converted / received * 100, 1) if received else 0.0


def list_sources(db: Session, p: Principal, params: dict) -> list[dict]:
    from app.services import marketing

    perm = marketing.perms_of(p)
    if not perm["viewSources"]:
        marketing.denied(db, p, "Lead sources view", "You do not have access to lead sources.")
    branch = clean(params.get("branch"), 40) if p.is_super_admin and params.get("branch") not in (None, "", "all") else None
    if branch and db.execute(select(Branch.id).where(Branch.name == branch)).first() is None:
        raise invalid("Unknown branch.", {"branch": "Unknown branch."})
    start, end = _parse_day(params.get("from")), _parse_day(params.get("to"))
    with _BranchView(db, branch):
        stmt = marketing.visible_sources(db)
        by_id = {r["id"]: r for r in marketing.compute_marketing(marketing.dataset(db), {k: v for k, v in (("from", params.get("from")), ("to", params.get("to"))) if v})["sources"]}
        counts = enquiry_counts(db, start, end)
        sources = list(db.execute(stmt.order_by(LeadSource.id)).scalars())
        maps: dict[str, list[LeadSourceIntegration]] = {}
        for m in db.execute(select(LeadSourceIntegration)).scalars():
            maps.setdefault(m.source_id, []).append(m)
        names = dict(db.execute(select(Employee.id, Employee.full_name)).all())
    out = []
    for s in sources:
        if branch and s.branch not in (None, branch):
            continue
        received, converted = counts.get(s.id, (0, 0))
        items = maps.get(s.id, [])
        row = marketing.source_public(p, s, by_id.get(s.id), perm)
        row.update(scope="Common" if s.branch is None else "Branch-specific", enquiryCount=received, convertedLeadCount=converted, enquiryConversionRate=rate(converted, received),
                   integrationStatus=integration_status(items), integrationCount=len(items), createdByName=names.get(s.created_by) or ("System" if s.system else None), used=_uses(db, s.id))
        out.append(row)
    return out


def detail_extras(db: Session, p: Principal, s: LeadSource) -> dict:
    items = integrations_of(db, s.id)
    received, converted = enquiry_counts(db, None, None).get(s.id, (0, 0))
    created_by = db.get(Employee, s.created_by) if s.created_by else None
    return {"scope": "Common" if s.branch is None else "Branch-specific", "integrations": [integration_json(i) for i in items], "integrationStatus": integration_status(items), "enquiryCount": received,
            "convertedLeadCount": converted, "enquiryConversionRate": rate(converted, received), "createdByName": created_by.full_name if created_by else ("System" if s.system else None), "used": _uses(db, s.id),
            "perms": {"edit": None, "manageIntegrations": p.is_super_admin}}


# ---- create / change / delete -----------------------------------------------------------------------------------------------------------------
def source_options(db: Session, p: Principal) -> list[dict]:
    """The active sources this person may choose when creating or editing a lead or enquiry: common ones plus their branch's own."""
    from app.services import marketing

    if not (p.can("Leads", "view") or p.can("Enquiries", "view") or p.can("Deals", "view") or marketing.perms_of(p)["viewSources"]):
        marketing.denied(db, p, "Lead source options", "You do not have access to lead sources.")
    return [{"id": s.id, "name": s.name, "category": s.category, "branch": s.branch, "shared": s.branch is None}
            for s in db.execute(marketing.visible_sources(db).where(LeadSource.active.is_(True)).order_by(LeadSource.category, LeadSource.name)).scalars()]


def _target_scope(db: Session, p: Principal, req: dict, cur: LeadSource | None) -> str | None:
    """The branch the source will belong to (None = common), decided by who is asking and what they asked for."""
    wanted = str(req.get("scope") or "").strip().lower()
    if wanted and wanted not in ("common", "branch", "branch-specific"):
        raise invalid("Choose Common or Branch-specific.", {"scope": "Choose a scope."})
    if not p.is_super_admin:  # a branch's marketing user works inside their own branch only
        if wanted == "common" or (cur is not None and cur.branch is None):
            raise forbidden("Common lead sources are managed by the Super Admin.")
        if "branch" in req and req["branch"] not in (None, "", p.scope.write):
            raise forbidden("You can only manage lead sources of your own branch.")
        return p.scope.write
    if cur is not None and not wanted:
        wanted = "common" if cur.branch is None else "branch"
    if not wanted:  # no explicit choice: following the branch the Super Admin is looking at keeps the older behaviour
        wanted = "branch" if p.scope.write else "common"
    if wanted == "common":
        return None
    branch = clean(req.get("branch") or (cur.branch if cur else None) or p.scope.write, 40)
    found = db.execute(select(Branch).where(Branch.name == branch)).scalar_one_or_none() if branch else None
    if found is None:
        raise invalid("Choose the branch this source belongs to.", {"branch": "Choose a branch."})
    if found.status != "Active" and (cur is None or cur.branch != found.name):
        raise invalid(f"The {found.name} branch is inactive.", {"branch": "Branch is inactive."})
    return found.name


def _duplicate(db: Session, name: str, branch: str | None, exclude_id: str | None) -> LeadSource | None:
    """A common source clashes with the same name anywhere; a branch source clashes with the same name in that branch or among the common sources. (Looked up across ALL branches.)"""
    from app.db.branch import get_scope, set_scope

    saved = get_scope(db)
    set_scope(db, None)  # the rule is about the whole catalogue, not what the caller can see
    try:
        stmt = select(LeadSource).where(LeadSource.name_key == source_key(name))
        if branch is not None:
            stmt = stmt.where(LeadSource.branch.is_(None) | (LeadSource.branch == branch))
        if exclude_id:
            stmt = stmt.where(LeadSource.id != exclude_id)
        return db.execute(stmt).scalars().first()
    finally:
        set_scope(db, saved)


def _input(db: Session, p: Principal, req: dict, cur: LeadSource | None) -> dict:
    errors: dict = {}
    v: dict = {}
    v["name"] = clean(req.get("name", cur.name if cur else ""), 60)
    v["category"] = clean(req.get("category", cur.category if cur else ""), 60)
    if len(v["name"]) < 2:
        errors["name"] = "Enter the source name."
    if v["category"] not in categories(db):
        errors["category"] = "Choose a category from the list, or add a new one."
    v["source_type"] = clean(req.get("sourceType", cur.source_type if cur else "Digital"), 60)
    v["capture_method"] = clean(req.get("captureMethod", cur.capture_method if cur else "Manual"), 30)
    v["description"] = clean(req.get("description", cur.description if cur else ""), 500)
    if errors:
        raise invalid(next(iter(errors.values())), errors)
    branch = _target_scope(db, p, req, cur)
    if cur is not None and branch != cur.branch and _uses(db, cur.id):
        raise conflict("This source is already used by CRM records, so it cannot move between Common and a branch. Deactivate it and create a new one instead.", {"scope": "In use."})
    clash = _duplicate(db, v["name"], branch, cur.id if cur else None)
    if clash is not None:
        where = "among the common sources" if clash.branch is None else f"in the {clash.branch} branch"
        raise invalid(f"A source named “{clash.name}” already exists {where}.", {"name": "A source with this name already exists."})
    v["branch"] = branch
    return v


def create_source(db: Session, p: Principal, req: dict) -> dict:
    from app.services import marketing

    if not marketing.perms_of(p)["manageSources"]:
        marketing.denied(db, p, "Lead source create", "You do not have permission to manage lead sources.")
    v = _input(db, p, req, None)
    new_id = ids.new_id(db, "LS", 3)
    while db.get(LeadSource, new_id) is not None:  # the standard sources were seeded with fixed ids
        new_id = ids.new_id(db, "LS", 3)
    s = LeadSource(id=new_id, active=req.get("active") is not False, system=False, created_by=p.actor_id, attributes={}, **v)
    db.add(s)
    marketing.log(db, p, "Lead source created", s.id, f"{s.name} ({'common' if s.branch is None else s.branch})")
    db.commit()
    return marketing.to_json(s)


def update_source(db: Session, p: Principal, source_id: str, req: dict) -> dict:
    from app.services import marketing

    if not marketing.perms_of(p)["manageSources"]:
        marketing.denied(db, p, "Lead source edit", "You do not have permission to manage lead sources.")
    cur = marketing.find_source(db, source_id)
    if cur is None:
        raise not_found("Lead source not found.")
    if not marketing._can_manage(p, cur, marketing.perms_of(p)):
        marketing.denied(db, p, "Lead source edit", "Common lead sources are managed by the Super Admin.")
    v = _input(db, p, req, cur)
    old = cur.name
    for k, val in v.items():
        setattr(cur, k, val)
    if "active" in req:
        cur.active = bool(req["active"])
    if cur.name != old:  # records keep pointing at the source; the readable name follows it
        for model in (Lead, Enquiry, Deal, Customer):
            for r in db.execute(select(model).where(model.lead_source_id == cur.id)).scalars():
                r.source = cur.name
    marketing.log(db, p, "Lead source updated", cur.id, f"{old} -> {str(req)[:200]}")
    db.commit()
    return marketing.to_json(cur)


def delete_source(db: Session, p: Principal, source_id: str) -> dict:
    from app.services import marketing

    if not marketing.perms_of(p)["manageSources"]:
        marketing.denied(db, p, "Lead source delete", "You do not have permission to manage lead sources.")
    cur = marketing.find_source(db, source_id)
    if cur is None:
        raise not_found("Lead source not found.")
    if not marketing._can_manage(p, cur, marketing.perms_of(p)):
        marketing.denied(db, p, "Lead source delete", "Common lead sources are managed by the Super Admin.")
    if cur.system:
        raise conflict("A standard source can be deactivated but not deleted.", code="IN_USE")
    if _uses(db, cur.id):
        raise conflict("This source is used by enquiries, leads or other CRM records, so it cannot be deleted. Deactivate it instead.", code="IN_USE")
    db.delete(cur)
    marketing.log(db, p, "Lead source deleted", source_id, cur.name)
    db.commit()
    return {"success": True}


# ---- attribution carried on enquiries and leads ----------------------------------------------------------------------------------------
ATTRIBUTION_FIELDS = (("ad_name", "adName", 160), ("ad_id", "adId", 80), ("landing_page", "landingPage", 200), ("utm_source", "utmSource", 120), ("utm_medium", "utmMedium", 120),
                      ("utm_campaign", "utmCampaign", 160), ("utm_content", "utmContent", 160))
# what conversion copies from an enquiry to its lead (and from a lead to the deal / customer it creates is the source ids, which already travel): the ORIGINAL attribution, never rewritten
CARRIED = ("source_category", "ad_name", "ad_id", "landing_page", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referring_employee_id")


def check_attribution(db: Session, p: Principal, obj, changes: dict | None = None) -> None:
    """Optional attribution fields on a new / edited enquiry or lead: tidy text within its length, and a referring employee who is a real employee of the record's branch.
    Only the fields in `changes` (camelCase keys) are looked at when updating; everything is checked on create."""
    for column, key, limit in ATTRIBUTION_FIELDS:
        if changes is not None and key not in changes:
            continue
        raw = str(getattr(obj, column) or "")
        if len(raw.strip()) > limit:
            raise invalid(f"{key} can be at most {limit} characters.", {key: f"At most {limit} characters."})
        setattr(obj, column, clean(raw, limit))
    if changes is None or "referringEmployeeId" in changes:
        ref = getattr(obj, "referring_employee_id", None)
        if ref:
            emp = db.get(Employee, ref)
            where = getattr(obj, "branch", None) or p.scope.write
            if emp is None or (where is not None and emp.branch not in (None, where)):
                raise invalid("Choose an employee of this branch as the referring employee.", {"referringEmployeeId": "Choose an employee of this branch."})
        else:
            obj.referring_employee_id = None


def stamp_created_via(obj, via: str = "Manual") -> None:
    obj.created_via = via
