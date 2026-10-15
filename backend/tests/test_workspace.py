from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def test_templates_are_separate_per_kind_with_one_default(client, sa, salem_admin):
    q1 = client.post(f"{API}/quotationTemplates", json={"name": "Classic", "isDefault": True, "isActive": True, "layout": {"accent": "#123"}}, headers=salem_admin)
    assert q1.status_code == 201, q1.text
    assert q1.json()["layout"] == {"accent": "#123"} and q1.json()["isDefault"] is True
    q2 = client.post(f"{API}/quotationTemplates", json={"name": "Modern", "isDefault": True}, headers=salem_admin).json()
    p1 = client.post(f"{API}/proposalTemplates", json={"name": "Classic", "isDefault": True}, headers=salem_admin)
    assert p1.status_code == 201
    quotes = {t["name"]: t for t in client.get(f"{API}/quotationTemplates", params={"all": "true"}, headers=salem_admin).json()}
    assert set(quotes) == {"Classic", "Modern"} and quotes["Classic"]["isDefault"] is False and quotes["Modern"]["isDefault"] is True
    assert [t["name"] for t in client.get(f"{API}/proposalTemplates", params={"all": "true"}, headers=salem_admin).json()] == ["Classic"]
    assert client.get(f"{API}/proposalTemplates/{q2['id']}", headers=salem_admin).status_code == 404  # another kind
    assert client.put(f"{API}/quotationTemplates/{q2['id']}", json={"kind": "proposal", "isActive": False}, headers=salem_admin).status_code in (200, 403, 422)
    assert client.get(f"{API}/quotationTemplates/{q2['id']}", headers=salem_admin).json()["isActive"] is False


def test_global_search_respects_permissions_and_branches(client, sa, salem_admin):
    make_account(client, sa, first="Mia", last="Mumbai", level="Admin", branch="Mumbai", username="mia.mumbai")
    mia = headers_of(login(client, "mia.mumbai"))
    client.post(f"{API}/companies", json={"name": "Zenith Industries"}, headers=salem_admin)
    client.post(f"{API}/leads", json={"name": "Zenith lead", "company": "Zenith"}, headers=salem_admin)
    hits = client.get(f"{API}/search", params={"q": "zenith"}, headers=salem_admin).json()
    assert {h["type"] for h in hits} == {"Company", "Lead"}
    assert client.get(f"{API}/search", params={"q": "zenith"}, headers=mia).json() == []  # another branch
    assert client.get(f"{API}/search", params={"q": ""}, headers=salem_admin).json() == []
    assert client.get(f"{API}/search", params={"q": "zenith"}).status_code == 401


def test_notifications_read_all_only_touches_my_own(client, sa, salem_admin):
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.models import Notification
    from app.services import timeline

    me = client.get(f"{API}/auth/me", headers=salem_admin).json()["id"]
    other = client.get(f"{API}/auth/me", headers=sa).json()["id"]
    with get_session_factory()() as db:
        timeline.notify(db, user_id=me, message="mine 1", branch="Salem")
        timeline.notify(db, user_id=me, message="mine 2", branch="Salem")
        timeline.notify(db, user_id=other, message="theirs", branch="Salem")
        db.commit()
    assert client.post(f"{API}/notifications/read-all", headers=salem_admin).json() == {"success": True}
    with get_session_factory()() as db:
        rows = {n.message: n.read for n in db.execute(select(Notification)).scalars()}
    assert rows == {"mine 1": True, "mine 2": True, "theirs": False}


def test_people_directory_is_branch_scoped_and_carries_no_secrets(client, sa, salem_admin):
    make_account(client, sa, first="Mia", last="Mumbai", branch="Mumbai", username="mia.mumbai")
    rows = client.get(f"{API}/directory/people", headers=salem_admin).json()
    names = {r["name"] for r in rows}
    assert "Priya Salem" in names and "Mia Mumbai" not in names
    one = next(r for r in rows if r["name"] == "Priya Salem")
    assert {"id", "name", "email", "role", "department", "branch", "initials"} <= set(one) and not any("password" in k.lower() for k in one)
    assert "Mia Mumbai" in {r["name"] for r in client.get(f"{API}/directory/people", headers=sa).json()}
    assert client.get(f"{API}/directory/people").status_code == 401


