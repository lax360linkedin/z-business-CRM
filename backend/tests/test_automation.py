"""n8n integration: configuration (secret never leaves the server), workflows, events from the CRM screens, run status / retries / errors, n8n's callback, access rules and AI Insights."""
import hashlib
import hmac
import json
from datetime import date, timedelta

import httpx
import pytest

from app.services import automation
from tests.conftest import PASSWORD, headers_of, login, make_account, perms

API = "/api/v1"
SECRET = "correct-horse-battery-staple-123"
BASE = "https://n8n.example.test"


class FakeN8n:
    """Stands in for the network: records every message and answers as told."""

    def __init__(self):
        self.calls: list[dict] = []
        self.status = 200
        self.error: Exception | None = None

    def post(self, url, headers, body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(body), "raw": body})
        if self.error:
            raise self.error
        return httpx.Response(self.status, json={"message": "Workflow was started"} if self.status < 300 else {"message": "nope"})

    def get(self, url, timeout):
        return httpx.Response(200, json={"status": "ok"})


@pytest.fixture
def n8n(monkeypatch):
    fake = FakeN8n()
    monkeypatch.setattr(automation, "_post", fake.post)
    monkeypatch.setattr(automation, "_get", fake.get)
    return fake


def connect(client, sa, **extra):
    r = client.put(f"{API}/automation/config", json={"enabled": True, "baseUrl": BASE, "secret": SECRET, **extra}, headers=sa)
    assert r.status_code == 200, r.text
    return r.json()


def add_workflow(client, sa, event="lead.created", **extra):
    r = client.post(f"{API}/automation/workflows", json={"name": extra.pop("name", f"Flow for {event}"), "event": event, "webhookUrl": "/webhook/crm-flow", **extra}, headers=sa)
    assert r.status_code == 201, r.text
    return r.json()


def in_salem(sa):
    return {**sa, "X-Branch-Scope": "Salem"}


def make_lead(client, sa, **extra):
    r = client.post(f"{API}/leads", json={"name": "Asha Verma", "company": "Verma Traders", **extra}, headers=in_salem(sa))
    assert r.status_code == 201, r.text
    return r.json()


def runs(client, headers, **params):
    return client.get(f"{API}/automation/runs", params=params, headers=headers).json()["data"]


# ---- configuration ----------------------------------------------------------------------------------------------------------------
def test_only_the_super_admin_configures_and_the_secret_never_comes_back(client, sa, salem_admin):
    cfg = connect(client, sa)
    assert cfg["enabled"] and cfg["configured"] and cfg["hasSecret"] and cfg["baseUrl"] == BASE
    assert SECRET not in json.dumps(client.get(f"{API}/automation/overview", headers=sa).json())
    assert client.put(f"{API}/automation/config", json={"enabled": False}, headers=salem_admin).status_code == 403
    assert client.post(f"{API}/automation/test-connection", headers=salem_admin).status_code == 403
    seen = client.get(f"{API}/automation/overview", headers=salem_admin).json()["config"]
    assert "baseUrl" not in seen and "publicApiUrl" not in seen  # an Admin sees that it is connected, not where
    assert client.get(f"{API}/automation/overview").status_code == 401


def test_configuration_is_validated(client, sa):
    assert client.put(f"{API}/automation/config", json={"enabled": True}, headers=sa).status_code == 422  # nothing to connect to yet
    bad = [{"baseUrl": "not a url"}, {"baseUrl": "ftp://n8n.example.test"}, {"baseUrl": "https://user:pw@n8n.example.test"}, {"secret": "short"}, {"timeoutSeconds": 1}, {"authHeader": "bad header!"}]
    for body in bad:
        assert client.put(f"{API}/automation/config", json={"baseUrl": BASE, "secret": SECRET, **body}, headers=sa).status_code == 422, body
    cfg = connect(client, sa, baseUrl=BASE + "/", authHeader="X-My-Key", timeoutSeconds=20)
    assert cfg["baseUrl"] == BASE and cfg["authHeader"] == "X-My-Key" and cfg["timeoutSeconds"] == 20
    assert client.put(f"{API}/automation/config", json={"secret": ""}, headers=sa).json()["hasSecret"] is True  # an empty secret field keeps the stored one


