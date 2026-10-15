from datetime import date, timedelta

from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def cast(client, sa, branch="Salem"):
    for first, role, username in (("Mark", "Marketing", "mark"), ("Sam", "Sales Manager", "sam"), ("Eve", "Sales Executive", "eve"), ("Fin", "Accounts", "fin")):
        make_account(client, sa, first=first, last=branch, role=role, branch=branch, username=f"{username}.{branch.lower()}")
    return [headers_of(login(client, f"{u}.{branch.lower()}")) for u in ("mark", "sam", "eve", "fin")]


def source_id(client, h, name="Website Contact Form"):
    return next(s["id"] for s in client.get(f"{API}/lead-sources", headers=h).json() if s["name"] == name)


def campaign_body(client, h, **extra):
    start = (date.today() + timedelta(days=5)).isoformat()
    end = (date.today() + timedelta(days=35)).isoformat()
    return {"name": "Diwali Push", "type": "Email Marketing", "channel": "Email", "startDate": start, "endDate": end, "budget": 50000, "targetLeads": 100, "leadSourceId": source_id(client, h), **extra}


def test_lead_source_master_rules(client, sa):
    mark, sam, eve, fin = cast(client, sa)
    assert client.get(f"{API}/lead-sources", headers=eve).status_code == 403  # no Lead Sources module permission
    assert len(client.get(f"{API}/lead-sources", headers=mark).json()) >= 17
    r = client.post(f"{API}/lead-sources", json={"name": "Trade Show", "category": "Offline"}, headers=mark)
    assert r.status_code == 201, r.text
    assert client.post(f"{API}/lead-sources", json={"name": "trade show", "category": "Offline"}, headers=mark).status_code == 422
    assert client.post(f"{API}/lead-sources", json={"name": "X", "category": "Offline"}, headers=mark).status_code == 422
    assert client.post(f"{API}/lead-sources", json={"name": "Podcast", "category": "Mystery"}, headers=mark).status_code == 422
    assert client.post(f"{API}/lead-sources", json={"name": "Podcast", "category": "Website"}, headers=sam).status_code == 403  # view only
    assert client.delete(f"{API}/lead-sources/{source_id(client, mark)}", headers=mark).status_code == 403  # a standard source is shared by every branch: only the Super Admin manages it
    assert client.put(f"{API}/lead-sources/{r.json()['id']}", json={"active": False}, headers=mark).json()["active"] is False
    assert client.delete(f"{API}/lead-sources/{r.json()['id']}", headers=mark).json() == {"success": True}
    # the generic endpoint obeys the same rule
    assert client.post(f"{API}/leadSources", json={"name": "Sneaky"}, headers=sam).status_code == 403


def test_campaign_validation_and_permissions(client, sa):
    mark, sam, eve, fin = cast(client, sa)
    assert client.post(f"{API}/campaigns", json=campaign_body(client, mark), headers=sam).status_code == 403  # a sales manager may view, not create
    assert client.get(f"{API}/campaigns", headers=eve).status_code == 403
    for bad in ({"name": "ab"}, {"type": "Skywriting"}, {"channel": ""}, {"startDate": ""}, {"endDate": "2000-01-01"}, {"budget": -5}, {"leadSourceId": "LS-999"}, {"ownerId": "EMP-9999"}):
        assert client.post(f"{API}/campaigns", json=campaign_body(client, mark, **bad), headers=mark).status_code == 422, bad
    ok = client.post(f"{API}/campaigns", json=campaign_body(client, mark, requestId="req-1"), headers=mark)
    assert ok.status_code == 201, ok.text
    c = ok.json()
    assert c["status"] == "Draft" and c["number"].startswith(f"CMP-{date.today().year}-") and c["actions"]["start"] and c["actions"]["deleteDraft"] and c["budget"] == 50000
    assert client.post(f"{API}/campaigns", json=campaign_body(client, mark, requestId="req-1", name="Another"), headers=mark).status_code == 409  # the same submit twice
    assert client.post(f"{API}/campaigns", json=campaign_body(client, mark, name="diwali push"), headers=mark).status_code == 422  # duplicate name
    seen = client.get(f"{API}/campaigns/{c['id']}", headers=sam).json()
    assert seen["budget"] is None and seen["financialHidden"] is True and seen["actions"]["start"] is False  # no financial capability, cannot run
    assert client.get(f"{API}/campaigns/{c['id']}", headers=sa).json()["budget"] == 50000
    tasks = client.get(f"{API}/tasks", params={"all": "true"}, headers=mark).json()
    assert any("Plan campaign" in t["title"] for t in (tasks if isinstance(tasks, list) else tasks["data"]))


