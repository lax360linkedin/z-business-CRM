"""Spreadsheet imports (Leads, Enquiries, Employees): ONE description of each import's columns drives the downloadable Excel template, the reading of the uploaded file and the checking of
every row, so the template can never drift from what the import accepts.

* `schema_for` describes a module's columns to the browser (header, required, kind, the allowed values read live from the CRM - sources, departments, option lists ...), which builds the
  `.xlsx` template and maps the uploaded file's headers.
* `preview` checks every row WITHOUT writing anything and says, per row, what is wrong (missing required value, value not on the list, bad date / email / number, owner not found, duplicate
  of an existing record or of an earlier row of the same file).
* `commit` creates the valid rows one by one through the same record engine as the "Add" form (so every module rule, audit entry, branch stamp and automation event applies), and returns what was
  created and what was refused and why. Nothing is skipped silently.
Branch isolation and record scope come from the session exactly as for any other request; the Super Admin must be working inside one branch to import leads or enquiries."""
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, forbidden, invalid, not_found
from app.models import Branch, Department, Employee, Enquiry, Lead, LeadSource, Product, Team
from app.services import audit, data_scope, flows, lead_sources, marketing, option_lists, records
from app.services.org import WORKING

log = logging.getLogger("app.imports")
MAX_ROWS = 500
MAX_COMMIT_ROWS = 100
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE = re.compile(r"^[+0-9()\-\s]{7,20}$")
DAY_FIRST = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$")
EXCEL_EPOCH = date(1899, 12, 30)


@dataclass(frozen=True)
class Col:
    key: str
    header: str
    kind: str = "text"  # text | email | phone | date | number | choice (only the listed values) | suggest (listed values offered, anything else accepted)
    required: bool = False
    options: Callable[[Session, Principal], list[str]] | tuple | None = None
    examples: tuple[str, ...] = ()
    help: str = ""
    aliases: tuple[str, ...] = ()
    max_len: int = 0
    width: int = 20
    default: str = ""  # what is used when the cell is left empty


@dataclass
class ImportModule:
    key: str
    label: str
    sheet: str
    permission: str  # the module whose "create" right is needed
    mode: str  # partial = every valid row is imported and the rest reported; atomic = all or nothing
    columns: list[Col]
    notes: list[str] = field(default_factory=list)
    spec_key: str | None = None  # the record-engine module rows are created through (None: the module has its own importer)


# ---- allowed values, read live ----------------------------------------------------------------------------------------------------------
def _option_list(key: str) -> Callable[[Session, Principal], list[str]]:
    def load(db: Session, p: Principal) -> list[str]:
        return [i["value"] for i in option_lists.items_of(db, option_lists.spec_of(key)) if i["active"]]

    return load


def _sources(db: Session, p: Principal) -> list[str]:
    return [s.name for s in db.execute(marketing.visible_sources(db).where(LeadSource.active.is_(True)).order_by(LeadSource.category, LeadSource.name)).scalars()]


def _products(db: Session, p: Principal) -> list[str]:
    return [n for (n,) in db.execute(select(Product.name).where(Product.status == "Active").order_by(Product.name).limit(300)).all()]


def _branches(db: Session, p: Principal) -> list[str]:
    return [n for (n,) in db.execute(select(Branch.name).where(Branch.status == "Active").order_by(Branch.name)).all()]


def _departments(db: Session, p: Principal) -> list[str]:
    return [n for (n,) in db.execute(select(Department.name).where(Department.status == "Active").order_by(Department.name)).all()]


def _teams(db: Session, p: Principal) -> list[str]:
    return sorted({n for (n,) in db.execute(select(Team.name).where(Team.status == "Active")).all()})


def _const(*values: str) -> tuple:
    return tuple(values)


def _org_constants():
    from app.services import org_admin

    return org_admin


def _emp_types(db, p):
    return list(_org_constants().EMPLOYMENT_TYPES)


def _work_modes(db, p):
    return list(_org_constants().WORK_MODES)


def _shifts(db, p):
    return list(_org_constants().SHIFTS)


def _genders(db, p):
    return list(_org_constants().GENDERS)


def _locations(db, p):
    return ["Office", "Remote", "Hybrid"]


def _working(db, p):
    return list(WORKING)