def test_production_refuses_private_addresses(monkeypatch):
    class Prod:
        is_production = True

    monkeypatch.setattr(automation, "get_settings", lambda: Prod())
    for url in ("http://n8n.example.com", "https://127.0.0.1", "https://localhost:5678", "https://169.254.169.254/latest"):
        with pytest.raises(Exception):
            automation.check_url(url)


def test_connection_test(client, sa, n8n):
    assert client.post(f"{API}/automation/test-connection", headers=sa).status_code == 422  # not configured
    connect(client, sa)
    r = client.post(f"{API}/automation/test-connection", headers=sa).json()
    assert r["ok"] is True and r["status"] == 200


# ---- workflows --------------------------------------------------------------------------------------------------------------------
def test_workflow_validation_and_access(client, sa, salem_admin):
    connect(client, sa)
    body = {"name": "Welcome email", "event": "lead.created", "webhookUrl": "/webhook/welcome"}
    assert client.post(f"{API}/automation/workflows", json=body, headers=salem_admin).status_code == 403
    for bad in ({"name": "x"}, {"event": "nonsense.event"}, {"webhookUrl": ""}, {"webhookUrl": "ftp://x"}, {"onlyWhen": "Won"}, {"description": "d" * 301}):
        assert client.post(f"{API}/automation/workflows", json={**body, **bad}, headers=sa).status_code == 422, bad
    first = client.post(f"{API}/automation/workflows", json=body, headers=sa).json()
    assert client.post(f"{API}/automation/workflows", json=body, headers=sa).status_code == 409  # same name
    assert first["eventLabel"] and first["webhookUrl"] == "/webhook/welcome"
    listed = client.get(f"{API}/automation/workflows", headers=salem_admin).json()
    assert listed[0]["name"] == "Welcome email" and "webhookUrl" not in listed[0]
    assert client.put(f"{API}/automation/workflows/{first['id']}", json={"enabled": False}, headers=sa).json()["enabled"] is False
    assert client.delete(f"{API}/automation/workflows/{first['id']}", headers=salem_admin).status_code == 403
    assert client.delete(f"{API}/automation/workflows/{first['id']}", headers=sa).status_code == 200
    assert client.get(f"{API}/automation/workflows", headers=sa).json() == []


# ---- events from the CRM ----------------------------------------------------------------------------------------------------------
def test_creating_a_lead_runs_the_workflow_with_a_signed_message(client, sa, n8n):
    connect(client, sa, publicApiUrl="https://crm-api.example.test")
    wf = add_workflow(client, sa)
    lead = make_lead(client, sa)
    call = n8n.calls[0]
    assert call["url"] == BASE + "/webhook/crm-flow"
    body = call["body"]
    assert body["event"] == "lead.created" and body["record"]["id"] == lead["id"] and body["record"]["data"]["name"] == "Asha Verma" and body["actor"]["name"]
    assert body["callbackUrl"] == "https://crm-api.example.test/api/v1/automation/callback" and body["runId"].startswith("RUN-")
    h = call["headers"]
    assert h["X-CRM-Key"] == SECRET and h["X-CRM-Event"] == "lead.created" and h["X-CRM-Run-Id"] == body["runId"]
    assert h["X-CRM-Signature"] == "sha256=" + hmac.new(SECRET.encode(), call["raw"], hashlib.sha256).hexdigest()
    row = runs(client, sa)[0]
    assert row["status"] == "Success" and row["workflowId"] == wf["id"] and row["recordId"] == lead["id"] and row["attempts"] == 1 and row["responseCode"] == 200 and row["trigger"] == "event"


def test_nothing_is_sent_when_off_disabled_or_unrelated(client, sa, n8n):
    connect(client, sa, enabled=False)
    add_workflow(client, sa, "lead.created")
    make_lead(client, sa)  # the workflow exists but automation is switched off
    assert n8n.calls == []
    client.put(f"{API}/automation/config", json={"enabled": True}, headers=sa)
    add_workflow(client, sa, "deal.created", name="Deal flow")
    add_workflow(client, sa, "lead.status_changed", name="Disabled", enabled=False)
    make_lead(client, sa, name="Second")
    assert len(n8n.calls) == 1 and n8n.calls[0]["body"]["record"]["data"]["name"] == "Second"  # only the matching, enabled workflow
    client.put(f"{API}/automation/config", json={"enabled": False}, headers=sa)
    make_lead(client, sa, name="Third")
    assert len(n8n.calls) == 1