def test_account_sessions_and_activity_for_the_super_admin(client, sa, salem_admin):
    uid = client.get(f"{API}/auth/me", headers=salem_admin).json()["accountId"]
    sessions = client.get(f"{API}/userAccounts/{uid}/sessions", headers=sa).json()
    assert sessions and sessions[0]["active"] is True and "refresh" not in str(sessions[0]).lower()
    assert any(a["action"] == "Login" for a in client.get(f"{API}/userAccounts/{uid}/activity", headers=sa).json())
    assert client.get(f"{API}/userAccounts/{uid}/sessions", headers=salem_admin).status_code == 403


def test_monthly_performance_is_real_and_hides_money_without_finance_access(client, sa, salem_admin):
    from datetime import date

    make_account(client, sa, first="Sal", last="Seller", role="Sales Executive", branch="Salem", username="sal.perf")
    seller = headers_of(login(client, "sal.perf"))
    client.post(f"{API}/leads", json={"name": "This month"}, headers=seller)
    rows = client.get(f"{API}/reports/monthly-performance", params={"months": 6}, headers=salem_admin).json()
    assert len(rows) == 6 and rows[-1]["key"] == date.today().isoformat()[:7] and rows[-1]["leads"] == 1 and rows[-1]["revenue"] == 0
    mine = client.get(f"{API}/reports/monthly-performance", headers=seller).json()
    assert len(mine) == 12 and mine[-1]["revenue"] is None  # an executive has no finance view
    assert client.get(f"{API}/reports/monthly-performance", params={"months": 99}, headers=seller).status_code == 422


def test_settings_audit_and_system_status_are_for_administrators(client, sa, salem_admin):
    seller = make_account(client, sa, first="Sal", last="Set", role="Sales Executive", branch="Salem", username="sal.set")
    h = headers_of(login(client, "sal.set"))
    assert client.get(f"{API}/settings", headers=h).json()["tax"]["rate"] == 18  # everyone may read them
    assert client.put(f"{API}/settings/company", json={"name": "LAX360"}, headers=h).status_code == 403
    ok = client.put(f"{API}/settings/company", json={"name": "LAX360 Pvt Ltd", "email": "hello@lax360.com", "gstNumber": "29aabcd1234e1z5"}, headers=salem_admin)
    assert ok.status_code == 200 and ok.json()["gstNumber"] == "29AABCD1234E1Z5"
    assert client.put(f"{API}/settings/company", json={"name": "X"}, headers=salem_admin).status_code == 422
    assert client.put(f"{API}/settings/company", json={"name": "LAX", "email": "nope"}, headers=salem_admin).status_code == 422
    assert client.put(f"{API}/settings/tax", json={"rate": 140}, headers=salem_admin).status_code == 422
    assert client.put(f"{API}/settings/tax", json={"rate": 12.5, "inclusive": True}, headers=salem_admin).json()["rate"] == 12.5
    assert client.put(f"{API}/settings/bogus", json={}, headers=salem_admin).status_code == 422
    # a switched-off notification kind is no longer created
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.models import Notification
    from app.services import timeline

    client.put(f"{API}/settings/notifications", json={"events": {"Deal Won": False}}, headers=salem_admin)
    with get_session_factory()() as db:
        assert timeline.notify(db, user_id=seller["employeeId"], message="won", type="Deal Won") is None
        assert timeline.notify(db, user_id=seller["employeeId"], message="lost", type="Deal Lost") is not None
        db.commit()
        assert [n.message for n in db.execute(select(Notification)).scalars()] == ["lost"]
    trail = client.get(f"{API}/audit", params={"kind": "login"}, headers=sa).json()
    assert trail["total"] >= 1 and all(r["module"] == "Authentication" for r in trail["data"])
    assert client.get(f"{API}/audit", headers=h).status_code == 403
    assert client.get(f"{API}/audit", params={"from": "garbage"}, headers=sa).status_code == 422
    admin_view = client.get(f"{API}/audit", headers=salem_admin).json()
    assert all(r["branch"] in ("Salem", None) for r in admin_view["data"])
    status = client.get(f"{API}/system/status", headers=sa).json()
    assert status["email"]["connected"] is False and status["storage"]["backend"] == "database" and status["security"]["maxFailedLogins"] == 5
    assert client.get(f"{API}/system/status", headers=h).status_code == 403
