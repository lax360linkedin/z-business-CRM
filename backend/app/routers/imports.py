"""Spreadsheet imports: the template schema, a no-write check of an uploaded file, and the import itself (see services/imports.py)."""
from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.core.errors import ApiError
from app.db.session import get_db
from app.services import imports, org_admin

router = APIRouter(prefix="/imports", tags=["Imports"])


@router.get("/{module}/schema", summary="The import's columns, required fields and allowed values (what the Excel template is built from)")
def schema(module: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return imports.schema_for(db, p, module)


@router.post("/{module}/preview", summary="Check an uploaded file's rows without saving anything")
def preview(module: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if module == "employees":
        imports.module_of(module)
        status, body = org_admin.import_employees(db, p, {"rows": imports._rows_of(payload, imports.MAX_ROWS), "commit": False})
        return {"module": module, "blocked": None, "total": len(body["rows"]), **body}
    return imports.preview(db, p, module, payload)


@router.post("/{module}/commit", summary="Import the valid rows (leads and enquiries: each valid row, a few at a time; employees: all rows or none)")
def commit(module: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if module == "employees":
        imports.module_of(module)
        try:
            status, body = org_admin.import_employees(db, p, {"rows": imports._rows_of(payload, imports.MAX_ROWS), "commit": True})
        except ApiError:
            raise
        return {"module": module, "created": [{"id": i} for i in body["created"]], "failed": [], "count": body["count"]}
    return imports.commit(db, p, module, payload)
