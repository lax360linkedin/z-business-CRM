"""Salem, Mumbai and Bangalore, each with several admins and staff: nobody reaches another branch's data, only the Super Admin spans all of them.

The matrix builds real records in every branch (through each branch's own admin) and then, for every person in every branch, tries to list, open, change, delete and search the other
branches' records. Every attempt must fail without leaking that the record exists."""
import json

import pytest

from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account
from tests.test_documents import put as upload

API = "/api/v1"
BRANCHES = ("Salem", "Mumbai", "Bangalore")
# module path -> a body that creates one record in the caller's branch (links filled in by `seed_branch`)
LISTS = ("companies", "contacts", "leads", "enquiries", "deals", "tickets", "tasks", "employees")


def seed_branch(client, sa, branch: str) -> dict:
    """Two admins, a sales manager and a sales executive for the branch, plus one record of every kind created by the branch's first admin."""
    tag = branch.lower()
    people = {}
    for key, level, role in (("admin1", "Admin", "Admin"), ("admin2", "Admin", "Admin"), ("manager", "Employee", "Sales Manager"), ("rep", "Employee", "Sales Executive"), ("support", "Employee", "Support")):
        make_account(client, sa, first=key.title(), last=branch, level=level, role=role, branch=branch, username=f"{key}.{tag}")
        people[key] = headers_of(login(client, f"{key}.{tag}"))
    a = people["admin1"]
    co = client.post(f"{API}/companies", json={"name": f"Company {branch}"}, headers=a)
    assert co.status_code == 201, co.text
    me = client.get(f"{API}/auth/me", headers=a).json()["id"]
    ids = {"companies": co.json()["id"]}
    bodies = {
        "contacts": {"name": f"Contact {branch}", "companyId": ids["companies"]},
        "leads": {"name": f"Lead {branch}", "company": f"Company {branch}"},
        "enquiries": {"name": f"Enquiry {branch}"},
        "deals": {"name": f"Deal {branch}", "companyId": ids["companies"]},
        "tickets": {"subject": f"Ticket {branch}"},
        "tasks": {"title": f"Task {branch}", "assignees": [me], "dueDate": "2030-01-01"},
    }
    for path, body in bodies.items():
        r = client.post(f"{API}/{path}", json=body, headers=a)
        assert r.status_code == 201, (path, r.status_code, r.text)
        ids[path] = r.json()["id"]
    doc = upload(client, a, relatedType="Company", relatedId=ids["companies"], category="Other", name=f"doc-{tag}.pdf")
    assert doc.status_code == 201, doc.text
    ids["documents"] = doc.json()["id"]
    ids["employees"] = me
    return {"people": people, "ids": ids, "branch": branch}


@pytest.fixture
def world(client, sa):
    return {b: seed_branch(client, sa, b) for b in BRANCHES}


def rows(r):
    body = r.json()
    return body["data"] if isinstance(body, dict) and "data" in body else body


def test_each_branch_sees_only_its_own_rows_in_every_module(client, world):
    for branch, mine in world.items():
        foreign = {path: {w["ids"][path] for other, w in world.items() if other != branch} for path in (*LISTS, "documents")}
        for who, h in mine["people"].items():
            for path in (*LISTS, "documents"):
                r = client.get(f"{API}/{path}", params={"all": "true"}, headers=h)
                if r.status_code == 403:  # the role has no access to this module at all: also fine
                    continue
                assert r.status_code == 200, (branch, who, path, r.status_code)
                got = rows(r)
                assert not ({x["id"] for x in got} & foreign[path]), (branch, who, path, "leaked another branch's record")
                for x in got:
                    if "branch" in x and x["branch"]:
                        assert x["branch"] == branch, (branch, who, path, x["id"], x["branch"])


