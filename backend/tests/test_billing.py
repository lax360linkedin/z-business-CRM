from datetime import date, timedelta

from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"
ITEMS = [{"name": "Website build", "qty": 2, "unitPrice": 10000, "discount": 10, "taxRate": 18}, {"name": "Hosting", "qty": 1, "unitPrice": 5000, "discount": 0, "taxRate": 12}]


def accountant(client, sa, branch="Salem", name="Acc"):
    make_account(client, sa, first=name, last="Ants", level="Employee", role="Accounts", branch=branch, username=f"{name.lower()}.ants")
    return headers_of(login(client, f"{name.lower()}.ants"))


def customer(client, h, name="Billing Co", gstin=""):
    """Customers are created by the Super Admin working in the same branch as `h` (an Accounts user can only view CRM records)."""
    branch = client.get(f"{API}/auth/me", headers=h).json()["branch"]
    root = headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD), scope=branch)
    company = client.post(f"{API}/companies", json={"name": name}, headers=root).json()
    r = client.post(f"{API}/customers", json={"name": name, "companyId": company["id"], "billingAddress": "12 MG Road, Salem", "gstin": gstin, "email": "bill@co.in"}, headers=root)
    assert r.status_code == 201, r.text
    return r.json()


def invoice(client, h, cust, **extra):
    r = client.post(f"{API}/invoices", json={"customerId": cust["id"], "items": ITEMS, **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def send(client, h, inv):
    r = client.post(f"{API}/invoices/{inv['id']}/send", json={}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_totals_are_computed_by_the_server_with_gst_split(client, sa):
    h = accountant(client, sa)
    c = customer(client, h)
    inv = invoice(client, h, c, amount=1, tax=1, paidAmount=99999)  # client-supplied figures are ignored
    # line 1: 20000 - 10% = 18000 taxable, 18% = 3240 ; line 2: 5000 taxable, 12% = 600  -> taxable 23000, tax 3840, total 26840
    assert inv["subtotal"] == 25000 and inv["discountAmount"] == 2000 and inv["taxableAmount"] == 23000 and inv["tax"] == 3840 and inv["amount"] == 26840
    assert inv["cgst"] == 1920 and inv["sgst"] == 1920 and inv["igst"] == 0 and inv["taxType"] == "intra" and inv["paidAmount"] == 0
    assert inv["number"].startswith(f"INV-{date.today().year}-") and inv["status"] == "Draft" and inv["balance"] == 26840


def test_inter_state_customers_get_igst_and_extra_taxes_and_round_off(client, sa):
    h = accountant(client, sa)
    c = customer(client, h, "Delhi Co", gstin="07AABCD1234E1Z5")
    inv = invoice(client, h, c, extraTaxes=[{"name": "Cess", "rate": 1}])
    assert inv["taxType"] == "inter" and inv["igst"] == 3840 and inv["cgst"] == 0
    assert inv["otherTaxAmount"] == 230 and inv["amount"] == 27070 and inv["roundOff"] == 0.0  # 23000 + 3840 + 230
    odd = invoice(client, h, c, items=[{"name": "x", "qty": 1, "unitPrice": 100.4, "taxRate": 0}])
    assert odd["amount"] == 100 and odd["roundOff"] == -0.4


def test_validation(client, sa):
    h = accountant(client, sa)
    c = customer(client, h)
    for body in ({"customerId": c["id"], "items": []}, {"customerId": c["id"], "items": [{"name": "", "qty": 1, "unitPrice": 1}]}, {"customerId": c["id"], "items": [{"name": "a", "qty": 0, "unitPrice": 1}]},
                 {"customerId": c["id"], "items": [{"name": "a", "qty": 1, "unitPrice": 1, "discount": 150}]}, {"customerId": c["id"], "items": ITEMS, "dueDate": "2000-01-01"},
                 {"customerId": c["id"], "items": ITEMS, "gstin": "BAD"}, {"customerId": "CUS-9999", "items": ITEMS}):
        assert client.post(f"{API}/invoices", json=body, headers=h).status_code == 422, body


def test_status_is_derived_from_real_payments(client, sa):
    h = accountant(client, sa)
    inv = send(client, h, invoice(client, h, customer(client, h)))
    assert inv["status"] == "Sent"
    assert client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 10000, "method": "UPI"}, headers=h).status_code == 201
    got = client.get(f"{API}/invoices/{inv['id']}", headers=h).json()
    assert got["status"] == "Partially Paid" and got["paidAmount"] == 10000 and got["balance"] == 16840 and got["paymentStatus"] == "Partially Paid"
    assert client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 16841}, headers=h).status_code == 422  # more than the balance
    final = client.post(f"{API}/invoices/{inv['id']}/payments", json={"amount": 16840, "method": "NEFT", "reference": "UTR1"}, headers=h)
    assert final.status_code == 201 and final.json()["invoice"]["status"] == "Paid"
    assert client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 1}, headers=h).status_code == 409  # fully paid


