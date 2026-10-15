from datetime import date, timedelta

from tests.conftest import headers_of, login, make_account

API = "/api/v1"
FULL = {"view": True, "create": True, "edit": True, "delete": True, "export": True}


def people(client, sa, branch="Salem"):
    make_account(client, sa, first="Pm", last=branch, role="Project Manager", branch=branch, username=f"pm.{branch.lower()}")
    make_account(client, sa, first="Dev", last=branch, role="Project Staff", branch=branch, username=f"dev.{branch.lower()}")
    return headers_of(login(client, f"pm.{branch.lower()}")), headers_of(login(client, f"dev.{branch.lower()}"))


def customer(client, sa, branch="Salem"):
    h = headers_of(login(client, "root@lax360.com", "Root@Pass123"), scope=branch)
    company = client.post(f"{API}/companies", json={"name": f"Ops Co {branch}"}, headers=h).json()
    return client.post(f"{API}/customers", json={"name": f"Ops Co {branch}", "companyId": company["id"]}, headers=h).json()


def project(client, h, cust, **extra):
    body = {"name": "Portal build", "customerId": cust["id"], "projectType": "Development", "priority": "High", "startDate": "2026-11-01", "deadline": "2026-12-31", "value": 100000, **extra}
    r = client.post(f"{API}/projects", json=body, headers=h)
    return r


def test_project_creation_rules_and_validation(client, sa):
    pm, dev = people(client, sa)
    cust = customer(client, sa)
    ok = project(client, pm, cust)
    assert ok.status_code == 201, ok.text
    assert ok.json()["manager"] == client.get(f"{API}/auth/me", headers=pm).json()["id"] and ok.json()["status"] == "Planned"
    assert project(client, dev, cust).status_code == 403  # project staff do not create projects
    for bad in ({"name": ""}, {"deadline": "2026-10-01"}, {"projectType": "Magic"}, {"priority": "Whenever"}, {"value": -5}, {"startDate": None}):
        assert project(client, pm, cust, **bad).status_code == 422, bad


def test_project_status_flow_reasons_and_completion(client, sa):
    pm, dev = people(client, sa)
    cust = customer(client, sa)
    pr = project(client, pm, cust).json()
    assert client.put(f"{API}/projects/{pr['id']}", json={"status": "Completed"}, headers=pm).status_code == 422  # Planned cannot jump to Completed
    assert client.put(f"{API}/projects/{pr['id']}", json={"status": "Active"}, headers=pm).status_code == 200
    assert client.put(f"{API}/projects/{pr['id']}", json={"status": "On Hold"}, headers=pm).status_code == 422  # reason needed
    assert client.put(f"{API}/projects/{pr['id']}", json={"status": "On Hold", "statusReason": "Waiting for assets"}, headers=pm).status_code == 200
    client.put(f"{API}/projects/{pr['id']}", json={"status": "Active"}, headers=pm)
    done = client.put(f"{API}/projects/{pr['id']}", json={"status": "Completed"}, headers=pm).json()
    assert done["progress"] == 100 and done["actualEndDate"] == date.today().isoformat()
    assert client.put(f"{API}/projects/{pr['id']}", json={"status": "Active"}, headers=dev).status_code == 404  # a non-member cannot even see the project
    assert client.delete(f"{API}/projects/{pr['id']}", headers=pm).status_code == 409  # only planned / cancelled projects are deleted


def test_progress_is_derived_from_the_linked_tasks_and_members_only_see_their_projects(client, sa):
    pm, dev = people(client, sa)
    cust = customer(client, sa)
    pr = project(client, pm, cust).json()
    for title in ("A", "B", "C", "D"):
        t = client.post(f"{API}/tasks", json={"title": title, "relatedType": "Project", "relatedId": pr["id"], "dueDate": "2026-11-30"}, headers=pm).json()
        if title in ("A", "B"):
            client.post(f"{API}/tasks/{t['id']}/complete", json={}, headers=pm)
    assert client.get(f"{API}/projects/{pr['id']}", headers=pm).json()["progress"] == 50
    assert client.get(f"{API}/projects", headers=dev).json()["total"] == 0  # not a member
    client.put(f"{API}/projects/{pr['id']}", json={"team": [client.get(f"{API}/auth/me", headers=dev).json()["id"]]}, headers=pm)
    assert client.get(f"{API}/projects", headers=dev).json()["total"] == 1
    seen = client.get(f"{API}/projects/{pr['id']}", headers=dev).json()
    assert seen["value"] is None and seen["financialHidden"] is True  # staff do not see project money


def contract(client, h, cust, **extra):
    body = {"title": "Support agreement", "customerId": cust["id"], "contractType": "Service Agreement", "startDate": "2026-11-01", "endDate": "2027-10-31", "value": 120000, **extra}
    return client.post(f"{API}/contracts", json=body, headers=h)


def move(client, h, c, to, expect=200, **extra):
    r = client.post(f"{API}/contracts/{c['id']}/status", json={"to": to, **extra}, headers=h)
    assert r.status_code == expect, (to, r.status_code, r.text)
    return r.json()