def test_status_changes_and_the_only_when_condition(client, sa, n8n):
    connect(client, sa)
    add_workflow(client, sa, "lead.status_changed", name="Contacted only", onlyWhen="Contacted")
    lead = make_lead(client, sa)
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Contacted"}, headers=in_salem(sa)).status_code == 200
    assert len(n8n.calls) == 1 and n8n.calls[0]["body"]["changes"]["status"] == "Contacted"
    client.put(f"{API}/leads/{lead['id']}", json={"status": "Qualified"}, headers=in_salem(sa))
    assert len(n8n.calls) == 1  # Qualified does not match the condition
    client.put(f"{API}/leads/{lead['id']}", json={"notes": "just a note"}, headers=in_salem(sa))
    assert len(n8n.calls) == 1  # not a status change


def test_a_rejected_save_sends_nothing(client, sa, n8n):
    connect(client, sa)
    add_workflow(client, sa)
    assert client.post(f"{API}/leads", json={"company": "No name"}, headers=in_salem(sa)).status_code == 422
    assert n8n.calls == [] and runs(client, sa) == []


# ---- failures, retries -----------------------------------------------------------------------------------------------------------
def test_a_wrong_webhook_fails_clearly_and_is_not_retried_automatically(client, sa, n8n):
    connect(client, sa)
    add_workflow(client, sa)
    n8n.status = 404
    make_lead(client, sa)  # the save itself succeeds
    row = runs(client, sa)[0]
    assert row["status"] == "Failed" and row["responseCode"] == 404 and "Production URL" in row["message"] and row["nextRetryAt"] is None and SECRET not in json.dumps(row)


def test_network_trouble_is_retried_then_succeeds_or_gives_up(client, sa, n8n):
    from app.db.session import get_session_factory
    from app.models import AutomationRun

    connect(client, sa)
    add_workflow(client, sa)
    n8n.error = httpx.ConnectError("boom")
    make_lead(client, sa)
    row = runs(client, sa)[0]
    assert row["status"] == "Failed" and row["attempts"] == 1 and row["nextRetryAt"] and "Could not reach n8n" in row["message"] and "attempt 2 of 3" in row["message"]

    def make_due():
        with get_session_factory()() as db:
            db.query(AutomationRun).update({"next_retry_at": automation._now() - timedelta(seconds=1)})
            db.commit()

    make_due()
    with get_session_factory()() as db:
        assert automation.sweep(db)["retried"] == 1
    assert runs(client, sa)[0]["attempts"] == 2 and runs(client, sa)[0]["status"] == "Failed"
    n8n.error = None
    make_due()
    with get_session_factory()() as db:
        automation.sweep(db)
    final = runs(client, sa)[0]
    assert final["status"] == "Success" and final["attempts"] == 3 and final["nextRetryAt"] is None
    n8n.error = httpx.ReadTimeout("slow")
    make_lead(client, sa, name="Another")
    assert "did not answer" in runs(client, sa)[0]["message"]


def test_manual_retry_of_a_failed_run(client, sa, n8n, mumbai_admin):
    connect(client, sa)
    add_workflow(client, sa)
    n8n.status = 401
    make_lead(client, sa)
    run = runs(client, sa)[0]
    assert run["status"] == "Failed" and "credentials" in run["message"]
    n8n.status = 200
    assert client.post(f"{API}/automation/runs/{run['id']}/retry", headers=mumbai_admin).status_code == 404  # another branch's run is not visible
    r = client.post(f"{API}/automation/runs/{run['id']}/retry", headers=sa)
    assert r.status_code == 200 and r.json()["status"] == "Success" and r.json()["trigger"] == "retry"
    assert client.post(f"{API}/automation/runs/{run['id']}/retry", headers=sa).status_code == 409  # only failed runs


