"""Read models for the people & organisation screens: what an employee, a department and a team look like once their live work is attached.

The record engine serves the bare rows; the screens also need each person's workload (counted from tasks, projects, tickets, deals and leads), who leads what,
the reporting chain, the work attached to a person, and the caller's own capabilities. Everything here is computed from the real tables on every request - nothing is stored
separately - and the related work lists respect what the *caller* is allowed to see (the same row filters and task visibility rules as the modules themselves).
Counts are bulk-loaded once per request (5 queries) and cached on the session, so listing 200 employees does not issue 200 queries."""
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import not_found
from app.models import Deal, Lead, Project, Task, Ticket
from app.models.identity import Department, Employee, Team, User
from app.models.work import TaskPerson
from app.services import flows, org_admin, records, tasks as task_svc

OPEN_PROJECT = ("Planned", "Active", "On Hold")
CLOSED_TICKET = ("Resolved", "Closed", "Cancelled")
OPEN_LEAD = ("New", "Contacted", "Qualified")
WORKING = ("Active", "Probation", "On Leave", "Remote")
ACTIVE = ("Active", "Probation", "Remote")
ZERO = {"pendingTasks": 0, "overdueTasks": 0, "activeProjects": 0, "openTickets": 0, "activeDeals": 0, "openLeads": 0}


def level_of(w: dict) -> str:
    """How loaded a person (or group) is. Overdue work and projects weigh more than a single open item."""
    score = w["pendingTasks"] + 2 * w["overdueTasks"] + 3 * w["activeProjects"] + w["openTickets"] + w["activeDeals"] + w["openLeads"]
    return "None" if score == 0 else "Light" if score <= 6 else "Moderate" if score <= 14 else "Heavy" if score <= 24 else "Overloaded"


def workloads(db: Session) -> dict[str, dict]:
    """employee id -> workload counts + level, for everyone, from the live records the caller's branch can see."""
    cached = db.info.get("org_workloads")
    if cached is not None:
        return cached
    w: dict[str, dict] = defaultdict(lambda: dict(ZERO))
    now = datetime.now(UTC)
    for task, emp_id in db.execute(select(Task, TaskPerson.employee_id).join(TaskPerson, TaskPerson.task_id == Task.id).where(TaskPerson.kind == "assignee", Task.status.in_(task_svc.OPEN))).all():
        w[emp_id]["pendingTasks"] += 1
        if task_svc.is_overdue(task, now):
            w[emp_id]["overdueTasks"] += 1
    for project in db.execute(select(Project).where(Project.status.in_(OPEN_PROJECT))).scalars():
        for emp_id in {project.manager, *((project.attributes or {}).get("team") or [])} - {None}:
            w[emp_id]["activeProjects"] += 1
    for emp_id, n in db.execute(select(Ticket.assigned_staff, func.count()).where(Ticket.assigned_staff.is_not(None), Ticket.status.notin_(CLOSED_TICKET)).group_by(Ticket.assigned_staff)).all():
        w[emp_id]["openTickets"] += n
    for emp_id, n in db.execute(select(Deal.salesperson, func.count()).where(Deal.salesperson.is_not(None), Deal.stage.notin_(flows.CLOSED_DEAL_STAGES)).group_by(Deal.salesperson)).all():
        w[emp_id]["activeDeals"] += n
    for emp_id, n in db.execute(select(Lead.assigned_to, func.count()).where(Lead.assigned_to.is_not(None), Lead.status.in_(OPEN_LEAD)).group_by(Lead.assigned_to)).all():
        w[emp_id]["openLeads"] += n
    out = {emp_id: {**counts, "level": level_of(counts)} for emp_id, counts in w.items()}
    db.info["org_workloads"] = out
    return out


def workload_of(db: Session, employee_id: str) -> dict:
    return workloads(db).get(employee_id) or {**ZERO, "level": "None"}


def _sum(rows: list[dict]) -> dict:
    total = dict(ZERO)
    for r in rows:
        for key in ZERO:
            total[key] += r[key]
    return total


def _structure(db: Session) -> dict:
    """Who leads which team, who heads which department - loaded once per request."""
    cached = db.info.get("org_structure")
    if cached is None:
        teams = list(db.execute(select(Team)).scalars())
        cached = {"teams": {t.id: t for t in teams}, "departments": {d.id: d for d in db.execute(select(Department)).scalars()},
                  "leaders": defaultdict(list), "heads": {d.head_id for d in db.execute(select(Department)).scalars() if d.head_id},
                  "names": {row[0]: row[1] for row in db.execute(select(Employee.id, Employee.full_name)).all()},
                  "members": defaultdict(list)}
        for t in teams:
            if t.leader_id:
                cached["leaders"][t.leader_id].append(t)
        for e in db.execute(select(Employee)).scalars():
            cached["members"]["dept:" + (e.department_id or "")].append(e)
            for key in {e.team_id, e.sub_team_id} - {None}:
                cached["members"]["team:" + key].append(e)
        db.info["org_structure"] = cached
    return cached


