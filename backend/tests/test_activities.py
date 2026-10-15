from datetime import date, timedelta

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Task
from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def rep(client, sa, branch="Salem", name="Asha"):
    make_account(client, sa, first=name, last="A", branch=branch, role="Sales Executive", username=f"{name.lower()}.a")
    return headers_of(login(client, f"{name.lower()}.a"))


def lead(client, h):
    return client.post(f"{API}/leads", json={"name": "Lead One", "company": "One Ltd"}, headers=h).json()


def log(client, h, **body):
    return client.post(f"{API}/activities/log", json=body, headers=h)


def test_logging_a_call_stamps_user_and_resolves_links(client, sa):
    h = rep(client, sa)
    lead_ = lead(client, h)
    r = log(client, h, type="Call", relatedType="Lead", relatedId=lead_["id"], outcome="Connected", description="Discussed pricing")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["status"] == "Completed" and a["source"] == "manual" and a["by"] == client.get(f"{API}/auth/me", headers=h).json()["id"]
    assert a["links"]["leadId"] == lead_["id"] and a["branch"] == "Salem" and a["callOutcome"] == "Connected"
    assert client.get(f"{API}/leads/{lead_['id']}", headers=h).json()["lastContactedDate"] == date.today().isoformat()


def test_field_rules_per_type(client, sa):
    h = rep(client, sa)
    lead_ = lead(client, h)
    base = {"relatedType": "Lead", "relatedId": lead_["id"]}
    assert log(client, h, type="Call", **base).status_code == 422  # outcome required
    assert log(client, h, type="Bogus", **base).status_code == 422
    assert log(client, h, type="Meeting", subject="Demo", **base).status_code == 422  # needs date + time
    assert log(client, h, type="Proposal Sent", **base).status_code == 422  # only on proposals
    future = (date.today() + timedelta(days=5)).isoformat()
    assert log(client, h, type="Note", description="x", date=future, **base).status_code == 422  # a note cannot be in the future
    assert log(client, h, type="Note", description="ok", relatedType="Lead", relatedId="LD-9999").status_code == 404


def test_activities_cannot_claim_facts_that_are_not_true(client, sa):
    h = rep(client, sa)
    company = client.post(f"{API}/companies", json={"name": "Fact Co"}, headers=h).json()
    deal = client.post(f"{API}/deals", json={"name": "D", "companyId": company["id"]}, headers=h).json()
    r = log(client, h, type="Deal Stage Changed", relatedType="Deal", relatedId=deal["id"], toStatus="Negotiation")
    assert r.status_code == 409 and "never been" in r.json()["message"]
    client.put(f"{API}/deals/{deal['id']}", json={"stage": "Negotiation"}, headers=h)
    assert log(client, h, type="Deal Stage Changed", relatedType="Deal", relatedId=deal["id"], toStatus="Negotiation").status_code == 201


def test_follow_up_creates_a_linked_task_and_completion_keeps_them_in_step(client, sa):
    h = rep(client, sa)
    lead_ = lead(client, h)
    due = (date.today() + timedelta(days=3)).isoformat()
    a = log(client, h, type="Follow-up", subject="Chase quote", date=due, followUpType="Call", relatedType="Lead", relatedId=lead_["id"]).json()
    assert a["status"] == "Scheduled" and a["taskId"]
    with get_session_factory()() as db:
        task = db.execute(select(Task).where(Task.id == a["taskId"])).scalar_one()
        assert task.activity_id == a["id"] and task.task_type == "Call" and task.due_date.isoformat() == due
    assert client.get(f"{API}/leads/{lead_['id']}", headers=h).json()["nextFollowUp"] == due
    done = client.post(f"{API}/activities/{a['id']}/complete", json={"notes": "Done"}, headers=h)
    assert done.status_code == 200 and done.json()["status"] == "Completed"
    assert client.get(f"{API}/tasks/{a['taskId']}", headers=h).json()["status"] == "Completed"
    assert client.post(f"{API}/activities/{a['id']}/complete", json={}, headers=h).status_code == 409


