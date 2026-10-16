"""Employee administration beyond plain CRUD: the rules every employee record must satisfy (organisation structure, reporting line, formats), the directory settings the UI needs,
bulk operations (per-person results, server-side confirmation) and the validated, all-or-nothing import."""
import re
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, conflict, forbidden, invalid
from app.db import ids
from app.models.identity import Branch, Department, Employee, Team, User
from app.services import audit
from app.services.codec import to_json
from app.services.org import EMPLOYEE_STATUSES, WORKING, apply_status, audit_now

EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Intern", "Consultant"]
WORK_MODES = ["On-site", "Hybrid", "Remote"]
SHIFTS = ["General (9:00–18:00)", "Morning (6:00–15:00)", "Evening (14:00–23:00)", "Night (22:00–07:00)", "Flexible"]
# Work location is Office / Remote / Hybrid, or "Others" with the place typed in: what is stored is the one text (the option, or what was typed - up to 80 characters)
WORK_LOCATIONS = ["Office", "Remote", "Hybrid", "Others"]
MAX_LOCATION = 80
GENDERS = ["Female", "Male", "Other", "Prefer not to say"]
EMPLOYEE_PERMISSIONS = [["view", "View the employee directory"], ["viewSensitive", "View personal & HR details"], ["create", "Add employees"], ["edit", "Edit employees"],
                        ["changeStatus", "Change employee status"], ["manageOrg", "Manage departments & teams"], ["bulk", "Bulk operations"], ["import", "Import employees"],
                        ["export", "Export employees"], ["assignRole", "Assign CRM roles"], ["manageDocuments", "Manage employee documents"]]
_ALL = [k for k, _ in EMPLOYEE_PERMISSIONS]
EMPLOYEE_ROLE_CAPS = {"Super Admin": _ALL, "Admin": _ALL, "HR": [k for k in _ALL if k != "assignRole"], "MD": ["view", "export"], "CEO": ["view", "export"], "Sales Manager": ["view"],
                      "Project Manager": ["view"]}
PRIVILEGED_ROLES = ("Super Admin", "Admin")
BULK_ACTIONS = ("department", "team", "teamLeader", "status", "activate", "deactivate", "role")
SENSITIVE_BULK = ("status", "deactivate", "role", "activate", "teamLeader", "department")


def role_of(p: Principal) -> str:
    return "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)


def perms_of(p: Principal) -> dict:
    caps = set(EMPLOYEE_ROLE_CAPS.get(role_of(p), []))
    view = "view" in caps and p.can("Employees", "view")
    edit = p.can("Employees", "edit")
    return {"view": view, "viewSensitive": view and "viewSensitive" in caps, "create": "create" in caps and p.can("Employees", "create"), "edit": "edit" in caps and edit,
            "changeStatus": "changeStatus" in caps and edit, "manageOrg": "manageOrg" in caps and edit, "bulk": "bulk" in caps and edit, "import": "import" in caps and p.can("Employees", "create"),
            "export": "export" in caps and p.can("Employees", "export"), "assignRole": "assignRole" in caps and edit, "manageDocuments": "manageDocuments" in caps and edit,
            "delete": p.is_super_admin, "privileged": role_of(p) in PRIVILEGED_ROLES}


def denied(db: Session, p: Principal, what: str, why: str):
    audit.record(db, user=p.user, action=f"Denied: {what}", module="Employees", result="Denied", details=why, info=p.info)
    db.commit()
    raise forbidden(why)


# ---- rules ----------------------------------------------------------------------------------------------------------------
def would_create_cycle(db: Session, employee_id: str, manager_id: str | None) -> bool:
    """Would making `manager_id` the manager of `employee_id` create a loop (or make someone their own manager)?"""
    if not manager_id:
        return False
    if manager_id == employee_id:
        return True
    seen: set[str] = set()
    cur: str | None = manager_id
    while cur:
        if cur == employee_id or cur in seen:
            return True
        seen.add(cur)
        cur = db.execute(select(Employee.reports_to).where(Employee.id == cur)).scalar_one_or_none()
    return False


