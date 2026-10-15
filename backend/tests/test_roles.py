from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def test_a_template_edit_changes_what_accounts_on_that_role_may_do(client, sa):
    make_account(client, sa, first="Sal", last="Seller", role="Sales Executive", branch="Salem", username="sal.role")
    h = headers_of(login(client, "sal.role"))
    assert client.get(f"{API}/campaigns", headers=h).status_code == 403
    cfg = client.get(f"{API}/roles", headers=sa).json()
    assert "Sales Executive" in cfg["roles"] and cfg["permissions"]["Sales Executive"]["Leads"]["view"] is True
    perms = {**cfg["permissions"]["Sales Executive"], "Campaigns": {"view": True, "create": False, "edit": False, "delete": False, "export": False}}
    r = client.put(f"{API}/roles/Sales%20Executive/permissions", json={"permissions": perms}, headers=sa)
    assert r.status_code == 200 and "Sales Executive" in r.json()["customized"]
    assert client.get(f"{API}/auth/me", headers=h).json()["permissions"]["Campaigns"]["view"] is True  # effective on the very next request
    # an account with its own explicit permission set does not follow the template
    make_account(client, sa, first="Own", last="Set", role="Sales Executive", branch="Salem", username="own.set", permissions={"Leads": {"view": True, "create": False, "edit": False, "delete": False, "export": False}})
    assert client.get(f"{API}/auth/me", headers=headers_of(login(client, "own.set"))).json()["permissions"]["Campaigns"]["view"] is False
    back = client.post(f"{API}/roles/Sales%20Executive/reset", headers=sa).json()
    assert "Sales Executive" not in back["customized"] and client.get(f"{API}/auth/me", headers=h).json()["permissions"]["Campaigns"]["view"] is False


def test_hard_locks_survive_any_template_and_protected_roles_are_fixed(client, sa):
    cfg = client.get(f"{API}/roles", headers=sa).json()
    everything = {m: {"view": True, "create": True, "edit": True, "delete": True, "export": True} for m in cfg["modules"]}
    assert client.put(f"{API}/roles/Admin/permissions", json={"permissions": everything}, headers=sa).status_code == 409
    assert client.put(f"{API}/roles/Nobody/permissions", json={"permissions": everything}, headers=sa).status_code == 404
    out = client.put(f"{API}/roles/HR/permissions", json={"permissions": everything}, headers=sa).json()["permissions"]["HR"]
    assert out["User Management"]["view"] is False and out["Roles & Permissions"]["view"] is False and out["Branches"]["view"] is False and out["Employees"]["create"] is False
    assert client.put(f"{API}/roles/HR/permissions", json={"permissions": {}}, headers=sa).status_code == 422  # a role must open something


def test_custom_roles_can_be_added_used_and_removed(client, sa):
    r = client.post(f"{API}/roles", json={"name": "Field Agent", "copyFrom": "Sales Executive"}, headers=sa)
    assert r.status_code == 201 and "Field Agent" in r.json()["custom"] and r.json()["permissions"]["Field Agent"]["Leads"]["view"] is True
    assert client.post(f"{API}/roles", json={"name": "field agent"}, headers=sa).status_code == 409
    assert client.post(f"{API}/roles", json={"name": "X"}, headers=sa).status_code == 422
    acc = make_account(client, sa, first="Fi", last="Eld", role="Field Agent", branch="Salem", username="fi.eld")
    assert acc["role"] == "Field Agent" and client.get(f"{API}/auth/me", headers=headers_of(login(client, "fi.eld"))).json()["permissions"]["Leads"]["view"] is True
    assert client.delete(f"{API}/roles/Field%20Agent", headers=sa).status_code == 409  # still in use
    assert client.delete(f"{API}/roles/Sales%20Manager", headers=sa).status_code == 409  # built-in
    client.put(f"{API}/userAccounts/{acc['id']}", json={"role": "Support"}, headers=sa)
    assert client.delete(f"{API}/roles/Field%20Agent", headers=sa).status_code == 200


def test_only_the_super_admin_manages_roles(client, sa, salem_admin):
    assert client.get(f"{API}/roles", headers=salem_admin).status_code == 403
    assert client.post(f"{API}/roles", json={"name": "Sneaky"}, headers=salem_admin).status_code == 403