OWNER_HELP = "Employee ID (EMP-003), email or full name of a working employee in your branch. Leave empty for no owner."

LEADS = ImportModule(
    key="leads", label="Leads", sheet="Leads", permission="Leads", mode="partial", spec_key="leads",
    columns=[
        Col("name", "Contact Name", required=True, examples=("Meera Iyer", "Arjun Rao"), help="The person to contact.", aliases=("name", "lead name", "full name", "contact"), max_len=160, width=24),
        Col("company", "Company", examples=("Iyer Textiles Pvt Ltd", "Rao Logistics"), help="Company name as you would write it.", max_len=200, width=26),
        Col("designation", "Designation", examples=("Purchase Manager", "Director"), max_len=120),
        Col("email", "Email", kind="email", examples=("meera@iyertextiles.in", "arjun@raologistics.in"), help="Used to spot duplicates.", width=28),
        Col("phone", "Phone", kind="phone", examples=("+91 98400 12345", "9876543210"), help="7-20 digits; may include + ( ) - and spaces. Used to spot duplicates."),
        Col("website", "Website", examples=("iyertextiles.in",), max_len=200),
        Col("industry", "Industry", kind="suggest", options=_option_list("industries"), examples=("Manufacturing", "Logistics"), help="Pick from the list, or type your own.", max_len=120),
        Col("location", "City / Location", kind="suggest", options=_option_list("cities"), examples=("Chennai", "Salem"), help="Pick from the list, or type your own.", max_len=120),
        Col("source", "Source", kind="choice", options=_sources, examples=("Website", "Referral"), help="Where the lead came from: one of the configured, active lead sources.", default="Import"),
        Col("sourceDetail", "Source Detail", examples=("Contact form, pricing page",), max_len=200),
        Col("service", "Service / Product", kind="suggest", options=_products, examples=("Business Workflow Automation", "AI Chatbots"), help="Pick from the catalogue, or type your own.", max_len=200, width=28),
        Col("requirement", "Requirement", examples=("Automate invoice approvals",), help="What the lead needs.", max_len=4000, width=34),
        Col("budget", "Budget (INR)", kind="number", examples=("250000", "80000"), help="A number, without currency symbols."),
        Col("expectedPurchaseDate", "Expected Purchase Date", kind="date", examples=("2026-12-15",), help="yyyy-mm-dd (dd/mm/yyyy is also understood)."),
        Col("priority", "Priority", kind="choice", options=tuple(flows.PRIORITIES), examples=("High", "Medium"), default="Medium", help="Defaults to Medium."),
        Col("assignedTo", "Assigned To", examples=("EMP-003", "asha.mehta@lax360.com"), help=OWNER_HELP, width=26),
        Col("nextFollowUp", "Next Follow-up", kind="date", examples=("2026-11-03",), help="yyyy-mm-dd (dd/mm/yyyy is also understood)."),
    ],
    notes=[
        "Every imported lead starts with the status New.",
        "Only Contact Name is required. Rows are checked before anything is created; rows with a problem are listed with the reason and are not imported.",
        "A row whose Email or Phone already belongs to an existing lead, or repeats an earlier row of the file, is reported as a duplicate and not imported.",
        "The Source must be one of the configured lead sources (see the Lists sheet); an empty Source becomes “Import”.",
        "You must be working inside a branch (the branch selector in the top bar) so the leads belong to it. Super Admins: pick one branch first.",
    ],
)