def check_employee(db: Session, e: Employee, changed: set[str]) -> None:
    """The final state of an employee record must be coherent. `changed` = the JSON keys this request touched (an inactive department / manager only matters when newly chosen)."""
    errors: dict[str, str] = {}
    if len((e.full_name or "").strip()) < 2:
        errors["fullName"] = "Enter the employee’s full name."
    if not EMAIL.match(e.official_email or ""):
        errors["officialEmail"] = "Enter a valid official email."
    elif db.execute(select(User.id).where(func.lower(User.email) == e.official_email.lower(), User.employee_id != e.id)).first():
        errors["officialEmail"] = "This official email already belongs to another employee."
    if e.personal_email and not EMAIL.match(e.personal_email):
        errors["personalEmail"] = "Enter a valid email."
    if e.mobile and not re.fullmatch(r"[+0-9()\-\s]{7,20}", e.mobile):
        errors["mobile"] = "Enter a valid mobile number."
    if not (e.designation or "").strip():
        errors["designation"] = "Enter the designation."
    if e.join_date is None:
        errors["joinDate"] = "Enter the joining date."
    elif e.join_date > date.today() + timedelta(days=366):
        errors["joinDate"] = "That joining date is too far ahead."
    if e.dob and e.dob > date.today():
        errors["dob"] = "Enter a valid date of birth."
    dept = db.get(Department, e.department_id) if e.department_id else None
    if dept is None:
        errors["departmentId"] = "Choose a department."
    elif dept.status != "Active" and "departmentId" in changed:
        errors["departmentId"] = "That department is inactive."
    team = db.get(Team, e.team_id) if e.team_id else None
    if e.team_id and (team is None or team.department_id != e.department_id or team.parent_team_id):
        errors["teamId"] = "Choose a team of the selected department."
    elif team is not None and team.status != "Active" and "teamId" in changed:
        errors["teamId"] = "That team is inactive."
    elif team is not None and team.branch and e.branch and team.branch != e.branch:
        errors["teamId"] = f"That team belongs to the {team.branch} branch."
    sub = db.get(Team, e.sub_team_id) if e.sub_team_id else None
    if e.sub_team_id and (sub is None or sub.parent_team_id != e.team_id):
        errors["subTeamId"] = "Choose a sub-team of the selected team."
    if e.employment_type and e.employment_type not in EMPLOYMENT_TYPES:
        errors["employmentType"] = "Choose an employment type."
    if e.work_mode and e.work_mode not in WORK_MODES:
        errors["workMode"] = "Choose a work mode."
    e.work_location = re.sub(r"\s+", " ", (e.work_location or "").strip())
    if len(e.work_location) > MAX_LOCATION:
        errors["workLocation"] = f"Work location can be at most {MAX_LOCATION} characters."
    elif e.work_location.lower() == "others":
        errors["workLocation"] = "Enter the actual work location instead of “Others”."
    if e.gender and e.gender not in GENDERS:
        errors["gender"] = "Choose from the list."
    if e.reports_to:
        mgr = db.get(Employee, e.reports_to)
        if mgr is None:
            errors["reportsTo"] = "That manager does not exist."
        elif mgr.status not in WORKING and "reportsTo" in changed:
            errors["reportsTo"] = "That manager is no longer active."
        elif mgr.branch and e.branch and mgr.branch != e.branch:
            errors["reportsTo"] = f"That manager works in the {mgr.branch} branch; an employee reports to someone in their own branch."
        elif would_create_cycle(db, e.id, e.reports_to):
            errors["reportsTo"] = "An employee cannot report to themselves." if e.reports_to == e.id else f"That would create a reporting loop — {mgr.full_name} already reports (directly or indirectly) to this employee."
    if errors:
        raise invalid(next(iter(errors.values())), errors)


