"""CRM conversion actions (each runs as one transaction on the server)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.core.errors import forbidden
from app.db.session import get_db
from app.services import crm_flow

router = APIRouter(tags=["CRM workflow"])


@router.post("/enquiries/{enquiry_id}/convert", summary="Convert a Qualified enquiry into a Lead (creates / links Company and Contact)")
def convert_enquiry(enquiry_id: str, p: Principal = Depends(require("Enquiries", "edit")), db: Session = Depends(get_db)):
    if not p.can("Leads", "create"):
        raise forbidden("You need permission to create leads to convert an enquiry.")
    return crm_flow.convert_enquiry(db, p, enquiry_id)


@router.post("/leads/{lead_id}/convert", summary="Convert a Qualified lead into a Deal (creates / links Company, Contact and Customer)")
def convert_lead(lead_id: str, p: Principal = Depends(require("Leads", "edit")), db: Session = Depends(get_db)):
    if not p.can("Deals", "create"):
        raise forbidden("You need permission to create deals to convert a lead.")
    return crm_flow.convert_lead(db, p, lead_id)