# ---- employees ---------------------------------------------------------------------------------------------------------------
def employee_row_extras(db: Session, e: Employee) -> dict:
    """What the directory needs next to each employee: workload, whether they lead a team / head a department, and who their team leader is."""
    s = _structure(db)
    team = s["teams"].get(e.sub_team_id) or s["teams"].get(e.team_id)
    leader_id = team.leader_id if team and team.leader_id != e.id else None
    return {"workload": workload_of(db, e.id), "isTeamLeader": e.id in s["leaders"], "isDeptHead": e.id in s["heads"], "teamLeaderId": leader_id, "teamLeaderName": s["names"].get(leader_id)}


def _capabilities(p: Principal) -> dict:
    perms = org_admin.perms_of(p)
    privileged = p.is_super_admin or p.level == "Admin"
    return {**perms, "assignTask": p.can("Tasks", "create"), "grantAccess": p.is_super_admin, "viewAccount": privileged}


def _visible(spec_key: str, p: Principal):
    from app.services.modules import SPEC_BY_KEY

    spec = SPEC_BY_KEY[spec_key]
    return spec.row_filter(p) if spec.row_filter else None


def _related(db: Session, p: Principal, e: Employee) -> dict:
    """The work attached to this person that the CALLER may see."""
    actor = task_svc.actor_of(p)
    perms = task_svc.perms_of(db, actor, p.permissions.get("Tasks"))
    tasks = [t for t in task_svc.visible_tasks(db, actor, perms) if e.id in task_svc.people(t, "assignees")]
    out = {"tasks": [{"id": t.id, "title": t.title, "status": t.status, "dueDate": t.due_date.isoformat() if t.due_date else None} for t in tasks[:200]], "projects": [], "deals": [], "leads": [], "tickets": []}
    from app.services import operations

    scope = operations.project_scope(p)
    pstmt = select(Project)
    if scope is not None:
        pstmt = pstmt.where(scope)
    for pr in db.execute(pstmt).scalars():
        team = (pr.attributes or {}).get("team") or []
        if pr.manager == e.id or e.id in team:
            role = (((pr.attributes or {}).get("teamRoles") or {}).get(e.id) or {}).get("role") or ("Project Manager" if pr.manager == e.id else "Team Member")
            out["projects"].append({"id": pr.id, "name": pr.name, "status": pr.status, "role": role})

    def rows(model, key: str, column, build) -> list[dict]:
        stmt = select(model).where(column == e.id)
        flt = _visible(key, p)
        if flt is not None:
            stmt = stmt.where(flt)
        return [build(r) for r in db.execute(stmt.limit(200)).scalars()]

    out["deals"] = rows(Deal, "deals", Deal.salesperson, lambda r: {"id": r.id, "name": r.name, "stage": r.stage, "value": float(r.value or 0)})
    out["leads"] = rows(Lead, "leads", Lead.assigned_to, lambda r: {"id": r.id, "name": r.name, "company": r.company, "status": r.status})
    out["tickets"] = rows(Ticket, "tickets", Ticket.assigned_staff, lambda r: {"id": r.id, "subject": r.subject, "priority": r.priority, "status": r.status})
    return out


def employee_detail(db: Session, p: Principal, employee_id: str) -> dict:
    from app.services.org import EMPLOYEE_SPEC

    data = records.get_record(db, EMPLOYEE_SPEC, p, employee_id)
    e = db.get(Employee, employee_id)
    if e is None:
        raise not_found("Employee not found.")
    s = _structure(db)
    names = s["names"]
    chain, seen, cur = [], {e.id}, e.reports_to
    while cur and cur not in seen and len(chain) < 20:  # the reporting line upwards, nearest manager first
        seen.add(cur)
        boss = db.get(Employee, cur)
        if boss is None:
            break
        chain.append({"id": boss.id, "name": boss.full_name, "designation": boss.designation})
        cur = boss.reports_to
    reports = [{"id": m.id, "name": m.full_name, "designation": m.designation, "teamName": (s["teams"].get(m.team_id).name if s["teams"].get(m.team_id) else None), "status": m.status}
               for m in db.execute(select(Employee).where(Employee.reports_to == e.id).order_by(Employee.full_name)).scalars()]
    team = s["teams"].get(e.team_id)
    acct = db.execute(select(User).where(User.employee_id == e.id)).scalars().first()
    privileged = p.is_super_admin or p.level == "Admin"
    timeline = [{"id": f"{e.id}-{i}", **entry, "byName": names.get(entry.get("by")) or entry.get("byName")} for i, entry in enumerate(reversed((e.attributes or {}).get("timeline") or []))]
    data.update(
        perms=_capabilities(p), related=_related(db, p, e), directReports=reports, chain=chain, timeline=timeline,
        ledTeams=[{"id": t.id, "name": t.name} for t in s["leaders"].get(e.id, [])], team={"members": len(s["members"].get("team:" + team.id, []))} if team else None,
        account={"roles": [acct.job_role]} if acct and privileged else None,
    )
    return data