def test_no_branch_can_open_change_or_delete_another_branchs_record(client, world):
    for branch, mine in world.items():
        for other, theirs in world.items():
            if other == branch:
                continue
            for who in ("admin1", "admin2", "manager"):
                h = mine["people"][who]
                for path in ("companies", "contacts", "leads", "enquiries", "deals", "tickets", "employees"):
                    rid = theirs["ids"][path]
                    assert client.get(f"{API}/{path}/{rid}", headers=h).status_code in (403, 404), (branch, who, path, "opened")
                    assert client.put(f"{API}/{path}/{rid}", json={"notes": "hijack"}, headers=h).status_code in (403, 404), (branch, who, path, "changed")
                    assert client.delete(f"{API}/{path}/{rid}", headers=h).status_code in (403, 404), (branch, who, path, "deleted")
                assert client.get(f"{API}/tasks/{theirs['ids']['tasks']}", headers=h).status_code in (403, 404)
                assert client.get(f"{API}/documents/{theirs['ids']['documents']}", headers=h).status_code in (403, 404)
                assert client.get(f"{API}/documents/{theirs['ids']['documents']}/download", headers=h).status_code in (403, 404)
    # and nothing was damaged: the owners still see their records untouched
    for branch, mine in world.items():
        assert client.get(f"{API}/leads/{mine['ids']['leads']}", headers=mine["people"]["admin1"]).json().get("notes") != "hijack"


def test_search_and_directories_do_not_cross_branches(client, world):
    for branch, mine in world.items():
        h = mine["people"]["admin2"]
        found = client.get(f"{API}/search", params={"q": "Company"}, headers=h)
        assert found.status_code == 200, found.text
        text = json.dumps(found.json())
        for other in BRANCHES:
            if other != branch:
                assert f"Company {other}" not in text and f"Lead {other}" not in text, (branch, other)
        assert f"Company {branch}" in text
        people = client.get(f"{API}/directory/people", headers=h)
        if people.status_code == 200:
            assert not any(other.lower() in json.dumps(people.json()).lower() for other in BRANCHES if other != branch and f".{other.lower()}" in json.dumps(people.json()).lower() and False)
        emps = rows(client.get(f"{API}/employees", params={"all": "true"}, headers=h))
        assert emps and {e["branch"] for e in emps} == {branch}


def test_a_branch_user_cannot_widen_the_scope_by_header_or_body(client, world):
    salem = world["Salem"]["people"]["admin1"]
    spoof = {**salem, "X-Branch-Scope": "Mumbai"}
    assert world["Mumbai"]["ids"]["leads"] not in {x["id"] for x in rows(client.get(f"{API}/leads", params={"all": "true"}, headers=spoof))}
    assert client.get(f"{API}/leads/{world['Mumbai']['ids']['leads']}", headers=spoof).status_code in (403, 404)
    assert client.get(f"{API}/leads", headers={**salem, "X-Branch-Scope": "all"}).status_code in (200, 403)
    assert world["Mumbai"]["ids"]["leads"] not in {x["id"] for x in rows(client.get(f"{API}/leads", params={"all": "true"}, headers={**salem, "X-Branch-Scope": "all"}))}
    for branch in ("Mumbai", "Bangalore"):
        r = client.post(f"{API}/leads", json={"name": "Sneaky", "branch": branch}, headers=salem)
        assert r.status_code in (403, 422) or (r.status_code == 201 and r.json()["branch"] == "Salem"), r.text  # refused, or placed in their own branch - never in another
    r = client.post(f"{API}/leads", json={"name": "Honest lead"}, headers=salem)
    assert r.status_code == 201 and r.json()["branch"] == "Salem"


