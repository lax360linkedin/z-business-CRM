import io
import json
import zipfile

from app.core.permissions import default_permissions_for
from tests.conftest import headers_of, login, make_account

API = "/api/v1"

PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24 + b"IEND\xaeB`\x82"


def pdf(tag="a"):
    return PDF.replace(b"Catalog", f"Catalog{tag}".encode())


def xlsx(extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<workbook/>")
        for name, body in (extra or {}).items():
            z.writestr(name, body)
    return buf.getvalue()


def put(client, h, data=None, name="plan.pdf", mime="application/pdf", **meta):
    files = {"file": (name, data if data is not None else pdf(name), mime)}
    return client.post(f"{API}/documents", files=files, data={"meta": json.dumps(meta)}, headers=h)


def grant(role, **documents):
    """The job profile's default permissions with the Documents module set explicitly (the default profiles hold no Documents rights for most roles)."""
    base = default_permissions_for(role)
    base["Documents"] = {"view": False, "create": False, "edit": False, "delete": False, "export": False, **documents}
    return base


DOCS = {"Exec": dict(view=True, create=True, edit=True), "Boss": dict(view=True, create=True, edit=True, delete=True), "Fin": dict(view=True, create=True, edit=True),
        "Peer": dict(view=True, create=True)}


def cast(client, sa, branch="Salem"):
    out = []
    for first, role, username in (("Exec", "Sales Executive", "exec"), ("Boss", "Sales Manager", "boss"), ("Fin", "Accounts", "fin"), ("Peer", "Sales Executive", "peer")):
        make_account(client, sa, first=first, last=branch, role=role, branch=branch, username=f"{username}.{branch.lower()}", permissions=grant(role, **DOCS[first]))
        out.append(headers_of(login(client, f"{username}.{branch.lower()}")))
    return out


def test_upload_stores_bytes_and_serves_them_back(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    r = put(client, exec_, name="Scope of work.pdf", category="Reports", visibility="Organization", description="v1")
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["id"].startswith("DOC-") and d["version"] == 1 and d["fileType"] == "pdf" and d["branch"] == "Salem" and d["status"] == "Active"
    assert d["access"]["download"] and d["versions"][0]["active"] and "storage" not in json.dumps(d).lower()
    got = client.get(f"{API}/documents/{d['id']}/file", params={"mode": "download"}, headers=exec_)
    assert got.status_code == 200 and got.content == pdf("Scope of work.pdf") and got.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in got.headers["content-disposition"]
    assert [x["id"] for x in client.get(f"{API}/documents", headers=boss).json()] == [d["id"]]  # organisation-wide, same branch
    audit = client.get(f"{API}/documents/{d['id']}/audit", headers=exec_).json()
    assert [a["action"] for a in audit][:2] == ["Downloaded", "Uploaded"]


def test_content_validation_rejects_bad_files(client, sa):
    exec_, *_ = cast(client, sa)
    cases = [
        ("empty.pdf", b"", "application/pdf"),
        ("fake.pdf", b"hello, not a pdf", "application/pdf"),
        ("trunc.pdf", b"%PDF-1.4 no end", "application/pdf"),
        ("evil.pdf", b"%PDF-1.4\n/OpenAction << /S /JavaScript >>\n%%EOF", "application/pdf"),
        ("run.exe", b"MZ\x90\x00", "application/octet-stream"),
        ("double.pdf.exe", PDF, "application/pdf"),
        ("../../etc/passwd.pdf", PDF, "application/pdf"),
        ("pic.png", b"\x89PNG\r\n\x1a\n<script>alert(1)</script>IEND", "image/png"),
        ("wrongtype.pdf", PDF, "image/png"),
        ("macro.xlsx", xlsx({"xl/vbaProject.bin": "x"}), "application/octet-stream"),
        ("notzip.xlsx", b"PK\x03\x04garbage", "application/octet-stream"),
        ("formula.csv", b"a,b\n=cmd|' /c calc'!A1,2\n", "text/csv"),
        ("notes.txt", b"plain", "text/plain"),
    ]
    for name, data, mime in cases:
        r = put(client, exec_, data=data, name=name, mime=mime, category="Other")
        assert r.status_code == 422, (name, r.status_code, r.text)
        assert r.json()["code"] == "FILE_REJECTED" and r.json()["errors"], name
    ok = put(client, exec_, data=xlsx(), name="book.xlsx", mime="application/octet-stream", category="Other")
    assert ok.status_code == 201, ok.text
    assert put(client, exec_, data=PNG, name="logo.png", mime="image/png").status_code == 201
    # nothing the rejections did left a document behind
    assert len(client.get(f"{API}/documents", headers=exec_).json()) == 2


def test_size_limit_follows_the_setting_and_duplicates_are_refused(client, sa):
    exec_, boss, fin, _ = cast(client, sa)
    admin = sa
    assert client.put(f"{API}/documents/config", json={"maxSizeMb": 1}, headers=exec_).status_code == 403
    assert client.put(f"{API}/documents/config", json={"maxSizeMb": 1}, headers=admin).json()["maxSizeMb"] == 1
    big = PDF[:-6] + b"x" * (1024 * 1024 + 10) + b"\n%%EOF\n"
    r = put(client, exec_, data=big, name="big.pdf")
    assert r.status_code == 422 and "limit is 1 MB" in r.json()["message"]
    first = put(client, exec_, name="a.pdf").json()
    again = put(client, exec_, data=pdf("a.pdf"), name="b.pdf")
    assert again.status_code == 409 and again.json()["existingId"] == first["id"]
    same_name = put(client, exec_, data=pdf("other"), name="A.pdf")
    assert same_name.status_code == 409 and same_name.json()["code"] == "DUPLICATE_NAME"


def test_versions_replace_restore_and_signed_contract_guard(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    d = put(client, exec_, name="spec.pdf", visibility="Organization").json()
    v2 = client.post(f"{API}/documents/{d['id']}/versions", files={"file": ("spec-final.pdf", pdf("v2"), "application/pdf")}, data={"meta": json.dumps({"note": "Final"})}, headers=exec_)
    assert v2.status_code == 200, v2.text
    body = v2.json()
    assert body["version"] == 2 and body["fileName"] == "spec-final.pdf" and [v["active"] for v in body["versions"]] == [False, True]
    dup = client.post(f"{API}/documents/{d['id']}/versions", files={"file": ("x.pdf", pdf("v2"), "application/pdf")}, headers=exec_)
    assert dup.status_code == 409
    old = client.get(f"{API}/documents/{d['id']}/file", params={"version": 1}, headers=exec_)
    assert old.content == pdf("spec.pdf")
    assert client.post(f"{API}/documents/{d['id']}/versions/1/restore", headers=exec_).status_code == 403  # a sales executive cannot manage versions
    back = client.post(f"{API}/documents/{d['id']}/versions/1/restore", headers=boss)
    assert back.status_code == 200, back.text
    b = back.json()
    assert b["version"] == 3 and b["versions"][-1]["restoredFrom"] == 1 and b["fileName"] == "spec.pdf"
    assert client.get(f"{API}/documents/{d['id']}/file", headers=exec_).content == pdf("spec.pdf")
    assert client.post(f"{API}/documents/{d['id']}/versions/3/restore", headers=boss).status_code == 409  # already current
    assert client.post(f"{API}/documents/{d['id']}/versions", files={"file": ("p.pdf", pdf("p"), "application/pdf")}, headers=peer).status_code == 403  # a peer is not the owner/manager


def test_visibility_rules_and_branch_isolation(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    other = cast(client, sa, "Mumbai")
    private = put(client, exec_, name="private.pdf", visibility="Private").json()
    org = put(client, exec_, name="org.pdf", visibility="Organization").json()
    conf = put(client, exec_, name="conf.pdf", visibility="Confidential").json()
    assigned = put(client, exec_, name="assigned.pdf", visibility="Assigned User", assignedTo=client.get(f"{API}/auth/me", headers=peer).json()["id"]).json()
    ids_of = lambda h: sorted(x["id"] for x in client.get(f"{API}/documents", headers=h).json())  # noqa: E731
    assert ids_of(exec_) == sorted([private["id"], org["id"], conf["id"], assigned["id"]])
    assert ids_of(peer) == sorted([org["id"], assigned["id"]])
    assert ids_of(boss) == sorted([org["id"]])  # managers do not see private / confidential files of others
    assert client.get(f"{API}/documents/{private['id']}", headers=peer).status_code == 404
    assert client.get(f"{API}/documents/{private['id']}/file", headers=peer).status_code == 404
    assert ids_of(sa) == sorted([private["id"], org["id"], conf["id"], assigned["id"]])  # administrators see all
    for h in other:
        assert ids_of(h) == []  # another branch sees nothing
        assert client.get(f"{API}/documents/{org['id']}", headers=h).status_code == 404
    denied = [a for a in client.get(f"{API}/documents/{private['id']}/audit", headers=exec_).json() if a["result"] == "Denied"]
    assert len(denied) == 2  # the refused detail + file requests by the peer were recorded


def test_documents_follow_the_record_they_belong_to(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    company = client.post(f"{API}/companies", json={"name": "Acme"}, headers=boss).json()
    deal = client.post(f"{API}/deals", json={"name": "Big deal", "companyId": company["id"], "salesperson": client.get(f"{API}/auth/me", headers=exec_).json()["id"]}, headers=boss)
    assert deal.status_code == 201, deal.text
    d = put(client, boss, name="deal.pdf", relatedType="Deal", relatedId=deal.json()["id"], category="Proposals")
    assert d.status_code == 201, d.text
    doc = d.json()
    assert doc["dealId"] == deal.json()["id"] and doc["companyId"] == company["id"] and doc["primary"] == {"type": "Deal", "id": deal.json()["id"]}
    assert {r["type"] for r in doc["related"]} >= {"Deal", "Company"} and doc["branch"] == "Salem"
    listed = client.get(f"{API}/documents", params={"relatedType": "Deal", "relatedId": deal.json()["id"]}, headers=boss).json()
    assert [x["id"] for x in listed] == [doc["id"]]
    assert client.get(f"{API}/documents", params={"relatedType": "Nonsense", "relatedId": "x"}, headers=boss).status_code == 422
    assert put(client, boss, name="x.pdf", relatedType="Deal", relatedId="DL-9999").status_code == 404
    # a timeline entry was written by the server
    acts = client.get(f"{API}/activities", params={"all": "true", "relatedType": "Deal", "relatedId": deal.json()["id"]}, headers=boss).json()
    assert any(a.get("attachmentAction") == "Uploaded" for a in (acts if isinstance(acts, list) else acts["data"]))


def test_sharing_with_expiry_revoke_and_confidential_rules(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    peer_id = client.get(f"{API}/auth/me", headers=peer).json()["id"]
    d = put(client, exec_, name="secret.pdf", visibility="Private").json()
    assert client.get(f"{API}/documents/{d['id']}", headers=peer).status_code == 404
    assert client.post(f"{API}/documents/{d['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view"}, headers=peer).status_code == 404
    assert client.post(f"{API}/documents/{d['id']}/share", json={"targets": [], "access": "view"}, headers=exec_).status_code == 403  # sales executives cannot share
    assert client.post(f"{API}/documents/{d['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view"}, headers=sa).status_code == 200
    seen = client.get(f"{API}/documents/{d['id']}", headers=peer)
    assert seen.status_code == 200 and seen.json()["access"]["shareLevel"] == "view" and seen.json()["access"]["download"] is False
    assert client.get(f"{API}/documents/{d['id']}/file", params={"mode": "download"}, headers=peer).status_code == 403
    assert client.get(f"{API}/documents/{d['id']}/file", headers=peer).status_code == 200
    sid = next(s["id"] for s in client.get(f"{API}/documents/{d['id']}", headers=sa).json()["shares"])
    assert client.delete(f"{API}/documents/{d['id']}/share/{sid}", headers=sa).status_code == 200
    assert client.get(f"{API}/documents/{d['id']}", headers=peer).status_code == 404
    bad_expiry = client.post(f"{API}/documents/{d['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view", "expiresAt": "2020-01-01"}, headers=sa)
    assert bad_expiry.status_code == 422
    conf = put(client, exec_, name="conf.pdf", visibility="Confidential").json()
    assert client.post(f"{API}/documents/{conf['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view"}, headers=sa).status_code == 422  # needs an expiry
    ok = client.post(f"{API}/documents/{conf['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view", "expiresAt": "2099-01-01"}, headers=sa)
    assert ok.status_code == 422  # beyond the 90-day limit
    from datetime import date, timedelta

    soon = (date.today() + timedelta(days=5)).isoformat()
    assert client.post(f"{API}/documents/{conf['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view", "expiresAt": soon}, headers=sa).status_code == 200
    assert client.post(f"{API}/documents/{conf['id']}/share", json={"targets": [{"type": "user", "targetId": peer_id}], "access": "view", "expiresAt": soon}, headers=sa).status_code == 409
    notes = client.get(f"{API}/notifications", params={"all": "true"}, headers=peer).json()
    assert any("shared" in n["message"] for n in (notes if isinstance(notes, list) else notes["data"]))


