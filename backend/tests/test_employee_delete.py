"""Deleting a person: the login and the employee record go together (never an orphan login, never a person without a record), the Super Admin is protected, business records survive
with their owner cleared or handed over, and every list agrees afterwards."""
from tests.conftest import PASSWORD, headers_of, login, make_account, perms

API = "/api/v1"


def rows(response):
    body = response.json()
    return body if isinstance(body, list) else body["data"]


def person(client, sa, first="Neha", last="Rao", branch="Salem", **extra):
    acct = make_account(client, sa, first=first, last=last, branch=branch, permissions=perms(Leads=True, Tasks=True), **extra)
    return acct, acct["employeeId"]


def test_deleting_an_employee_removes_the_login_too_and_they_can_no_longer_sign_in(client, sa):
    acct, eid = person(client, sa)
    old = headers_of(login(client, acct["username"]))  # a live session at the moment of deletion
    r = client.delete(f"{API}/employees/{eid}", headers=sa)
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True and r.json()["loginRemoved"] is True and r.json()["name"] == "Neha Rao"
    assert client.get(f"{API}/employees/{eid}", headers=sa).status_code == 404
    assert client.get(f"{API}/userAccounts/{acct['id']}", headers=sa).status_code == 404
    login(client, acct["username"], expect=401)
    assert client.get(f"{API}/auth/me", headers=old).status_code == 401  # the session they already had ended with the login


def test_deleting_from_user_management_removes_the_employee_record_too(client, sa):
    acct, eid = person(client, sa)
    r = client.delete(f"{API}/userAccounts/{acct['id']}", headers=sa)
    assert r.status_code == 200 and r.json()["loginRemoved"] is True
    assert client.get(f"{API}/employees/{eid}", headers=sa).status_code == 404
    assert client.get(f"{API}/userAccounts/{acct['id']}", headers=sa).status_code == 404


def test_a_deleted_person_disappears_from_lists_search_filters_and_the_directory(client, sa):
    acct, eid = person(client, sa, first="Zebulon", last="Quill")
    assert any(e["id"] == eid for e in rows(client.get(f"{API}/employees?q=Zebulon&all=true", headers=sa)))
    client.delete(f"{API}/employees/{eid}", headers=sa)
    assert not any(e["id"] == eid for e in rows(client.get(f"{API}/employees?q=Zebulon&all=true", headers=sa)))
    assert not any(e["id"] == eid for e in rows(client.get(f"{API}/employees?branch=Salem&status=Active&all=true", headers=sa)))
    assert not any(u["id"] == acct["id"] for u in rows(client.get(f"{API}/userAccounts?q=Zebulon&all=true", headers=sa)))
    people = client.get(f"{API}/directory/people", headers=sa).json()
    assert "Zebulon" not in str(people)


def test_only_the_super_admin_may_delete(client, sa, salem_admin):
    _, eid = person(client, sa)
    assert client.delete(f"{API}/employees/{eid}", headers=salem_admin).status_code == 403
    assert client.get(f"{API}/employees/{eid}/delete-impact", headers=salem_admin).status_code == 403
    assert client.delete(f"{API}/employees/{eid}").status_code == 401
    assert client.get(f"{API}/employees/{eid}", headers=sa).status_code == 200  # nothing happened


def test_you_cannot_delete_yourself_and_the_last_super_admin_stays(client, sa):
    me = client.get(f"{API}/auth/me", headers=sa).json()
    own_user, own_employee = me["accountId"], me["id"]
    assert client.delete(f"{API}/userAccounts/{own_user}", headers=sa).status_code == 403
    r = client.delete(f"{API}/employees/{own_employee}", headers=sa)
    assert r.status_code == 403 and "own account" in r.json()["message"]
    impact = client.get(f"{API}/userAccounts/{own_user}/delete-impact", headers=sa).json()
    assert impact["allowed"] is False and impact["reason"]


def test_a_second_super_admin_can_be_deleted_by_the_first_but_never_the_last(client, sa):
    from app.db.session import get_session_factory
    from app.models.identity import User

    acct, eid = person(client, sa, first="Second", last="Root")
    with get_session_factory()() as db:  # Super Admins cannot be created through the API: promote directly
        user = db.get(User, acct["id"])
        user.access_level, user.branch, user.branch_access = "Super Admin", None, "all"
        db.commit()
    assert client.get(f"{API}/userAccounts/{acct['id']}/delete-impact", headers=sa).json()["allowed"] is True
    second = headers_of(login(client, acct["username"]))
    me = client.get(f"{API}/auth/me", headers=sa).json()
    # the second Super Admin may not remove the root one while the root is the only OTHER active one - that is allowed (root stays); but deleting root when second is deleted is not
    assert client.delete(f"{API}/userAccounts/{acct['id']}", headers=sa).status_code == 200
    assert client.get(f"{API}/auth/me", headers=second).status_code == 401
    assert client.delete(f"{API}/userAccounts/{me['accountId']}", headers=sa).status_code == 403


