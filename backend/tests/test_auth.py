import pytest
from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import User
from tests.conftest import PASSWORD, ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account, perms

API = "/api/v1"


def post_login(client, identifier, password=PASSWORD, branch=None):
    body = {"identifier": identifier, "password": password}
    if branch is not None:
        body["branch"] = branch
    return client.post(f"{API}/auth/login", json=body)


def set_user(username, **fields):
    with get_session_factory()() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one()
        for key, value in fields.items():
            setattr(user, key, value)
        db.commit()


@pytest.fixture
def accounts(client, sa):
    make_account(client, sa, first="Priya", last="Salem", level="Admin", branch="Salem", username="priya.salem")
    make_account(client, sa, first="Vikram", last="Mumbai", branch="Mumbai", role="Project Manager", username="vikram.mumbai")


def test_valid_credentials_automatic_branch(client, accounts):
    body = login(client, "priya.salem").json()
    assert body["user"]["accessLevel"] == "Admin" and body["user"]["branch"] == "Salem" and body["user"]["allBranches"] is False
    assert body["user"]["role"] == "Admin"
    assert body["user"]["permissions"]["Leads"]["view"] is True and body["user"]["permissions"]["User Management"]["view"] is False


def test_email_or_username_both_work_case_insensitive(client, accounts):
    assert login(client, "PRIYA.SALEM@lax360.com").status_code == 200
    assert login(client, "Priya.Salem").status_code == 200


def test_matching_branch_signs_in_and_wrong_branch_is_refused_without_revealing_the_assigned_one(client, accounts):
    assert login(client, "priya.salem", branch="Salem").status_code == 200
    r = post_login(client, "priya.salem", branch="Mumbai")
    assert r.status_code == 403 and r.json()["code"] == "BRANCH_MISMATCH"
    assert "Salem" not in r.json()["message"]


def test_all_branches_is_only_for_the_super_admin(client, accounts):
    assert post_login(client, "priya.salem", branch="all").json()["code"] == "BRANCH_MISMATCH"
    assert post_login(client, ROOT_EMAIL, ROOT_PASSWORD, branch="all").status_code == 200
    assert post_login(client, ROOT_EMAIL, ROOT_PASSWORD, branch="Bangalore").status_code == 200  # any branch label is accepted: access is the account's explicit authorisation


def test_unknown_branch_value_is_rejected(client, accounts):
    assert post_login(client, "priya.salem", branch="Delhi").json()["code"] == "BRANCH_INVALID"


def test_invalid_credentials_do_not_reveal_which_part_was_wrong(client, accounts):
    wrong_pw = post_login(client, "priya.salem", "Nope@12345")
    unknown = post_login(client, "ghost.user", "Nope@12345")
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json() and wrong_pw.json()["code"] == "INVALID_CREDENTIALS"


def test_account_locks_after_five_failures_then_refuses_even_the_right_password(client, accounts):
    for _ in range(4):
        assert post_login(client, "priya.salem", "Wrong@1234").status_code == 401
    assert post_login(client, "priya.salem", "Wrong@1234").json()["code"] == "ACCOUNT_LOCKED"
    assert post_login(client, "priya.salem").json()["code"] == "ACCOUNT_LOCKED"


def test_a_branch_mismatch_does_not_count_as_a_failed_password(client, accounts):
    for _ in range(8):
        post_login(client, "priya.salem", branch="Mumbai")
    assert login(client, "priya.salem").status_code == 200


@pytest.mark.parametrize("status,code", [("Inactive", "ACCOUNT_INACTIVE"), ("Suspended", "ACCOUNT_SUSPENDED"), ("Pending", "ACCOUNT_PENDING")])
def test_non_active_accounts_cannot_sign_in(client, accounts, status, code):
    set_user("priya.salem", status=status)
    r = post_login(client, "priya.salem")
    assert r.status_code == 403 and r.json()["code"] == code


def test_account_without_any_module_access_cannot_sign_in(client, accounts):
    set_user("vikram.mumbai", permissions={})
    assert post_login(client, "vikram.mumbai").json()["code"] == "ACCOUNT_NOT_CONFIGURED"


