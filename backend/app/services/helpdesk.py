"""Ticket conversation: a reply to the customer or an internal note. Both are recorded on the ticket with the signed-in person and the time; neither can be written through the
ticket's ordinary update (those keys are server-owned). No e-mail or WhatsApp service is connected, so a reply is *recorded*, not delivered - the response says so."""
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.api.deps import Principal
from app.core.errors import forbidden, invalid
from app.services import records
from app.services.modules import SPEC_BY_KEY

MAX_TEXT = 4000
MAX_ENTRIES = 500


def add_message(db: Session, p: Principal, ticket_id: str, data: dict) -> dict:
    spec = SPEC_BY_KEY["tickets"]
    if not p.can(spec.label, "edit"):
        raise forbidden("You do not have permission to update tickets.")
    kind = str(data.get("kind") or "reply").lower()
    if kind not in ("reply", "note"):
        raise invalid("kind must be reply or note.", {"kind": "Not an allowed value."})
    text = str(data.get("text") or "").strip()
    if not text:
        raise invalid("Write something first.", {"text": "Required."})
    if len(text) > MAX_TEXT:
        raise invalid(f"Keep it under {MAX_TEXT} characters.", {"text": "Too long."})
    obj = records.get_or_404(db, spec, p, ticket_id)
    now = datetime.now(UTC).isoformat()
    attrs = dict(obj.attributes or {})
    entry = {"by": p.name, "byId": p.actor_id, "text": text, "date": now}
    if kind == "reply":
        attrs["messages"] = [*(attrs.get("messages") or []), {**entry, "from": "staff"}][-MAX_ENTRIES:]
        event = {"action": "Customer Response", "details": "Reply recorded on the ticket"}
    else:
        attrs["internalNotes"] = [*(attrs.get("internalNotes") or []), entry][-MAX_ENTRIES:]
        event = {"action": "Note Added", "details": "Added internal note"}
    attrs["timeline"] = [*(attrs.get("timeline") or []), {**event, "by": p.actor_id, "date": now}][-MAX_ENTRIES:]
    obj.attributes = attrs
    obj.updated_date = datetime.now(UTC).date()
    records._log(db, p, spec, "Updated", obj.id, "Reply recorded" if kind == "reply" else "Internal note added")
    db.commit()
    out = spec.hooks.present(records.Ctx(db, p, spec), obj, records.to_json(obj))
    return {**out, "delivery": "not-sent" if kind == "reply" else "internal"}