def test_lifecycle_spend_and_deletion(client, sa):
    mark, sam, eve, fin = cast(client, sa)
    c = client.post(f"{API}/campaigns", json=campaign_body(client, mark), headers=mark).json()
    cid = c["id"]
    assert client.post(f"{API}/campaigns/{cid}/pause", json={"reason": "no"}, headers=mark).status_code == 403  # not running
    assert client.post(f"{API}/campaigns/{cid}/spend", json={"amount": 10, "date": date.today().isoformat(), "note": "Ads"}, headers=mark).status_code == 403  # not started
    assert client.post(f"{API}/campaigns/{cid}/schedule", headers=sam).status_code == 403
    assert client.post(f"{API}/campaigns/{cid}/schedule", headers=mark).json()["status"] == "Scheduled"
    assert client.put(f"{API}/campaigns/{cid}", json={"channel": "Social"}, headers=mark).status_code == 409  # attribution fields are frozen once scheduled
    assert client.put(f"{API}/campaigns/{cid}", json={"targetLeads": 250}, headers=mark).json()["targetLeads"] == 250
    started = client.post(f"{API}/campaigns/{cid}/start", headers=mark).json()
    assert started["status"] == "Active" and started["actions"]["pause"] and not started["actions"]["start"]
    assert client.delete(f"{API}/campaigns/{cid}", headers=mark).status_code == 403  # only a draft is deletable
    assert client.post(f"{API}/campaigns/{cid}/pause", json={}, headers=mark).status_code == 422
    assert client.post(f"{API}/campaigns/{cid}/pause", json={"reason": "Creative being redone"}, headers=mark).json()["status"] == "Paused"
    assert client.post(f"{API}/campaigns/{cid}/resume", headers=mark).json()["status"] == "Active"
    assert client.post(f"{API}/campaigns/{cid}/spend", json={"amount": 5, "date": date.today().isoformat(), "note": "Ads"}, headers=mark).status_code == 422  # before the campaign start
    body = campaign_body(client, mark, name="Already running", startDate=(date.today() - timedelta(days=3)).isoformat(), endDate=(date.today() + timedelta(days=9)).isoformat())
    cid = client.post(f"{API}/campaigns", json=body, headers=mark).json()["id"]
    assert client.post(f"{API}/campaigns/{cid}/schedule", headers=mark).status_code == 409  # its start date has already arrived
    assert client.post(f"{API}/campaigns/{cid}/start", headers=mark).json()["status"] == "Active"
    for bad in ({"amount": 0, "date": date.today().isoformat(), "note": "Ads"}, {"amount": 5, "date": "2999-01-01", "note": "Ads"}, {"amount": 5, "date": date.today().isoformat(), "note": ""}):
        assert client.post(f"{API}/campaigns/{cid}/spend", json=bad, headers=mark).status_code == 422, bad
    spent = client.post(f"{API}/campaigns/{cid}/spend", json={"amount": 12000, "date": date.today().isoformat(), "note": "Banner ads"}, headers=mark).json()
    assert spent["spend"] == 12000 and spent["costs"][0]["note"] == "Banner ads"
    assert client.post(f"{API}/campaigns/{cid}/cancel", json={"reason": "no"}, headers=mark).status_code == 422
    done = client.post(f"{API}/campaigns/{cid}/complete", json={"reason": "Ran its course"}, headers=mark).json()
    assert done["status"] == "Completed" and done["actions"]["recordSpend"] is True and done["actions"]["edit"] is False
    assert client.put(f"{API}/campaigns/{cid}", json={"targetLeads": 1}, headers=mark).status_code == 403
    detail = client.get(f"{API}/campaigns/{cid}", headers=mark).json()
    assert [e["type"] for e in detail["timeline"]][-1] == "Created" and "Completed" in [e["type"] for e in detail["timeline"]]
    draft = client.post(f"{API}/campaigns", json=campaign_body(client, mark, name="Throwaway"), headers=mark).json()
    assert client.delete(f"{API}/campaigns/{draft['id']}", headers=mark).json() == {"success": True}


