from datetime import date, timedelta

from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"
ITEMS = [{"name": "CRM licence", "qty": 10, "unitPrice": 1000, "discount": 10, "taxRate": 18}]


def team(client, sa, branch="Salem"):
    make_account(client, sa, first="Rep", last=branch, role="Sales Executive", branch=branch, username=f"rep.{branch.lower()}")
    make_account(client, sa, first="Mgr", last=branch, role="Sales Manager", branch=branch, username=f"mgr.{branch.lower()}")
    return headers_of(login(client, f"rep.{branch.lower()}")), headers_of(login(client, f"mgr.{branch.lower()}"))


def deal_for(client, h, name="Chain Co"):
    company = client.post(f"{API}/companies", json={"name": name, "email": "c@chain.in", "phone": "9000000011", "billingAddress": "1 Salem Rd", "gstin": "29AABCD1234E1Z5"}, headers=h).json()
    contact = client.post(f"{API}/contacts", json={"name": "Chitra", "email": "chitra@chain.in", "companyId": company["id"]}, headers=h).json()
    return client.post(f"{API}/deals", json={"name": "Chain deal", "companyId": company["id"], "contactId": contact["id"], "service": "CRM", "value": 9000, "requirement": "A CRM"}, headers=h).json()


def quotation(client, h, deal, **extra):
    r = client.post(f"{API}/quotations", json={"dealId": deal["id"], "companyId": deal["companyId"], "contactId": deal["contactId"], "customerName": "Chain Co", "items": ITEMS, **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def test_quotation_totals_are_server_computed_and_the_deal_is_linked(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    q = quotation(client, rep, deal, subtotal=1, tax=1, amount=1)
    assert q["subtotal"] == 9000 and q["tax"] == 1620 and q["amount"] == 10620 and q["status"] == "Draft" and q["number"].startswith(f"QUO-{date.today().year}-")
    assert client.get(f"{API}/deals/{deal['id']}", headers=rep).json()["quotationIds"] == [q["id"]]
    assert client.post(f"{API}/quotations", json={"dealId": deal["id"], "companyId": deal["companyId"], "items": []}, headers=rep).status_code == 422
    assert client.post(f"{API}/quotations", json={"dealId": deal["id"], "companyId": deal["companyId"], "items": ITEMS, "status": "Sent"}, headers=rep).status_code == 403  # only a manager starts a quotation as sent
    edited = client.put(f"{API}/quotations/{q['id']}", json={"items": [{"name": "x", "qty": 1, "unitPrice": 100, "taxRate": 0}]}, headers=rep).json()
    assert edited["amount"] == 100


def test_quotation_approval_workflow(client, sa):
    rep, mgr = team(client, sa)
    q = quotation(client, rep, deal_for(client, rep))
    assert client.put(f"{API}/quotations/{q['id']}", json={"status": "Accepted"}, headers=rep).status_code == 422  # cannot skip the workflow
    assert client.put(f"{API}/quotations/{q['id']}", json={"status": "Pending Approval"}, headers=rep).status_code == 200
    assert client.put(f"{API}/quotations/{q['id']}", json={"status": "Sent"}, headers=rep).status_code == 403  # the rep cannot approve
    assert client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Your quotation", "includeGeneratedPdf": True}, headers=rep).status_code == 403
    sent = client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Your quotation", "includeGeneratedPdf": True}, headers=mgr)
    assert sent.status_code == 200 and sent.json()["quotation"]["status"] == "Sent" and sent.json()["send"]["to"] == "chitra@chain.in" and sent.json()["quotation"]["sentAt"]
    assert client.post(f"{API}/quotations/{q['id']}/send", json={"subject": ""}, headers=mgr).status_code == 422
    assert client.put(f"{API}/quotations/{q['id']}", json={"status": "Accepted"}, headers=rep).status_code == 200
    assert client.put(f"{API}/quotations/{q['id']}", json={"notes": "x", "items": ITEMS}, headers=rep).status_code == 409  # accepted quotations are locked


def accepted_quotation(client, rep, mgr, deal):
    q = quotation(client, rep, deal)
    client.put(f"{API}/quotations/{q['id']}", json={"status": "Pending Approval"}, headers=rep)
    client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Your quotation", "includeGeneratedPdf": True}, headers=mgr)
    client.put(f"{API}/quotations/{q['id']}", json={"status": "Accepted"}, headers=rep)
    return q


def test_sales_order_only_from_an_accepted_quotation_with_computed_totals(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    q = quotation(client, rep, deal)
    assert client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": q["id"]}, headers=rep).status_code == 409
    assert client.post(f"{API}/salesOrders", json={}, headers=rep).status_code == 422
    accepted_quotation_id = accepted_quotation(client, rep, mgr, deal)["id"]
    draft = client.get(f"{API}/quotations/{accepted_quotation_id}/sales-order-draft", headers=rep).json()
    assert draft["taxType"] == "intra" and draft["items"][0]["name"] == "CRM licence"
    so = client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": accepted_quotation_id}, headers=rep)
    assert so.status_code == 201, so.text
    so = so.json()
    assert so["status"] == "Draft" and so["amount"] == 10620 and so["cgst"] == 810 and so["sgst"] == 810 and so["number"].startswith("SO-")
    assert client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": accepted_quotation_id}, headers=rep).status_code == 409  # one order per quotation
    assert client.get(f"{API}/quotations/{accepted_quotation_id}", headers=rep).json()["salesOrderId"] == so["id"]
    assert client.get(f"{API}/deals/{deal['id']}", headers=rep).json()["salesOrderIds"] == [so["id"]]


def test_sales_order_confirmation_is_a_manager_right_and_locks_the_commercials(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    qid = accepted_quotation(client, rep, mgr, deal)["id"]
    so = client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": qid}, headers=rep).json()
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Confirmed"}, headers=rep).status_code == 403
    assert client.put(f"{API}/salesOrders/{so['id']}", json={"items": [{"name": "Edited", "qty": 1, "unitPrice": 500, "taxRate": 0}]}, headers=rep).json()["amount"] == 500
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Confirmed"}, headers=mgr).json()["status"] == "Confirmed"
    assert client.put(f"{API}/salesOrders/{so['id']}", json={"items": ITEMS}, headers=rep).status_code == 409
    assert client.put(f"{API}/salesOrders/{so['id']}", json={"notes": "Call before delivery"}, headers=rep).status_code == 200
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Fulfilled"}, headers=mgr).status_code == 409  # must be Processing first
    client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Processing"}, headers=mgr)
    ful = client.post(f"{API}/salesOrders/{so['id']}/fulfillment", json={"lines": [{"index": 0, "fulfilledQty": 1}]}, headers=rep).json()
    assert ful["status"] == "Fulfilled"  # a single line with quantity 1
    assert client.post(f"{API}/salesOrders/{so['id']}/fulfillment", json={"lines": [{"index": 0, "fulfilledQty": 99}]}, headers=rep).status_code == 409


def test_cancel_needs_a_reason_and_no_live_invoice_and_revision_keeps_history(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    qid = accepted_quotation(client, rep, mgr, deal)["id"]
    so = client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": qid, "confirm": True}, headers=mgr).json()
    assert so["status"] == "Confirmed"
    revised = client.post(f"{API}/salesOrders/{so['id']}/revise", json={"reason": "Price agreed again", "order": {"items": [{"name": "CRM licence", "qty": 5, "unitPrice": 1000, "taxRate": 18}]}}, headers=mgr).json()
    assert revised["revision"] == 2 and revised["amount"] == 5900 and revised["revisions"][0]["amount"] == 10620
    assert client.post(f"{API}/salesOrders/{so['id']}/revise", json={}, headers=mgr).status_code == 422
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Cancelled"}, headers=mgr).status_code == 422
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Cancelled", "reason": "Client withdrew"}, headers=mgr).json()["status"] == "Cancelled"
    assert client.get(f"{API}/quotations/{qid}", headers=rep).json()["salesOrderId"] is None  # the quotation can be turned into a new order


def test_full_chain_sales_order_to_invoice_to_payment(client, sa):
    rep, mgr = team(client, sa)
    make_account(client, sa, first="Fin", last="Acc", role="Accounts", branch="Salem", username="fin.acc")
    fin = headers_of(login(client, "fin.acc"))
    deal = deal_for(client, rep)
    qid = accepted_quotation(client, rep, mgr, deal)["id"]
    so = client.post(f"{API}/salesOrders/from-quotation", json={"quotationId": qid}, headers=rep).json()
    assert client.post(f"{API}/salesOrders/{so['id']}/invoice", json={}, headers=fin).status_code == 409  # not confirmed yet
    client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Confirmed"}, headers=mgr)
    inv = client.post(f"{API}/salesOrders/{so['id']}/invoice", json={}, headers=fin)
    assert inv.status_code == 201, inv.text
    inv = inv.json()
    assert inv["amount"] == 10620 and inv["salesOrderId"] == so["id"] and inv["quotationId"] == qid and inv["dealId"] == deal["id"] and inv["status"] == "Draft"
    assert client.post(f"{API}/salesOrders/{so['id']}/invoice", json={}, headers=fin).status_code == 409  # already invoiced
    assert client.post(f"{API}/salesOrders/{so['id']}/status", json={"status": "Cancelled", "reason": "x"}, headers=mgr).status_code == 409  # live invoice blocks cancellation
    client.post(f"{API}/invoices/{inv['id']}/send", json={}, headers=fin)
    pay = client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 10620, "method": "NEFT"}, headers=fin)
    assert pay.status_code == 201 and pay.json()["invoice"]["status"] == "Paid"
    assert client.get(f"{API}/deals/{deal['id']}", headers=rep).status_code == 200


def test_proposal_lifecycle_versions_and_quotation(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    draft = client.get(f"{API}/deals/{deal['id']}/proposal-draft", headers=rep)
    assert draft.status_code == 200 and draft.json()["content"]["items"][0]["unitPrice"] == 9000
    assert client.post(f"{API}/proposals", json={}, headers=rep).status_code == 422
    pr = client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"]}, headers=rep)
    assert pr.status_code == 201, pr.text
    pr = pr.json()
    assert pr["status"] == "Draft" and pr["version"] == 1 and pr["number"].startswith(f"PROP-{date.today().year}-") and pr["value"] == 9000
    assert client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"]}, headers=rep).status_code == 409  # one open proposal per deal
    assert client.get(f"{API}/deals/{deal['id']}/proposal-draft", headers=rep).status_code == 409
    upd = client.put(f"{API}/proposals/{pr['id']}", json={"content": {"items": [{"name": "CRM", "qty": 2, "unitPrice": 5000, "discount": 0, "taxRate": 18}]}}, headers=rep).json()
    assert upd["value"] == 10000
    assert client.post(f"{API}/proposals/{pr['id']}/send", json={"subject": "Hi", "document": {"fileName": "p.pdf", "dataUrl": "data:application/pdf;base64,AAAA"}}, headers=mgr).status_code == 409  # review first
    assert client.post(f"{API}/proposals/{pr['id']}/status", json={"status": "Internal Review"}, headers=rep).status_code == 200
    body = {"subject": "Your proposal", "document": {"fileName": "p.pdf", "dataUrl": "data:application/pdf;base64,AAAA"}}
    assert client.post(f"{API}/proposals/{pr['id']}/send", json=body, headers=rep).status_code == 403  # approval is a manager right
    sent = client.post(f"{API}/proposals/{pr['id']}/send", json=body, headers=mgr).json()
    assert sent["proposal"]["status"] == "Sent" and sent["send"]["to"] == "chitra@chain.in"
    assert client.put(f"{API}/proposals/{pr['id']}", json={"title": "Changed"}, headers=rep).status_code == 409  # a sent version is immutable
    assert client.post(f"{API}/proposals/{pr['id']}/status", json={"status": "Revision Requested"}, headers=rep).status_code == 422  # a reason is required
    assert client.post(f"{API}/proposals/{pr['id']}/status", json={"status": "Revision Requested", "reason": "Lower the price"}, headers=rep).status_code == 200
    rev = client.post(f"{API}/proposals/{pr['id']}/revise", json={"reason": "Price reduced"}, headers=rep).json()
    assert rev["version"] == 2 and rev["status"] == "Draft" and rev["versions"][0]["version"] == 1
    q = client.post(f"{API}/proposals/{pr['id']}/create-quotation", json={}, headers=rep)
    assert q.status_code == 201 and q.json()["quotation"]["proposalId"] == pr["id"] and q.json()["quotation"]["amount"] == 11800
    assert client.post(f"{API}/proposals/{pr['id']}/create-quotation", json={}, headers=rep).status_code == 409


def test_proposal_expiry_sweep_and_delete_rules(client, sa):
    rep, mgr = team(client, sa)
    deal = deal_for(client, rep)
    past = (date.today() - timedelta(days=2)).isoformat()
    pr = client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"], "proposal": {"validUntil": past}}, headers=rep)
    assert pr.status_code == 422  # expiry before the created date
    pr = client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"]}, headers=rep).json()
    assert client.delete(f"{API}/proposals/{pr['id']}", headers=mgr).status_code == 200
    pr = client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"]}, headers=rep).json()
    client.post(f"{API}/proposals/{pr['id']}/status", json={"status": "Internal Review"}, headers=rep)
    client.post(f"{API}/proposals/{pr['id']}/send", json={"subject": "s", "document": {"fileName": "p.pdf", "dataUrl": "data:application/pdf;base64,AAAA"}}, headers=mgr)
    from app.db.session import get_session_factory
    from app.models import Proposal

    with get_session_factory()() as db:
        db.get(Proposal, pr["id"]).valid_until = date.today() - timedelta(days=1)
        db.commit()
    assert client.post(f"{API}/proposals/expire-sweep", headers=rep).json()["expired"] == [pr["id"]]
    assert client.get(f"{API}/proposals/{pr['id']}", headers=rep).json()["status"] == "Expired"
    assert client.delete(f"{API}/proposals/{pr['id']}", headers=mgr).status_code == 409


def test_everything_stays_in_its_branch(client, sa):
    rep, mgr = team(client, sa, "Salem")
    other_rep, other_mgr = team(client, sa, "Mumbai")
    deal = deal_for(client, rep)
    q = quotation(client, rep, deal)
    assert client.get(f"{API}/quotations/{q['id']}", headers=other_rep).status_code == 404
    assert client.get(f"{API}/deals/{deal['id']}/proposal-draft", headers=other_rep).status_code == 404
    assert client.post(f"{API}/proposals/from-deal", json={"dealId": deal["id"]}, headers=other_mgr).status_code == 404
    assert q["branch"] == "Salem"


def test_templates_are_managed_by_managers_and_stamped_by_the_server(client, sa):
    from tests.conftest import headers_of, login, make_account

    make_account(client, sa, first="Mgr", last="T", role="Sales Manager", branch="Salem", username="mgr.t")
    make_account(client, sa, first="Rep", last="T", role="Sales Executive", branch="Salem", username="rep.t")
    mgr, rep = headers_of(login(client, "mgr.t")), headers_of(login(client, "rep.t"))
    body = {"name": "Letterhead A", "fileType": "pdf", "uploadedBy": "someone-else", "uploadedAt": "2001-01-01T00:00:00Z"}
    assert client.post("/api/v1/quotationTemplates", json=body, headers=rep).status_code == 403
    assert client.post("/api/v1/proposalTemplates", json=body, headers=rep).status_code == 403
    made = client.post("/api/v1/quotationTemplates", json=body, headers=mgr)
    assert made.status_code == 201, made.text
    t = made.json()
    me = client.get("/api/v1/auth/me", headers=mgr).json()["id"]
    assert t["uploadedBy"] == me and t["uploadedAt"].startswith("20") and not t["uploadedAt"].startswith("2001")
    assert client.put(f"/api/v1/quotationTemplates/{t['id']}", json={"isActive": True}, headers=rep).status_code == 403
    assert any(x["id"] == t["id"] for x in client.get("/api/v1/quotationTemplates", params={"all": "true"}, headers=rep).json())  # everyone can pick a template