def test_inactive_branch_blocks_its_users_but_not_the_super_admin(client, sa, accounts):
    client.put(f"{API}/branches/BR-MUM", json={"status": "Inactive"}, headers=sa)
    assert post_login(client, "vikram.mumbai").json()["code"] == "BRANCH_INACTIVE"
    assert login(client, "priya.salem").status_code == 200
    assert post_login(client, ROOT_EMAIL, ROOT_PASSWORD).status_code == 200


def test_there_is_no_way_to_pick_a_role_at_sign_in(client, accounts):
    body = {"identifier": "vikram.mumbai", "password": PASSWORD, "role": "Super Admin", "accessLevel": "Super Admin"}
    r = client.post(f"{API}/auth/login", json=body)
    assert r.json()["user"]["accessLevel"] == "Employee"


def test_session_requires_a_valid_token(client, accounts):
    assert client.get(f"{API}/auth/me").status_code == 401
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not.a.token"}).json()["code"] == "UNAUTHENTICATED"
    token = login(client, "priya.salem").json()["tokens"]["accessToken"]
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + token[:-3] + "xyz"}).status_code == 401  # tampered signature
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 200


def test_logout_revokes_the_token(client, accounts):
    h = headers_of(login(client, "priya.salem"))
    assert client.post(f"{API}/auth/logout", headers=h).status_code == 200
    assert client.get(f"{API}/auth/me", headers=h).json()["code"] == "SESSION_EXPIRED"


def test_refresh_rotates_and_reuse_ends_the_session(client, accounts):
    first = login(client, "priya.salem").json()["tokens"]
    second = client.post(f"{API}/auth/refresh", json={"refreshToken": first["refreshToken"]}).json()["tokens"]
    assert second["refreshToken"] != first["refreshToken"]
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + second["accessToken"]}).status_code == 200
    # the already-used refresh token comes back: assume it leaked and kill the session
    assert client.post(f"{API}/auth/refresh", json={"refreshToken": first["refreshToken"]}).status_code == 401
    assert client.get(f"{API}/auth/me", headers={"Authorization": "Bearer " + second["accessToken"]}).status_code == 401


def test_deactivating_an_account_ends_its_live_session_immediately(client, sa, accounts):
    h = headers_of(login(client, "priya.salem"))
    assert client.get(f"{API}/leads", headers=h).status_code == 200
    uid = client.get(f"{API}/userAccounts", params={"q": "priya"}, headers=sa).json()["data"][0]["id"]
    assert client.put(f"{API}/userAccounts/{uid}", json={"status": "Inactive"}, headers=sa).status_code == 200
    assert client.get(f"{API}/leads", headers=h).status_code == 401


def test_removing_a_users_branch_assignment_ends_the_session(client, accounts):
    h = headers_of(login(client, "vikram.mumbai"))
    assert client.get(f"{API}/auth/me", headers=h).status_code == 200
    with get_session_factory()() as db:
        db.execute(User.__table__.update().where(User.username == "vikram.mumbai").values(permissions={}))
        db.commit()
    assert client.get(f"{API}/auth/me", headers=h).status_code == 401


def test_change_password(client, accounts):
    h1 = headers_of(login(client, "priya.salem"))
    h2 = headers_of(login(client, "priya.salem"))
    bad = client.post(f"{API}/auth/change-password", json={"currentPassword": "Wrong@1234", "newPassword": "Brand@New123"}, headers=h1)
    assert bad.status_code == 422
    weak = client.post(f"{API}/auth/change-password", json={"currentPassword": PASSWORD, "newPassword": "weak"}, headers=h1)
    assert weak.status_code == 422 and "newPassword" in weak.json()["fields"]
    ok = client.post(f"{API}/auth/change-password", json={"currentPassword": PASSWORD, "newPassword": "Brand@New123"}, headers=h1)
    assert ok.status_code == 200
    assert client.get(f"{API}/auth/me", headers=h2).status_code == 401  # other sessions end
    assert client.get(f"{API}/auth/me", headers=h1).status_code == 200
    assert post_login(client, "priya.salem").status_code == 401
    assert login(client, "priya.salem", "Brand@New123").status_code == 200


