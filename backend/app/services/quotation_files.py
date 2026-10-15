"""Quotation attachments and sending. The attached file is filed in the central Documents repository (one managed document per quotation, each replacement a new version) and the
quotation keeps a small history of what was attached and what was sent to the client. The recipient of a send is always the contact on the quotation - never taken from the request."""
import base64
import binascii
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import conflict, forbidden, invalid, not_found
from app.db import ids
from app.models import Quotation
from app.services import audit, documents, timeline
from app.services.codec import to_json

LOCKED = ("Accepted", "Rejected", "Expired")
MAX_VERSIONS = 25
KINDS = {"pdf": "PDF", "doc": "Word", "docx": "Word"}
APPROVERS = ("Super Admin", "Admin", "MD", "Sales Manager")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _get(db: Session, p: Principal, quotation_id: str) -> Quotation:
    from app.services.modules import SPEC_BY_KEY

    spec = SPEC_BY_KEY["quotations"]
    extra = spec.row_filter(p) if spec.row_filter else None
    stmt = select(Quotation).where(Quotation.id == quotation_id)
    q = db.execute(stmt.where(extra) if extra is not None else stmt).scalar_one_or_none()
    if q is None:
        raise not_found("Quotation not found.")
    return q


def _decode(data_url: str) -> bytes:
    head, _, body = str(data_url or "").partition(",")
    if not head.startswith("data:") or ";base64" not in head:
        raise invalid("The uploaded file data is corrupt.")
    try:
        return base64.b64decode(body, validate=True)
    except (binascii.Error, ValueError):
        raise invalid("The uploaded file data is corrupt.") from None


def _atts(q: Quotation) -> list[dict]:
    return list((q.attributes or {}).get("attachments") or [])


def attach(db: Session, p: Principal, quotation_id: str, body: dict) -> dict:
    q = _get(db, p, quotation_id)
    if not p.can("Quotations", "edit"):
        raise forbidden("You do not have permission to attach documents.")
    if q.status in LOCKED:
        raise conflict(f"A {q.status.lower()} quotation's documents can't be changed.")
    data = _decode(body.get("dataUrl"))
    name = documents.R.sanitize_file_name(body.get("fileName"))
    ext = documents.R.ext_of(name)
    if ext not in KINDS:
        raise invalid("Only PDF and Word documents (.pdf, .doc, .docx) can be attached to a quotation.", {"fileName": "Unsupported file type."})
    if not re.fullmatch(r"[0-9a-f]{64}", str(body.get("hash") or "")):
        raise invalid("Missing file fingerprint.")
    attachments = _atts(q)
    active = next((a for a in attachments if a["status"] == "Active"), None)
    if active and not body.get("replace"):
        raise conflict("This quotation already has an attached document. Use Replace to swap it.")
    from app.services import storage

    if active and active.get("hash") == storage.sha256(data):
        raise conflict("This exact file is already attached to this quotation.")
    if len(attachments) >= MAX_VERSIONS:
        raise invalid(f"This quotation has reached the limit of {MAX_VERSIONS} attachment versions.")
    doc, version = documents.sync_managed(db, p, managed_by="quotation-attachment", primary_type="Quotation", record=q, data=data, file_name=name, mime=body.get("mimeType"), category="Quotations",
                                          note="Attached to the quotation", source="quotation", description="Attached to the quotation.", only=tuple(KINDS))
    now = now_iso()
    entry = {"id": ids.new_id(db, "ATT", 5), "quotationId": q.id, "quotationNumber": q.number, "companyId": q.company_id, "customerId": q.customer_id, "contactId": q.contact_id, "customerName": q.customer_name,
             "fileName": name, "mimeType": body.get("mimeType") or "", "kind": KINDS[ext], "size": len(data), "hash": storage.sha256(data), "version": len(attachments) + 1, "status": "Active", "uploadedAt": now,
             "uploadedBy": p.actor_id, "uploadedByName": p.name, "sentAt": None, "sentTo": None, "documentId": doc.id, "documentVersion": version}
    history = [{**a, "status": "Replaced", "replacedAt": now, "replacedByName": p.name} if a["status"] == "Active" else a for a in attachments]
    q.attributes = {**q.attributes, "attachments": [entry, *history], "attachmentId": entry["id"]}
    subject = f'Replaced attached document "{active["fileName"]}" with "{name}"' if active else f'Attached document "{name}"'
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Attachment", subject=subject, by=p.actor_id, branch=q.branch,
                          extra={"attachmentAction": "Replaced" if active else "Attached", "attachmentName": name, "attachmentSize": len(data), "attachmentVersion": entry["version"], "documentId": doc.id})
    audit.record(db, user=p.user, action="Quotation attachment", module="Quotations", record_id=q.id, details=subject, info=p.info)
    db.commit()
    return {"quotation": to_json(q), "attachment": entry}