# ---- directory settings ---------------------------------------------------------------------------------------------------
def org_config(db: Session, p: Principal) -> dict:
    perm = perms_of(p)
    if not perm["view"]:
        denied(db, p, "Org config", "You do not have access to the employee directory.")
    names = dict(db.execute(select(Employee.id, Employee.full_name)).all())
    depts = [{**to_json(d), "headName": names.get(d.head_id)} for d in db.execute(select(Department).order_by(Department.name)).scalars()]
    teams = [{**to_json(t), "leaderName": names.get(t.leader_id), "deputyName": names.get(t.deputy_id)} for t in db.execute(select(Team).order_by(Team.name)).scalars()]
    return {"perms": perm, "user": {"id": p.actor_id, "name": p.name, "role": role_of(p), "department": p.user.department}, "statuses": list(EMPLOYEE_STATUSES), "employmentTypes": EMPLOYMENT_TYPES,
            "workModes": WORK_MODES, "shifts": SHIFTS, "locations": WORK_LOCATIONS, "genders": GENDERS, "departments": depts, "teams": teams,
            "matrix": {"roles": EMPLOYEE_ROLE_CAPS, "permissions": EMPLOYEE_PERMISSIONS}}


# ---- bulk operations ------------------------------------------------------------------------------------------------------
def bulk(db: Session, p: Principal, req: dict) -> dict:
    perm = perms_of(p)
    if not perm["bulk"]:
        denied(db, p, "Bulk operation", "You do not have permission for bulk operations.")
    emp_ids = list(dict.fromkeys(req.get("ids") or []))
    if not emp_ids or len(emp_ids) > 200:
        raise invalid("Select between 1 and 200 employees.")
    action = req.get("action")
    if action not in BULK_ACTIONS:
        raise invalid("Unknown bulk action.")
    if action in SENSITIVE_BULK and req.get("confirm") is not True:
        raise ApiError(409, f"Confirm this bulk change for {len(emp_ids)} employee(s).", "CONFIRMATION_REQUIRED", None, {"requiresConfirmation": True, "count": len(emp_ids)})
    if action == "role":
        denied(db, p, "Bulk role", "Roles and permissions are set per account in User Management (Super Admin only).")
    results: list[dict] = []
    for emp_id in emp_ids:
        e = db.get(Employee, emp_id)
        if e is None:
            results.append({"id": emp_id, "ok": False, "error": "Not found"})
            continue
        results.append(_bulk_one(db, p, e, action, req))
    ok = sum(1 for r in results if r["ok"])
    audit.record(db, user=p.user, action=f"Bulk {action}", module="Employees", details=f"{ok}/{len(emp_ids)} ok", info=p.info)
    db.commit()
    db.info.pop("org_maps", None)
    return {"results": results, "ok": ok, "failed": len(results) - ok}


def _log(e: Employee, p: Principal, type: str, text: str, from_=None, to=None) -> None:
    entry = {"at": audit_now(), "type": type, "text": text, "details": "Bulk operation", "by": p.actor_id, "from": from_, "to": to}
    e.attributes = {**(e.attributes or {}), "timeline": [*((e.attributes or {}).get("timeline") or []), entry]}