def test_payments_cannot_be_recorded_on_drafts_and_amounts_are_checked(client, sa):
    h = accountant(client, sa)
    draft = invoice(client, h, customer(client, h))
    assert client.post(f"{API}/payments", json={"invoiceId": draft["id"], "amount": 100}, headers=h).status_code == 409
    sent = send(client, h, draft)
    for body in ({"amount": 0}, {"amount": -5}, {"amount": 100, "method": "Bitcoin"}, {"amount": 100, "date": (date.today() + timedelta(days=2)).isoformat()}):
        assert client.post(f"{API}/payments", json={"invoiceId": sent["id"], **body}, headers=h).status_code == 422, body


def test_cancel_reverse_and_refund_keep_the_invoice_in_step(client, sa):
    h = accountant(client, sa)
    inv = send(client, h, invoice(client, h, customer(client, h)))
    pay = client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 26840, "method": "Bank Transfer"}, headers=h).json()
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["status"] == "Paid"
    assert client.post(f"{API}/payments/{pay['id']}/cancel", json={"reason": "no"}, headers=h).status_code == 422  # reason too short
    refund = client.post(f"{API}/payments/{pay['id']}/refund", json={"amount": 6840, "reason": "Part returned goods"}, headers=h)
    assert refund.status_code == 200 and refund.json()["status"] == "Partially Refunded" and refund.json()["invoice"]["paidAmount"] == 20000
    assert refund.json()["invoice"]["status"] == "Partially Paid"
    assert client.post(f"{API}/payments/{pay['id']}/refund", json={"amount": 99999, "reason": "too much money"}, headers=h).status_code == 422
    assert client.post(f"{API}/payments/{pay['id']}/cancel", json={"reason": "Entered by mistake"}, headers=h).status_code == 409  # already refunded
    pay2 = client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 6840}, headers=h).json()
    assert client.post(f"{API}/payments/{pay2['id']}/cancel", json={"reason": "Cheque bounced"}, headers=h).json()["invoice"]["paidAmount"] == 20000
    assert client.put(f"{API}/payments/{pay['id']}", json={"amount": 1}, headers=h).status_code == 409  # completed payments are frozen


def test_cancel_and_void_rules(client, sa):
    h = accountant(client, sa)
    c = customer(client, h)
    draft = invoice(client, h, c)
    assert client.post(f"{API}/invoices/{draft['id']}/cancel", json={"reason": "Created twice"}, headers=h).json()["status"] == "Cancelled"
    assert client.put(f"{API}/invoices/{draft['id']}", json={"notes": "x"}, headers=h).status_code == 409  # dead invoices are closed
    paid = send(client, h, invoice(client, h, c))
    client.post(f"{API}/payments", json={"invoiceId": paid["id"], "amount": 100}, headers=h)
    assert client.post(f"{API}/invoices/{paid['id']}/cancel", json={"reason": "No longer needed"}, headers=h).status_code == 409
    assert client.post(f"{API}/invoices/{paid['id']}/void", json={"reason": "Wrong client"}, headers=h).status_code == 409  # has an active payment
    clean = send(client, h, invoice(client, h, c))
    assert client.post(f"{API}/invoices/{clean['id']}/void", json={}, headers=h).status_code == 422
    assert client.post(f"{API}/invoices/{clean['id']}/void", json={"reason": "Wrong client"}, headers=h).json()["status"] == "Void"


def test_issued_invoices_lock_the_commercial_fields(client, sa):
    h = accountant(client, sa)
    inv = invoice(client, h, customer(client, h))
    assert client.put(f"{API}/invoices/{inv['id']}", json={"items": [{"name": "Only", "qty": 1, "unitPrice": 1000, "taxRate": 0}]}, headers=h).json()["amount"] == 1000
    send(client, h, inv)
    assert client.put(f"{API}/invoices/{inv['id']}", json={"items": ITEMS}, headers=h).status_code == 409
    assert client.put(f"{API}/invoices/{inv['id']}", json={"notes": "Thanks", "dueDate": (date.today() + timedelta(days=40)).isoformat()}, headers=h).status_code == 200


