"""Module permissions: which modules exist, what each job profile may do by default, and what ONE account is finally allowed.

Authorisation is decided here, from the account stored in the database - never from anything the client sends. A permission set is
{ "<Module label>": {view, create, edit, delete, export} }; the module labels are the ones shown in the CRM's navigation.
"""
from collections.abc import Mapping

ACTIONS = ("view", "create", "edit", "delete", "export")
ACCESS_LEVELS = ("Super Admin", "Admin", "Employee")

# module label -> section (the sidebar grouping the default job-profile rules key off)
MODULES: dict[str, str] = {
    "Dashboard": "General",
    "Leads": "CRM", "Enquiries": "CRM", "Contacts": "CRM", "Companies": "CRM", "Customers": "CRM",
    "Deals": "Sales", "Sales Pipeline": "Sales", "Quotations": "Sales", "Sales Orders": "Sales", "Proposals": "Sales",
    "Activities": "Activities", "Tasks": "Activities", "Calendar": "Activities",
    "Products & Services": "Operations", "Projects": "Operations", "Contracts": "Operations", "Documents": "Operations",
    "Invoices": "Finance", "Payments": "Finance", "Expenses": "Finance",
    "Campaigns": "Marketing", "Lead Sources": "Marketing", "Marketing Analytics": "Marketing",
    "Email": "Communication", "WhatsApp": "Communication", "Communication History": "Communication",
    "Helpdesk / Tickets": "Support",
    "Sales Reports": "Reports", "Lead Reports": "Reports", "Marketing Reports": "Reports", "Finance Reports": "Reports", "Project Reports": "Reports", "Team Performance": "Reports",
    "AI Insights": "Reports", "Notifications": "Reports",
    "Branches": "Team", "Employees": "Team", "User Management": "Team", "Teams": "Team", "Roles & Permissions": "Team",
    "Settings": "Settings",
}

# Only a Super Admin may open or change these, whatever a stored permission set says.
SUPER_ADMIN_ONLY_MODULES = ("Roles & Permissions", "User Management", "Branches")

FULL = {"view": True, "create": True, "edit": True, "delete": True, "export": True}
VIEW_ONLY = {"view": True, "create": False, "edit": False, "delete": False, "export": False}
CRUD_NO_DELETE = {"view": True, "create": True, "edit": True, "delete": False, "export": True}
NONE = {"view": False, "create": False, "edit": False, "delete": False, "export": False}

# Job profiles the Super Admin can start an account's permissions from. A profile is a template, not a login role.
JOB_PROFILES = ("Admin", "Employee", "MD", "CEO", "HR", "Sales Manager", "Sales Executive", "Marketing", "Project Manager", "Project Staff", "Accounts", "Support")


