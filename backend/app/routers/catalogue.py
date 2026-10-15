from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.db.session import get_db
from app.services import catalogue

router = APIRouter(tags=["Products & Services"])


@router.get("/products/categories", summary="The categories a product / service can have")
def product_categories(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    # anyone who can pick a product anywhere (lead, enquiry, deal, quotation ...) needs the list; the catalogue itself is not branch data
    return {"categories": catalogue.categories(db)}


@router.post("/products/categories", status_code=201, summary="Add a category (no code change needed)")
def add_product_category(payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Products & Services", "create")), db: Session = Depends(get_db)):
    return {"categories": catalogue.add_category(db, p, payload.get("name"))}


@router.put("/products/categories/{name}", summary="Rename a category (carried to every product that has it)")
def rename_product_category(name: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(require("Products & Services", "edit")), db: Session = Depends(get_db)):
    return {"categories": catalogue.rename_category(db, p, name, payload.get("name"))}


@router.delete("/products/categories/{name}", summary="Delete a category (products using it are moved to `moveTo`)")
def delete_product_category(name: str, moveTo: str | None = None, p: Principal = Depends(require("Products & Services", "delete")), db: Session = Depends(get_db)):
    return {"categories": catalogue.delete_category(db, p, name, moveTo)}


@router.get("/products/{product_id}/usage", summary="How many records and documents use this product (every branch)")
def product_usage(product_id: str, p: Principal = Depends(require("Products & Services", "view")), db: Session = Depends(get_db)):
    return catalogue.usage(db, product_id)