def test_a_switched_off_or_removed_workflow_fails_with_a_reason(client, sa, n8n):
    from app.db.session import get_session_factory
    from app.models import AutomationRun

    connect(client, sa)
    wf = add_workflow(client, sa)
    n8n.status = 500
    make_lead(client, sa)
    client.put(f"{API}/automation/workflows/{wf['id']}", json={"enabled": False}, headers=sa)
    n8n.status = 200
    run = runs(client, sa)[0]
    with get_session_factory()() as db:
        db.query(AutomationRun).update({"next_retry_at": automation._now() - timedelta(seconds=1), "attempts": 1})
        db.commit()
        automation.sweep(db)
    assert runs(client, sa)[0]["message"].startswith("This workflow is switched off") and run["id"] == runs(client, sa)[0]["id"]


# ---- n8n -> CRM callback -----------------------------------------------------------------------------------------------------------
def test_callback_finishes_a_run_that_waits_for_n8n(client, sa, n8n):
    connect(client, sa)
    add_workflow(client, sa, awaitCallback=True)
    make_lead(client, sa)
    run = runs(client, sa)[0]
    assert run["status"] == "Running" and "Waiting" in run["message"]
    ok = {"runId": run["id"], "status": "success", "message": "Email sent to asha@example.com"}
    assert client.post(f"{API}/automation/callback", json=ok).status_code == 401
    assert client.post(f"{API}/automation/callback", json=ok, headers={"X-CRM-Key": "wrong-secret-wrong-secret"}).status_code == 401
    assert client.post(f"{API}/automation/callback", json={**ok, "status": "maybe"}, headers={"X-CRM-Key": SECRET}).status_code == 422
    assert client.post(f"{API}/automation/callback", json={**ok, "runId": "RUN-nope"}, headers={"X-CRM-Key": SECRET}).status_code == 404
    assert client.post(f"{API}/automation/callback", json=ok, headers={"Authorization": f"Bearer {SECRET}"}).status_code == 200
    done = runs(client, sa)[0]
    assert done["status"] == "Success" and done["message"] == "Email sent to asha@example.com"
    client.post(f"{API}/automation/callback", json={"runId": run["id"], "status": "failed", "message": "SMTP rejected"}, headers={"X-CRM-Key": SECRET})
    assert runs(client, sa)[0]["status"] == "Failed" and runs(client, sa)[0]["message"] == "SMTP rejected"


def test_callback_wait_times_out(client, sa, n8n):
    from app.db.session import get_session_factory
    from app.models import AutomationRun

    connect(client, sa)
    add_workflow(client, sa, awaitCallback=True)
    make_lead(client, sa)
    with get_session_factory()() as db:
        db.query(AutomationRun).update({"started_at": automation._now() - timedelta(minutes=20)})
        db.commit()
        assert automation.sweep(db)["timedOut"] == 1
    assert runs(client, sa)[0]["status"] == "Failed" and "15 minutes" in runs(client, sa)[0]["message"]


# ---- manual test runs and run history ---------------------------------------------------------------------------------------------
def test_test_message_and_history_filters(client, sa, n8n, salem_admin, mumbai_admin):
    connect(client, sa)
    wf = add_workflow(client, sa)
    r = client.post(f"{API}/automation/workflows/{wf['id']}/test", headers=sa)
    assert r.status_code == 200 and r.json()["status"] == "Success" and r.json()["trigger"] == "manual"
    assert n8n.calls[-1]["body"]["event"] == "manual.test" and n8n.calls[-1]["body"]["test"] is True
    n8n.status = 500
    make_lead(client, sa)
    assert [x["status"] for x in runs(client, sa, status="Failed")] == ["Failed"] and len(runs(client, sa)) == 2
    assert runs(client, sa, workflowId="WF-none") == []
    ov = client.get(f"{API}/automation/overview", headers=sa).json()
    assert ov["last24h"]["Success"] == 1 and ov["last24h"]["Failed"] == 1 and ov["lastRun"]
    assert [r["recordType"] for r in runs(client, salem_admin)] == ["lead"]  # an Admin sees the runs of their own branch (the lead was made in Salem), not the Super Admin's branchless test
    assert runs(client, mumbai_admin) == []  # and not another branch's
    client.put(f"{API}/automation/config", json={"enabled": False}, headers=sa)
    assert client.post(f"{API}/automation/workflows/{wf['id']}/test", headers=sa).status_code == 409


