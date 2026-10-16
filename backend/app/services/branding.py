"""Company branding: the logo the Super Admin uploads in Settings (replaces the built-in one everywhere until removed).

The bytes live in `stored_files` (one row at a time - replacing or removing deletes the old one), the pointer and display details in the `branding` row of `app_settings`. Reading is public
(the sign-in page needs the logo before anybody has signed in); changing is Super Admin only. What is accepted is decided here, on the server, from the file's own bytes - never from the
file name or the type the browser claims."""
import hashlib
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import ApiError, invalid, not_found
from app.models import AppSetting, StoredFile
from app.services import audit

KEY = "branding"
MAX_LOGO_BYTES = 1024 * 1024  # 1 MB: a logo is small; a larger file only slows every page down
ALLOWED = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# an SVG is code, not just a picture: anything that can run or fetch something is refused (the file is also served sandboxed and only ever shown through <img>, where scripts never run)
SVG_FORBIDDEN = re.compile(r"<!doctype|<!entity|<script|<foreignobject|<iframe|<embed|<object|<audio|<video|<link|<meta|<style\b[^>]*@import|\bon[a-z]+\s*=|javascript:|vbscript:|data:text/html", re.I)
SVG_EXTERNAL = re.compile(r"(?:xlink:)?href\s*=\s*[\"'](?!#|data:image/(?:png|jpe?g|gif|webp);base64,)", re.I)
SVG_URL = re.compile(r"url\(\s*[\"']?(?!#)", re.I)


def _row(db: Session) -> dict:
    row = db.get(AppSetting, KEY)
    return dict(row.value) if row and row.value else {}


def sniff(data: bytes) -> str | None:
    """The real type of the bytes (PNG / JPEG / SVG), or None."""
    if data.startswith(PNG_MAGIC):
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    head = data.lstrip(b"\xef\xbb\xbf \t\r\n")[:600].lower()
    if head.startswith((b"<?xml", b"<svg", b"<!--")) and b"<svg" in data[:4000].lower():
        return "image/svg+xml"
    return None


def check_svg(data: bytes) -> None:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise invalid("That SVG is not valid text (UTF-8).", {"file": "Not a valid SVG."}) from None
    if SVG_FORBIDDEN.search(text) or SVG_EXTERNAL.search(text) or SVG_URL.search(text):
        raise invalid("That SVG contains scripts or links to other files, which are not allowed in a logo. Export a plain SVG and try again.", {"file": "Unsafe SVG."})
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise invalid("That SVG file could not be read - it may be damaged.", {"file": "Damaged SVG."}) from None
    if not root.tag.lower().endswith("svg"):
        raise invalid("That file is not an SVG image.", {"file": "Not an SVG."})


def validate(data: bytes, declared: str | None, name: str) -> str:
    """Returns the real mime type, or raises a 422 saying plainly what is wrong."""
    if not data:
        raise invalid("Choose an image file to upload.", {"file": "Choose a file."})
    if len(data) > MAX_LOGO_BYTES:
        raise invalid(f"The logo must be {MAX_LOGO_BYTES // (1024 * 1024)} MB or smaller.", {"file": "File is too large."})
    mime = sniff(data)
    if mime is None:
        raise invalid("Only PNG, JPG, JPEG or SVG images can be used as the logo.", {"file": "Unsupported file type."})
    ext = (name.rsplit(".", 1)[-1] if "." in name else "").lower()
    if ext and ext not in {"png", "jpg", "jpeg", "svg"}:
        raise invalid("Only PNG, JPG, JPEG or SVG images can be used as the logo.", {"file": "Unsupported file type."})
    if mime == "image/svg+xml":
        check_svg(data)
    return mime


def public(db: Session) -> dict:
    """What every screen needs to show the logo. `url` carries the content hash, so a replaced logo is fetched afresh and an unchanged one is cached for a year."""
    row = _row(db)
    if not row.get("fileId"):
        return {"hasLogo": False, "url": None, "version": None}
    return {"hasLogo": True, "url": f"/branding/logo?v={row['sha256'][:16]}", "version": row["sha256"][:16], "mime": row["mime"], "name": row.get("name", ""), "size": row.get("size", 0), "updatedAt": row.get("updatedAt")}


def logo(db: Session) -> tuple[bytes, str, str]:
    row = _row(db)
    stored = db.get(StoredFile, row["fileId"]) if row.get("fileId") else None
    if stored is None:
        raise not_found("No custom logo has been uploaded.")
    return bytes(stored.data), row["mime"], row["sha256"]


def _drop_current(db: Session, row: dict) -> None:
    old = db.get(StoredFile, row["fileId"]) if row.get("fileId") else None
    if old is not None:
        db.delete(old)


def _save(db: Session, p: Principal, value: dict) -> None:
    current = db.get(AppSetting, KEY)
    if current is None:
        db.add(AppSetting(key=KEY, value=value, updated_by=p.actor_id))
    else:
        current.value, current.updated_by = value, p.actor_id


def set_logo(db: Session, p: Principal, data: bytes, file_name: str, declared: str | None) -> dict:
    if not p.is_super_admin:
        raise ApiError(403, "Only the Super Admin can change the company logo.", "FORBIDDEN")
    mime = validate(data, declared, file_name or "")
    _drop_current(db, _row(db))
    sha = hashlib.sha256(data).hexdigest()
    file_id = f"SF-brand-{uuid.uuid4().hex[:16]}"
    db.add(StoredFile(id=file_id, name=(file_name or f"logo.{ALLOWED[mime]}")[:255], mime=mime, size_bytes=len(data), sha256=sha, data=data))
    _save(db, p, {"fileId": file_id, "mime": mime, "name": (file_name or "")[:255], "size": len(data), "sha256": sha, "updatedAt": datetime.now(UTC).isoformat()})
    audit.record(db, user=p.user, action="Change company logo", module="Settings", details=f"{(file_name or 'logo')[:120]} ({mime}, {len(data) // 1024} KB)", info=p.info)
    db.commit()
    return public(db)


def remove_logo(db: Session, p: Principal) -> dict:
    if not p.is_super_admin:
        raise ApiError(403, "Only the Super Admin can change the company logo.", "FORBIDDEN")
    row = _row(db)
    _drop_current(db, row)
    _save(db, p, {})
    audit.record(db, user=p.user, action="Remove company logo", module="Settings", details="Back to the default logo", info=p.info)
    db.commit()
    return public(db)
