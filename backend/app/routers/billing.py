from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.core.errors import forbidden
from app.db.session import get_db
from app.services import billing, records
from app.services.modules import SPEC_BY_KEY

router = APIRouter(tags=["Billing"])


# ---- invoices -----------------------------------------------------------------------------------------------------------------
@router.get("/invoices", summary="List invoices (status is derived from real payments and the due date)")
def list_invoices(request: Request, p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    if billing.refresh_overdue(db):
        db.commit()
    return records.list_records(db, SPEC_BY_KEY["invoices"], p, dict(request.query_params))


@router.post("/invoices/engine/run", summary="Sweep: issued invoices past their due date become Overdue")
def invoice_engine(p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    if p.level not in ("Super Admin", "Admin"):
        raise forbidden("Only an administrator can run the invoice engine.")
    changed = billing.refresh_overdue(db)
    db.commit()
    return {"overdue": changed}


@router.get("/invoices/{invoice_id}", summary="One invoice with its payments and timeline")
def get_invoice(invoice_id: str, p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    inv = billing.get_invoice(db, p, invoice_id)
    return billing.invoice_json(db, p, inv, detail=True)


@router.post("/invoices", status_code=201, summary="Create an invoice (computed server-side)")
def create_invoice(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Invoices", "create")), db: Session = Depends(get_db)):
    return billing.create_invoice(db, p, payload)


@router.post("/salesOrders/{so_id}/invoice", status_code=201, summary="Invoice a sales order")
def invoice_from_so(so_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Invoices", "create")), db: Session = Depends(get_db)):
    return billing.invoice_from_sales_order(db, p, so_id, payload)


@router.put("/invoices/{invoice_id}")
def edit_invoice(invoice_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Invoices", "edit")), db: Session = Depends(get_db)):
    return billing.edit_invoice(db, p, invoice_id, payload)


def _invoice_action(name: str):
    def handler(invoice_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
        return billing.invoice_action(db, p, invoice_id, name, payload)

    router.post(f"/invoices/{{invoice_id}}/{name}")(handler)


for _action in ("send", "viewed", "cancel", "void", "duplicate", "refresh"):
    _invoice_action(_action)


@router.delete("/invoices/{invoice_id}", summary="Delete a draft invoice")
def delete_invoice(invoice_id: str, p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    return billing.delete_draft(db, p, invoice_id)


# ---- payments -----------------------------------------------------------------------------------------------------------------
@router.post("/payments", status_code=201, summary="Record a payment against an invoice")
def create_payment(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Payments", "create")), db: Session = Depends(get_db)):
    return billing.create_payment(db, p, payload)


@router.post("/invoices/{invoice_id}/payments", status_code=201)
def create_invoice_payment(invoice_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Payments", "create")), db: Session = Depends(get_db)):
    return billing.create_payment(db, p, payload, invoice_id=invoice_id)


@router.put("/payments/{payment_id}")
def update_payment(payment_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Payments", "edit")), db: Session = Depends(get_db)):
    return billing.update_payment(db, p, payment_id, payload)


def _payment_action(name: str):
    def handler(payment_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Payments", "view")), db: Session = Depends(get_db)):
        return billing.payment_action(db, p, payment_id, name, payload)

    router.post(f"/payments/{{payment_id}}/{name}")(handler)


for _action in ("complete", "fail", "cancel", "reverse", "refund"):
    _payment_action(_action)


@router.post("/payments/{payment_id}/receipt", summary="Receipt data for a payment (the PDF is rendered in the browser)")
def receipt(payment_id: str, p: Principal = Depends(require("Payments", "view")), db: Session = Depends(get_db)):
    from sqlalchemy import select

    from app.models import Invoice, Payment
    from app.services.codec import to_json

    pay = db.execute(select(Payment).where(Payment.id == payment_id)).scalar_one_or_none()
    if pay is None:
        from app.core.errors import not_found

        raise not_found("Payment not found.")
    if not {"downloadReceipt", "printReceipt"} & billing.payment_caps(p):
        raise forbidden("You do not have permission to download receipts.")
    inv = db.get(Invoice, pay.invoice_id)
    return {"payment": to_json(pay), "invoice": billing.invoice_json(db, p, inv) if inv else None}


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: str, p: Principal = Depends(require("Payments", "view")), db: Session = Depends(get_db)):
    return billing.delete_payment(db, p, payment_id)
