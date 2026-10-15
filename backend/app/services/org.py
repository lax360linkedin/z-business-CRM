"""People and organisation: employees, departments, teams (served by the record engine) and the employee-specific actions (status change, CRM access)."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.models.identity import Department, Employee, Team, User
from app.services import accounts, audit
from app.services.records import Ctx, Hooks, ModuleSpec

EMPLOYEE_STATUSES = ("Active", "Probation", "On Leave", "Remote", "Suspended", "Resigned", "Terminated", "Inactive")
WORKING = ("Active", "Probation", "On Leave", "Remote")
SENSITIVE = ("dob", "personalEmail", "address", "emergencyContact", "gender", "altPhone")


def _maps(ctx: Ctx) -> dict:
    """Lookups loaded once per request (not per row) so listing employees does not issue a query per employee."""
    cache = ctx.db.info.get("org_maps")
    if cache is None:
        db = ctx.db
        cache = {
            "dept": {d.id: d for d in db.execute(select(Department)).scalars()},
            "team": {t.id: t for t in db.execute(select(Team)).scalars()},
            "emp": {row[0]: row[1] for row in db.execute(select(Employee.id, Employee.full_name)).all()},
            "acct": {u.employee_id: u for u in db.execute(select(User)).scalars().unique()},
        }
        db.info["org_maps"] = cache
    return cache


def _can_see_sensitive(p: Principal, employee_id: str) -> bool:
    return p.is_super_admin or p.level == "Admin" or p.can("Employees", "edit") or p.actor_id == employee_id


class EmployeeHooks(Hooks):
    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        if obj.status not in EMPLOYEE_STATUSES:
            raise invalid("Choose a valid status.", {"status": "Not an allowed value."})
        if not obj.official_email or "@" not in obj.official_email:
            raise invalid("Enter a valid official email.", {"officialEmail": "Invalid email."})
        if not (obj.branch or ctx.principal.scope.write):  # every employee belongs to exactly one branch; only the Super Admin's own record (seeded) has none
            raise invalid("Choose the branch this employee works in.", {"branch": "Choose a branch."})
        obj.attributes = {**(obj.attributes or {}), "timeline": [{"at": audit_now(), "type": "Created", "text": "Employee record created", "by": ctx.principal.actor_id}]}

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        from app.services import org_admin

        org_admin.check_employee(ctx.db, obj, {"departmentId", "teamId", "reportsTo"})

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        from app.services import org_admin

        org_admin.check_employee(ctx.db, obj, set(changes))

    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        maps = _maps(ctx)
        dept, team, sub, acct = maps["dept"].get(obj.department_id), maps["team"].get(obj.team_id), maps["team"].get(obj.sub_team_id), maps["acct"].get(obj.id)
        data.update(
            departmentName=dept.name if dept else None, departmentColor=dept.color if dept else None, teamName=team.name if team else None, subTeamName=sub.name if sub else None,
            reportsToName=maps["emp"].get(obj.reports_to), managerName=maps["emp"].get(obj.reports_to), working=obj.status in WORKING,
            crmAccess=acct is not None, accountId=acct.id if acct else None, accountStatus=acct.status if acct else None, crmRole=acct.job_role if acct else None,
            crmAccessLevel=acct.access_level if acct else None, lastLogin=acct.last_login_at.isoformat() if acct and acct.last_login_at else None,
            loginStatus=(("Has signed in" if acct.last_login_at else "Never signed in") if acct.status == "Active" else acct.status) if acct else "No CRM access",
            experience=round(((date.today() - obj.join_date).days / 365.25), 1) if obj.join_date else 0,
        )
        if not _can_see_sensitive(ctx.principal, obj.id):
            for key in SENSITIVE:
                data[key] = None
            data["sensitiveHidden"] = True
        if not (ctx.principal.is_super_admin or ctx.principal.level == "Admin"):
            data["lastLogin"], data["accountId"] = None, None
        from app.services import org_detail

        data.update(org_detail.employee_row_extras(ctx.db, obj))
        return data


def audit_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class DepartmentHooks(Hooks):
    def before_delete(self, ctx: Ctx, obj) -> None:
        if ctx.db.execute(select(Employee.id).where(Employee.department_id == obj.id).limit(1)).first():
            raise conflict("This department still has employees. Move them first.", code="IN_USE")

    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        maps = _maps(ctx)
        data["headName"] = maps["emp"].get(obj.head_id)
        from app.services import org_detail

        data.update(org_detail.department_stats(ctx.db, obj))
        return data


class TeamHooks(Hooks):
    """Teams keep their own history: who created them and every change of name, department, leader, deputy or status."""

    WATCHED = (("name", "Team renamed"), ("departmentId", "Department changed"), ("leaderId", "Team leader changed"), ("deputyId", "Deputy changed"), ("status", "Status changed"), ("parentTeamId", "Parent team changed"))

    def _people_in_branch(self, ctx: Ctx, branch: str | None, leader_id, deputy_id, parent_id) -> None:
        """A team's leader and deputy work in the team's own branch, and a sub-team lives in its parent's branch."""
        for key, person_id, label in (("leaderId", leader_id, "leader"), ("deputyId", deputy_id, "deputy")):
            person = ctx.db.get(Employee, person_id) if person_id else None
            if person is not None and branch and person.branch and person.branch != branch:
                raise invalid(f"The team {label} must work in the {branch} branch.", {key: f"{person.full_name} works in {person.branch}."})
        parent = ctx.db.get(Team, parent_id) if parent_id else None
        if parent is not None and branch and parent.branch and parent.branch != branch:
            raise invalid(f"A sub-team belongs to its parent team's branch ({parent.branch}).", {"parentTeamId": "Belongs to another branch."})

    def before_create(self, ctx: Ctx, obj, payload: dict) -> None:
        self._people_in_branch(ctx, obj.branch or ctx.principal.scope.write, obj.leader_id, obj.deputy_id, obj.parent_team_id)

    def after_create(self, ctx: Ctx, obj, payload: dict) -> None:
        obj.attributes = {**(obj.attributes or {}), "history": [{"at": audit_now(), "text": "Team created", "by": ctx.principal.actor_id}]}

    def before_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        self._people_in_branch(ctx, obj.branch, changes.get("leaderId", obj.leader_id), changes.get("deputyId", obj.deputy_id), changes.get("parentTeamId", obj.parent_team_id))
        names = _maps(ctx)["emp"]
        ctx.state["team_before"] = {key: (names.get(getattr(obj, col)) if key in ("leaderId", "deputyId") else getattr(obj, col)) for key, col in
                                    (("name", "name"), ("departmentId", "department_id"), ("leaderId", "leader_id"), ("deputyId", "deputy_id"), ("status", "status"), ("parentTeamId", "parent_team_id")) if key in changes}

    def after_update(self, ctx: Ctx, obj, changes: dict, payload: dict) -> None:
        names, rows = _maps(ctx)["emp"], []
        after = {"name": obj.name, "departmentId": obj.department_id, "leaderId": names.get(obj.leader_id), "deputyId": names.get(obj.deputy_id), "status": obj.status, "parentTeamId": obj.parent_team_id}
        for key, text in self.WATCHED:
            if key in ctx.state.get("team_before", {}) and ctx.state["team_before"][key] != after[key]:
                rows.append({"at": audit_now(), "text": text, "from": ctx.state["team_before"][key], "to": after[key], "by": ctx.principal.actor_id})
        if rows:
            obj.attributes = {**(obj.attributes or {}), "history": [*(obj.attributes or {}).get("history", []), *rows][-200:]}

    def present(self, ctx: Ctx, obj, data: dict) -> dict:
        maps = _maps(ctx)
        dept = maps["dept"].get(obj.department_id)
        data.update(departmentName=dept.name if dept else None, leaderName=maps["emp"].get(obj.leader_id), deputyName=maps["emp"].get(obj.deputy_id))
        from app.services import org_detail

        data.update(org_detail.team_stats(ctx.db, obj))
        data.pop("history", None)  # the history is part of the team's own page, not of every row of the list
        return data