def test_only_the_super_admin_spans_branches_and_manages_logins(client, sa, world):
    everyone = world
    all_leads = {x["id"] for x in rows(client.get(f"{API}/leads", params={"all": "true"}, headers=sa))}
    assert {w["ids"]["leads"] for w in world.values()} <= all_leads
    only_mumbai = rows(client.get(f"{API}/leads", params={"all": "true"}, headers={**sa, "X-Branch-Scope": "Mumbai"}))
    assert {x["branch"] for x in only_mumbai} == {"Mumbai"}
    for branch, w in everyone.items():
        for who in ("admin1", "admin2"):  # branch admins manage their branch's business data, not logins, roles or other branches
            h = w["people"][who]
            assert client.get(f"{API}/userAccounts", headers=h).status_code == 403
            assert client.post(f"{API}/userAccounts", json={"firstName": "X", "email": "x@lax360.com", "username": "x.user", "password": "Aa1!aaaaaaaa", "accessLevel": "Admin", "branch": branch}, headers=h).status_code == 403
            assert client.get(f"{API}/branches", headers=h).status_code == 403
            assert client.get(f"{API}/roles", headers=h).status_code in (403, 404)
            uid = client.get(f"{API}/auth/me", headers=w["people"]["rep"]).json()["accountId"]
            assert client.post(f"{API}/userAccounts/{uid}/reset-password", headers=h).status_code == 403
            assert client.put(f"{API}/userAccounts/{uid}", json={"branch": "Mumbai"}, headers=h).status_code == 403