def _bulk_one(db: Session, p: Principal, e: Employee, action: str, req: dict) -> dict:
    rid = e.id
    if action == "department":
        d = db.get(Department, req.get("departmentId") or "")
        if d is None or d.status != "Active":
            return {"id": rid, "ok": False, "error": "Invalid department"}
        if e.department_id == d.id:
            return {"id": rid, "ok": True, "unchanged": True}
        old = db.get(Department, e.department_id).name if e.department_id else None
        e.department_id, e.team_id, e.sub_team_id = d.id, None, None
        _log(e, p, "DepartmentChanged", "Department changed", from_=old, to=d.name)
        return {"id": rid, "ok": True}
    if action == "team":
        t = db.get(Team, req.get("teamId") or "")
        if t is None or t.status != "Active" or t.parent_team_id:
            return {"id": rid, "ok": False, "error": "Invalid team"}
        old = db.get(Team, e.team_id).name if e.team_id else None
        e.department_id, e.team_id, e.sub_team_id = t.department_id, t.id, None
        _log(e, p, "TeamChanged", "Team changed", from_=old, to=t.name)
        return {"id": rid, "ok": True}
    if action == "teamLeader":
        leader = db.get(Employee, req.get("leaderId") or "")
        team = db.execute(select(Team).where(Team.leader_id == (leader.id if leader else ""), Team.parent_team_id.is_(None))).scalars().first() if leader else None
        if leader is None or team is None:
            return {"id": rid, "ok": False, "error": "That person does not lead a team"}
        if rid == leader.id:
            return {"id": rid, "ok": False, "error": "Is the leader"}
        if would_create_cycle(db, rid, leader.id):
            return {"id": rid, "ok": False, "error": "Would create a reporting loop"}
        old = db.get(Employee, e.reports_to).full_name if e.reports_to else None
        e.reports_to, e.team_id, e.department_id, e.sub_team_id = leader.id, team.id, team.department_id, None
        _log(e, p, "TeamChanged", "Team leader changed", from_=old, to=leader.full_name)
        return {"id": rid, "ok": True}
    # status / activate / deactivate
    to = "Active" if action == "activate" else "Inactive" if action == "deactivate" else req.get("status")
    if to not in EMPLOYEE_STATUSES:
        return {"id": rid, "ok": False, "error": "Invalid status"}
    if to == e.status:
        return {"id": rid, "ok": True, "unchanged": True}
    if rid == p.actor_id and to not in WORKING:
        return {"id": rid, "ok": False, "error": "Cannot deactivate yourself"}
    reason = str(req.get("reason") or "").strip()[:300]
    if to not in WORKING and len(reason) < 3:
        return {"id": rid, "ok": False, "error": "Reason required"}
    apply_status(db, p, e, to, reason, None, "Bulk operation")
    return {"id": rid, "ok": True}


# ---- import ---------------------------------------------------------------------------------------------------------------
def _norm(s) -> str:
    return str(s or "").strip().lower()


def _import_branch(db: Session, p: Principal, raw) -> tuple[str | None, str | None]:
    """The branch an imported row goes to: a branch user imports into their own branch only; the Super Admin must name an active branch on every row."""
    wanted = str(raw or "").strip()
    if p.scope.write:
        if wanted and wanted.lower() != p.scope.write.lower():
            return None, f"You can only import into the {p.scope.write} branch"
        return p.scope.write, None
    if not wanted:
        return None, "Branch is required (Salem, Mumbai or Bangalore)"
    branch = db.execute(select(Branch).where(func.lower(Branch.name) == wanted.lower())).scalar_one_or_none()
    if branch is None or branch.status != "Active":
        return None, f"Unknown or inactive branch “{wanted}”"
    return branch.name, None


