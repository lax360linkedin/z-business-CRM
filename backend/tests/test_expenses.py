from datetime import date

from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def cast(client, sa, branch="Salem"):
    for first, role, username in (("Staff", "Sales Executive", "staff"), ("Boss", "Sales Manager", "boss"), ("Fin", "Accounts", "fin")):
        make_account(client, sa, first=first, last=branch, role=role, branch=branch, username=f"{username}.{branch.lower()}")
    return [headers_of(login(client, f"{u}.{branch.lower()}")) for u in ("staff", "boss", "fin")]


def category(client, h):
    return client.get(f"{API}/expenses/config", headers=h).json()["categories"][0]["id"]


def claim(client, h, **extra):
    body = {"kind": "Employee", "date": date.today().isoformat(), "categoryId": category(client, h), "description": "Taxi to client site", "amount": 1000, "taxRate": 18, **extra}
    return client.post(f"{API}/expenses", json=body, headers=h)


def test_create_computes_totals_and_validates(client, sa):
    staff, boss, fin = cast(client, sa)
    r = claim(client, staff, total=1, tax=1)
    assert r.status_code == 201, r.text
    e = r.json()
    assert e["amount"] == 1000 and e["tax"] == 180 and e["total"] == 1180 and e["status"] == "Draft" and e["number"].startswith(f"EXP-{date.today().year}-")
    assert e["employeeId"] == client.get(f"{API}/auth/me", headers=staff).json()["id"] and e["paidBy"] == "Employee"
    for bad in ({"amount": 0}, {"amount": -4}, {"taxRate": 7}, {"date": "2099-01-01"}, {"description": ""}, {"categoryId": "EXC-999"}, {"paymentMethod": "Gold"}, {"kind": "Barter"}):
        assert claim(client, staff, **bad).status_code == 422, bad
    assert claim(client, staff).status_code == 409  # the same claim twice needs confirmation
    assert claim(client, staff, confirmDuplicate=True).status_code == 201


def test_vendor_expense_needs_vendor_and_bill_and_rejects_duplicate_bills(client, sa):
    staff, boss, fin = cast(client, sa)
    vendor = client.post(f"{API}/vendors", json={"name": "Stationers Ltd"}, headers=fin)
    assert vendor.status_code == 201, vendor.text
    vid = vendor.json()["id"]
    assert claim(client, fin, kind="Vendor").status_code == 422
    assert claim(client, fin, kind="Vendor", vendorId=vid).status_code == 422  # bill number required
    ok = claim(client, fin, kind="Vendor", vendorId=vid, vendorBillNumber="B-100")
    assert ok.status_code == 201 and ok.json()["vendorName"] == "Stationers Ltd"
    dup = claim(client, fin, kind="Vendor", vendorId=vid, vendorBillNumber="b-100", amount=77)
    assert dup.status_code == 409 and "vendorBillNumber" in dup.json()["fields"]
    assert client.post(f"{API}/vendors", json={"name": "Stationers Ltd"}, headers=staff).status_code == 403  # vendors are managed by finance


def test_employee_claim_approval_and_reimbursement_flow(client, sa):
    staff, boss, fin = cast(client, sa)
    e = claim(client, staff).json()
    assert client.post(f"{API}/expenses/{e['id']}/approve", json={}, headers=boss).status_code == 403  # a draft employee claim is not approvable
    assert client.post(f"{API}/expenses/{e['id']}/submit", json={}, headers=staff).status_code == 200
    got = client.get(f"{API}/expenses/{e['id']}", headers=staff).json()
    assert got["status"] == "Submitted" and got["perms"]["withdraw"] is True and got["perms"]["approve"] is False  # you cannot approve your own claim
    assert client.post(f"{API}/expenses/{e['id']}/approve", json={}, headers=staff).status_code == 403
    assert client.post(f"{API}/expenses/{e['id']}/approve", json={"approvedAmount": 500}, headers=boss).status_code == 422  # a lower figure needs a reason
    ok = client.post(f"{API}/expenses/{e['id']}/approve", json={"approvedAmount": 1000, "comments": "Approved less: parking is not covered"}, headers=boss)
    assert ok.status_code == 200 and ok.json()["status"] == "Approved" and ok.json()["payable"] == 1000 and ok.json()["paymentStatus"] == "Reimbursement pending"
    assert client.post(f"{API}/expenses/{e['id']}/pay", json={"amount": 100, "method": "UPI", "date": date.today().isoformat(), "reference": "R1"}, headers=fin).status_code == 409  # employees are reimbursed
    assert client.post(f"{API}/expenses/{e['id']}/reimburse", json={"amount": 400, "method": "UPI", "date": date.today().isoformat(), "reference": "R1"}, headers=staff).status_code == 403
    part = client.post(f"{API}/expenses/{e['id']}/reimburse", json={"amount": 400, "method": "UPI", "date": date.today().isoformat(), "reference": "R1"}, headers=fin).json()
    assert part["status"] == "Approved" and part["paymentStatus"] == "Partly reimbursed" and part["remaining"] == 600
    assert client.post(f"{API}/expenses/{e['id']}/reimburse", json={"amount": 600, "method": "UPI", "date": date.today().isoformat(), "reference": "R1"}, headers=fin).status_code == 409  # reference already used
    assert client.post(f"{API}/expenses/{e['id']}/reimburse", json={"amount": 700, "method": "NEFT", "date": date.today().isoformat(), "reference": "R2"}, headers=fin).status_code == 422
    done = client.post(f"{API}/expenses/{e['id']}/reimburse", json={"amount": 600, "method": "NEFT", "date": date.today().isoformat(), "reference": "R2"}, headers=fin).json()
    assert done["status"] == "Reimbursed" and done["reimbursedAmount"] == 1000
    assert client.post(f"{API}/expenses/{e['id']}/cancel", json={"reason": "Changed my mind"}, headers=staff).status_code == 403  # money has moved