def test_edit_details_delete_restore_and_purge(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    d = put(client, exec_, name="memo.pdf", visibility="Organization", category="Reports").json()
    assert client.put(f"{API}/documents/{d['id']}", json={"name": "Quarterly memo", "category": "Legal Documents", "tags": ["q1"]}, headers=peer).status_code == 403
    r = client.put(f"{API}/documents/{d['id']}", json={"name": "Quarterly memo", "category": "Legal Documents", "tags": ["q1"], "reviewBy": "2099-01-01"}, headers=exec_)
    assert r.status_code == 200 and r.json()["name"] == "Quarterly memo" and r.json()["tags"] == ["q1"] and r.json()["reviewBy"] == "2099-01-01"
    assert client.put(f"{API}/documents/{d['id']}", json={"category": "Nope"}, headers=exec_).status_code == 422
    assert client.put(f"{API}/documents/{d['id']}", json={"name": " "}, headers=exec_).status_code == 422
    assert client.post(f"{API}/documents/{d['id']}/delete", json={"reason": "obsolete"}, headers=peer).status_code == 403
    assert client.delete(f"{API}/documents/{d['id']}", headers=sa).status_code == 409  # not in the bin yet
    assert client.post(f"{API}/documents/{d['id']}/delete", json={"reason": "obsolete"}, headers=boss).status_code == 200  # a manager (delete capability + module permission)
    assert client.get(f"{API}/documents", headers=exec_).json() == []
    binned = client.get(f"{API}/documents", params={"trash": "true"}, headers=sa).json()
    assert [x["id"] for x in binned] == [d["id"]] and binned[0]["status"] == "Deleted" and binned[0]["deleteReason"] == "obsolete"
    assert client.get(f"{API}/documents/{d['id']}/file", headers=exec_).status_code == 404  # a binned file is out of sight for anyone who cannot restore it
    back = client.post(f"{API}/documents/{d['id']}/restore", headers=boss)
    assert back.status_code == 200 and back.json()["status"] == "Active"
    client.post(f"{API}/documents/{d['id']}/delete", json={}, headers=boss)
    assert client.delete(f"{API}/documents/{d['id']}", headers=boss).status_code == 403  # only administrators erase
    assert client.delete(f"{API}/documents/{d['id']}", headers=sa).json() == {"success": True}
    assert client.get(f"{API}/documents/{d['id']}", headers=sa).status_code == 404


def test_retention_purges_the_bin_and_its_bytes(client, sa):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.models import Document, DocumentVersion, StoredFile
    from app.services import documents

    exec_, boss, *_ = cast(client, sa)
    d = put(client, exec_, name="old.pdf", visibility="Organization").json()
    client.post(f"{API}/documents/{d['id']}/delete", json={}, headers=boss)
    with get_session_factory()() as db:
        row = db.get(Document, d["id"])
        row.purge_after = datetime.now(UTC) - timedelta(days=1)
        db.commit()
        assert documents.purge_expired(db) == 1
        assert db.execute(select(Document).where(Document.id == d["id"])).first() is None
        assert db.execute(select(DocumentVersion)).first() is None and db.execute(select(StoredFile)).first() is None
    # the history of the erased file is still readable by an administrator through the global audit table
    from app.models import DocumentAudit

    with get_session_factory()() as db:
        assert [a.action for a in db.execute(select(DocumentAudit).where(DocumentAudit.document_id == d["id"]).order_by(DocumentAudit.id)).scalars()][-1] == "Permanently deleted"


def test_folders_and_categories(client, sa):
    exec_, boss, fin, peer = cast(client, sa)
    assert client.post(f"{API}/documents/folders", json={"name": "Contracts 2026"}, headers=exec_).status_code == 403
    f = client.post(f"{API}/documents/folders", json={"name": "Contracts 2026"}, headers=boss)
    assert f.status_code == 201 and client.post(f"{API}/documents/folders", json={"name": "contracts 2026"}, headers=boss).status_code == 409
    d = put(client, exec_, name="in-folder.pdf", folderId=f.json()["id"]).json()
    assert d["folderId"] == f.json()["id"] and put(client, exec_, name="z.pdf", folderId="FLD-9999").status_code == 422
    assert client.delete(f"{API}/documents/folders/{f.json()['id']}", headers=boss).status_code == 409
    assert client.put(f"{API}/documents/folders/{f.json()['id']}", json={"name": "Renamed"}, headers=boss).json()["name"] == "Renamed"
    cfg = client.get(f"{API}/documents/config", headers=sa).json()
    cats = cfg["config"]["categories"]
    assert len(cats) == 17 and "manageCategories" in cfg["caps"]
    without_reports = [c for c in cats if c["name"] != "Reports"]
    assert client.put(f"{API}/documents/config", json={"categories": [c for c in cats if c["name"] != "Other"]}, headers=sa).status_code == 422
    assert client.put(f"{API}/documents/config", json={"categories": without_reports}, headers=sa).status_code == 200  # no document uses it yet
    assert put(client, exec_, name="r.pdf", category="Reports").status_code == 422  # no longer a category
    assert [c["name"] for c in client.get(f"{API}/documents/config", headers=exec_).json()["config"]["categories"]].count("Reports") == 0


def test_unauthenticated_and_cross_module_access(client, sa):
    assert client.get(f"{API}/documents").status_code == 401
    assert client.post(f"{API}/documents", files={"file": ("a.pdf", PDF, "application/pdf")}).status_code == 401
    make_account(client, sa, first="Nodocs", last="User", role="Support", branch="Salem", username="nodocs", permissions=grant("Support"))
    h = headers_of(login(client, "nodocs"))
    r = put(client, h, name="x.pdf")
    assert r.status_code == 403 and "general documents" in r.json()["message"]