def import_employees(db: Session, p: Principal, req: dict) -> tuple[int, dict]:
    perm = perms_of(p)
    if not perm["import"]:
        denied(db, p, "Employee import", "You do not have permission to import employees.")
    rows = (req.get("rows") or [])[:500]
    if not rows:
        raise invalid("The file has no rows.")
    depts = {_norm(d.name): d for d in db.execute(select(Department)).scalars()}
    teams = list(db.execute(select(Team)).scalars())
    emps = list(db.execute(select(Employee)).scalars())
    emp_by_id = {e.id: e for e in emps}
    taken_mail = {_norm(e.official_email) for e in emps}
    seen_id: set[str] = set()
    seen_mail: set[str] = set()
    out = []

    def find_person(v):
        n = _norm(v)
        return next((e for e in emps if n in (_norm(e.id), _norm(e.full_name), _norm(e.official_email))), None) if n else None

    for i, r in enumerate(rows, start=1):
        errors: list[str] = []
        dept = depts.get(_norm(r.get("department")))
        team = next((t for t in teams if dept and t.department_id == dept.id and not t.parent_team_id and _norm(t.name) == _norm(r.get("team"))), None) if r.get("team") else None
        if dept is None:
            errors.append(f"Unknown department “{r.get('department')}”" if r.get("department") else "Department is required")
        if r.get("team") and dept and team is None:
            errors.append(f"Team “{r['team']}” does not exist in {dept.name}")
        sub = next((t for t in teams if team and t.parent_team_id == team.id and _norm(t.name) == _norm(r.get("subTeam"))), None) if r.get("subTeam") and team else None
        if r.get("subTeam") and team and sub is None:
            errors.append(f"Sub-team “{r['subTeam']}” does not exist")
        idv = str(r.get("employeeId") or "").strip().upper()[:20]
        if idv and (idv in emp_by_id or idv in seen_id):
            errors.append(f"Employee ID {idv} is a duplicate")
        if idv and not re.fullmatch(r"EMP-[0-9]{3,6}", idv):
            errors.append("Use the employee ID format EMP-001")
        if idv:
            seen_id.add(idv)
        mail = _norm(r.get("officialEmail"))
        if mail and (mail in seen_mail or mail in taken_mail):
            errors.append(f"Official email {r.get('officialEmail')} is a duplicate")
        if mail:
            seen_mail.add(mail)
        leader = find_person(r.get("teamLeader")) if r.get("teamLeader") else None
        if r.get("teamLeader") and leader is None:
            errors.append(f"Team leader “{r['teamLeader']}” was not found")
        elif leader and team and team.leader_id and team.leader_id != leader.id:
            errors.append(f"{leader.full_name} is not the leader of {team.name}")
        if r.get("reportsTo"):
            mgr = find_person(r["reportsTo"])
            if mgr is None:
                errors.append(f"Manager “{r['reportsTo']}” was not found")
        else:
            mgr = leader or (emp_by_id.get(team.leader_id) if team and team.leader_id else None) or (emp_by_id.get(dept.head_id) if dept and dept.head_id else None)
        branch_name, branch_error = _import_branch(db, p, r.get("branch"))
        if branch_error:
            errors.append(branch_error)
        status = r.get("status") or "Active"
        if status not in WORKING:
            errors.append("Status must be a working status (Active, Probation, On Leave, Remote)")
        probe = Employee(id="__import__", full_name=str(r.get("fullName") or "").strip(), official_email=str(r.get("officialEmail") or "").strip(), mobile=str(r.get("mobile") or ""), designation=str(r.get("designation") or "").strip(),
                         personal_email=str(r.get("personalEmail") or ""), gender=str(r.get("gender") or ""), employment_type=str(r.get("employmentType") or "Full-time"), work_mode=str(r.get("workMode") or "On-site"),
                         department_id=dept.id if dept else None, team_id=team.id if team else None, sub_team_id=sub.id if sub else None, reports_to=mgr.id if mgr else None, attributes={})
        try:
            probe.join_date = date.fromisoformat(str(r.get("joinDate") or ""))
        except ValueError:
            probe.join_date = None
        try:
            probe.dob = date.fromisoformat(str(r["dob"])) if r.get("dob") else None
        except ValueError:
            errors.append("Enter a valid date of birth.")
        try:
            check_employee(db, probe, {"departmentId", "teamId", "reportsTo"})
        except ApiError as exc:
            for msg in (exc.fields or {}).values():
                if msg not in errors and not re.search(r"department|team|manager", msg, re.I):
                    errors.append(msg)
        db.expunge(probe) if probe in db else None
        out.append({"row": i, "errors": errors, "data": None if errors else {"probe": probe, "id": idv or None, "status": status, "branch": branch_name, "raw": r}})
    invalid_rows = sum(1 for x in out if x["errors"])
    if not req.get("commit"):
        return 200, {"rows": [{"row": x["row"], "errors": x["errors"]} for x in out], "valid": len(out) - invalid_rows, "invalid": invalid_rows}
    if invalid_rows:
        raise invalid(f"{invalid_rows} row(s) have errors. Fix them before importing.", {"invalid": str(invalid_rows)})
    created = []
    for x in out:
        d, probe = x["data"], x["data"]["probe"]
        new_id = d["id"] or _next_employee_id(db)
        e = Employee(id=new_id, full_name=probe.full_name, official_email=probe.official_email, mobile=probe.mobile, alt_phone=str(d["raw"].get("altPhone") or ""), designation=probe.designation,
                     job_title=str(d["raw"].get("jobTitle") or probe.designation), gender=probe.gender, dob=probe.dob, personal_email=probe.personal_email, address=str(d["raw"].get("address") or "")[:400],
                     join_date=probe.join_date, employment_type=probe.employment_type, status=d["status"], work_location=str(d["raw"].get("workLocation") or "Office"),
                     shift=str(d["raw"].get("shift") or SHIFTS[0]), work_mode=probe.work_mode, department_id=probe.department_id, team_id=probe.team_id, sub_team_id=probe.sub_team_id,
                     reports_to=probe.reports_to, branch=d.get("branch") or None, created_by=p.actor_id,
                     attributes={"timeline": [{"at": audit_now(), "type": "Created", "text": "Employee imported", "by": p.actor_id}]})
        db.add(e)
        db.flush()
        created.append(new_id)
    audit.record(db, user=p.user, action="Employee import", module="Employees", details=f"{len(created)} employee(s)", info=p.info)
    db.commit()
    db.info.pop("org_maps", None)
    return 201, {"created": created, "count": len(created)}


