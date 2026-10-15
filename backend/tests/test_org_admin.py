from tests.conftest import headers_of, login, make_account

API = "/api/v1"
DEPT = "DEP-001"


def emp(client, h, name, email, **extra):
    body = {"fullName": name, "officialEmail": email, "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": DEPT, "branch": "Salem", **extra}
    return client.post(f"{API}/employees", json=body, headers=h)


def test_employee_rules_are_enforced_on_create_and_update(client, sa):
    bad = [{"fullName": "A"}, {"officialEmail": "nope"}, {"designation": ""}, {"joinDate": ""}, {"departmentId": "DEP-999"}, {"employmentType": "Pirate"}, {"workMode": "Moon"},
           {"gender": "?"}, {"mobile": "abc"}, {"dob": "2999-01-01"}, {"reportsTo": "EMP-999"}, {"teamId": "TEAM-999"}]
    for extra in bad:
        r = emp(client, sa, "Asha Rao", f"a{abs(hash(str(extra)))}@lax360.com", **extra)
        assert r.status_code in (422, 404), (extra, r.status_code, r.text)
    boss = emp(client, sa, "Boss Man", "boss@lax360.com")
    assert boss.status_code == 201, boss.text
    worker = emp(client, sa, "Work Er", "work@lax360.com", reportsTo=boss.json()["id"])
    assert worker.status_code == 201
    loop = client.put(f"{API}/employees/{boss.json()['id']}", json={"reportsTo": worker.json()["id"]}, headers=sa)
    assert loop.status_code == 422 and "loop" in loop.json()["message"]
    assert client.put(f"{API}/employees/{boss.json()['id']}", json={"reportsTo": boss.json()["id"]}, headers=sa).status_code == 422
    assert emp(client, sa, "Dup", "BOSS@lax360.com").status_code == 409  # email already used


def test_org_config_and_capabilities(client, sa):
    make_account(client, sa, first="Hana", last="Hr", role="HR", branch="Salem", username="hana.hr")
    make_account(client, sa, first="Sal", last="Seller", role="Sales Executive", branch="Salem", username="sal.seller")
    hr = headers_of(login(client, "hana.hr"))
    cfg = client.get(f"{API}/org/config", headers=sa).json()
    assert cfg["perms"]["privileged"] and "Probation" in cfg["statuses"] and len(cfg["departments"]) >= 5 and cfg["matrix"]["roles"]["HR"]
    assert client.get(f"{API}/org/config", headers=hr).json()["perms"]["assignRole"] is False
    assert client.get(f"{API}/org/config", headers=headers_of(login(client, "sal.seller"))).status_code == 403


def test_bulk_operations_report_per_person_and_demand_confirmation(client, sa):
    a = emp(client, sa, "Bulk One", "b1@lax360.com").json()["id"]
    b = emp(client, sa, "Bulk Two", "b2@lax360.com").json()["id"]
    r = client.post(f"{API}/employees/bulk", json={"ids": [a, b], "action": "deactivate", "reason": "Restructure"}, headers=sa)
    assert r.status_code == 409 and r.json()["requiresConfirmation"] is True and r.json()["count"] == 2
    ok = client.post(f"{API}/employees/bulk", json={"ids": [a, b, "EMP-999"], "action": "deactivate", "reason": "Restructure", "confirm": True}, headers=sa).json()
    assert ok["ok"] == 2 and ok["failed"] == 1 and ok["results"][2]["error"] == "Not found"
    assert client.get(f"{API}/employees/{a}", headers=sa).json()["status"] == "Inactive"
    assert client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "deactivate", "confirm": True}, headers=sa).json()["results"][0].get("unchanged") is True
    assert client.post(f"{API}/employees/bulk", json={"ids": [b], "action": "activate", "confirm": True}, headers=sa).json()["ok"] == 1
    moved = client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "department", "departmentId": "DEP-002", "confirm": True}, headers=sa).json()
    assert moved["ok"] == 1 and client.get(f"{API}/employees/{a}", headers=sa).json()["departmentId"] == "DEP-002"
    assert client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "department", "departmentId": "DEP-999", "confirm": True}, headers=sa).json()["results"][0]["ok"] is False
    assert client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "role", "role": "Admin", "confirm": True}, headers=sa).status_code == 403
    assert client.post(f"{API}/employees/bulk", json={"ids": [], "action": "status"}, headers=sa).status_code == 422
    assert client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "explode", "confirm": True}, headers=sa).status_code == 422
    make_account(client, sa, first="Nope", last="Bulk", role="Sales Executive", branch="Salem", username="nope.bulk")
    assert client.post(f"{API}/employees/bulk", json={"ids": [a], "action": "activate", "confirm": True}, headers=headers_of(login(client, "nope.bulk"))).status_code == 403


def test_import_validates_everything_before_writing_anything(client, sa):
    dept_name = next(d["name"] for d in client.get(f"{API}/org/config", headers=sa).json()["departments"] if d["id"] == DEPT)
    good = {"fullName": "Imp One", "officialEmail": "imp1@lax360.com", "designation": "Exec", "joinDate": "2026-02-01", "department": dept_name, "branch": "Salem"}
    broken = {"fullName": "Imp Two", "officialEmail": "imp1@lax360.com", "designation": "", "joinDate": "2026-02-01", "department": "Nowhere", "branch": "Salem"}
    preview = client.post(f"{API}/employees/import", json={"rows": [good, broken]}, headers=sa)
    assert preview.status_code == 200 and preview.json()["valid"] == 1 and preview.json()["invalid"] == 1
    assert any("Unknown department" in e for e in preview.json()["rows"][1]["errors"]) and any("duplicate" in e for e in preview.json()["rows"][1]["errors"])
    assert client.post(f"{API}/employees/import", json={"rows": [good, broken], "commit": True}, headers=sa).status_code == 422
    assert not any(e["officialEmail"] == "imp1@lax360.com" for e in client.get(f"{API}/employees", params={"all": "true"}, headers=sa).json())  # nothing was written
    done = client.post(f"{API}/employees/import", json={"rows": [good], "commit": True}, headers=sa)
    assert done.status_code == 201 and done.json()["count"] == 1
    again = client.post(f"{API}/employees/import", json={"rows": [good]}, headers=sa).json()
    assert again["invalid"] == 1  # now a duplicate
    assert client.post(f"{API}/employees/import", json={"rows": []}, headers=sa).status_code == 422


def test_branch_summary_counts_every_branch_for_the_super_admin_only(client, sa, salem_admin, mumbai_admin):
    client.post(f"{API}/leads", json={"name": "S lead"}, headers=salem_admin)
    client.post(f"{API}/leads", json={"name": "M lead"}, headers=mumbai_admin)
    client.post(f"{API}/leads", json={"name": "M lead 2"}, headers=mumbai_admin)
    r = client.get(f"{API}/branches/summary", headers={**sa, "X-Branch-Scope": "Salem"})  # even while viewing one branch, the comparison shows all
    assert r.status_code == 200
    rows = {x["branch"]: x for x in r.json()["rows"]}
    assert rows["Salem"]["leads"] == 1 and rows["Mumbai"]["leads"] == 2 and r.json()["total"]["leads"] == 3 and rows["Salem"]["admins"] == 1
    assert client.get(f"{API}/branches/summary", headers=salem_admin).status_code == 403