ENQUIRIES = ImportModule(
    key="enquiries", label="Enquiries", sheet="Enquiries", permission="Enquiries", mode="partial", spec_key="enquiries",
    columns=[
        Col("name", "Name", required=True, examples=("Kavitha Menon", "Rohit Shah"), help="The person who enquired.", aliases=("contact name", "enquirer", "full name"), max_len=160, width=24),
        Col("company", "Company", examples=("Menon Foods", ""), max_len=200, width=24),
        Col("designation", "Designation", examples=("Owner",), max_len=120),
        Col("email", "Email", kind="email", examples=("kavitha@menonfoods.in", "rohit.shah@example.com"), help="Used to spot duplicates.", width=28),
        Col("phone", "Phone", kind="phone", examples=("+91 99620 54321", "9811122233"), help="7-20 digits; may include + ( ) - and spaces. Used to spot duplicates."),
        Col("city", "City", kind="suggest", options=_option_list("cities"), examples=("Coimbatore", "Mumbai"), help="Pick from the list, or type your own.", aliases=("location",), max_len=80),
        Col("state", "State", examples=("Tamil Nadu", "Maharashtra"), max_len=60),
        Col("country", "Country", examples=("India",), default="India", max_len=60),
        Col("source", "Source", kind="choice", options=_sources, examples=("Website", "Phone Call"), help="Where the enquiry came from: one of the configured, active lead sources.", default="Import"),
        Col("enquiryType", "Enquiry Type", kind="choice", options=_option_list("enquiry_types"), examples=("Service Enquiry", "Pricing Enquiry"), default="General Enquiry", help="Defaults to General Enquiry."),
        Col("priority", "Priority", kind="choice", options=tuple(flows.ENQUIRY_PRIORITIES), examples=("High", "Medium"), default="Medium", help="Defaults to Medium."),
        Col("interestedService", "Interested Service / Product", kind="suggest", options=_products, examples=("AI Chatbots", "Business Workflow Automation"), help="Pick from the catalogue, or type your own.", max_len=200, width=28),
        Col("requirementType", "Requirement Type", kind="choice", options=_option_list("requirement_types"), examples=("New Requirement",), default="New Requirement", help="Defaults to New Requirement."),
        Col("requirementDescription", "Requirement Description", examples=("Wants a WhatsApp enquiry bot",), max_len=4000, width=34),
        Col("expectedPurchaseDate", "Expected Purchase Date", kind="date", examples=("2026-12-01",), help="yyyy-mm-dd (dd/mm/yyyy is also understood)."),
        Col("preferredContactMethod", "Preferred Contact Method", kind="choice", options=_option_list("contact_methods"), examples=("Phone", "WhatsApp"), default="Phone", help="Defaults to Phone."),
        Col("assignedUser", "Assigned To", examples=("EMP-003",), help=OWNER_HELP, aliases=("assigned user", "owner"), width=26),
        Col("nextFollowUp", "Next Follow-up", kind="date", examples=("2026-11-05",), help="yyyy-mm-dd (dd/mm/yyyy is also understood)."),
    ],
    notes=[
        "Only Name is required. Rows are checked before anything is created; rows with a problem are listed with the reason and are not imported.",
        "A row whose Email or Phone already belongs to an existing enquiry, or repeats an earlier row of the file, is reported as a duplicate and not imported.",
        "An enquiry with an Assigned To starts as Assigned; otherwise it starts as New.",
        "A Company that does not exist yet is created in Companies automatically (existing ones are matched by name, never duplicated).",
        "You must be working inside a branch (the branch selector in the top bar) so the enquiries belong to it. Super Admins: pick one branch first.",
    ],
)

