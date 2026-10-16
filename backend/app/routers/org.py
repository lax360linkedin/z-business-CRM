"""Branches (Super Admin) and the employee-specific actions that go beyond plain CRUD."""
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require, require_super_admin
from app.core.errors import conflict, invalid, not_found
from app.db.session import get_db
from app.models.identity import Branch, User
from app.services import accounts, audit, org, org_admin, org_detail

router = APIRouter(tags=["Organisation"])


def _branch_json(db: Session, b: Branch) -> dict:
    admins = accounts.branch_admins(db, b.name)
    return {"id": b.id, "name": b.name, "code": b.code, "status": b.status, "createdAt": b.created_at.isoformat(), "userCount": db.execute(select(func.count(User.id)).where(User.branch == b.name)).scalar_one(),
            "adminCount": len(admins), "admins": [{"id": a.id, "name": a.name, "email": a.email, "username": a.username, "lastLogin": a.last_login_at.isoformat() if a.last_login_at else None} for a in admins],
            "adminCoverage": accounts.admin_coverage(len(admins)), "adminsMin": accounts.ADMINS_MIN, "adminsMax": accounts.ADMINS_MAX}


@router.get("/branches", summary="Branches (Super Admin)", dependencies=[Depends(require_super_admin)])
def list_branches(db: Session = Depends(get_db)):
    return [_branch_json(db, b) for b in db.execute(select(Branch).order_by(Branch.name)).scalars()]


@router.post("/branches", status_code=201, summary="Add a branch (Super Admin)")
def create_branch(payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    name, code = (payload.get("name") or "").strip(), (payload.get("code") or "").strip().upper()
    if not name or not code:
        raise invalid("Name and code are required.", {"name": "Required.", "code": "Required."})
    if db.execute(select(Branch.id).where((func.lower(Branch.name) == name.lower()) | (Branch.code == code))).first():
        raise conflict("A branch with that name or code already exists.")
    branch = Branch(id=f"BR-{code}", name=name[:40], code=code[:10], status="Active")
    db.add(branch)
    audit.record(db, user=p.user, action="Create branch", module="Branches", record_id=branch.id, info=p.info)
    db.commit()
    return _branch_json(db, branch)


@router.put("/branches/{branch_id}", summary="Activate / deactivate a branch (Super Admin)")
def update_branch(branch_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    branch = db.get(Branch, branch_id)
    if branch is None:
        raise not_found("Branch not found.")
    status = payload.get("status")
    if status not in ("Active", "Inactive"):
        raise invalid("Status must be Active or Inactive.", {"status": "Invalid."})
    branch.status = status
    audit.record(db, user=p.user, action=f"Branch {status.lower()}", module="Branches", record_id=branch.id, info=p.info)
    db.commit()
    return _branch_json(db, branch)


@router.get("/branches/summary", summary="Per-branch figures (Super Admin)")
def branches_summary(p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return org_admin.branch_summary(db)


@router.post("/employees/{employee_id}/status", summary="Change an employee's status (dated, reasoned, audited)")
def employee_status(employee_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Employees", "edit")), db: Session = Depends(get_db)):
    return org.change_status(db, p, employee_id, payload.get("status", ""), payload.get("reason", ""), payload.get("effectiveDate"))


@router.post("/employees/{employee_id}/access", status_code=201, summary="Give an existing employee a CRM login (Super Admin)")
def employee_access(employee_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return org.grant_access(db, p, employee_id, payload)


@router.get("/org/config", summary="Directory settings: statuses, lists, departments, teams and your capabilities")
def org_config(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return org_admin.org_config(db, p)


@router.post("/employees/bulk", summary="Bulk change for up to 200 employees (per-person results)")
def employees_bulk(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return org_admin.bulk(db, p, payload)


@router.post("/employees/import", summary="Validate (default) or commit an employee import")
def employees_import(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    status, body = org_admin.import_employees(db, p, payload)
    return JSONResponse(body, status_code=status)


# ---- detail pages: the record plus its live workload, related work, structure and the caller's capabilities --------------------------
@router.get("/employees/{employee_id}/delete-impact", summary="What deleting this employee would touch, and whether it is allowed (Super Admin)")
def employee_delete_impact(employee_id: str, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.deletion_impact(db, p, employee_id)


@router.delete("/employees/{employee_id}", summary="Delete an employee and their login together (Super Admin; reassignTo = who inherits their work)")
def delete_employee(employee_id: str, reassignTo: str | None = None, p: Principal = Depends(require_super_admin), db: Session = Depends(get_db)):
    return accounts.delete_person(db, p, employee_id, reassignTo)


@router.get("/employees/{employee_id}", summary="One employee with workload, related work, reporting line and what you may do")
def employee_detail(employee_id: str, p: Principal = Depends(require("Employees", "view")), db: Session = Depends(get_db)):
    return org_detail.employee_detail(db, p, employee_id)


@router.get("/departments/{department_id}", summary="One department with its teams, people and workload")
def department_detail(department_id: str, p: Principal = Depends(require("Employees", "view")), db: Session = Depends(get_db)):
    return org_detail.department_detail(db, p, department_id)


@router.get("/teams/{team_id}", summary="One team with its people, sub-teams, performance figures and history")
def team_detail(team_id: str, p: Principal = Depends(require("Teams", "view")), db: Session = Depends(get_db)):
    return org_detail.team_detail(db, p, team_id)
