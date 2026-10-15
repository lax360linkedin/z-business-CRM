from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def test_ticket_details_due_date_and_timeline_are_set_by_the_server(client, sa):
    make_account(client, sa, first="Sue", last="Salem", role="Support", branch="Salem", username="sue.salem")
    make_account(client, sa, first="Sam", last="Salem", role="Sales Manager", branch="Salem", username="sam.salem")
    sue = headers_of(login(client, "sue.salem"))
    sam = headers_of(login(client, "sam.salem"))
    company = client.post(f"{API}/companies", json={"name": "Orbit Care"}, headers=sam).json()
    contact = client.post(f"{API}/contacts", json={"name": "Dr Sam", "email": "sam@orbit.com", "phone": "9840000000", "companyId": company["id"]}, headers=sam).json()
    body = {"subject": "Cannot sign in", "priority": "Urgent", "companyId": company["id"], "contactId": contact["id"],
            # none of this may be taken from the browser
            "slaStatus": "Breached", "createdBy": "someone-else", "timeline": [{"action": "forged"}]}
    r = client.post(f"{API}/tickets", json=body, headers=sue)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "New" and t["companyName"] == "Orbit Care" and t["contactName"] == "Dr Sam"
    assert t["contactEmail"] == "sam@orbit.com" and t["contactPhone"] == "9840000000"
    assert t["slaStatus"] == "On Track" and t["dueDate"]
    assert t["createdBy"] != "someone-else" and [e["action"] for e in t["timeline"]] == ["Ticket Created"]
    # a ticket cannot be raised already closed
    assert client.post(f"{API}/tickets", json={"subject": "x", "status": "Closed"}, headers=sue).status_code == 422

    # the timeline is written by the server as the ticket changes; the browser cannot write it, the SLA or the conversation
    r = client.put(f"{API}/tickets/{t['id']}", json={"status": "In Progress", "priority": "High", "timeline": [], "messages": [{"text": "forged"}], "slaStatus": "Breached"}, headers=sue)
    assert r.status_code == 200, r.text
    t2 = r.json()
    assert [e["action"] for e in t2["timeline"]] == ["Ticket Created", "Status changed", "Priority changed"]
    assert not t2.get("messages") and t2["slaStatus"] == "On Track"

    # replies and notes go through their own endpoint, signed with the person and kept apart
    reply = client.post(f"{API}/tickets/{t['id']}/messages", json={"kind": "reply", "text": "We are on it."}, headers=sue)
    assert reply.status_code == 201, reply.text
    assert reply.json()["delivery"] == "not-sent" and reply.json()["messages"][0]["text"] == "We are on it." and reply.json()["messages"][0]["from"] == "staff"
    note = client.post(f"{API}/tickets/{t['id']}/messages", json={"kind": "note", "text": "Check the SSO config."}, headers=sue).json()
    assert [m["text"] for m in note["internalNotes"]] == ["Check the SSO config."] and len(note["messages"]) == 1
    assert client.post(f"{API}/tickets/{t['id']}/messages", json={"kind": "reply", "text": "  "}, headers=sue).status_code == 422
    assert client.post(f"{API}/tickets/{t['id']}/messages", json={"kind": "shout", "text": "x"}, headers=sue).status_code == 422
    # a person without ticket access cannot add to the conversation
    assert client.post(f"{API}/tickets/{t['id']}/messages", json={"text": "hi"}, headers=sam).status_code == 403

    # a file can be attached to the ticket through the Documents module, and is listed against it
    from tests.test_documents import put
    up = put(client, sue, relatedType="Ticket", relatedId=t["id"], category="Other")
    assert up.status_code == 201, up.text
    assert up.json()["ticketId"] == t["id"]
    listed = client.get(f"{API}/documents", params={"relatedType": "Ticket", "relatedId": t["id"]}, headers=sue).json()
    assert [d["id"] for d in (listed["data"] if isinstance(listed, dict) else listed)] == [up.json()["id"]]