EMPLOYEE_SPEC = ModuleSpec(
    "employees", Employee, "Employees", "EMP", 3, required=("fullName", "officialEmail"), search=("fullName", "officialEmail", "mobile", "designation", "jobTitle"),
    enums={"status": EMPLOYEE_STATUSES}, hooks=EmployeeHooks(), protected_update=frozenset({"status", "exitDate"}),
    unique=((("official_email",), "An employee with this email already exists."),),
)
DEPARTMENT_SPEC = ModuleSpec("departments", Department, "Employees", "DEP", 3, required=("name",), search=("name", "code"), unique=((("name",), "A department with this name already exists."),), hooks=DepartmentHooks())
TEAM_SPEC = ModuleSpec("teams", Team, "Teams", "TEAM", 3, required=("name",), search=("name",), hooks=TeamHooks())


# ---- employee actions --------------------------------------------------------------------------------------------------
def change_status(db: Session, p: Principal, employee_id: str, status: str, reason: str, effective: str | None) -> dict:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise not_found("Employee not found.")
    if status not in EMPLOYEE_STATUSES:
        raise invalid("Choose a status.", {"status": "Choose a status."})
    if status == employee.status:
        raise conflict(f"The employee is already {status}.")
    if employee.id == p.actor_id and status not in WORKING:
        raise conflict("You cannot take your own record out of service.")
    if status not in WORKING and len((reason or "").strip()) < 3:
        raise invalid("Give a reason.", {"reason": "Give a reason."})
    apply_status(db, p, employee, status, reason, effective)
    db.commit()
    db.info.pop("org_maps", None)
    return EMPLOYEE_SPEC.hooks.present(Ctx(db, p, EMPLOYEE_SPEC), employee, {"id": employee.id, "status": employee.status})


