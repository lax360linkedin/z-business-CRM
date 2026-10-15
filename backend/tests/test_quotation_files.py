import base64
import hashlib

from tests.test_sales_chain import API, deal_for, quotation, team

PDF1 = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"
PDF2 = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog2 >>\nendobj\n%%EOF\n"


def body(data, name="quote.pdf", **extra):
    return {"fileName": name, "mimeType": "application/pdf", "dataUrl": "data:application/pdf;base64," + base64.b64encode(data).decode(), "hash": hashlib.sha256(data).hexdigest(), **extra}


def test_attach_replace_remove_and_send_with_the_attachment(client, sa):
    rep, mgr = team(client, sa)
    q = quotation(client, rep, deal_for(client, rep))
    r = client.post(f"{API}/quotations/{q['id']}/attachments", json=body(PDF1), headers=rep)
    assert r.status_code == 200, r.text
    att = r.json()["attachment"]
    assert att["version"] == 1 and att["status"] == "Active" and att["kind"] == "PDF" and att["documentId"].startswith("DOC-") and "dataUrl" not in att
    again = client.post(f"{API}/quotations/{q['id']}/attachments", json=body(PDF2), headers=rep)
    assert again.status_code == 409  # replace must be explicit
    assert client.post(f"{API}/quotations/{q['id']}/attachments", json=body(PDF1, replace=True), headers=rep).status_code == 409  # the same file
    rep2 = client.post(f"{API}/quotations/{q['id']}/attachments", json=body(PDF2, name="quote-v2.pdf", replace=True), headers=rep)
    assert rep2.status_code == 200 and rep2.json()["attachment"]["version"] == 2
    history = client.get(f"{API}/quotations/{q['id']}", headers=rep).json()["attachments"]
    assert [a["status"] for a in history] == ["Active", "Replaced"]
    # the bytes live in Documents, as one managed document with two versions
    doc = client.get(f"{API}/documents/{att['documentId']}", headers=rep).json()
    assert doc["managedBy"] == "quotation-attachment" and doc["version"] == 2 and doc["primary"] == {"type": "Quotation", "id": q["id"]} and doc["category"] == "Quotations"
    assert client.get(f"{API}/documents/{att['documentId']}/file", headers=rep).content == PDF2
    assert client.delete(f"{API}/documents/{att['documentId']}", headers=rep).status_code in (403, 404, 409)  # a managed file is removed from its own module
    # refusals
    assert client.post(f"{API}/quotations/{q['id']}/attachments", json=body(b"not a pdf", name="fake.pdf", replace=True), headers=rep).status_code == 422
    assert client.post(f"{API}/quotations/{q['id']}/attachments", json=body(b"x" * 10, name="data.csv", replace=True), headers=rep).status_code == 422  # only PDF / Word
    assert client.post(f"{API}/quotations/{q['id']}/attachments", json={**body(PDF1, name="n.pdf", replace=True), "dataUrl": "garbage"}, headers=rep).status_code == 422
    # send: recipient is the quotation's contact, the attachment is marked as sent
    assert client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Hi"}, headers=mgr).status_code == 200
    sent = client.get(f"{API}/quotations/{q['id']}", headers=rep).json()
    assert sent["status"] == "Sent" and sent["attachments"][0]["sentTo"] == "chitra@chain.in" and sent["sends"][0]["attachmentName"] == "quote-v2.pdf"
    removed = client.delete(f"{API}/quotations/{q['id']}/attachments/{rep2.json()['attachment']['id']}", headers=rep)
    assert removed.status_code == 200 and removed.json()["quotation"]["attachmentId"] is None
    assert client.get(f"{API}/documents/{att['documentId']}", headers=rep).json()["status"] == "Archived"
    assert client.delete(f"{API}/quotations/{q['id']}/attachments/{rep2.json()['attachment']['id']}", headers=rep).status_code == 409


def test_locked_quotations_and_missing_content(client, sa):
    rep, mgr = team(client, sa)
    q = quotation(client, rep, deal_for(client, rep))
    assert client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Hi"}, headers=mgr).status_code == 422  # nothing to send
    client.put(f"{API}/quotations/{q['id']}", json={"status": "Pending Approval"}, headers=rep)
    client.post(f"{API}/quotations/{q['id']}/send", json={"subject": "Hi", "includeGeneratedPdf": True}, headers=mgr)
    client.put(f"{API}/quotations/{q['id']}", json={"status": "Accepted"}, headers=rep)
    assert client.post(f"{API}/quotations/{q['id']}/attachments", json=body(PDF1), headers=rep).status_code == 409  # accepted quotations are locked
    assert client.post(f"{API}/quotations/QT-9999/attachments", json=body(PDF1), headers=rep).status_code == 404