EMPLOYEES = ImportModule(
    key="employees", label="Employees", sheet="Employees", permission="Employees", mode="atomic",
    columns=[
        Col("branch", "Branch", kind="choice", options=_branches, examples=("Salem", "Mumbai"), help="Required for the Super Admin. Branch users: leave empty, your own branch is used."),
        Col("employeeId", "Employee ID", examples=("", ""), help="Optional, format EMP-001. Leave empty to have one assigned.", aliases=("id", "emp id"), width=14),
        Col("fullName", "Full Name", required=True, examples=("Jane Doe", "Karthik Raman"), aliases=("name", "employee name"), max_len=160, width=24),
        Col("officialEmail", "Official Email", kind="email", required=True, examples=("jane.doe@lax360.com", "karthik.raman@lax360.com"), aliases=("email", "work email"), help="Must be unique.", width=30),
        Col("mobile", "Mobile", kind="phone", examples=("+91 90000 00000", "9876500000"), aliases=("phone", "mobile number"), help="7-20 digits; may include + ( ) - and spaces."),
        Col("altPhone", "Alternate Phone", kind="phone", examples=("",), aliases=("alternate number", "alt phone")),
        Col("designation", "Designation", required=True, examples=("Software Engineer", "Sales Executive"), max_len=120, width=22),
        Col("jobTitle", "Job Title", examples=("",), max_len=120),
        Col("department", "Department", kind="choice", required=True, options=_departments, examples=("IT / Tech Services", "Sales"), help="One of the active departments."),
        Col("team", "Team", kind="suggest", options=_teams, examples=("Web Development Team", ""), help="A team of that department. Leave empty for none.", width=24),
        Col("subTeam", "Sub-team", examples=("",), aliases=("sub team", "sub-team", "subteam")),
        Col("teamLeader", "Team Leader", examples=("",), aliases=("team leader",), help="Employee ID, email or full name of the team's leader (only needed if it differs from the team's leader)."),
        Col("reportsTo", "Reports To", examples=("",), aliases=("manager", "reports to"), help="Employee ID, email or full name of the manager. Empty: the team leader or department head."),
        Col("joinDate", "Joining Date", kind="date", required=True, examples=("2026-11-01", "2026-11-15"), aliases=("join date", "joining date"), help="yyyy-mm-dd (dd/mm/yyyy is also understood)."),
        Col("employmentType", "Employment Type", kind="choice", options=_emp_types, examples=("Full-time", "Intern"), default="Full-time", aliases=("employment type",), help="Defaults to Full-time."),
        Col("status", "Status", kind="choice", options=_working, examples=("Active", "Probation"), default="Active", help="Only working statuses can be imported. Defaults to Active."),
        Col("workMode", "Work Mode", kind="choice", options=_work_modes, examples=("Hybrid", "On-site"), default="On-site", aliases=("work mode",), help="Defaults to On-site."),
        Col("workLocation", "Work Location", kind="suggest", options=_locations, examples=("Office", "Client site, Pune"), default="Office", aliases=("work location",), help="Office, Remote, Hybrid, or type the place. Defaults to Office.", max_len=80),
        Col("shift", "Shift", kind="choice", options=_shifts, examples=("General (9:00–18:00)",), help="Defaults to the General shift.", width=24),
        Col("gender", "Gender", kind="choice", options=_genders, examples=("",), help="Optional."),
        Col("dob", "Date of Birth", kind="date", examples=("",), aliases=("date of birth", "birth date"), help="Optional. yyyy-mm-dd."),
        Col("personalEmail", "Personal Email", kind="email", examples=("",), aliases=("personal email",), width=28),
        Col("address", "Address", examples=("",), max_len=400, width=30),
    ],
    notes=[
        "Required: Full Name, Official Email, Designation, Department and Joining Date (and Branch for the Super Admin).",
        "Rows are checked before anything is created. If any row has a problem, nothing is imported: fix the rows listed and import again.",
        "Departments, teams, leaders and managers must already exist; people are matched by Employee ID, email or full name.",
        "Employee IDs and Official Emails must be unique, across the file and across existing employees.",
        "Importing creates employee records only. Give them a CRM login afterwards from Employees → Grant CRM access.",
    ],
)

MODULES = {m.key: m for m in (LEADS, ENQUIRIES, EMPLOYEES)}


def module_of(key: str) -> ImportModule:
    mod = MODULES.get(key)
    if mod is None:
        raise not_found("This module has no import.")
    return mod


def _can_import(p: Principal, mod: ImportModule) -> bool:
    if mod.key == "employees":
        from app.services import org_admin

        return bool(org_admin.perms_of(p)["import"])
    return p.can(mod.permission, "create")


def _require(p: Principal, mod: ImportModule) -> None:
    if not _can_import(p, mod):
        raise forbidden(f"You do not have permission to import {mod.label.lower()}.")


def _options(col: Col, db: Session, p: Principal) -> list[str] | None:
    if col.options is None:
        return None
    return list(col.options(db, p)) if callable(col.options) else list(col.options)


# ---- schema for the browser ---------------------------------------------------------------------------------------------------------------
def schema_for(db: Session, p: Principal, key: str) -> dict:
    mod = module_of(key)
    _require(p, mod)
    cols = []
    for c in mod.columns:
        options = _options(c, db, p)
        required = c.required or (mod.key == "employees" and c.key == "branch" and p.scope.write is None)
        cols.append({"key": c.key, "header": c.header, "kind": c.kind, "required": required, "options": options, "examples": list(c.examples), "help": c.help, "aliases": list(c.aliases),
                     "default": c.default, "width": c.width, "maxLen": c.max_len})
    return {"module": mod.key, "label": mod.label, "sheet": mod.sheet, "mode": mod.mode, "maxRows": MAX_ROWS, "columns": cols, "notes": mod.notes,
            "blocked": _blocked(p, mod)}