def test_attribution_flows_into_analytics_and_expenses_count_as_spend(client, sa):
    mark, sam, eve, fin = cast(client, sa)
    today = date.today()
    body = campaign_body(client, mark, name="Launch", startDate=(today - timedelta(days=2)).isoformat(), endDate=(today + timedelta(days=20)).isoformat())
    c = client.post(f"{API}/campaigns", json=body, headers=mark).json()
    assert client.post(f"{API}/campaigns/{c['id']}/start", headers=mark).status_code == 200
    sam_id = client.get(f"{API}/auth/me", headers=sam).json()["id"]
    lead = client.post(f"{API}/leads", json={"name": "Asha", "company": "Zen", "campaign": "launch", "source": "Website Contact Form", "assignedTo": sam_id}, headers=sam)
    assert lead.status_code == 201, lead.text
    assert lead.json()["campaignId"] == c["id"] and lead.json()["leadSourceId"] == source_id(client, mark) and lead.json()["campaign"] == "Launch"
    other = client.post(f"{API}/leads", json={"name": "Ravi", "company": "Orbit", "assignedTo": sam_id}, headers=sam).json()
    assert other.get("campaignId") in (None, "")
    attached = client.post(f"{API}/campaigns/{c['id']}/attach-lead", json={"leadId": other["id"]}, headers=mark)
    assert attached.status_code == 200, attached.text
    assert client.post(f"{API}/campaigns/{c['id']}/attach-lead", json={"leadId": other["id"]}, headers=mark).status_code == 409  # attribution is never rewritten
    assert client.post(f"{API}/campaigns/{c['id']}/attach-lead", json={"leadId": other["id"]}, headers=sam).status_code == 403
    client.post(f"{API}/campaigns/{c['id']}/spend", json={"amount": 1000, "date": today.isoformat(), "note": "Sponsored post"}, headers=mark)
    stats = client.get(f"{API}/marketing/analytics", params={"campaignId": c["id"]}, headers=mark).json()
    row = stats["campaigns"][0]
    assert row["leads"] == 2 and row["spend"] == 1000 and row["costPerLead"] == 500 and stats["totals"]["leads"] == 2
    assert stats["unattributedLeads"] == 0 and len(stats["trend"]) == 12 and [f["name"] for f in stats["funnel"]][:2] == ["Enquiries", "Leads"]
    by_source = next(s for s in stats["sources"] if s["name"] == "Website Contact Form")
    assert by_source["leads"] == 2
    manager_view = client.get(f"{API}/marketing/analytics", headers=sam).json()
    assert manager_view["financialHidden"] is True and manager_view["totals"]["spend"] is None and all("₹" not in f["name"] for f in manager_view["funnel"])
    assert client.get(f"{API}/marketing/analytics", headers=eve).status_code == 403
    # an approved expense linked to the campaign adds to its spend
    cat = client.get(f"{API}/expenses/config", headers=fin).json()["categories"][0]["id"]
    exp = client.post(f"{API}/expenses", json={"kind": "Employee", "date": today.isoformat(), "categoryId": cat, "description": "Boosted posts", "amount": 500, "taxRate": 0, "campaignId": c["id"]}, headers=fin)
    assert exp.status_code == 201, exp.text
    assert exp.json()["campaignId"] == c["id"] and exp.json()["campaignName"] == "Launch"
    client.put(f"{API}/expenses/config", json={"receiptRequiredAbove": 0, "allowSelfApproval": True}, headers=fin)
    client.post(f"{API}/expenses/{exp.json()['id']}/submit", json={}, headers=fin)
    approved = client.post(f"{API}/expenses/{exp.json()['id']}/approve", json={}, headers=fin)
    assert approved.status_code == 200, approved.text
    assert client.get(f"{API}/marketing/analytics", params={"campaignId": c["id"]}, headers=mark).json()["campaigns"][0]["spend"] == 1500
    detail = client.get(f"{API}/campaigns/{c['id']}", headers=mark).json()
    assert {x["id"] for x in detail["leadsList"]} == {lead.json()["id"], other["id"]} and any(e["type"] == "LeadGenerated" for e in detail["timeline"])
    assert client.put(f"{API}/campaigns/{c['id']}", json={"name": "Launch 2"}, headers=mark).status_code == 200
    assert client.get(f"{API}/leads/{lead.json()['id']}", headers=sam).json()["campaign"] == "Launch 2"
    assert client.delete(f"{API}/campaigns/{c['id']}", headers=mark).status_code == 403


def test_export_is_csv_and_permission_gated(client, sa):
    mark, sam, eve, fin = cast(client, sa)
    client.post(f"{API}/campaigns", json=campaign_body(client, mark), headers=mark)
    r = client.get(f"{API}/marketing/export", params={"type": "campaigns"}, headers=mark)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("Name,Leads") and lines[1].startswith("Diwali Push")
    assert client.get(f"{API}/marketing/export", headers=sam).status_code == 403
    assert "Website Contact Form" in client.get(f"{API}/marketing/export", params={"type": "sources"}, headers=mark).text
    cfg = client.get(f"{API}/marketing/config", headers=sam).json()
    assert cfg["perms"]["viewCampaigns"] and not cfg["perms"]["createCampaign"] and "Email Marketing" in cfg["types"]
    assert client.get(f"{API}/marketing/config", headers=eve).status_code == 403
