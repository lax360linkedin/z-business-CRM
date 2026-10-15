from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"
QUAL = {"businessNeed": "Growth", "budget": "₹2,50,000", "timeline": "1 month", "purchaseIntent": "High", "productInterest": "CRM Suite", "requirementDetailed": "Needs a CRM for 20 users"}


def sales(client, sa, branch="Salem", username=None):
    make_account(client, sa, first="Sam", last=branch, branch=branch, role="Sales Executive", username=username or f"sam.{branch.lower()}")
    return headers_of(login(client, username or f"sam.{branch.lower()}"))


def qualified_enquiry(client, h, **extra):
    e = client.post(f"{API}/enquiries", json={"name": "Ravi Kumar", "company": "Kumar Traders", "email": "ravi@kumar.in", "phone": "9876543210", "source": "Website Contact Form", "priority": "Critical", **extra}, headers=h)
    assert e.status_code == 201, e.text
    eid = e.json()["id"]
    for status in ("Contacted", "Qualified"):
        r = client.put(f"{API}/enquiries/{eid}", json={"status": status, **({"qualification": QUAL} if status == "Qualified" else {})}, headers=h)
        assert r.status_code == 200, r.text
    return eid


def test_lead_and_enquiry_status_follow_their_workflow_graphs(client, sa):
    h = sales(client, sa)
    lead = client.post(f"{API}/leads", json={"name": "Asha", "company": "Asha Ltd", "email": "a@a.in"}, headers=h).json()
    assert lead["status"] == "New"
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Qualified"}, headers=h).status_code == 422  # New cannot jump to Qualified
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Contacted"}, headers=h).status_code == 200
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Converted"}, headers=h).status_code == 422  # only the conversion action may do that
    assert client.post(f"{API}/leads", json={"name": "X", "status": "Converted"}, headers=h).status_code == 422
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Bogus"}, headers=h).status_code == 422
    assert client.put(f"{API}/leads/{lead['id']}", json={"priority": "Extreme"}, headers=h).status_code == 422


def test_status_change_is_logged_by_the_server_not_the_browser(client, sa):
    h = sales(client, sa)
    lead = client.post(f"{API}/leads", json={"name": "Asha"}, headers=h).json()
    client.put(f"{API}/leads/{lead['id']}", json={"status": "Contacted"}, headers=h)
    acts = client.get(f"{API}/activities", params={"relatedId": lead["id"]}, headers=h)
    assert acts.status_code in (200, 404)  # the activities router arrives with the work module; the rows are written regardless
    from app.db.session import get_session_factory
    from app.models import Activity
    from sqlalchemy import select
    with get_session_factory()() as db:
        rows = db.execute(select(Activity).where(Activity.related_id == lead["id"])).scalars().all()
    changes = [(r.type, r.from_status, r.to_status) for r in rows if r.type == "StatusChange"]
    assert changes == [("StatusChange", "New", "Contacted")]
    assert sum(1 for r in rows if r.type == "Created") == 1  # the server also writes the "created" timeline entry


