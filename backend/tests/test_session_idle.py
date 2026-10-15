"""Sessions end after a period of NO activity - and only then. Using the app (a heartbeat the browser sends while the person types / clicks) keeps it alive; an open but abandoned
tab does not, even though the app keeps asking the server small questions in the background."""
from datetime import UTC, datetime, timedelta

from app.db.session import get_session_factory
from app.models.identity import AuthSession
from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"


def set_inactive_for(session_id: str, minutes: float) -> None:
    """Pretend the person last did something `minutes` ago."""
    with get_session_factory()() as db:
        db.get(AuthSession, session_id).last_activity_at = datetime.now(UTC) - timedelta(minutes=minutes)
        db.commit()


def activity_of(session_id: str) -> datetime:
    with get_session_factory()() as db:
        return db.get(AuthSession, session_id).last_activity_at


def person(client, sa, name="idle.user"):
    make_account(client, sa, first="Idle", last="User", role="Sales Executive", branch="Salem", username=name)
    r = login(client, name)
    return r.json()["tokens"]["sessionId"], headers_of(r), r.json()["tokens"]["refreshToken"]


def test_an_active_person_is_never_signed_out_but_an_inactive_one_is(client, sa):
    sid, h, _ = person(client, sa)
    assert client.get(f"{API}/auth/me", headers=h).json()["idleTimeoutMinutes"] == 30
    set_inactive_for(sid, 29)  # still inside the limit
    assert client.get(f"{API}/leads", headers=h).status_code == 200
    set_inactive_for(sid, 31)  # past it
    r = client.get(f"{API}/leads", headers=h)
    assert r.status_code == 401 and r.json()["code"] == "SESSION_IDLE" and "30 minutes" in r.json()["message"]
    again = client.get(f"{API}/leads", headers=h)  # the session is over for good, with the same reason
    assert again.status_code == 401 and again.json()["code"] == "SESSION_IDLE"
    assert login(client, "idle.user").status_code == 200  # signing in again starts a fresh session


def test_the_heartbeat_keeps_a_session_alive_and_background_requests_do_not(client, sa):
    sid, h, _ = person(client, sa)
    set_inactive_for(sid, 29)
    before = activity_of(sid)
    for path in ("/auth/me", "/directory/people", "/notifications", "/leads"):  # what the open app asks in the background
        client.get(f"{API}{path}", headers=h)
    assert abs((activity_of(sid) - before).total_seconds()) < 1, "background requests must not reset the inactivity clock"
    beat = client.post(f"{API}/auth/activity", headers=h)
    assert beat.status_code == 200 and beat.json()["idleTimeoutMinutes"] == 30
    assert (datetime.now(UTC) - activity_of(sid)).total_seconds() < 5
    set_inactive_for(sid, 5)
    assert client.get(f"{API}/leads", headers=h).status_code == 200


def test_an_idle_session_cannot_be_revived_by_a_heartbeat_or_a_refresh(client, sa):
    sid, h, refresh = person(client, sa)
    set_inactive_for(sid, 45)
    renewed = client.post(f"{API}/auth/refresh", json={"refreshToken": refresh})
    assert renewed.status_code == 401 and renewed.json()["code"] == "SESSION_IDLE"
    assert client.post(f"{API}/auth/activity", headers=h).status_code == 401


def test_a_refresh_is_housekeeping_not_activity(client, sa):
    sid, h, refresh = person(client, sa)
    set_inactive_for(sid, 20)
    before = activity_of(sid)
    assert client.post(f"{API}/auth/refresh", json={"refreshToken": refresh}).status_code == 200
    assert abs((activity_of(sid) - before).total_seconds()) < 1


def test_the_super_admin_sets_the_inactivity_limit(client, sa):
    sid, h, _ = person(client, sa)
    for bad in (4, 481, "abc"):
        assert client.put(f"{API}/settings/security", json={"idleTimeoutMinutes": bad}, headers=sa).status_code == 422
    ok = client.put(f"{API}/settings/security", json={"idleTimeoutMinutes": 10}, headers=sa)
    assert ok.status_code == 200 and ok.json()["idleTimeoutMinutes"] == 10
    assert client.get(f"{API}/auth/me", headers=h).json()["idleTimeoutMinutes"] == 10
    set_inactive_for(sid, 11)
    assert client.get(f"{API}/leads", headers=h).json()["code"] == "SESSION_IDLE"
    # only the Super Admin may change it; an empty value returns to the server default
    make_account(client, sa, first="Adm", last="In", level="Admin", branch="Salem", username="adm.in")
    assert client.put(f"{API}/settings/security", json={"idleTimeoutMinutes": 5}, headers=headers_of(login(client, "adm.in"))).status_code == 403
    assert client.put(f"{API}/settings/security", json={"idleTimeoutMinutes": None}, headers=sa).json()["idleTimeoutMinutes"] is None
    assert client.get(f"{API}/auth/me", headers=headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD))).json()["idleTimeoutMinutes"] == 30
    assert client.get(f"{API}/system/status", headers=sa).json()["security"]["idleTimeoutMinutes"] == 30
