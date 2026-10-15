from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.db.session import get_db
from app.services import helpdesk as svc

router = APIRouter(tags=["Helpdesk"])


@router.post("/tickets/{ticket_id}/messages", status_code=201, summary="Record a reply to the customer (kind=reply) or an internal note (kind=note) on a ticket")
def add_message(ticket_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Helpdesk / Tickets", "edit")), db: Session = Depends(get_db)):
    return svc.add_message(db, p, ticket_id, payload)