def _rule(role: str, section: str, label: str) -> dict:
    if role == "Super Admin":
        return FULL
    if role == "Admin":
        return NONE if label in SUPER_ADMIN_ONLY_MODULES else FULL
    if role == "Employee":
        return VIEW_ONLY if label == "Dashboard" else NONE
    if role == "MD":
        if label in ("Dashboard", "AI Insights", "Notifications") or section in ("CRM", "Sales", "Operations", "Finance", "Marketing", "Reports", "Team"):
            return VIEW_ONLY
        return NONE
    if role == "CEO":
        if label in ("Dashboard", "AI Insights", "Notifications") or section in ("CRM", "Sales", "Operations", "Finance", "Marketing", "Reports") or label in ("Employees", "Teams"):
            return VIEW_ONLY
        return NONE
    if role == "HR":
        if label in ("Dashboard", "Notifications", "Team Performance"):
            return VIEW_ONLY
        if label in ("Employees", "User Management", "Teams"):
            return FULL
        if label in ("Activities", "Tasks"):
            return CRUD_NO_DELETE
        return NONE
    if role == "Sales Manager":
        if section in ("CRM", "Sales", "Activities", "Marketing"):
            return FULL
        if section in ("Reports", "Team", "Communication", "Finance", "Operations") or label == "Dashboard":
            return VIEW_ONLY
        return NONE
    if role == "Sales Executive":
        if section in ("CRM", "Sales", "Activities"):
            return CRUD_NO_DELETE
        if section == "Communication" or label == "Dashboard":
            return VIEW_ONLY
        return NONE
    if role == "Marketing":
        if section == "Marketing":
            return FULL
        if label == "Leads":
            return CRUD_NO_DELETE
        if label in ("Customers", "Deals", "Dashboard") or section == "Reports":
            return VIEW_ONLY
        return NONE
    if role == "Project Manager":
        if section in ("Operations", "Activities"):
            return FULL
        if section in ("CRM", "Reports", "Communication") or label == "Dashboard":
            return VIEW_ONLY
        return NONE
    if role == "Project Staff":
        if label in ("Projects", "Tasks"):
            return CRUD_NO_DELETE
        if label in ("Activities", "Documents", "Dashboard"):
            return VIEW_ONLY
        return NONE
    if role == "Accounts":
        if section == "Finance":
            return FULL
        if label == "Quotations":
            return CRUD_NO_DELETE
        if section in ("CRM", "Operations", "Reports") or label == "Dashboard":
            return VIEW_ONLY
        return NONE
    if role == "Support":
        if section == "Support":
            return FULL
        if section in ("CRM", "Communication") or label == "Dashboard":
            return VIEW_ONLY
        return NONE
    return NONE


def nobody() -> dict[str, dict]:
    return {label: dict(NONE) for label in MODULES}


def default_permissions_for(role: str) -> dict[str, dict]:
    """The starting permission set of a job profile (what the Super Admin sees pre-filled when creating an account)."""
    perms = {label: dict(_rule(role, section, label)) for label, section in MODULES.items()}
    # Tasks and the calendar are everyone's daily work list; contracts are raised by the sales roles; every employee raises their own expense claims.
    if not perms["Tasks"]["view"]:
        perms["Tasks"] = dict(VIEW_ONLY)
    if not perms["Calendar"]["view"]:
        perms["Calendar"] = dict(VIEW_ONLY)
    if role in ("Sales Manager", "Sales Executive"):
        perms["Contracts"] = dict(CRUD_NO_DELETE)
    if role not in ("Super Admin", "Admin", "Accounts"):
        perms["Expenses"] = (
            {"view": True, "create": False, "edit": False, "delete": False, "export": True} if role == "CEO"
            else {"view": True, "create": False, "edit": True, "delete": False, "export": True} if role == "MD"
            else {"view": True, "create": True, "edit": True, "delete": True, "export": False}
        )
    return perms


def normalise_permissions(raw: Mapping | None) -> dict[str, dict]:
    """Clean a client-supplied permission set: known modules only, the five booleans only."""
    out = nobody()
    for label, grant in (raw or {}).items():
        if label in out and isinstance(grant, Mapping):
            out[label] = {action: bool(grant.get(action, False)) for action in ACTIONS}
    return out


def effective_permissions(access_level: str, job_role: str, stored: Mapping | None) -> dict[str, dict]:
    """What one account may do, module by module. Super Admin: everything. Others: the set the Super Admin configured, else the job profile's defaults -
    then the hard locks (accounts, roles, branches are the Super Admin's alone; only the Super Admin adds employees)."""
    if access_level == "Super Admin":
        return {label: dict(FULL) for label in MODULES}
    if access_level not in ACCESS_LEVELS:
        return nobody()
    perms = {**nobody(), **(normalise_permissions(stored) if stored is not None else default_permissions_for(job_role or access_level))}
    for label in SUPER_ADMIN_ONLY_MODULES:
        perms[label] = dict(NONE)
    perms["Employees"] = {**perms["Employees"], "create": False}
    return perms


def has_any_view(perms: Mapping) -> bool:
    return any(grant.get("view") for grant in perms.values())