def test_cancel_and_reschedule_a_scheduled_activity(client, sa):
    h = rep(client, sa)
    lead_ = lead(client, h)
    due = (date.today() + timedelta(days=3)).isoformat()
    a = log(client, h, type="Follow-up", subject="Chase", date=due, relatedType="Lead", relatedId=lead_["id"]).json()
    new_day = (date.today() + timedelta(days=6)).isoformat()
    assert client.post(f"{API}/activities/{a['id']}/reschedule", json={"date": "2020-01-01"}, headers=h).status_code == 422
    moved = client.post(f"{API}/activities/{a['id']}/reschedule", json={"date": new_day}, headers=h).json()
    assert moved["followUpDate"] == new_day and moved["rescheduledCount"] == 1
    assert client.get(f"{API}/tasks/{a['taskId']}", headers=h).json()["dueDate"] == new_day
    assert client.post(f"{API}/activities/{a['id']}/cancel", json={}, headers=h).status_code == 422
    cancelled = client.post(f"{API}/activities/{a['id']}/cancel", json={"reason": "Client unavailable"}, headers=h).json()
    assert cancelled["status"] == "Cancelled" and client.get(f"{API}/tasks/{a['taskId']}", headers=h).json()["status"] == "Cancelled"


def test_system_events_are_immutable_and_cannot_be_forged(client, sa):
    h = rep(client, sa)
    lead_ = lead(client, h)
    client.put(f"{API}/leads/{lead_['id']}", json={"status": "Contacted"}, headers=h)
    rows = client.get(f"{API}/activities", params={"all": "true", "relatedId": lead_["id"]}, headers=h).json()
    system = next(r for r in rows if r["type"] == "StatusChange")
    assert system["source"] == "system" or system.get("source") == "system"
    assert client.delete(f"{API}/activities/{system['id']}", headers=h).status_code == 409
    assert client.post(f"{API}/activities/{system['id']}/edit", json={"subject": "x"}, headers=h).status_code == 409
    forged = client.post(f"{API}/activities", json={"type": "StatusChange", "relatedType": "Lead", "relatedId": lead_["id"], "subject": "forged"}, headers=h)
    assert forged.status_code == 403


def test_quick_action_dialogs_can_post_plain_activities_and_the_server_owns_who_and_where(client, sa):
    h = rep(client, sa, branch="Salem")
    lead_ = lead(client, h)
    r = client.post(f"{API}/activities", json={"type": "Note", "relatedType": "Lead", "relatedId": lead_["id"], "subject": "Spoke", "by": "SOMEONE-ELSE", "branch": "Mumbai", "meetingDate": "2026-12-01"}, headers=h)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["by"] != "SOMEONE-ELSE" and a["branch"] == "Salem" and a["source"] == "manual" and a["meetingDate"] == "2026-12-01"
    bad = client.post(f"{API}/activities", json={"type": "Note", "relatedType": "Lead", "relatedId": "LD-9999"}, headers=h)
    assert bad.status_code == 404


def test_activities_are_branch_scoped_and_notifications_private(client, sa):
    h = rep(client, sa, "Salem", "Asha")
    other = rep(client, sa, "Mumbai", "Mira")
    lead_ = lead(client, h)
    client.put(f"{API}/leads/{lead_['id']}", json={"status": "Contacted"}, headers=h)
    assert client.get(f"{API}/activities", params={"all": "true"}, headers=other).json() == []
    # a notification belongs to its recipient
    boss = rep(client, sa, "Salem", "Bala")
    client.put(f"{API}/leads/{lead_['id']}", json={"assignedTo": client.get(f"{API}/auth/me", headers=boss).json()["id"]}, headers=h)
    mine = client.get(f"{API}/notifications", params={"all": "true"}, headers=boss).json()
    assert any("assigned to you" in n["message"] for n in mine)
    assert client.get(f"{API}/notifications", params={"all": "true"}, headers=h).json() == [] or all("assigned to you" not in n["message"] for n in client.get(f"{API}/notifications", params={"all": "true"}, headers=h).json())
    n = mine[0]
    assert client.put(f"{API}/notifications/{n['id']}", json={"read": True}, headers=boss).json()["read"] is True
    assert client.put(f"{API}/notifications/{n['id']}", json={"message": "tamper"}, headers=boss).status_code == 403
    assert client.get(f"{API}/notifications/{n['id']}", headers=h).status_code == 404
