"""Company logo: Super Admin uploads / replaces / removes it, everybody (even before signing in) can read it, only real PNG / JPEG / safe SVG up to 1 MB is accepted, and it survives sign-out."""
import base64
import struct
import zlib

from tests.conftest import ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"


def png(width=2, height=2, extra=b""):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"") + extra


JPG = base64.b64decode("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==")
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7c3aed"/></svg>'


def upload(client, headers, data, name="logo.png", mime="image/png"):
    return client.put(f"{API}/branding/logo", files={"file": (name, data, mime)}, headers=headers)


def test_default_until_a_logo_is_uploaded(client):
    r = client.get(f"{API}/branding")  # public: no sign-in
    assert r.status_code == 200 and r.json() == {"hasLogo": False, "url": None, "version": None}
    assert client.get(f"{API}/branding/logo").status_code == 404


def test_super_admin_uploads_and_everyone_can_read_it_without_signing_in(client, sa):
    r = upload(client, sa, png())
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["hasLogo"] and info["mime"] == "image/png" and info["url"].startswith("/branding/logo?v=") and info["name"] == "logo.png"
    seen = client.get(f"{API}{info['url']}")  # no Authorization header
    assert seen.status_code == 200 and seen.headers["content-type"] == "image/png" and seen.content == png()
    assert "immutable" in seen.headers["cache-control"] and seen.headers["x-content-type-options"] == "nosniff"
    again = client.get(f"{API}{info['url']}", headers={"If-None-Match": seen.headers["etag"]})
    assert again.status_code == 304
    assert client.get(f"{API}/branding").json()["version"] == info["version"]


def test_replacing_changes_the_address_and_removing_goes_back_to_the_default(client, sa):
    first = upload(client, sa, png()).json()
    second = upload(client, sa, JPG, "company.JPEG", "image/jpeg").json()
    assert second["mime"] == "image/jpeg" and second["url"] != first["url"]
    assert client.get(f"{API}/branding/logo").content == JPG  # only the newest is kept
    from app.db.session import get_session_factory
    from app.models import StoredFile
    from sqlalchemy import func, select

    with get_session_factory()() as db:
        assert db.execute(select(func.count()).select_from(StoredFile)).scalar_one() == 1
    gone = client.delete(f"{API}/branding/logo", headers=sa)
    assert gone.status_code == 200 and gone.json()["hasLogo"] is False
    assert client.get(f"{API}/branding/logo").status_code == 404
    with get_session_factory()() as db:
        assert db.execute(select(func.count()).select_from(StoredFile)).scalar_one() == 0


def test_the_logo_survives_signing_out_and_in_again(client, sa):
    upload(client, sa, SVG, "mark.svg", "image/svg+xml")
    client.post(f"{API}/auth/logout", headers=sa)
    again = headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD))
    assert client.get(f"{API}/branding", headers=again).json()["mime"] == "image/svg+xml"
    r = client.get(f"{API}/branding/logo")
    assert r.status_code == 200 and r.content == SVG and r.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in r.headers["content-security-policy"]


def test_only_the_super_admin_may_change_it(client, sa, salem_admin):
    assert upload(client, salem_admin, png()).status_code == 403
    assert client.delete(f"{API}/branding/logo", headers=salem_admin).status_code == 403
    assert upload(client, {}, png()).status_code == 401
    assert client.delete(f"{API}/branding/logo").status_code == 401
    staff = make_account(client, sa, first="Plain", last="Staff", username="plain.staff")
    h = headers_of(login(client, staff["username"]))
    assert upload(client, h, png()).status_code == 403
    assert client.get(f"{API}/branding").json()["hasLogo"] is False


def test_validation_by_content_not_by_name(client, sa):
    too_big = png(extra=b"\x00" * (1024 * 1024 + 10))
    assert upload(client, sa, too_big).status_code == 422
    assert upload(client, sa, b"").status_code == 422
    assert upload(client, sa, b"GIF89a....", "x.gif", "image/gif").status_code == 422
    assert upload(client, sa, b"%PDF-1.4 ...", "logo.png", "image/png").status_code == 422  # a PDF renamed .png is still a PDF
    assert upload(client, sa, png(), "logo.exe", "image/png").status_code == 422
    assert upload(client, sa, b"<html><body>hi</body></html>", "logo.svg", "image/svg+xml").status_code == 422
    assert client.get(f"{API}/branding").json()["hasLogo"] is False  # nothing was stored by the refused attempts


def test_unsafe_svgs_are_refused(client, sa):
    bad = [
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example"><rect width="1" height="1"/></a></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/x.png"/></svg>',
        b'<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(http://evil.example/a)" width="1" height="1"/></svg>',
        b'<svg xmlns="http://www.w3.org/2000/svg"><rect',
    ]
    for body in bad:
        r = upload(client, sa, body, "x.svg", "image/svg+xml")
        assert r.status_code == 422, body
    assert upload(client, sa, SVG, "ok.svg", "image/svg+xml").status_code == 200


def test_changes_are_audited(client, sa):
    upload(client, sa, png())
    client.delete(f"{API}/branding/logo", headers=sa)
    from app.db.session import get_session_factory
    from app.models import AuditLog
    from sqlalchemy import select

    with get_session_factory()() as db:
        actions = [a for (a,) in db.execute(select(AuditLog.action).where(AuditLog.module == "Settings")).all()]
    assert "Change company logo" in actions and "Remove company logo" in actions