def _next_employee_id(db: Session) -> str:
    while True:
        new_id = ids.new_id(db, "EMP", 3)
        if db.get(Employee, new_id) is None:
            return new_id


__all__ = ["conflict"]


def branch_summary(db: Session) -> dict:
    """Per-branch figures for the Super Admin's comparison views. Reads every branch regardless of the branch she is currently viewing."""
    from app.db.branch import BranchScope, set_scope
    from app.models import Deal, Enquiry, Lead, Project, Quotation, Task, Ticket, Customer

    set_scope(db, BranchScope(read=None, write=None, all_access=True))

    def counts(model, *where) -> dict:
        stmt = select(model.branch, func.count()).where(*where).group_by(model.branch)
        return {b: n for b, n in db.execute(stmt).all()}

    closed_stages = ("Closed Won", "Closed Lost", "Closed Lost - No Budget", "Closed Lost - Competitor", "Closed Lost - No Response")
    tables = {
        "employees": counts(Employee, Employee.status.notin_(("Resigned", "Terminated", "Inactive"))),
        "enquiries": counts(Enquiry), "leads": counts(Lead), "quotations": counts(Quotation), "customers": counts(Customer),
        "openDeals": counts(Deal, Deal.stage.notin_(closed_stages), ~Deal.stage.like("Closed%")), "wonDeals": counts(Deal, Deal.stage == "Closed Won"),
        "projects": counts(Project, Project.status == "Active"), "openTasks": counts(Task, Task.status.notin_(("Completed", "Cancelled"))),
        "openTickets": counts(Ticket, Ticket.status.notin_(("Resolved", "Closed", "Cancelled"))),
    }
    admins = {b: n for b, n in db.execute(select(User.branch, func.count()).where(User.access_level == "Admin").group_by(User.branch)).all()}
    names = [b for (b,) in db.execute(select(Branch.name).order_by(Branch.name)).all()]
    rows = [{"branch": n, **{k: v.get(n, 0) for k, v in tables.items()}, "admins": admins.get(n, 0)} for n in names]
    total = {"branch": "All branches", **{k: sum(r[k] for r in rows) for k in [*tables, "admins"]}}
    return {"rows": rows, "total": total}