def _blocked(p: Principal, mod: ImportModule) -> str | None:
    if mod.key in ("leads", "enquiries") and p.scope.write is None:
        return f"Choose the branch to import into (the branch selector in the top bar) before importing {mod.label.lower()}: every record belongs to one branch."
    return None


# ---- reading one value --------------------------------------------------------------------------------------------------------------------
def parse_date(value: Any) -> date | None:
    """yyyy-mm-dd (also with a time), dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, or an Excel serial number. Raises ValueError when it is none of them."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if re.fullmatch(r"\d{5}(\.\d+)?", text) and 20000 <= int(float(text)) <= 80000:  # a date typed into Excel that came through as its serial number
        return EXCEL_EPOCH + timedelta(days=int(float(text)))
    m = DAY_FIRST.match(text)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    if re.match(r"^\d{4}-\d{2}-\d{2}", text):
        return date.fromisoformat(text[:10])
    raise ValueError(text)


def _clean(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text).strip()
    return text[:-2] if re.fullmatch(r"-?\d+\.0", text) else text  # Excel hands whole numbers over as 12.0


def _normalise(col: Col, raw: Any, options: list[str] | None) -> tuple[Any, str | None]:
    text = _clean(raw)
    if not text:
        return "", None
    if col.max_len and len(text) > col.max_len:
        return text, f"{col.header} is too long (at most {col.max_len} characters)"
    if col.kind == "email":
        text = text.lower()
        return (text, None) if EMAIL.match(text) else (text, f"{col.header} “{text}” is not a valid email address")
    if col.kind == "phone":
        return (text, None) if PHONE.match(text) else (text, f"{col.header} “{text}” is not a valid phone number (7-20 digits, may include + ( ) - and spaces)")
    if col.kind == "number":
        try:
            number = float(re.sub(r"[₹,\s]|INR|Rs\.?", "", text, flags=re.I))
        except ValueError:
            return text, f"{col.header} “{text}” is not a number"
        return (number, None) if number >= 0 else (text, f"{col.header} cannot be negative")
    if col.kind == "date":
        try:
            return parse_date(text).isoformat(), None
        except ValueError:
            return text, f"{col.header} “{text}” is not a valid date (use yyyy-mm-dd or dd/mm/yyyy)"
    if col.kind in ("choice", "suggest") and options is not None:
        hit = next((o for o in options if o.lower() == text.lower()), None)
        if hit is not None:
            return hit, None
        if col.kind == "choice":
            shown = ", ".join(options[:10]) + (" …" if len(options) > 10 else "")
            return text, f"{col.header} “{text}” is not one of the allowed values ({shown})" if options else f"{col.header} has no allowed values configured"
    return text, None


def normalise_row(db: Session, p: Principal, mod: ImportModule, raw: dict, option_cache: dict | None = None, quiet: frozenset = frozenset(), bad: set | None = None) -> tuple[dict, list[str]]:
    """Cleans one uploaded row against the columns. Returns (values by key, problems). `quiet` keys are cleaned but not complained about (the caller has a better message for them)."""
    cache = option_cache if option_cache is not None else {}
    values: dict[str, Any] = {}
    errors: list[str] = []
    for col in mod.columns:
        if col.key not in cache:
            cache[col.key] = _options(col, db, p)
        value, error = _normalise(col, raw.get(col.key), cache[col.key])
        if error and col.key not in quiet:
            errors.append(error)
            if bad is not None:
                bad.add(col.key)
        values[col.key] = value
        if value == "" and col.required and not (mod.key == "employees" and col.key == "branch") and col.key not in quiet:
            errors.append(f"{col.header} is required")
            if bad is not None:
                bad.add(col.key)
    return values, errors


# ---- leads / enquiries --------------------------------------------------------------------------------------------------------------------
def _digits(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 10 else d


def _resolve_person(db: Session, p: Principal, text: str, cache: dict) -> tuple[str | None, str | None]:
    """An owner named by Employee ID, email or full name -> employee id. Only working employees visible in the session's branch can own records."""
    if not text:
        return None, None
    if "people" not in cache:
        cache["people"] = list(db.execute(select(Employee).where(Employee.status.in_(WORKING))).scalars())
    n = text.strip().lower()
    hits = [e for e in cache["people"] if n in (e.id.lower(), (e.official_email or "").lower())] or [e for e in cache["people"] if e.full_name.lower() == n]
    if not hits:
        return None, f"Assigned To “{text}” was not found among the working employees of this branch (use their Employee ID, email or full name)"
    if len(hits) > 1:
        return None, f"Assigned To “{text}” matches more than one employee; use their Employee ID or email"
    return hits[0].id, None