def test_approval_limits_rejection_and_revision(client, sa):
    staff, boss, fin = cast(client, sa)
    client.put(f"{API}/expenses/config", json={"receiptRequiredAbove": 0}, headers=fin)  # (receipts are covered by their own test)
    big = claim(client, staff, amount=60000, description="Laptop bag and more").json()
    client.post(f"{API}/expenses/{big['id']}/submit", json={}, headers=staff)
    assert client.post(f"{API}/expenses/{big['id']}/approve", json={}, headers=boss).status_code == 403  # above the manager's 50,000 limit (70,800 with tax)
    assert client.post(f"{API}/expenses/{big['id']}/approve", json={}, headers=fin).status_code == 200  # accounts has no limit
    small = claim(client, staff, amount=200, description="Printouts").json()
    assert client.post(f"{API}/expenses/{small['id']}/submit", json={}, headers=staff).status_code == 200
    assert client.post(f"{API}/expenses/{small['id']}/reject", json={"reason": "no"}, headers=boss).status_code == 422
    assert client.post(f"{API}/expenses/{small['id']}/reject", json={"reason": "Not a business expense"}, headers=boss).json()["status"] == "Rejected"
    assert client.put(f"{API}/expenses/{small['id']}", json={"amount": 1}, headers=staff).status_code == 403
    assert client.post(f"{API}/expenses/{small['id']}/revise", json={}, headers=staff).json()["status"] == "Draft"


def test_receipt_required_above_threshold_and_financial_record_is_frozen(client, sa):
    staff, boss, fin = cast(client, sa)
    e = claim(client, staff, amount=8000, description="Training course").json()
    r = client.post(f"{API}/expenses/{e['id']}/submit", json={}, headers=staff)
    assert r.status_code == 409 and "documents" in r.json()["fields"]
    cheap = claim(client, staff, amount=100, description="Coffee").json()
    client.post(f"{API}/expenses/{cheap['id']}/submit", json={}, headers=staff)
    client.post(f"{API}/expenses/{cheap['id']}/approve", json={}, headers=boss)
    assert client.put(f"{API}/expenses/{cheap['id']}", json={"amount": 5}, headers=fin).status_code == 409  # approved amounts are locked
    assert client.put(f"{API}/expenses/{cheap['id']}", json={"notes": "Receipt on file"}, headers=fin).status_code == 200


def test_visibility_scope_and_branch_isolation(client, sa):
    staff, boss, fin = cast(client, sa, "Salem")
    other_staff, other_boss, other_fin = cast(client, sa, "Mumbai")
    mine = claim(client, staff).json()
    assert client.get(f"{API}/expenses/{mine['id']}", headers=other_fin).status_code == 404  # another branch
    assert client.get(f"{API}/expenses", params={"all": "true"}, headers=other_staff).json() == []
    make_account(client, sa, first="Peer", last="Salem", role="Sales Executive", branch="Salem", username="peer.salem")
    peer = headers_of(login(client, "peer.salem"))
    assert client.get(f"{API}/expenses/{mine['id']}", headers=peer).status_code == 404  # staff see their own claims only
    assert [x["id"] for x in client.get(f"{API}/expenses", params={"all": "true"}, headers=fin).json()] == [mine["id"]]
    assert [x["id"] for x in client.get(f"{API}/expenses", params={"all": "true"}, headers=boss).json()] == [mine["id"]]  # a manager sees their department's claims


def test_delete_only_drafts_and_settings_are_finance_only(client, sa):
    staff, boss, fin = cast(client, sa)
    d = claim(client, staff).json()
    assert client.delete(f"{API}/expenses/{d['id']}", headers=staff).status_code == 200
    s = claim(client, staff, description="Another").json()
    client.post(f"{API}/expenses/{s['id']}/submit", json={}, headers=staff)
    assert client.delete(f"{API}/expenses/{s['id']}", headers=staff).status_code == 403
    assert client.put(f"{API}/expenses/config", json={"allowSelfApproval": True}, headers=staff).status_code == 403
    assert client.put(f"{API}/expenses/config", json={"prefix": "XP"}, headers=fin).json()["prefix"] == "XP"
    assert client.put(f"{API}/expenses/config", json={"prefix": "1"}, headers=fin).status_code == 422