def apply_status(db: Session, p: Principal, employee: Employee, status: str, reason: str, effective: str | None, details: str = "") -> None:
    """Moves one employee to a new status (no commit): exit date, history, and - when the person leaves - the linked login is suspended / restored."""
    previous = employee.status
    employee.status = status
    employee.exit_date = None if status in WORKING else (date.fromisoformat(effective[:10]) if effective else date.today())
    timeline = list((employee.attributes or {}).get("timeline") or [])
    timeline.append({"at": audit_now(), "type": "StatusChanged", "text": f"Status changed: {previous} → {status}", "details": reason or details, "by": p.actor_id, "from": previous, "to": status})
    employee.attributes = {**(employee.attributes or {}), "timeline": timeline}
    account = db.execute(select(User).where(User.employee_id == employee.id)).scalar_one_or_none()
    if account is not None and account.access_level != "Super Admin":
        if status not in WORKING and account.status not in ("Inactive", "Suspended"):
            account.previous_status, account.status = account.status, ("Suspended" if status == "Suspended" else "Inactive")  # a person who has left cannot sign in
        elif status in WORKING and account.status in ("Inactive", "Suspended") and account.previous_status:
            account.status, account.previous_status = account.previous_status, None
    audit.record(db, user=p.user, action="Employee status", module="Employees", record_id=employee.id, details=f"{previous} → {status} {reason or ''}".strip(), info=p.info)


def grant_access(db: Session, p: Principal, employee_id: str, payload: dict) -> dict:
    """Give an existing employee a CRM login (Super Admin only - enforced by the router)."""
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise not_found("Employee not found.")
    if employee.status not in WORKING:
        raise conflict("An employee who has left cannot be given CRM access.")
    if db.execute(select(User.id).where(User.employee_id == employee.id)).first():
        raise conflict("This employee already has a CRM account.")
    first, _, last = employee.full_name.partition(" ")
    department = db.get(Department, employee.department_id).name if employee.department_id else ""
    body = {**payload, "employeeId": employee.id, "firstName": first, "lastName": last, "email": employee.official_email, "phone": employee.mobile, "department": department,
            "branch": payload.get("branch") or employee.branch}
    return accounts.create_account(db, p, body)