def test_overdue_follows_the_due_date_and_the_sweep(client, sa):
    h = accountant(client, sa)
    past = (date.today() - timedelta(days=10)).isoformat()
    inv = invoice(client, h, customer(client, h), issueDate=(date.today() - timedelta(days=30)).isoformat(), dueDate=past)
    send(client, h, inv)
    got = client.get(f"{API}/invoices/{inv['id']}", headers=h).json()
    assert got["status"] == "Overdue" and got["overdueDays"] == 10
    assert client.get(f"{API}/invoices", params={"status": "Overdue", "all": "true"}, headers=h).json()[0]["id"] == inv["id"]
    client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 26840}, headers=h)
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["status"] == "Paid"


def test_role_capabilities_and_financial_visibility(client, sa):
    h = accountant(client, sa)
    inv = invoice(client, h, customer(client, h))
    make_account(client, sa, first="Rep", last="R", role="Sales Executive", branch="Salem", username="rep.r",
                 permissions={"Invoices": {"view": True, "create": True, "edit": True, "delete": False, "export": False}, "Payments": {"view": True}, "Dashboard": {"view": True}})
    rep = headers_of(login(client, "rep.r"))
    assert client.post(f"{API}/invoices", json={"customerId": inv["customerId"], "items": ITEMS}, headers=rep).status_code == 403  # createManual is an Accounts / Admin right
    assert client.get(f"{API}/invoices", params={"all": "true"}, headers=rep).json() == []  # a sales executive sees only invoices they own
    assert client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 1}, headers=rep).status_code == 403
    rep_id = client.get(f"{API}/auth/me", headers=rep).json()["id"]
    mine = invoice(client, h, customer(client, h, "Rep Co"), ownerId=rep_id)
    seen = client.get(f"{API}/invoices/{mine['id']}", headers=rep).json()
    assert seen["number"] == mine["number"] and seen["amount"] is None and seen["financialHidden"] is True  # no "viewFinancial" capability: the money is withheld
    assert client.get(f"{API}/invoices", params={"all": "true"}, headers=rep).json()[0]["amount"] is None
    make_account(client, sa, first="Boss", last="B", role="Sales Manager", branch="Salem", username="boss.b",
                 permissions={"Invoices": {"view": True}, "Dashboard": {"view": True}})
    mgr = headers_of(login(client, "boss.b"))
    assert client.get(f"{API}/invoices/{mine['id']}", headers=mgr).json()["amount"] == 26840  # a sales manager may see financial data


def test_invoices_and_payments_are_branch_scoped(client, sa):
    salem = accountant(client, sa, "Salem", "Sal")
    mumbai = accountant(client, sa, "Mumbai", "Mum")
    inv = send(client, salem, invoice(client, salem, customer(client, salem)))
    client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 500}, headers=salem)
    assert client.get(f"{API}/invoices/{inv['id']}", headers=mumbai).status_code == 404
    assert client.get(f"{API}/invoices", headers=mumbai).json()["total"] == 0 and client.get(f"{API}/payments", headers=mumbai).json()["total"] == 0
    assert client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 1}, headers=mumbai).status_code == 422
    assert client.get(f"{API}/invoices", headers=sa).json()["total"] == 1


def test_delete_only_drafts_without_payments(client, sa):
    h = accountant(client, sa)
    c = customer(client, h)
    draft = invoice(client, h, c)
    assert client.delete(f"{API}/invoices/{draft['id']}", headers=h).status_code == 200
    sent = send(client, h, invoice(client, h, c))
    assert client.delete(f"{API}/invoices/{sent['id']}", headers=h).status_code == 409
    assert client.delete(f"{API}/invoices/INV-0000", headers=h).status_code == 404


def test_each_invoice_and_payment_carries_the_actions_the_person_may_take_now(client, sa):
    h = accountant(client, sa)
    draft = invoice(client, h, customer(client, h))
    d = client.get(f"{API}/invoices/{draft['id']}", headers=h).json()["perms"]
    assert d["edit"] and d["send"] and d["deleteDraft"] and d["cancel"] and not d["recordPayment"] and not d["void"] and not d["markViewed"]
    sent = send(client, h, draft)
    s = client.get(f"{API}/invoices/{sent['id']}", headers=h).json()["perms"]
    assert s["recordPayment"] and s["markViewed"] and s["void"] and s["cancel"] and not s["deleteDraft"]
    pay = client.post(f"{API}/payments", json={"invoiceId": sent["id"], "amount": 26840, "method": "Bank Transfer"}, headers=h).json()
    assert pay["perms"]["refund"] and pay["perms"]["cancel"] and not pay["perms"]["complete"] and pay["perms"]["downloadReceipt"]
    paid = client.get(f"{API}/invoices/{sent['id']}", headers=h).json()["perms"]
    assert not paid["recordPayment"] and not paid["void"] and not paid["cancel"]  # fully paid: reverse the payment first