def test_forgot_and_reset_password(client, accounts):
    r = client.post(f"{API}/auth/forgot-password", json={"identifier": "priya.salem"})
    assert r.status_code == 202
    unknown = client.post(f"{API}/auth/forgot-password", json={"identifier": "ghost"})
    assert unknown.status_code == 202 and "devResetToken" not in unknown.json()  # same answer; nothing leaks
    token = r.json()["devResetToken"]
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "newPassword": "weak"}).status_code == 422
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "newPassword": "Reset@Pass123"}).status_code == 200
    assert client.post(f"{API}/auth/reset-password", json={"token": token, "newPassword": "Reset@Pass456"}).status_code == 400  # one use
    assert login(client, "priya.salem", "Reset@Pass123").status_code == 200


def test_public_branch_list_has_names_only(client):
    r = client.get(f"{API}/auth/branches")
    assert [b["name"] for b in r.json()] == ["Bangalore", "Mumbai", "Salem"]
    assert set(r.json()[0]) == {"name", "code"}


def test_a_person_can_see_and_end_their_own_sessions(client, sa, salem_admin):
    from tests.conftest import login

    second = login(client, "priya.salem")
    other = {"Authorization": f"Bearer {second.json()['tokens']['accessToken']}"}
    mine = client.get("/api/v1/auth/sessions", headers=salem_admin).json()
    assert len(mine) == 2 and sum(1 for s in mine if s["current"]) == 1
    other_id = next(s["id"] for s in mine if not s["current"])
    assert client.delete(f"/api/v1/auth/sessions/{other_id}", headers=salem_admin).json() == {"success": True}
    assert client.get("/api/v1/auth/me", headers=other).status_code == 401  # the ended session stops working at once
    assert client.delete("/api/v1/auth/sessions/nope", headers=salem_admin).status_code == 404
    assert client.post("/api/v1/auth/logout-all", headers=salem_admin).json()["ended"] >= 1
    assert client.get("/api/v1/auth/me", headers=salem_admin).status_code == 401


def test_a_person_can_update_their_own_name_and_phone_only(client, sa, salem_admin):
    r = client.put("/api/v1/auth/me", json={"name": "Priya S. Salem", "phone": "+91 98765 43210", "email": "hacker@x.com", "role": "Super Admin"}, headers=salem_admin)
    assert r.status_code == 200 and r.json()["name"] == "Priya S. Salem" and r.json()["initials"] == "PS"
    assert r.json()["email"] == "priya.salem@lax360.com" and r.json()["accessLevel"] == "Admin"  # identity and rights are not editable here
    assert client.put("/api/v1/auth/me", json={"name": "P"}, headers=salem_admin).status_code == 422
    assert client.put("/api/v1/auth/me", json={"phone": "abc"}, headers=salem_admin).status_code == 422
    assert "Priya S. Salem" in {e["fullName"] for e in client.get("/api/v1/employees", params={"all": "true"}, headers=sa).json()}


def test_seed_refuses_a_weak_password_unless_asked_and_then_forces_a_change():
    import pytest

    from app.core.errors import ApiError
    from app.db.session import get_session_factory
    from app.models import User
    from app.services.seed import seed_reference_data, seed_super_admin
    from sqlalchemy import delete

    with get_session_factory()() as db:
        db.execute(delete(User).where(User.access_level == "Super Admin"))
        seed_reference_data(db)
        db.commit()
        with pytest.raises(ApiError):
            seed_super_admin(db, email="boss@acme.in", name="Boss One", password="Weakpass123")
        db.rollback()
        admin = seed_super_admin(db, email="boss@acme.in", name="Boss One", password="Weakpass123", allow_weak_bootstrap=True)
        assert admin is not None and admin.force_password_change is True
        db.rollback()  # leave the shared test database as the other tests expect it
