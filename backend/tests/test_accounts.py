from tests.conftest import PASSWORD, ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account, perms

API = "/api/v1"


def create(client, sa, **overrides):
    body = {"firstName": "Neha", "lastName": "Rao", "email": "neha.rao@lax360.com", "username": "neha.rao", "password": PASSWORD, "accessLevel": "Employee", "role": "Sales Executive",
            "branch": "Bangalore", "department": "Sales", "forcePasswordChange": False, **overrides}
    return client.post(f"{API}/userAccounts", json=body, headers=sa)


def test_only_the_super_admin_manages_accounts(client, sa, salem_admin):
    assert client.get(f"{API}/userAccounts", headers=salem_admin).status_code == 403
    assert create(client, salem_admin).status_code == 403
    assert client.get(f"{API}/userAccounts", headers=sa).status_code == 200
    assert client.get(f"{API}/userAccounts").status_code == 401


def test_create_assigns_role_branch_permissions_and_a_matching_employee(client, sa):
    r = create(client, sa, permissions=perms(Leads=True, Dashboard={"view": True}))
    assert r.status_code == 201, r.text
    acct = r.json()
    assert acct["accessLevel"] == "Employee" and acct["role"] == "Sales Executive" and acct["branch"] == "Bangalore" and acct["branchAccess"] is None
    assert "password" not in acct and "passwordHash" not in acct
    assert acct["permissions"]["Leads"]["delete"] is True and acct["permissions"]["Deals"]["view"] is False
    employee = client.get(f"{API}/employees/{acct['employeeId']}", headers=sa).json()
    assert employee["branch"] == "Bangalore" and employee["fullName"] == "Neha Rao" and employee["crmAccess"] is True
    # the new user can sign in - automatically into their branch, with exactly the granted modules
    me = login(client, "neha.rao").json()["user"]
    assert me["branch"] == "Bangalore" and me["permissions"]["Leads"]["create"] is True and me["permissions"]["Companies"]["view"] is False


def test_branch_is_required_and_must_exist_and_be_active(client, sa):
    assert create(client, sa, branch=None).status_code == 422
    assert create(client, sa, branch="Delhi").status_code == 422
    client.put(f"{API}/branches/BR-BLR", json={"status": "Inactive"}, headers=sa)
    assert create(client, sa, branch="Bangalore").status_code == 422


def test_validation_of_identity_password_and_modules(client, sa):
    assert create(client, sa, email="not-an-email").status_code == 422
    assert create(client, sa, username="x").status_code == 422
    assert create(client, sa, password="weak").status_code == 422
    assert create(client, sa, permissions=perms()).status_code == 422  # no module at all: the person could never sign in
    assert create(client, sa, firstName="").status_code == 422
    assert create(client, sa, accessLevel="Client").status_code == 422
    assert create(client, sa).status_code == 201
    dup = create(client, sa, username="other.name")
    assert dup.status_code == 409 and "email" in dup.json()["fields"]
    dup = create(client, sa, email="other@lax360.com")
    assert dup.status_code == 409 and "username" in dup.json()["fields"]


def test_a_super_admin_cannot_be_created_and_all_branch_access_cannot_be_granted(client, sa):
    assert create(client, sa, accessLevel="Super Admin").status_code == 403
    uid = create(client, sa).json()["id"]
    assert client.put(f"{API}/userAccounts/{uid}", json={"branchAccess": "all"}, headers=sa).status_code == 403
    assert client.put(f"{API}/userAccounts/{uid}", json={"accessLevel": "Super Admin"}, headers=sa).status_code == 422


def test_the_super_admin_is_protected_and_nobody_edits_their_own_access(client, sa):
    me = client.get(f"{API}/auth/me", headers=sa).json()
    uid = me["accountId"]
    assert client.put(f"{API}/userAccounts/{uid}", json={"status": "Inactive"}, headers=sa).status_code == 403
    assert client.put(f"{API}/userAccounts/{uid}", json={"branch": "Salem"}, headers=sa).status_code == 403
    assert client.delete(f"{API}/userAccounts/{uid}", headers=sa).status_code == 403
    assert client.put(f"{API}/userAccounts/{uid}", json={"phone": "999"}, headers=sa).status_code == 200  # ordinary profile fields are fine


