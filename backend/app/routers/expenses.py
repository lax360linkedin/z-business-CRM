from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, require
from app.db.session import get_db
from app.services import expenses as svc
from app.services import records
from app.services.modules import SPEC_BY_KEY

router = APIRouter(prefix="/expenses", tags=["Expenses"])


@router.get("/config", summary="Expense settings, categories, caps and your permissions")
def get_config(p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.get_config_payload(db, p)


@router.put("/config", summary="Change expense settings (finance administrators)")
def put_config(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.put_config(db, p, payload)


# categories live under /expenses/categories in the UI; they are served by the record engine
@router.post("/categories", status_code=201)
def create_category(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return records.create_record(db, SPEC_BY_KEY["expenseCategories"], p, payload)


@router.put("/categories/{category_id}")
def update_category(category_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return records.update_record(db, SPEC_BY_KEY["expenseCategories"], p, category_id, payload)


@router.delete("/categories/{category_id}")
def delete_category(category_id: str, p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return records.delete_record(db, SPEC_BY_KEY["expenseCategories"], p, category_id)


@router.get("")
def list_(request: Request, p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.list_expenses(db, p, dict(request.query_params))


@router.post("", status_code=201)
def create(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.create_expense(db, p, payload)


@router.get("/{expense_id}")
def get_(expense_id: str, p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.public(db, p, svc.get_expense(db, p, expense_id), detail=True)


@router.put("/{expense_id}")
def update(expense_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.update_expense(db, p, expense_id, payload)


def _transition(kind: str):
    def handler(expense_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
        return svc.transition(db, p, expense_id, kind, payload)

    router.post(f"/{{expense_id}}/{kind}")(handler)


for _kind in ("submit", "withdraw", "review", "approve", "reject", "revise", "cancel"):
    _transition(_kind)


@router.post("/{expense_id}/pay")
def pay(expense_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.pay(db, p, expense_id, False, payload)


@router.post("/{expense_id}/reimburse")
def reimburse(expense_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.pay(db, p, expense_id, True, payload)


@router.delete("/{expense_id}")
def delete(expense_id: str, p: Principal = Depends(require("Expenses", "view")), db: Session = Depends(get_db)):
    return svc.delete_draft(db, p, expense_id)