def remove(db: Session, p: Principal, quotation_id: str, attachment_id: str) -> dict:
    q = _get(db, p, quotation_id)
    if not p.can("Quotations", "edit"):
        raise forbidden("You do not have permission to remove documents.")
    if q.status in LOCKED:
        raise conflict(f"A {q.status.lower()} quotation's documents can't be changed.")
    attachments = _atts(q)
    att = next((a for a in attachments if a["id"] == attachment_id), None)
    if att is None:
        raise not_found("Attachment not found on this quotation.")
    if att["status"] != "Active":
        raise conflict("Only the current attachment can be removed.")
    documents.archive_managed(db, p, managed_by="quotation-attachment", primary_type="Quotation", primary_id=q.id)
    now = now_iso()
    q.attributes = {**q.attributes, "attachments": [{**a, "status": "Removed", "removedAt": now, "removedByName": p.name} if a["id"] == attachment_id else a for a in attachments], "attachmentId": None}
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Attachment", subject=f'Removed attached document "{att["fileName"]}"', by=p.actor_id, branch=q.branch,
                          extra={"attachmentAction": "Removed", "attachmentName": att["fileName"], "attachmentSize": att["size"], "attachmentVersion": att["version"]})
    db.commit()
    return {"quotation": to_json(q)}


def send(db: Session, p: Principal, quotation_id: str, body: dict) -> dict:
    q = _get(db, p, quotation_id)
    if not p.can("Quotations", "edit"):
        raise forbidden("You do not have permission to send quotations.")
    if q.status in ("Rejected", "Expired", "Accepted"):
        raise conflict(f"A {q.status.lower()} quotation can't be sent.")
    role = "Super Admin" if p.is_super_admin else ("Admin" if p.level == "Admin" else p.user.job_role)
    if q.status in ("Draft", "Pending Approval") and role not in APPROVERS:
        raise forbidden("This quotation is not approved yet. Submit it for approval — a manager can then approve and send it.")
    to = (q.contact_email or "").strip()
    if not EMAIL.match(to):
        raise invalid("This quotation's client has no valid email address on file.", {"to": "No valid email on the quotation."})
    subject = str(body.get("subject") or "").strip()[:200]
    message = str(body.get("message") or "").strip()[:4000]
    if not subject:
        raise invalid("Add an email subject.", {"subject": "Add an email subject."})
    attachments = _atts(q)
    att = next((a for a in attachments if a["status"] == "Active"), None)
    include_generated = bool(body.get("includeGeneratedPdf"))
    if att is None and not include_generated:
        raise invalid("Nothing to send — attach a document or include the generated quotation PDF.")
    if att is not None and (att.get("quotationId") != q.id or not att.get("documentId")):
        raise conflict("The attached document is not linked to this quotation. Re-attach it before sending.")
    now = now_iso()
    record = {"id": ids.new_id(db, "SND", 4), "at": now, "byId": p.actor_id, "byName": p.name, "to": to, "subject": subject, "message": message, "attachmentId": att["id"] if att else None,
              "attachmentName": att["fileName"] if att else None, "attachmentSize": att["size"] if att else None, "generatedPdfIncluded": include_generated}
    previous = q.status
    next_status = "Sent" if previous in ("Draft", "Pending Approval") else previous
    q.status = next_status
    q.attributes = {**q.attributes, "attachments": [{**a, "sentAt": now, "sentTo": to} if att and a["id"] == att["id"] else a for a in attachments], "sends": [record, *(q.attributes.get("sends") or [])],
                    "sentAt": now}
    attached = f' with "{att["fileName"]}" attached' if att else ""
    timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="Email", by=p.actor_id, branch=q.branch, subject=f"Quotation emailed to {to}{attached}",
                          extra={"emailTo": to, "emailSubject": subject, "emailStatus": "Recorded (no mail server configured)", "attachmentName": att["fileName"] if att else None})
    if next_status != previous:
        timeline.log_activity(db, related_type="Quotation", related_id=q.id, related_name=q.number, type="StatusChange", subject=f"Status changed from {previous} to {next_status}", by=p.actor_id,
                              branch=q.branch, from_status=previous, to_status=next_status)
    audit.record(db, user=p.user, action="Send quotation", module="Quotations", record_id=q.id, details=to, info=p.info)
    db.commit()
    return {"quotation": to_json(q), "send": record}
