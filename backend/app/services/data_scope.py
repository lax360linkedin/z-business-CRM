"""Record-level data scope: which records of a module a person may open WITHIN a module they already have view access to (the Own / Team / Organization axis).
Mirrors the rules the React app shows, but is enforced here, in the query, so a hand-made request cannot read what the screen would hide.
Own = records owned by (or created by) the caller. Team = records owned by someone in the caller's department. Organization = no extra restriction."""
from sqlalchemy import or_, select

from app.api.deps import Principal
from app.models import User

SCOPED_MODULES = ("Leads", "Enquiries", "Contacts", "Companies", "Customers", "Deals", "Quotations", "Proposals", "Tasks", "Tickets")


def role_of(p: Principal) -> str:
    return "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)


def scope_for(p: Principal, module: str) -> str:
    role = role_of(p)
    if role in ("Super Admin", "Admin", "MD", "CEO", "Accounts"):
        return "Organization"
    if role == "HR":
        return "Organization" if module in ("Employees", "User Management", "Teams") else "Own"
    if role == "Sales Manager":
        return "Team" if module in SCOPED_MODULES else "Organization"
    if role == "Sales Executive":
        return "Own" if module in SCOPED_MODULES else "Organization"
    if role == "Marketing":
        return "Team" if module == "Leads" else "Organization"
    if role == "Project Manager":
        return "Team" if module in ("Projects", "Tasks") else "Organization"
    if role == "Project Staff":
        return "Own" if module in ("Projects", "Tasks") else "Organization"
    if role == "Support":
        return "Team" if module == "Tickets" else "Organization"
    return "Organization"


def owner_filter(p: Principal, module: str, owner_col, created_col=None):
    """A WHERE clause limiting a module to the caller's scope (None = no restriction). The creator always keeps sight of what they created."""
    scope = scope_for(p, module)
    if scope == "Organization":
        return None
    me = p.actor_id
    own = [owner_col == me]
    if created_col is not None:
        own.append(created_col == me)
    if scope == "Own":
        return or_(*own)
    mates = select(User.employee_id).where(User.department == (p.user.department or ""), User.status != "Inactive")
    return or_(*own, owner_col.in_(mates))