def test_changing_branch_role_and_permissions_takes_effect_on_the_live_session(client, sa):
    uid = create(client, sa, role="Employee").json()["id"]
    h = headers_of(login(client, "neha.rao"))
    assert client.get(f"{API}/companies", headers=h).status_code == 403  # a plain Employee profile has no Companies access
    assert client.put(f"{API}/userAccounts/{uid}", json={"permissions": perms(Companies=True, Dashboard={"view": True}), "role": "Sales Executive"}, headers=sa).status_code == 200
    assert client.get(f"{API}/companies", headers=h).status_code == 200
    client.post(f"{API}/companies", json={"name": "Bangalore Co"}, headers=h)
    r = client.put(f"{API}/userAccounts/{uid}", json={"branch": "Salem"}, headers=sa)
    assert r.json()["branch"] == "Salem" and r.json()["employeeBranch"] == "Salem"
    assert client.get(f"{API}/companies", headers=h).json()["total"] == 0  # now a Salem person: Bangalore's company is invisible


def test_admin_reset_returns_a_one_time_password_and_ends_sessions(client, sa):
    uid = create(client, sa).json()["id"]
    h = headers_of(login(client, "neha.rao"))
    reset = client.post(f"{API}/userAccounts/{uid}/reset-password", headers=sa).json()
    temp = reset["temporaryPassword"]
    assert reset["account"]["forcePasswordChange"] is True and "password" not in reset["account"]
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401
    assert login(client, "neha.rao", PASSWORD, expect=401).status_code == 401
    assert login(client, "neha.rao", temp).json()["user"]["forcePasswordChange"] is True


def test_super_admin_can_set_a_specific_password(client, sa):
    uid = create(client, sa).json()["id"]
    assert client.post(f"{API}/userAccounts/{uid}/password", json={"newPassword": "weak"}, headers=sa).status_code == 422
    assert client.post(f"{API}/userAccounts/{uid}/password", json={"newPassword": "Chosen@Pass1"}, headers=sa).status_code == 200
    assert login(client, "neha.rao", "Chosen@Pass1").status_code == 200


def test_terminate_sessions(client, sa):
    uid = create(client, sa).json()["id"]
    h = headers_of(login(client, "neha.rao"))
    assert client.post(f"{API}/userAccounts/{uid}/terminate-sessions", headers=sa).json()["terminated"] == 1
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401


def test_employee_access_grant_and_status_change_cascade(client, sa):
    emp = client.post(f"{API}/employees", json={"fullName": "Kiran Das", "officialEmail": "kiran.das@lax360.com", "branch": "Mumbai", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001"}, headers=sa)
    assert emp.status_code == 201, emp.text
    eid = emp.json()["id"]
    granted = client.post(f"{API}/employees/{eid}/access", json={"username": "kiran.das", "password": PASSWORD, "accessLevel": "Employee", "role": "Accounts", "forcePasswordChange": False}, headers=sa)
    assert granted.status_code == 201, granted.text
    assert granted.json()["branch"] == "Mumbai" and granted.json()["employeeId"] == eid
    assert client.post(f"{API}/employees/{eid}/access", json={"username": "kiran2", "password": PASSWORD}, headers=sa).status_code == 409
    assert login(client, "kiran.das").status_code == 200
    # a person who leaves can no longer sign in; coming back restores the previous state
    assert client.post(f"{API}/employees/{eid}/status", json={"status": "Resigned"}, headers=sa).status_code == 422  # a reason is required
    assert client.post(f"{API}/employees/{eid}/status", json={"status": "Resigned", "reason": "Left the company"}, headers=sa).status_code == 200
    assert login(client, "kiran.das", expect=403).json()["code"] == "ACCOUNT_INACTIVE"
    assert client.post(f"{API}/employees/{eid}/status", json={"status": "Active"}, headers=sa).status_code == 200
    assert login(client, "kiran.das").status_code == 200


def test_an_admin_cannot_change_an_employees_branch_or_status_through_the_generic_update(client, sa):
    make_account(client, sa, first="Ann", last="Admin", level="Admin", branch="Salem", username="ann.admin")
    h = headers_of(login(client, "ann.admin"))
    eid = client.post(f"{API}/employees", json={"fullName": "Sam Lee", "officialEmail": "sam.lee@lax360.com", "branch": "Salem", "designation": "Analyst", "joinDate": "2026-01-05", "departmentId": "DEP-001"}, headers=sa).json()["id"]
    assert client.post(f"{API}/employees", json={"fullName": "X Y", "officialEmail": "xy@lax360.com"}, headers=h).status_code == 403  # only the Super Admin adds employees
    client.put(f"{API}/employees/{eid}", json={"branch": "Mumbai", "status": "Resigned", "designation": "Lead"}, headers=h)
    emp = client.get(f"{API}/employees/{eid}", headers=sa).json()
    assert emp["branch"] == "Salem" and emp["status"] == "Active" and emp["designation"] == "Lead"
