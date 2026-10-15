from datetime import date

from tests.conftest import headers_of, login, make_account
from tests.test_billing import accountant, customer, invoice, send

API = "/api/v1"


def test_invoice_settings_drive_numbering_and_are_for_finance_only(client, sa):
    h = accountant(client, sa)
    cfg = client.get(f"{API}/invoices/config", headers=h).json()
    assert cfg["config"]["prefix"] == "INV" and "create" in cfg["caps"] and cfg["paymentMethods"][0] == "Cash"
    assert client.put(f"{API}/invoices/config", json={"prefix": "x"}, headers=h).status_code == 422
    assert client.put(f"{API}/invoices/config", json={"extraTaxes": [{"name": "Cess", "rate": 0}]}, headers=h).status_code == 422
    assert client.put(f"{API}/invoices/config", json={"org": {"gstin": "bad"}}, headers=h).status_code == 422
    ok = client.put(f"{API}/invoices/config", json={"prefix": "TAX", "paymentPrefix": "RCV", "defaultTermsDays": 30, "org": {"name": "LAX360", "gstin": "29aabcl1360k1z5"}}, headers=h)
    assert ok.status_code == 200 and ok.json()["org"]["gstin"] == "29AABCL1360K1Z5"
    inv = invoice(client, h, customer(client, h))
    assert inv["number"].startswith(f"TAX-{date.today().year}-")
    make_account(client, sa, first="Plain", last="Viewer", role="Support", branch="Salem", username="plain.viewer", permissions={"Invoices": {"view": True, "create": False, "edit": False, "delete": False, "export": False}, "Dashboard": {"view": True, "create": False, "edit": False, "delete": False, "export": False}})
    plain = headers_of(login(client, "plain.viewer"))
    assert client.put(f"{API}/invoices/config", json={"prefix": "ZZZ"}, headers=plain).status_code == 403
    assert client.get(f"{API}/invoices/export", headers=plain).status_code == 403


def test_exports_are_csv_of_the_callers_own_rows_and_payment_config(client, sa):
    h = accountant(client, sa)
    inv = send(client, h, invoice(client, h, customer(client, h)))
    client.post(f"{API}/payments", json={"invoiceId": inv["id"], "amount": 1000, "method": "UPI"}, headers=h)
    csv_text = client.get(f"{API}/invoices/export", headers=h)
    assert csv_text.status_code == 200 and csv_text.headers["content-type"].startswith("text/csv") and inv["number"] in csv_text.text and csv_text.text.lstrip("﻿").startswith("Invoice number,Status")
    pay = client.get(f"{API}/payments/export", headers=h)
    assert pay.status_code == 200 and "Payment number" in pay.text and "UPI" in pay.text
    pc = client.get(f"{API}/payments/config", headers=h).json()
    assert "Completed" in pc["statuses"] and "UPI" in pc["methods"] and pc["matrix"]["view"]
    assert client.get(f"{API}/expenses/export", headers=h).status_code in (200, 403)
    assert client.get(f"{API}/invoices/eligible-orders", headers=h).json() == []
    assert client.get(f"{API}/invoices/export").status_code == 401


def test_suggested_task_owner_follows_the_record_chain(client, sa):
    make_account(client, sa, first="Own", last="Er", role="Sales Executive", branch="Salem", username="own.er")
    h = headers_of(login(client, "own.er"))
    me = client.get(f"{API}/auth/me", headers=h).json()["id"]
    lead = client.post(f"{API}/leads", json={"name": "Chain lead", "assignedTo": me}, headers=h).json()
    r = client.get(f"{API}/tasks/suggest-owner", params={"relatedType": "Lead", "relatedId": lead["id"]}, headers=h).json()
    assert r["owner"] == me and r["ownerName"] == "Own Er" and r["links"]["leadId"] == lead["id"]
    assert client.get(f"{API}/tasks/suggest-owner", params={"relatedType": "Lead", "relatedId": "LD-9999"}, headers=h).status_code == 404
    assert client.get(f"{API}/tasks/suggest-owner", params={"relatedType": "Nope", "relatedId": "x"}, headers=h).status_code == 422