def _existing_contacts(db: Session, p: Principal, model, module_label: str) -> dict:
    """email / phone of the module's records in this branch, with whether this person may be told which record it is (their own record scope)."""
    owner_col = Lead.assigned_to if model is Lead else Enquiry.assigned_user
    scope = data_scope.owner_filter(p, module_label, owner_col, model.created_by)
    visible = set(db.execute(select(model.id).where(scope)).scalars()) if scope is not None else None
    by_email: dict[str, str] = {}
    by_phone: dict[str, str] = {}
    for rid, email, phone in db.execute(select(model.id, model.email, model.phone)).all():
        if email:
            by_email.setdefault(email.strip().lower(), rid)
        if phone and _digits(phone):
            by_phone.setdefault(_digits(phone), rid)
    return {"email": by_email, "phone": by_phone, "visible": visible}


def _who(existing: dict, rid: str, singular: str) -> str:
    return f"{singular} {rid}" if existing["visible"] is None or rid in existing["visible"] else f"{singular} held by someone else"


def prepare(db: Session, p: Principal, mod: ImportModule, rows: list[dict]) -> list[dict]:
    """Checks every row (no writes). Each result: { row, errors, payload } where payload is what would be created."""
    model, singular = (Lead, "lead") if mod.key == "leads" else (Enquiry, "enquiry")
    existing = _existing_contacts(db, p, model, mod.permission)
    seen_email: dict[str, int] = {}
    seen_phone: dict[str, int] = {}
    cache: dict = {}
    people_cache: dict = {}
    aliases = {k.lower(): v for k, v in lead_sources.SOURCE_ALIASES.items()}
    out = []
    for index, raw in enumerate(rows, start=1):
        number = int(raw.get("_row") or index + 1)  # the row number the person sees in their spreadsheet (the header is row 1)
        raw = {**raw, "source": aliases.get(_clean(raw.get("source")).lower(), raw.get("source"))}  # older wording ("Website", "Referral" ...) still means the current source
        values, errors = normalise_row(db, p, mod, raw, cache)
        owner_key = "assignedTo" if mod.key == "leads" else "assignedUser"
        owner_id, owner_error = _resolve_person(db, p, str(values.get(owner_key) or ""), people_cache)
        if owner_error:
            errors.append(owner_error)
        source = values.get("source") or "Import"
        if not any(e.startswith("Source ") for e in errors):  # (a source that was already refused as "not an allowed value" is not reported twice)
            src = marketing.find_source(db, None, source)
            if src is None or not src.active:
                errors.append(f"Source “{source}” is not a configured, active lead source")
        email, phone = (values.get("email") or "").lower(), _digits(values.get("phone") or "")
        if email and email in existing["email"]:
            errors.append(f"Duplicate: {_who(existing, existing['email'][email], singular)} already has the email {email}")
        elif email and email in seen_email:
            errors.append(f"Duplicate: the email {email} is already used by row {seen_email[email]} of this file")
        if phone and phone in existing["phone"] and not (email and email in existing["email"]):
            errors.append(f"Duplicate: {_who(existing, existing['phone'][phone], singular)} already has this phone number")
        elif phone and phone in seen_phone and not (email and email in seen_email):
            errors.append(f"Duplicate: the phone number is already used by row {seen_phone[phone]} of this file")
        if email:
            seen_email.setdefault(email, number)
        if phone:
            seen_phone.setdefault(phone, number)
        out.append({"row": number, "errors": errors, "payload": None if errors else _payload(mod, values, owner_id)})
    return out


