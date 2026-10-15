from datetime import date, timedelta

from sqlalchemy import select

from app.db.session import get_session_factory
from app.models import Notification, Task
from app.services import reminders, scheduler
from tests.conftest import headers_of, login, make_account
from tests.test_operations import contract, customer, people

API = "/api/v1"


def notes(db):
    return [n.message for n in db.execute(select(Notification).order_by(Notification.created_at)).scalars()]


def test_contract_expiry_reminders_and_the_renewal_task_are_raised_once(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.rm")
    mgr = headers_of(login(client, "sales.rm"))
    cust = customer(client, sa)
    soon = (date.today() + timedelta(days=20)).isoformat()
    c = contract(client, mgr, cust, startDate=(date.today() - timedelta(days=300)).isoformat(), endDate=soon)
    assert c.status_code == 201, c.text
    from app.models import Contract

    with get_session_factory()() as db:
        row = db.get(Contract, c.json()["id"])
        row.status = "Active"
        db.commit()
        first = reminders.contract_reminders(db)
        db.commit()
        assert first >= 1 and any("ends in 20 days" in n for n in notes(db))
        tasks = list(db.execute(select(Task).where(Task.automation_key == f"contractRenewal:{row.id}")).scalars())
        assert len(tasks) == 1 and tasks[0].title.startswith("Renewal follow-up")
        assert reminders.contract_reminders(db) == 0  # nothing is repeated
        db.commit()
        assert len(list(db.execute(select(Task).where(Task.automation_key == f"contractRenewal:{row.id}")).scalars())) == 1


def test_project_and_followup_reminders_and_the_timer_runs_them(client, sa):
    pm, dev = people(client, sa)
    cust = customer(client, sa)
    pr = client.post(f"{API}/projects", json={"name": "Late job", "customerId": cust["id"], "projectType": "Development", "startDate": "2026-01-01", "deadline": (date.today() - timedelta(days=2)).isoformat()}, headers=pm)
    assert pr.status_code == 201, pr.text
    client.put(f"{API}/projects/{pr.json()['id']}", json={"status": "Active"}, headers=pm)
    me = client.get(f"{API}/auth/me", headers=pm).json()["id"]
    client.post(f"{API}/leads", json={"name": "Due lead", "assignedTo": me, "nextFollowUp": date.today().isoformat()}, headers={**sa, "X-Branch-Scope": "Salem"})
    out = scheduler.run_once()
    assert isinstance(out["reminders"], dict) and out["reminders"]["projects"] >= 1 and out["reminders"]["followUps"] >= 1
    with get_session_factory()() as db:
        text = notes(db)
        assert any("“Late job” is overdue" in n for n in text) and any("Today’s follow-up: Due lead" in n for n in text)
    assert scheduler.run_once()["reminders"] == {"contracts": 0, "projects": 0, "followUps": 0}


def test_contract_settings_are_server_side_and_manager_only(client, sa):
    make_account(client, sa, first="Sales", last="E", role="Sales Executive", branch="Salem", username="sales.es")
    rep = headers_of(login(client, "sales.es"))
    got = client.get(f"{API}/contracts/settings", headers=rep).json()
    assert got["config"]["expiringSoonDays"] == 60 and "NDA" in got["types"]
    assert client.put(f"{API}/contracts/settings", json={"config": {"expiringSoonDays": 30}}, headers=rep).status_code == 403
    ok = client.put(f"{API}/contracts/settings", json={"types": ["NDA", "Lease"], "config": {"expiringSoonDays": 45, "reminderDays": [30, 7], "approvalRequired": False}}, headers=sa)
    assert ok.status_code == 200 and ok.json()["types"] == ["NDA", "Lease"] and ok.json()["config"]["reminderDays"] == [30, 7]
    assert client.put(f"{API}/contracts/settings", json={"config": {"expiringSoonDays": 1}}, headers=sa).status_code == 422
    assert client.put(f"{API}/contracts/settings", json={"types": []}, headers=sa).status_code == 422
    assert client.get(f"{API}/contracts/settings", headers=rep).json()["config"]["expiringSoonDays"] == 45


def test_contract_templates_are_shared_and_manager_managed(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.tm")
    make_account(client, sa, first="Sales", last="E", role="Sales Executive", branch="Salem", username="sales.te")
    mgr, rep = headers_of(login(client, "sales.tm")), headers_of(login(client, "sales.te"))
    made = client.post(f"{API}/contractTemplates", json={"name": "Service Agreement", "contractType": "Service Agreement", "body": "Hello {{CompanyName}}", "version": 1, "versions": [], "active": True}, headers=mgr)
    assert made.status_code == 201, made.text
    assert made.json()["body"].startswith("Hello") and made.json()["id"].startswith("CTPL-")
    assert client.post(f"{API}/contractTemplates", json={"name": "Mine"}, headers=rep).status_code == 403
    assert [t["name"] for t in client.get(f"{API}/contractTemplates", params={"all": "true"}, headers=rep).json()] == ["Service Agreement"]
    assert client.put(f"{API}/contractTemplates/{made.json()['id']}", json={"active": False}, headers=mgr).json()["active"] is False
    assert client.get(f"{API}/quotationTemplates", params={"all": "true"}, headers=mgr).json() == []  # a different kind