def activate(client, h, c):
    """The full path a contract takes to become Active, the way the screens take it."""
    today = date.today().isoformat()
    for to, extra in (("Internal Review", {}), ("Pending Approval", {}), ("Approved", {}), ("Sent", {"method": "Email"}), ("Signed", {"date": today}), ("Active", {})):
        move(client, h, c, to, **extra)


def test_contract_lifecycle_permissions_and_reasons(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.m")
    make_account(client, sa, first="Sales", last="E", role="Sales Executive", branch="Salem", username="sales.e")
    mgr, rep = headers_of(login(client, "sales.m")), headers_of(login(client, "sales.e"))
    cust = customer(client, sa)
    c = contract(client, rep, cust)
    assert c.status_code == 201, c.text
    c = c.json()
    assert c["status"] == "Draft" and c["number"].startswith(f"CNT-{date.today().year}-")
    assert contract(client, rep, cust, status="Active").status_code == 422  # a contract starts as Draft
    assert contract(client, rep, cust, endDate="2026-01-01").status_code == 422
    assert client.put(f"{API}/contracts/{c['id']}", json={"status": "Active"}, headers=rep).status_code == 422
    assert client.put(f"{API}/contracts/{c['id']}", json={"status": "Expired"}, headers=mgr).status_code == 422  # automatic statuses are never set by hand
    assert client.put(f"{API}/contracts/{c['id']}", json={"status": "Approved"}, headers=mgr).status_code == 422  # this workspace requires approval: no skipping the review
    move(client, rep, c, "Internal Review")
    move(client, rep, c, "Pending Approval")
    move(client, rep, c, "Approved", expect=403)  # approval is a manager right
    move(client, mgr, c, "Draft", expect=422)  # sending a contract back needs a reason
    back = move(client, mgr, c, "Internal Review", reason="Scope is unclear")
    assert back["approval"]["rejectionReason"] == "Scope is unclear" and back["approval"]["history"][0]["by"]
    move(client, rep, c, "Pending Approval")
    ok = move(client, mgr, c, "Approved", comments="Looks good")
    assert ok["approval"]["approvedBy"] and ok["approval"]["comments"] == "Looks good" and ok["approval"]["rejectionReason"] is None
    assert client.put(f"{API}/contracts/{c['id']}", json={"value": 1}, headers=mgr).status_code == 409  # terms are locked once approved
    assert move(client, rep, c, "Sent", method="WhatsApp")["sentVia"] == "WhatsApp"
    move(client, rep, c, "Signed", expect=422)  # the signing date is required
    signed = move(client, rep, c, "Signed", date="2026-10-01")
    assert signed["signedAt"].startswith("2026-10-01")
    move(client, rep, c, "Active")
    move(client, mgr, c, "Terminated", expect=422, date="2026-12-01")  # reason required
    move(client, mgr, c, "Terminated", expect=422, reason="Customer left")  # the effective date is required
    done = move(client, mgr, c, "Terminated", reason="Customer left", date="2026-12-01")
    assert done["terminationReason"] == "Customer left" and done["terminatedAt"] == "2026-12-01"
    assert client.put(f"{API}/contracts/{c['id']}", json={"notes": "x"}, headers=mgr).status_code == 409  # terminated contracts are closed
    # the audit trail is written by the server - who, when, from / to - and the browser cannot write it
    trail = client.get(f"{API}/contracts/{c['id']}", headers=mgr).json()["audit"]
    assert [e["to"] for e in trail if e.get("field") == "Status"] == ["Internal Review", "Pending Approval", "Internal Review", "Pending Approval", "Approved", "Sent", "Signed", "Active", "Terminated"]
    assert all(e["by"] and e["at"] for e in trail)


def test_contract_field_changes_are_audited_by_the_server(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.m")
    mgr = headers_of(login(client, "sales.m"))
    cust = customer(client, sa)
    c = contract(client, mgr, cust).json()
    forged = client.put(f"{API}/contracts/{c['id']}", json={"value": 150000, "title": "Support agreement v2", "audit": [{"action": "forged"}], "approval": {"approvedBy": "x"}, "auditEntry": {"action": "Renewal decision", "from": "Pending", "to": "Not renewing"}}, headers=mgr)
    assert forged.status_code == 200, forged.text
    got = forged.json()
    assert not got.get("approval") and all(e["action"] != "forged" for e in got["audit"])
    by_field = {e["field"]: e for e in got["audit"] if e.get("field")}
    assert by_field["Contract value"]["from"] == "₹1,20,000" and by_field["Contract value"]["to"] == "₹1,50,000"
    assert by_field["Title"]["to"] == "Support agreement v2"
    assert any(e["action"] == "Renewal decision" and e["by"] for e in got["audit"])
    # a second contract for the same deal is refused unless it is made on purpose
    deal = client.post(f"{API}/deals", json={"name": "D"}, headers=headers_of(login(client, "root@lax360.com", "Root@Pass123"), scope="Salem")).json()
    first = contract(client, mgr, cust, dealId=deal["id"])
    assert first.status_code == 201, first.text
    assert contract(client, mgr, cust, dealId=deal["id"]).status_code == 409
    assert contract(client, mgr, cust, dealId=deal["id"], allowDuplicate=True).status_code == 201


def test_renewal_creates_a_linked_draft_and_marks_the_old_one_renewed(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.m")
    mgr = headers_of(login(client, "sales.m"))
    cust = customer(client, sa)
    c = contract(client, mgr, cust, startDate="2025-01-01", endDate=(date.today() + timedelta(days=20)).isoformat()).json()
    activate(client, mgr, c)
    got = client.get(f"{API}/contracts/{c['id']}", headers=mgr).json()
    assert got["effectiveStatus"] == "Expiring Soon"
    r = client.post(f"{API}/contracts/{c['id']}/renew", json={"months": 12}, headers=mgr)
    assert r.status_code == 201, r.text
    new, old = r.json()["contract"], r.json()["renewed"]
    assert new["status"] == "Draft" and new["renewedFromId"] == c["id"] and old["status"] == "Renewed" and old["renewedToId"] == new["id"]
    assert client.post(f"{API}/contracts/{c['id']}/renew", json={}, headers=mgr).status_code == 409  # already renewed
    assert client.put(f"{API}/contracts/{c['id']}", json={"renewedToId": "x"}, headers=mgr).status_code == 409


def test_contract_expiry_sweep_follows_the_end_date(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.m")
    mgr = headers_of(login(client, "sales.m"))
    cust = customer(client, sa)
    c = contract(client, mgr, cust, startDate="2025-01-01", endDate="2025-12-31").json()
    activate(client, mgr, c)
    assert client.post(f"{API}/contracts/engine/run", headers=mgr).status_code == 403
    root = headers_of(login(client, "root@lax360.com", "Root@Pass123"))
    assert client.post(f"{API}/contracts/engine/run", headers=root).json()["changed"] == 1
    assert client.get(f"{API}/contracts/{c['id']}", headers=mgr).json()["status"] == "Expired"


def test_project_changes_and_team_moves_reach_the_timeline_and_duplicates_are_refused(client, sa):
    make_account(client, sa, first="Pat", last="M", role="Project Manager", branch="Salem", username="pat.m")
    make_account(client, sa, first="Dev", last="One", role="Developer", branch="Salem", username="dev.one")
    pm = headers_of(login(client, "pat.m"))
    dev = headers_of(login(client, "dev.one"))
    dev_id = client.get(f"{API}/auth/me", headers=dev).json()["id"]
    cust = customer(client, sa)
    body = {"name": "Rollout", "customerId": cust["id"], "projectType": "Implementation", "priority": "Medium", "startDate": "2026-11-01", "deadline": "2026-12-31", "dealId": None}
    deal = client.post(f"{API}/deals", json={"name": "Rollout deal"}, headers=headers_of(login(client, "root@lax360.com", "Root@Pass123"), scope="Salem")).json()
    pr = client.post(f"{API}/projects", json={**body, "dealId": deal["id"]}, headers=pm)
    assert pr.status_code == 201, pr.text
    assert client.post(f"{API}/projects", json={**body, "dealId": deal["id"]}, headers=pm).status_code == 409
    pr = pr.json()
    assert client.put(f"{API}/projects/{pr['id']}", json={"priority": "High", "team": [dev_id]}, headers=pm).status_code == 200
    subjects = [a["subject"] for a in client.get(f"{API}/activities", params={"relatedId": pr["id"], "all": "true"}, headers=pm).json()]
    assert any(s.startswith("Project updated — priority") for s in subjects) and any(s.startswith("Team member added") for s in subjects)
    assert any(n["relatedId"] == pr["id"] for n in client.get(f"{API}/notifications", params={"all": "true"}, headers=dev).json())


def test_notes_and_meetings_can_be_logged_on_a_contract_and_a_project(client, sa):
    make_account(client, sa, first="Sales", last="M", role="Sales Manager", branch="Salem", username="sales.m")
    mgr = headers_of(login(client, "sales.m"))
    c = contract(client, mgr, customer(client, sa)).json()
    note = client.post(f"{API}/activities/log", json={"type": "Note", "relatedType": "Contract", "relatedId": c["id"], "subject": "Client asked for a clause change", "description": "Call back Monday"}, headers=mgr)
    assert note.status_code == 201, note.text
    meeting = client.post(f"{API}/activities/log", json={"type": "Meeting", "relatedType": "Contract", "relatedId": c["id"], "subject": "Signature meeting", "date": (date.today() + timedelta(days=10)).isoformat(), "time": "11:00", "meetingType": "Online"}, headers=mgr)
    assert meeting.status_code == 201, meeting.text
    listed = client.get(f"{API}/activities", params={"relatedId": c["id"], "all": "true"}, headers=mgr).json()
    assert {"Note", "Meeting"} <= {a["type"] for a in listed}
    assert client.post(f"{API}/activities/log", json={"type": "Note", "relatedType": "Contract", "relatedId": "CON-9999", "subject": "x", "description": "y"}, headers=mgr).status_code == 404