def test_employees_cannot_see_automation(client, sa):
    make_account(client, sa, first="Plain", last="Staff", username="plain.staff", permissions=perms(Leads=True))
    h = headers_of(login(client, "plain.staff"))
    assert client.get(f"{API}/automation/overview", headers=h).status_code == 403
    assert client.get(f"{API}/automation/runs", headers=h).status_code == 403


# ---- AI Insights ------------------------------------------------------------------------------------------------------------------
def seed_business(client, sa):
    past = (date.today() - timedelta(days=9)).isoformat()
    for i in range(3):
        make_lead(client, sa, name=f"Late lead {i}", nextFollowUp=past)
    d = client.post(f"{API}/deals", json={"name": "Big deal", "companyName": "Verma Traders", "value": 500000, "expectedClosingDate": past, "stage": "Negotiation"}, headers=in_salem(sa))
    assert d.status_code == 201, d.text


def test_insights_are_computed_from_real_records(client, sa):
    seed_business(client, sa)
    data = client.get(f"{API}/insights", headers=sa).json()
    keys = {i["key"] for i in data["insights"]}
    assert {"overdue_followups", "slipping_deals"} <= keys
    late = next(i for i in data["insights"] if i["key"] == "overdue_followups")
    assert late["total"] == 3 and len(late["items"]) == 3 and late["items"][0]["to"].startswith("/leads/") and late["automation"] == "insight.overdue_followups" and late["category"] == "Sales"
    kpis = {k["key"]: k for k in data["kpis"]}
    assert kpis["pipeline"]["value"] == 500000 and kpis["open_leads"]["value"] == 3
    assert data["charts"]["pipelineByStage"][0]["stage"] == "Negotiation" and sum(b["count"] for b in data["charts"]["scoreBuckets"]) == 3
    assert [i["severity"] for i in data["insights"]] == sorted((i["severity"] for i in data["insights"]), key=lambda s: ["critical", "warning", "info", "positive"].index(s))
    assert "method" in data and data["counts"]["critical"] + data["counts"]["warning"] >= 2


def test_insights_respect_module_access_and_record_scope(client, sa):
    seed_business(client, sa)
    make_account(client, sa, first="Only", last="Leads", username="only.leads", role="Sales Executive", permissions=perms(Leads=True, AI_Insights={"view": True}))
    h = headers_of(login(client, "only.leads"))
    data = client.get(f"{API}/insights", headers=h).json()
    assert {i["key"] for i in data["insights"]}.isdisjoint({"slipping_deals", "stalled_deals", "overdue_invoices"})  # no Deals / Invoices access
    assert all(i["key"] != "overdue_followups" for i in data["insights"])  # an executive sees their own leads only - none are theirs
    assert client.get(f"{API}/insights").status_code == 401


def test_an_insight_can_be_sent_to_a_workflow(client, sa, n8n, salem_admin):
    seed_business(client, sa)
    connect(client, sa)
    wf = add_workflow(client, sa, "insight.overdue_followups", name="Chase follow-ups")
    other = add_workflow(client, sa, "lead.created", name="Welcome")
    listed = next(i for i in client.get(f"{API}/insights", headers=sa).json()["insights"] if i["key"] == "overdue_followups")
    assert listed["workflows"] == [{"id": wf["id"], "name": "Chase follow-ups"}]
    assert client.post(f"{API}/automation/insights/overdue_followups/run", json={"workflowId": other["id"]}, headers=sa).status_code == 422  # not an insight workflow
    assert client.post(f"{API}/automation/insights/nonsense/run", json={"workflowId": wf["id"]}, headers=sa).status_code == 422
    r = client.post(f"{API}/automation/insights/overdue_followups/run", json={"workflowId": wf["id"]}, headers=sa)
    assert r.status_code == 200 and r.json()["status"] == "Success" and r.json()["trigger"] == "insight"
    sent = n8n.calls[-1]["body"]
    assert sent["event"] == "insight.overdue_followups" and sent["insight"]["total"] == 3 and len(sent["insight"]["items"]) == 3
    assert client.post(f"{API}/automation/insights/stalled_deals/run", json={"workflowId": wf["id"]}, headers=sa).status_code == 422