# ---- departments -------------------------------------------------------------------------------------------------------------
def department_stats(db: Session, d: Department) -> dict:
    s = _structure(db)
    members = s["members"].get("dept:" + d.id, [])
    ws = [workload_of(db, m.id) for m in members]
    total = _sum(ws)
    teams = [t for t in s["teams"].values() if t.department_id == d.id]
    head = db.get(Employee, d.head_id) if d.head_id else None
    active = sum(1 for m in members if m.status in ACTIVE)
    on_leave = sum(1 for m in members if m.status == "On Leave")
    return {"total": len(members), "active": active, "onLeave": on_leave, "inactive": len(members) - active - on_leave, "teamCount": len(teams), "leaderCount": len({t.leader_id for t in teams if t.leader_id}),
            "openTasks": total["pendingTasks"], "overdueTasks": total["overdueTasks"], "activeProjects": total["activeProjects"], "openTickets": total["openTickets"], "workloadLevel": level_of(total),
            "headInactive": bool(head and head.status not in WORKING)}


def _member_row(db: Session, m: Employee, s: dict) -> dict:
    return {"id": m.id, "fullName": m.full_name, "designation": m.designation, "status": m.status, "working": m.status in WORKING, "isTeamLeader": m.id in s["leaders"], "workload": workload_of(db, m.id)}


def _team_size(s: dict, team_id: str) -> int:
    return len(s["members"].get("team:" + team_id, []))


def department_detail(db: Session, p: Principal, department_id: str) -> dict:
    from app.services.org import DEPARTMENT_SPEC

    data = records.get_record(db, DEPARTMENT_SPEC, p, department_id)
    d = db.get(Department, department_id)
    s = _structure(db)
    teams = sorted((t for t in s["teams"].values() if t.department_id == d.id), key=lambda t: t.name)
    data.update(department_stats(db, d), perms=_capabilities(p),
                teams=[{"id": t.id, "name": t.name, "parentTeamName": s["teams"][t.parent_team_id].name if t.parent_team_id in s["teams"] else None, "leaderName": s["names"].get(t.leader_id), "size": _team_size(s, t.id)} for t in teams],
                members=[_member_row(db, m, s) for m in sorted(s["members"].get("dept:" + d.id, []), key=lambda m: m.full_name)])
    return data


# ---- teams ---------------------------------------------------------------------------------------------------------------------
def team_stats(db: Session, t: Team) -> dict:
    s = _structure(db)
    members = s["members"].get("team:" + t.id, [])
    ids = {m.id for m in members}
    total = _sum([workload_of(db, i) for i in ids])
    leader = db.get(Employee, t.leader_id) if t.leader_id else None
    return {"size": len(members), "active": sum(1 for m in members if m.status in ACTIVE), "subTeamCount": sum(1 for x in s["teams"].values() if x.parent_team_id == t.id),
            "parentTeamName": s["teams"][t.parent_team_id].name if t.parent_team_id in s["teams"] else None, "workloadLevel": level_of(total), "leaderInactive": bool(leader and leader.status not in WORKING),
            "openTasks": total["pendingTasks"], "overdueTasks": total["overdueTasks"], "activeProjects": total["activeProjects"], "openTickets": total["openTickets"], "activeDeals": total["activeDeals"]}


def team_detail(db: Session, p: Principal, team_id: str) -> dict:
    from app.services.org import TEAM_SPEC

    data = records.get_record(db, TEAM_SPEC, p, team_id)
    t = db.get(Team, team_id)
    s = _structure(db)
    members = s["members"].get("team:" + t.id, [])
    ids = [m.id for m in members]
    done = db.execute(select(func.count(func.distinct(Task.id))).join(TaskPerson, TaskPerson.task_id == Task.id).where(TaskPerson.kind == "assignee", TaskPerson.employee_id.in_(ids), Task.status == "Completed")).scalar() if ids else 0
    stats = team_stats(db, t)
    open_tasks = stats["openTasks"]
    revenue = db.execute(select(func.coalesce(func.sum(Deal.value), 0)).where(Deal.salesperson.in_(ids), Deal.stage == "Closed Won")).scalar() if ids else 0
    history = [{"id": f"{t.id}-{i}", **h, "byName": s["names"].get(h.get("by")) or h.get("byName")} for i, h in enumerate(reversed((t.attributes or {}).get("history") or []))]
    data.update(stats, perms=_capabilities(p), completedTasks=int(done or 0), revenueWon=float(revenue or 0), completionRate=round(done / (done + open_tasks) * 100) if (done + open_tasks) else None,
                onTimeRate=round((open_tasks - stats["overdueTasks"]) / open_tasks * 100) if open_tasks else None, history=history,
                members=[_member_row(db, m, s) for m in sorted(members, key=lambda m: m.full_name)],
                subTeams=[{"id": x.id, "name": x.name, "leaderName": s["names"].get(x.leader_id), "size": _team_size(s, x.id)} for x in sorted(s["teams"].values(), key=lambda x: x.name) if x.parent_team_id == t.id])
    return data


__all__ = ["workloads", "employee_detail", "department_detail", "team_detail", "employee_row_extras", "department_stats", "team_stats"]