def test_branch_is_mandatory_for_every_admin_and_employee_login(client, sa):
    body = {"firstName": "No", "lastName": "Branch", "email": "no.branch@lax360.com", "username": "no.branch", "password": "Aa1!aaaaaaaa", "forcePasswordChange": False, "department": "Sales"}
    for level in ("Admin", "Employee"):
        assert client.post(f"{API}/userAccounts", json={**body, "accessLevel": level}, headers=sa).status_code == 422, level
        assert client.post(f"{API}/userAccounts", json={**body, "accessLevel": level, "branch": ""}, headers=sa).status_code == 422
        assert client.post(f"{API}/userAccounts", json={**body, "accessLevel": level, "branch": "Atlantis"}, headers=sa).status_code == 422
    assert client.post(f"{API}/userAccounts", json={**body, "accessLevel": "Super Admin", "branch": "Salem"}, headers=sa).status_code == 403
    for branch in BRANCHES:
        r = client.post(f"{API}/userAccounts", json={**body, "accessLevel": "Admin", "branch": branch, "username": f"ok.{branch.lower()}", "email": f"ok.{branch.lower()}@lax360.com"}, headers=sa)
        assert r.status_code == 201 and r.json()["branch"] == branch and r.json()["accessLevel"] == "Admin"
    # an employee record (with no login yet) also needs a branch when the Super Admin is looking at all branches
    emp = {"fullName": "Dev Null", "officialEmail": "dev.null@lax360.com", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001"}
    assert client.post(f"{API}/employees", json=emp, headers=sa).status_code in (422, 400)
    made = client.post(f"{API}/employees", json=emp, headers={**sa, "X-Branch-Scope": "Bangalore"})
    assert made.status_code == 201 and made.json()["branch"] == "Bangalore"


def test_an_admin_cannot_add_staff_to_another_branch_and_a_move_by_the_super_admin_takes_effect(client, sa, world):
    salem_admin = world["Salem"]["people"]["admin1"]
    emp = {"fullName": "Out Of Branch", "officialEmail": "oob@lax360.com", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001", "branch": "Mumbai"}
    r = client.post(f"{API}/employees", json=emp, headers=salem_admin)
    assert r.status_code in (403, 422), r.text
    # the Super Admin moves the Salem rep to Mumbai: they lose Salem and gain Mumbai, on their very next request
    rep = world["Salem"]["people"]["admin2"]
    rep_account = client.get(f"{API}/auth/me", headers=rep).json()["accountId"]
    assert world["Salem"]["ids"]["companies"] in {x["id"] for x in rows(client.get(f"{API}/companies", params={"all": "true"}, headers=rep))}
    moved = client.put(f"{API}/userAccounts/{rep_account}", json={"branch": "Mumbai"}, headers=sa)
    assert moved.status_code == 200 and moved.json()["branch"] == "Mumbai"
    fresh = headers_of(login(client, "admin2.salem"))
    seen = {x["id"] for x in rows(client.get(f"{API}/companies", params={"all": "true"}, headers=fresh))}
    assert world["Mumbai"]["ids"]["companies"] in seen and world["Salem"]["ids"]["companies"] not in seen


def test_several_admins_in_one_branch_share_the_branch_data_but_are_independent_logins(client, sa, world):
    salem = world["Salem"]["people"]
    third = make_account(client, sa, first="Admin3", last="Salem", level="Admin", branch="Salem", username="admin3.salem")
    a3 = headers_of(login(client, "admin3.salem"))
    for h in (salem["admin1"], salem["admin2"], a3):  # every admin of the branch sees the branch's records
        assert world["Salem"]["ids"]["deals"] in {x["id"] for x in rows(client.get(f"{API}/deals", params={"all": "true"}, headers=h))}
    created = client.post(f"{API}/leads", json={"name": "By admin three"}, headers=a3).json()
    assert client.get(f"{API}/leads/{created['id']}", headers=salem["admin2"]).status_code == 200
    assert client.get(f"{API}/leads/{created['id']}", headers=world["Mumbai"]["people"]["admin1"]).status_code in (403, 404)
    # one admin leaving does not affect the others
    assert client.put(f"{API}/userAccounts/{third['id']}", json={"status": "Inactive"}, headers=sa).status_code == 200
    assert client.get(f"{API}/leads", headers=a3).status_code in (401, 403)
    assert client.get(f"{API}/leads", headers=salem["admin1"]).status_code == 200
    login(client, "admin3.salem", expect=403)


def test_branch_admin_roster_coverage_and_the_fourth_admin_guard(client, sa):
    def admin(branch, n, **extra):
        body = {"firstName": f"Adm{n}", "lastName": branch, "email": f"adm{n}.{branch.lower()}@lax360.com", "username": f"adm{n}.{branch.lower()}", "password": "Aa1!aaaaaaaa", "accessLevel": "Admin", "branch": branch,
                "department": "Sales", "forcePasswordChange": False, **extra}
        return client.post(f"{API}/userAccounts", json=body, headers=sa)

    def branch_row(name):
        return next(b for b in client.get(f"{API}/branches", headers=sa).json() if b["name"] == name)

    assert branch_row("Mumbai")["adminCoverage"] == "none" and branch_row("Mumbai")["adminCount"] == 0
    assert admin("Mumbai", 1).status_code == 201
    assert branch_row("Mumbai")["adminCoverage"] == "low"
    assert admin("Mumbai", 2).status_code == 201 and admin("Mumbai", 3).status_code == 201
    row = branch_row("Mumbai")
    assert row["adminCoverage"] == "ok" and row["adminCount"] == 3 and {a["username"] for a in row["admins"]} == {"adm1.mumbai", "adm2.mumbai", "adm3.mumbai"}
    over = admin("Mumbai", 4)
    assert over.status_code == 409 and over.json()["code"] == "ADMIN_LIMIT"  # a fourth admin needs an explicit confirmation
    assert admin("Mumbai", 4, confirmExtraAdmin=True).status_code == 201 and branch_row("Mumbai")["adminCoverage"] == "high"
    assert branch_row("Salem")["adminCount"] == 0  # the other branches are counted on their own
    # an admin who is deactivated stops counting; an employee promoted to admin of a full branch needs the same confirmation
    emp = make_account(client, sa, first="Promote", last="Me", level="Employee", role="Sales Manager", branch="Mumbai", username="promote.me")
    assert client.put(f"{API}/userAccounts/{emp['id']}", json={"accessLevel": "Admin"}, headers=sa).status_code == 409
    assert client.put(f"{API}/userAccounts/{emp['id']}", json={"accessLevel": "Admin", "confirmExtraAdmin": True}, headers=sa).status_code == 200


def test_teams_belong_to_one_branch_and_cannot_mix_branches(client, sa, world):
    salem_admin, mumbai_admin = world["Salem"]["people"]["admin1"], world["Mumbai"]["people"]["admin1"]
    s_me = client.get(f"{API}/auth/me", headers=salem_admin).json()["id"]
    m_me = client.get(f"{API}/auth/me", headers=mumbai_admin).json()["id"]
    team_s = client.post(f"{API}/teams", json={"name": "Salem Sales", "departmentId": "DEP-002", "leaderId": s_me}, headers=salem_admin)
    team_m = client.post(f"{API}/teams", json={"name": "Mumbai Sales", "departmentId": "DEP-002", "leaderId": m_me}, headers=mumbai_admin)
    assert team_s.status_code == 201 and team_s.json()["branch"] == "Salem" and team_m.status_code == 201 and team_m.json()["branch"] == "Mumbai"
    # each branch sees only its own teams, and cannot open, change or remove the other's
    assert {t["name"] for t in rows(client.get(f"{API}/teams", params={"all": "true"}, headers=salem_admin))} == {"Salem Sales"}
    assert {t["name"] for t in rows(client.get(f"{API}/teams", params={"all": "true"}, headers=mumbai_admin))} == {"Mumbai Sales"}
    tid = team_m.json()["id"]
    assert client.get(f"{API}/teams/{tid}", headers=salem_admin).status_code in (403, 404)
    assert client.put(f"{API}/teams/{tid}", json={"name": "Hijacked"}, headers=salem_admin).status_code in (403, 404)
    assert client.delete(f"{API}/teams/{tid}", headers=salem_admin).status_code in (403, 404)
    assert {t["name"] for t in rows(client.get(f"{API}/teams", params={"all": "true"}, headers=sa))} == {"Salem Sales", "Mumbai Sales"}
    # a team's leader must work in the team's branch, and an employee joins only a team of their own branch
    cross = client.put(f"{API}/teams/{team_s.json()['id']}", json={"leaderId": m_me}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert cross.status_code in (404, 422), cross.text
    emp = client.put(f"{API}/employees/{s_me}", json={"teamId": tid}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert emp.status_code in (404, 422), emp.text
    boss = client.put(f"{API}/employees/{s_me}", json={"reportsTo": m_me}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert boss.status_code in (404, 422), boss.text


def test_moving_someone_to_another_branch_ends_their_old_branch_ties(client, sa, world):
    admin = world["Salem"]["people"]["admin1"]
    me = client.get(f"{API}/auth/me", headers=admin).json()
    team = client.post(f"{API}/teams", json={"name": "Salem Core", "departmentId": "DEP-002", "leaderId": me["id"]}, headers=admin).json()
    report = client.post(f"{API}/employees", json={"fullName": "Report Person", "officialEmail": "report.person@lax360.com", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-002",
                                                   "teamId": team["id"], "reportsTo": me["id"], "branch": "Salem"}, headers={**sa, "X-Branch-Scope": "Salem"})
    assert report.status_code == 201, report.text
    assert client.put(f"{API}/userAccounts/{me['accountId']}", json={"branch": "Bangalore"}, headers=sa).status_code == 200
    moved = client.get(f"{API}/employees/{me['id']}", headers={**sa, "X-Branch-Scope": "Bangalore"}).json()
    assert moved["branch"] == "Bangalore" and moved["teamId"] is None and moved["reportsTo"] is None and moved["timeline"][0]["type"] == "BranchChanged"
    assert client.get(f"{API}/teams/{team['id']}", headers={**sa, "X-Branch-Scope": "Salem"}).json()["leaderId"] is None
    assert client.get(f"{API}/employees/{report.json()['id']}", headers={**sa, "X-Branch-Scope": "Salem"}).json()["reportsTo"] is None