def _payload(mod: ImportModule, v: dict, owner_id: str | None) -> dict:
    if mod.key == "leads":
        return {"name": v["name"], "company": v["company"], "designation": v["designation"], "email": v["email"], "phone": v["phone"], "website": v["website"], "industry": v["industry"],
                "location": v["location"], "source": v["source"] or "Import", "sourceDetail": v["sourceDetail"], "captureMethod": "Import", "service": v["service"], "requirement": v["requirement"],
                "budget": v["budget"] or 0, "expectedPurchaseDate": v["expectedPurchaseDate"] or None, "priority": v["priority"] or "Medium", "assignedTo": owner_id,
                "nextFollowUp": v["nextFollowUp"] or None, "status": "New"}
    return {"name": v["name"], "company": v["company"], "designation": v["designation"], "email": v["email"], "phone": v["phone"], "city": v["city"], "state": v["state"], "country": v["country"] or "India",
            "source": v["source"] or "Import", "enquiryType": v["enquiryType"] or "General Enquiry", "priority": v["priority"] or "Medium", "interestedProduct": v["interestedService"],
            "interestedService": v["interestedService"], "requirementType": v["requirementType"] or "New Requirement", "requirementDescription": v["requirementDescription"],
            "expectedPurchaseDate": v["expectedPurchaseDate"] or None, "preferredContactMethod": v["preferredContactMethod"] or "Phone", "assignedUser": owner_id, "nextFollowUp": v["nextFollowUp"] or None}


def _rows_of(body: dict, limit: int) -> list[dict]:
    rows = body.get("rows")
    if not isinstance(rows, list) or not rows:
        raise invalid("The file has no data rows.")
    if len(rows) > limit:
        raise invalid(f"At most {limit} rows can be sent at a time.")
    return [r if isinstance(r, dict) else {} for r in rows]


def preview(db: Session, p: Principal, key: str, body: dict) -> dict:
    mod = module_of(key)
    _require(p, mod)
    if mod.spec_key is None:
        raise invalid("Use the employee import endpoint for employees.")
    blocked = _blocked(p, mod)
    results = prepare(db, p, mod, _rows_of(body, MAX_ROWS))
    bad = sum(1 for r in results if r["errors"])
    return {"module": mod.key, "blocked": blocked, "total": len(results), "valid": len(results) - bad, "invalid": bad, "rows": [{"row": r["row"], "errors": r["errors"]} for r in results]}


def commit(db: Session, p: Principal, key: str, body: dict) -> dict:
    mod = module_of(key)
    _require(p, mod)
    if mod.spec_key is None:
        raise invalid("Use the employee import endpoint for employees.")
    blocked = _blocked(p, mod)
    if blocked:
        raise invalid(blocked)
    from app.services import modules

    spec = modules.SPEC_BY_KEY[mod.spec_key]
    results = prepare(db, p, mod, _rows_of(body, MAX_COMMIT_ROWS))
    created: list[dict] = []
    failed: list[dict] = []
    for r in results:
        if r["errors"]:
            failed.append({"row": r["row"], "errors": r["errors"]})
            continue
        try:
            record = records.create_record(db, spec, p, r["payload"])
            saved = db.get(spec.model, record["id"])
            if saved is not None and hasattr(saved, "created_via"):  # the record says it arrived by import (attribution reports tell manual entry, import, conversion and integration apart)
                saved.created_via = "Import"
                db.commit()
            created.append({"row": r["row"], "id": record["id"], "name": record.get("name", "")})
        except ApiError as exc:  # a rule only the real create knows about: the row is refused with its reason, the others carry on
            db.rollback()
            fields = "; ".join(f"{v}" for v in (exc.fields or {}).values() if v and v != "Required.")
            failed.append({"row": r["row"], "errors": [exc.message + (f" ({fields})" if fields and fields not in exc.message else "")]})
        except Exception:  # noqa: BLE001  - one unexpected failure must not lose the rows already saved or stop the rest
            db.rollback()
            log.exception("import row %s could not be saved", r["row"])
            failed.append({"row": r["row"], "errors": ["This row could not be saved because of an unexpected problem. Check its values and try again."]})
    audit.record(db, user=p.user, action=f"Import {mod.label.lower()}", module=mod.label, details=f"{len(created)} created, {len(failed)} refused", info=p.info)
    db.commit()
    return {"module": mod.key, "created": created, "failed": failed, "count": len(created)}