def test_the_last_active_super_admin_is_protected_even_from_another_super_admin(client, sa):
    from app.db.session import get_session_factory
    from app.models.identity import User

    acct, eid = person(client, sa, first="Second", last="Root")
    with get_session_factory()() as db:
        user = db.get(User, acct["id"])
        user.access_level, user.branch, user.branch_access = "Super Admin", None, "all"
        root = db.get(User, client.get(f"{API}/auth/me", headers=sa).json()["accountId"])
        root.status = "Inactive"  # the only other Super Admin is not active, so the second one is the last ACTIVE one
        db.commit()
    other = headers_of(login(client, acct["username"]))
    # root is inactive; the second one is the last active - and tries to delete root (allowed: root is inactive, the second stays), but cannot delete itself
    r = client.delete(f"{API}/userAccounts/{acct['id']}", headers=other)
    assert r.status_code == 403
    impact = client.get(f"{API}/userAccounts/{acct['id']}/delete-impact", headers=other).json()
    assert impact["allowed"] is False


def test_records_survive_with_the_owner_cleared_and_the_audit_keeps_who_it_was(client, sa):
    acct, eid = person(client, sa)
    in_salem = {**sa, "X-Branch-Scope": "Salem"}  # the Super Admin creates records inside one branch
    created = client.post(f"{API}/leads", json={"name": "Orphan lead", "assignedTo": eid}, headers=in_salem)
    assert created.status_code == 201, created.text
    lead = created.json()
    task = client.post(f"{API}/tasks", json={"title": "Call back", "assignedTo": eid}, headers=in_salem)
    impact = client.get(f"{API}/employees/{eid}/delete-impact", headers=sa).json()
    assert impact["allowed"] is True and impact["hasLogin"] is True and impact["owned"].get("leads") == 1
    r = client.delete(f"{API}/employees/{eid}", headers=sa).json()
    assert r["unassigned"].get("leads") == 1 and r["handedTo"] is None
    kept = client.get(f"{API}/leads/{lead['id']}", headers=sa)
    assert kept.status_code == 200 and not kept.json().get("assignedTo")
    if task.status_code == 201:
        assert client.get(f"{API}/tasks/{task.json()['id']}", headers=in_salem).status_code == 200


def test_work_can_be_handed_to_a_colleague_in_the_same_branch(client, sa):
    _, leaver = person(client, sa, first="Leaving", last="Person", branch="Salem")
    _, heir = person(client, sa, first="Heir", last="Apparent", branch="Salem")
    lead = client.post(f"{API}/leads", json={"name": "Handed lead", "assignedTo": leaver}, headers={**sa, "X-Branch-Scope": "Salem"}).json()
    r = client.delete(f"{API}/employees/{leaver}?reassignTo={heir}", headers=sa)
    assert r.status_code == 200 and r.json()["handedOver"].get("leads") == 1 and r.json()["handedTo"] == "Heir Apparent"
    assert client.get(f"{API}/leads/{lead['id']}", headers=sa).json()["assignedTo"] == heir


def test_the_person_chosen_to_inherit_must_be_someone_else_and_still_working(client, sa):
    _, leaver = person(client, sa, first="Leaving", last="Person")
    assert client.delete(f"{API}/employees/{leaver}?reassignTo={leaver}", headers=sa).status_code == 422
    assert client.delete(f"{API}/employees/{leaver}?reassignTo=EMP-NOPE", headers=sa).status_code == 422
    assert client.get(f"{API}/employees/{leaver}", headers=sa).status_code == 200  # a refused deletion changes nothing


def test_the_reporting_line_closes_up(client, sa):
    _, boss = person(client, sa, first="Big", last="Boss")
    _, mid = person(client, sa, first="Middle", last="Manager")
    _, low = person(client, sa, first="Junior", last="Member")
    client.put(f"{API}/employees/{mid}", json={"reportsTo": boss}, headers=sa)
    client.put(f"{API}/employees/{low}", json={"reportsTo": mid}, headers=sa)
    assert client.delete(f"{API}/employees/{mid}", headers=sa).status_code == 200
    assert client.get(f"{API}/employees/{low}", headers=sa).json()["reportsTo"] == boss


def test_an_employee_without_a_login_can_be_deleted_too(client, sa):
    r = client.post(f"{API}/employees", json={"fullName": "No Login", "branch": "Mumbai", "officialEmail": "no.login@lax360.com", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001"}, headers=sa)
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    out = client.delete(f"{API}/employees/{eid}", headers=sa)
    assert out.status_code == 200 and out.json()["loginRemoved"] is False
    assert client.get(f"{API}/employees/{eid}", headers=sa).status_code == 404


def test_an_unknown_person_is_a_clean_404(client, sa):
    assert client.delete(f"{API}/employees/EMP-NOPE", headers=sa).status_code == 404
    assert client.delete(f"{API}/userAccounts/USR-NOPE", headers=sa).status_code == 404