def test_convert_enquiry_to_lead_creates_and_links_company_contact_lead_in_one_branch(client, sa):
    h = sales(client, sa, "Mumbai")
    eid = qualified_enquiry(client, h)
    r = client.post(f"{API}/enquiries/{eid}/convert", headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["enquiry"]["status"] == "Converted" and out["enquiry"]["convertedLeadId"] == out["lead"]["id"]
    lead = out["lead"]
    assert lead["sourceEnquiryId"] == eid and lead["status"] == "New" and lead["priority"] == "Urgent" and lead["budget"] == 250000 and lead["service"] == "CRM Suite"
    assert {out["company"]["branch"], out["contact"]["branch"], lead["branch"], out["enquiry"]["branch"]} == {"Mumbai"}
    assert lead["companyId"] == out["company"]["id"] and lead["contactId"] == out["contact"]["id"]
    # converting twice is refused (the enquiry is terminal) and nothing is duplicated
    assert client.post(f"{API}/enquiries/{eid}/convert", headers=h).status_code == 409
    assert client.get(f"{API}/companies", headers=h).json()["total"] == 1


def test_only_a_qualified_enquiry_converts(client, sa):
    h = sales(client, sa)
    eid = client.post(f"{API}/enquiries", json={"name": "Early"}, headers=h).json()["id"]
    r = client.post(f"{API}/enquiries/{eid}/convert", headers=h)
    assert r.status_code == 409 and "Qualified" in r.json()["message"]


def test_conversion_reuses_an_existing_company_and_contact(client, sa):
    h = sales(client, sa)
    first = client.post(f"{API}/enquiries/{qualified_enquiry(client, h)}/convert", headers=h).json()
    second = client.post(f"{API}/enquiries/{qualified_enquiry(client, h)}/convert", headers=h).json()
    assert second["company"]["id"] == first["company"]["id"] and second["contact"]["id"] == first["contact"]["id"]
    assert client.get(f"{API}/companies", headers=h).json()["total"] == 1 and client.get(f"{API}/contacts", headers=h).json()["total"] == 1
    assert second["lead"]["id"] != first["lead"]["id"]


def test_lead_to_deal_conversion_builds_customer_contact_and_deal(client, sa):
    h = sales(client, sa)
    lead = client.post(f"{API}/enquiries/{qualified_enquiry(client, h)}/convert", headers=h).json()["lead"]
    for status in ("Contacted", "Qualified"):
        assert client.put(f"{API}/leads/{lead['id']}", json={"status": status}, headers=h).status_code == 200
    r = client.post(f"{API}/leads/{lead['id']}/convert", headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["lead"]["status"] == "Converted" and out["lead"]["dealId"] == out["deal"]["id"]
    deal = out["deal"]
    assert deal["stage"] == "Deal Created" and deal["probability"] == 10 and deal["value"] == 250000 and deal["leadId"] == lead["id"]
    assert deal["customerId"] == out["customer"]["id"] and deal["contactId"] == out["contact"]["id"] and deal["companyId"] == out["company"]["id"]
    assert deal["sourceEnquiryId"] == lead["sourceEnquiryId"]  # the whole chain is traceable
    assert len(deal["stageHistory"]) == 1
    assert client.post(f"{API}/leads/{lead['id']}/convert", headers=h).status_code == 409


def test_deal_stage_rules_probability_history_and_lost_reason(client, sa):
    h = sales(client, sa)
    company = client.post(f"{API}/companies", json={"name": "Deal Co"}, headers=h).json()
    deal = client.post(f"{API}/deals", json={"name": "Big one", "companyId": company["id"], "value": 5000, "probability": 99}, headers=h).json()
    assert deal["stage"] == "Deal Created" and deal["probability"] == 10  # probability is derived, never typed
    moved = client.put(f"{API}/deals/{deal['id']}", json={"stage": "Negotiation", "probability": 1}, headers=h).json()
    assert moved["stage"] == "Negotiation" and moved["probability"] == 85 and [x["stage"] for x in moved["stageHistory"]] == ["Deal Created", "Negotiation"]
    assert client.put(f"{API}/deals/{deal['id']}", json={"stage": "Closed Lost"}, headers=h).status_code == 422  # a reason is required
    lost = client.put(f"{API}/deals/{deal['id']}", json={"stage": "Closed Lost", "lostReason": "Budget"}, headers=h).json()
    assert lost["probability"] == 0 and lost["closedAt"] and lost["lostReason"] == "Budget"
    assert client.put(f"{API}/deals/{deal['id']}", json={"stage": "Negotiation"}, headers=h).status_code == 422  # closed deals are terminal


def test_closed_won_links_a_customer_without_duplicating(client, sa):
    h = sales(client, sa)
    company = client.post(f"{API}/companies", json={"name": "Win Co", "email": "w@win.in", "phone": "9000000001"}, headers=h).json()
    d1 = client.post(f"{API}/deals", json={"name": "D1", "companyId": company["id"]}, headers=h).json()
    won = client.put(f"{API}/deals/{d1['id']}", json={"stage": "Closed Won"}, headers=h).json()
    assert won["probability"] == 100 and won["customerId"] and won["contactId"]
    d2 = client.post(f"{API}/deals", json={"name": "D2", "companyId": company["id"]}, headers=h).json()
    won2 = client.put(f"{API}/deals/{d2['id']}", json={"stage": "Closed Won"}, headers=h).json()
    assert won2["customerId"] == won["customerId"]
    assert client.get(f"{API}/customers", headers=h).json()["total"] == 1


def test_conversion_respects_permissions_and_branch(client, sa):
    h = sales(client, sa, "Salem")
    eid = qualified_enquiry(client, h)
    other = sales(client, sa, "Mumbai")
    assert client.post(f"{API}/enquiries/{eid}/convert", headers=other).status_code == 404  # another branch's enquiry does not exist for them
    make_account(client, sa, first="View", last="Only", branch="Salem", role="Employee", username="view.only",
                 permissions={"Enquiries": {"view": True, "create": False, "edit": True, "delete": False, "export": False}, "Dashboard": {"view": True}})
    viewer = headers_of(login(client, "view.only"))
    assert client.post(f"{API}/enquiries/{eid}/convert", headers=viewer).status_code == 403  # no right to create leads


def test_lead_score_and_stamps_are_set_by_the_server(client, sa):
    h = sales(client, sa)
    thin = client.post(f"{API}/leads", json={"name": "Thin"}, headers=h).json()
    assert thin["score"] == 4 and thin["status"] == "New" and thin["capturedAt"] and thin["createdDate"]  # only the default priority counts
    rich = client.post(f"{API}/leads", json={"name": "Rich", "email": "r@x.in", "phone": "9800000001", "company": "Rich Co", "source": "Website Contact Form", "service": "CRM", "requirement": "Need a CRM", "budget": 100000,
                                             "priority": "High", "score": 99, "createdDate": "2001-01-01", "assignedBy": "someone"}, headers=h).json()
    assert rich["score"] == 20 + 10 + 30 + 7 and rich["createdDate"] != "2001-01-01" and rich["assignedBy"] != "someone"  # typed values are ignored
    moved = client.put(f"{API}/leads/{rich['id']}", json={"status": "Contacted", "nextFollowUp": "2030-01-01"}, headers=h).json()
    assert moved["score"] == rich["score"] + 10 + 5
    lost = client.put(f"{API}/leads/{moved['id']}", json={"status": "Lost", "lostReason": "No budget"}, headers=h).json()
    assert lost["score"] <= 30


def test_enquiry_is_stamped_and_assigned_by_the_server(client, sa):
    h = sales(client, sa)
    me = client.get(f"{API}/auth/me", headers=h).json()["id"]
    e = client.post(f"{API}/enquiries", json={"name": "Asha Rao", "assignedUser": me, "createdBy": "x", "initials": "ZZ"}, headers=h).json()
    assert e["status"] == "Assigned" and e["assignedBy"] == me and e["initials"] == "AR" and e["createdDate"] and e["date"]
    dup = client.post(f"{API}/enquiries", json={"name": "Dup", "status": "Duplicate"}, headers=h).json()
    assert dup["status"] == "Duplicate" and dup["closedBy"] == me and dup["closeReason"]


def test_enquiry_naming_a_company_finds_or_creates_it_once(client, sa):
    h = sales(client, sa)
    a = client.post(f"{API}/enquiries", json={"name": "Asha", "company": "Orbit Care", "email": "a@orbit.in", "city": "Salem"}, headers=h).json()
    b = client.post(f"{API}/enquiries", json={"name": "Bala", "company": "ORBIT CARE"}, headers=h).json()
    assert a["companyId"] and a["companyId"] == b["companyId"]
    got = client.get(f"{API}/companies/{a['companyId']}", headers=h)
    assert got.status_code == 200 and got.json()["name"] == "Orbit Care" and got.json()["city"] == "Salem" and got.json()["status"] == "Prospect"


def test_enquiry_assignment_and_closing_are_stamped_by_the_server(client, sa):
    h = sales(client, sa)
    me = client.get(f"{API}/auth/me", headers=h).json()["id"]
    e = client.post(f"{API}/enquiries", json={"name": "Dev"}, headers=h).json()
    assert e["status"] == "New"
    assigned = client.put(f"{API}/enquiries/{e['id']}", json={"assignedUser": me, "assignedTeam": "Sales", "assignedBy": "x"}, headers=h).json()
    assert assigned["status"] == "Assigned" and assigned["assignedBy"] == me and assigned["assignedAt"]
    assert client.put(f"{API}/enquiries/{e['id']}", json={"status": "Closed"}, headers=h).status_code == 422  # a reason is needed to close
    closed = client.put(f"{API}/enquiries/{e['id']}", json={"status": "Closed", "closeReason": "No budget", "closedBy": "x"}, headers=h).json()
    assert closed["closedBy"] == me and closed["closedAt"] and closed["closeReason"] == "No budget"
    kinds = [a["type"] for a in client.get(f"{API}/activities", params={"relatedId": e["id"], "all": "true"}, headers=h).json()]
    assert "StatusChange" in kinds and "Created" in kinds


def test_closing_a_lead_needs_a_reason_and_is_stamped_by_the_server(client, sa):
    h = sales(client, sa)
    me = client.get(f"{API}/auth/me", headers=h).json()["id"]
    lead = client.post(f"{API}/leads", json={"name": "Meera", "company": "M Co"}, headers=h).json()
    client.put(f"{API}/leads/{lead['id']}", json={"status": "Contacted"}, headers=h)
    assert client.put(f"{API}/leads/{lead['id']}", json={"status": "Lost"}, headers=h).status_code == 422
    lost = client.put(f"{API}/leads/{lead['id']}", json={"status": "Lost", "lostReason": "Went with a competitor", "lostBy": "x", "lostDate": "2001-01-01"}, headers=h).json()
    assert lost["lostBy"] == me and lost["lostDate"] != "2001-01-01" and lost["lostReason"] == "Went with a competitor"


def test_product_price_history_is_kept_by_the_server(client, sa):
    root = headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD), scope="Salem")
    p = client.post(f"{API}/products", json={"name": "CRM Seat", "price": 1000, "priceHistory": [{"price": 1}]}, headers=root).json()
    assert [h["price"] for h in p["priceHistory"]] == [1000.0] and p["priceHistory"][0]["note"] == "Opening price"
    q = client.put(f"{API}/products/{p['id']}", json={"price": 1200, "priceHistory": []}, headers=root).json()
    assert [h["price"] for h in q["priceHistory"]] == [1000.0, 1200.0] and q["priceHistory"][1]["note"].startswith("Changed from")
    same = client.put(f"{API}/products/{p['id']}", json={"name": "CRM Seat Pro"}, headers=root).json()
    assert len(same["priceHistory"]) == 2
