from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.core.errors import ApiError, conflict, forbidden, invalid, not_found
from app.db.session import get_db
from app.models import Deal, Quotation
from app.services import activities as act_svc
from app.services import quotation_files
from app.services import sales_docs as svc

router = APIRouter(tags=["Sales documents"])


# ---- quotations ---------------------------------------------------------------------------------------------------------------
@router.post("/quotations/{quotation_id}/send", summary="Approve (if you are a manager) and send a quotation")
def quotation_send(quotation_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Quotations", "view")), db: Session = Depends(get_db)):
    return quotation_files.send(db, p, quotation_id, payload)


@router.get("/quotations/{quotation_id}/sales-order-draft", summary="Everything the Create Sales Order screen needs")
def so_draft(quotation_id: str, p: Principal = Depends(require("Sales Orders", "create")), db: Session = Depends(get_db)):
    return svc.sales_order_draft(db, svc.get_quotation_for_so(db, quotation_id))


@router.post("/quotations/{quotation_id}/attachments", summary="Attach (or replace) the quotation's document - filed in Documents")
def quotation_attach(quotation_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return quotation_files.attach(db, p, quotation_id, payload)


@router.delete("/quotations/{quotation_id}/attachments/{attachment_id}", summary="Remove the current attachment (kept in history)")
def quotation_detach(quotation_id: str, attachment_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return quotation_files.remove(db, p, quotation_id, attachment_id)


# ---- sales orders -------------------------------------------------------------------------------------------------------------
@router.post("/salesOrders", status_code=400, include_in_schema=False)
def so_manual():
    raise invalid("Sales orders are created from an Accepted quotation - open the quotation and choose Create Sales Order.")


@router.post("/salesOrders/from-quotation", status_code=201, summary="Create a sales order from an Accepted quotation")
def so_create(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "create")), db: Session = Depends(get_db)):
    return svc.create_sales_order(db, p, payload)


@router.put("/salesOrders/{so_id}")
def so_edit(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.edit_sales_order(db, p, so_id, payload)


@router.post("/salesOrders/{so_id}/status")
def so_set_status(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.so_status(db, p, so_id, payload.get("status", ""), payload.get("reason", ""))


@router.post("/salesOrders/{so_id}/fulfillment")
def so_fulfil(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.so_fulfilment(db, p, so_id, payload)


@router.post("/salesOrders/{so_id}/revise")
def so_revise(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.so_revise(db, p, so_id, payload)


@router.post("/salesOrders/{so_id}/notes")
def so_note(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.so_note(db, p, so_id, payload.get("text", ""))


@router.post("/salesOrders/{so_id}/followups")
def so_followup(so_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Sales Orders", "edit")), db: Session = Depends(get_db)):
    return svc.so_followup(db, p, so_id, payload)


@router.post("/salesOrders/{so_id}/documents")
def so_documents(so_id: str):
    raise ApiError(410, "Attachments moved to the Documents module - upload files from the record's Documents section.", "MOVED")


@router.delete("/salesOrders/{so_id}")
def so_delete(so_id: str, p: Principal = Depends(require("Sales Orders", "delete")), db: Session = Depends(get_db)):
    return svc.delete_sales_order(db, p, so_id)


# ---- proposals ----------------------------------------------------------------------------------------------------------------
@router.get("/deals/{deal_id}/proposal-draft", summary="The prefilled proposal for a deal")
def proposal_draft(deal_id: str, p: Principal = Depends(require("Proposals", "create")), db: Session = Depends(get_db)):
    deal = db.execute(select(Deal).where(Deal.id == deal_id)).scalar_one_or_none()
    if deal is None:
        raise not_found("Deal not found.")
    if deal.stage in svc.CLOSED_DEAL:
        raise conflict(f"This deal is {deal.stage} - proposals cannot be started for a closed deal.")
    from app.models import Proposal

    open_one = db.execute(select(Proposal).where(Proposal.deal_id == deal.id, Proposal.status.in_(svc.PROPOSAL_OPEN))).scalars().first()
    if open_one is not None:
        raise ApiError(409, f"{open_one.number} - Version {open_one.version} is still open for this deal. Continue with it, or create a revision.", "ALREADY_OPEN", fields={"existingId": open_one.id})
    return svc.proposal_draft(db, deal)


@router.post("/proposals", status_code=400, include_in_schema=False)
def proposal_manual():
    raise invalid("Proposals are created from a Deal - open the deal and choose Create Proposal.")


@router.post("/proposals/expire-sweep")
def proposal_sweep(p: Principal = Depends(require("Proposals", "view")), db: Session = Depends(get_db)):
    return svc.proposal_expire_sweep(db, p)


@router.post("/proposals/from-deal", status_code=201)
def proposal_create(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Proposals", "create")), db: Session = Depends(get_db)):
    return svc.create_proposal_from_deal(db, p, payload)


@router.put("/proposals/{proposal_id}")
def proposal_edit(proposal_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    return svc.edit_proposal(db, p, proposal_id, payload)


@router.post("/proposals/{proposal_id}/status")
def proposal_set_status(proposal_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    return svc.proposal_status(db, p, proposal_id, payload.get("status", ""), payload.get("reason", ""))


@router.post("/proposals/{proposal_id}/send")
def proposal_send(proposal_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    return svc.proposal_send(db, p, proposal_id, payload)


@router.post("/proposals/{proposal_id}/revise")
def proposal_revise(proposal_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    return svc.proposal_revise(db, p, proposal_id, payload.get("reason", ""))


@router.get("/proposals/{proposal_id}/client-diff")
def proposal_diff(proposal_id: str, p: Principal = Depends(require("Proposals", "view")), db: Session = Depends(get_db)):
    return svc.proposal_client_diff(db, proposal_id)


@router.post("/proposals/{proposal_id}/refresh-client")
def proposal_refresh(proposal_id: str, p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    return svc.proposal_refresh_client(db, p, proposal_id)


@router.post("/proposals/{proposal_id}/create-quotation", status_code=201)
def proposal_quote(proposal_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Quotations", "create")), db: Session = Depends(get_db)):
    return svc.proposal_create_quotation(db, p, proposal_id, payload)


@router.post("/proposals/{proposal_id}/activities", summary="Log a call / email / WhatsApp / meeting / note / follow-up on a proposal")
def proposal_activity(proposal_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Proposals", "edit")), db: Session = Depends(get_db)):
    atype, data = payload.get("type"), payload.get("data") or {}
    mapping = {
        "Note": lambda: {"type": "Note", "subject": data.get("title") or "Note added", "description": data.get("content")},
        "Call": lambda: {"type": "Call", "outcome": data.get("outcome"), "description": data.get("notes"), "callType": data.get("callType"), "duration": data.get("duration")},
        "Email": lambda: {"type": "Email", "subject": data.get("subject"), "description": data.get("message")},
        "WhatsApp": lambda: {"type": "WhatsApp", "description": data.get("message")},
        "Meeting": lambda: {"type": "Meeting", "subject": data.get("title"), "date": data.get("date"), "time": data.get("startTime"), "endTime": data.get("endTime"), "meetingType": data.get("meetingType"), "description": data.get("notes")},
        "Follow-up": lambda: {"type": "Follow-up", "subject": f"{data.get('followUpType') or 'Call'} follow-up - {proposal_id}", "date": data.get("date"), "time": data.get("time"), "followUpType": data.get("followUpType"),
                              "assignedTo": data.get("assignedTo"), "description": data.get("notes")},
    }
    if atype not in mapping:
        raise invalid("Unknown activity type.")
    entry = act_svc.log_manual(db, p, {**mapping[atype](), "relatedType": "Proposal", "relatedId": proposal_id})
    return {"activity": entry}


@router.post("/proposals/{proposal_id}/documents")
def proposal_documents(proposal_id: str):
    raise ApiError(410, "Attachments moved to the Documents module - upload files from the record's Documents section.", "MOVED")


@router.delete("/proposals/{proposal_id}")
def proposal_delete(proposal_id: str, p: Principal = Depends(require("Proposals", "delete")), db: Session = Depends(get_db)):
    return svc.delete_proposal(db, p, proposal_id)
