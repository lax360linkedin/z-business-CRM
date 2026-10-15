"""Router factory: GET list / GET one / POST / PUT / DELETE for a module spec, each behind the module's permission."""
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.db.session import get_db
from app.services import records
from app.services.records import ModuleSpec


def make_router(spec: ModuleSpec) -> APIRouter:
    router = APIRouter(prefix=f"/{spec.key}", tags=[spec.label])

    def need(action: str):
        return current_principal if action in spec.open_actions else require(spec.label, action)

    @router.get("", summary=f"List {spec.label}", description="Query: page, pageSize (default 10, max 200), all=true (everything as an array), q (search), sort, order, and any column name as an exact filter (comma = any of).")
    def list_(request: Request, p: Principal = Depends(need("view")), db: Session = Depends(get_db)):
        return records.list_records(db, spec, p, dict(request.query_params))

    @router.get("/{record_id}", summary=f"One {spec.label.rstrip('s')}")
    def get_(record_id: str, p: Principal = Depends(need("view")), db: Session = Depends(get_db)):
        return records.get_record(db, spec, p, record_id)

    @router.post("", status_code=201, summary=f"Create {spec.label.rstrip('s')}")
    def create_(payload: dict[str, Any] = Body(...), p: Principal = Depends(need("create")), db: Session = Depends(get_db)):
        return records.create_record(db, spec, p, payload)

    @router.put("/{record_id}", summary=f"Update {spec.label.rstrip('s')} (only the fields sent change)")
    def update_(record_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(need("edit")), db: Session = Depends(get_db)):
        return records.update_record(db, spec, p, record_id, payload)

    @router.delete("/{record_id}", summary=f"Delete {spec.label.rstrip('s')}")
    def delete_(record_id: str, p: Principal = Depends(need("delete")), db: Session = Depends(get_db)):
        return records.delete_record(db, spec, p, record_id)

    return router
