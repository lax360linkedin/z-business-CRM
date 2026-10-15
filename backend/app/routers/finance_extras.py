from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.db.session import get_db
from app.services import finance_extras as svc

router = APIRouter(tags=["Finance settings and exports"])
CSV = "text/csv; charset=utf-8"


@router.get("/invoices/config", summary="Invoice settings, your capabilities and the payment methods")
def invoice_config(p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    return svc.invoice_config_payload(db, p)


@router.put("/invoices/config", summary="Change invoice settings (finance administrators)")
def put_invoice_config(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    return svc.put_invoice_config(db, p, payload)


@router.get("/invoices/eligible-orders", summary="Sales orders that can still be invoiced")
def eligible_orders(p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    return svc.eligible_orders(db, p)


@router.get("/invoices/export", summary="CSV of the invoices you can see")
def export_invoices(request: Request, p: Principal = Depends(require("Invoices", "view")), db: Session = Depends(get_db)):
    return PlainTextResponse(svc.export_invoices(db, p, dict(request.query_params)), media_type=CSV, headers={"Content-Disposition": "attachment; filename=invoices.csv"})


@router.get("/payments/config", summary="Payment methods, accounts and your capabilities")
def payment_config(p: Principal = Depends(require("Payments", "view")), db: Session = Depends(get_db)):
    return svc.payment_config_payload(db, p)


@router.get("/payments/export", summary="CSV of the payments you can see")
def export_payments(request: Request, p: Principal = Depends(require("Payments", "view")), db: Session = Depends(get_db)):
    return PlainTextResponse(svc.export_payments(db, p, dict(request.query_params)), media_type=CSV, headers={"Content-Disposition": "attachment; filename=payments.csv"})


@router.get("/expenses/export", summary="CSV of the expenses you can see")
def export_expenses(request: Request, p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return PlainTextResponse(svc.export_expenses(db, p, dict(request.query_params)), media_type=CSV, headers={"Content-Disposition": "attachment; filename=expenses.csv"})
