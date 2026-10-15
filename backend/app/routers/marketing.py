from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal
from app.db.session import get_db
from app.core.errors import not_found
from app.services import lead_sources, marketing as svc

router = APIRouter(tags=["Marketing"])


@router.get("/marketing/config", summary="Marketing permissions, statuses, types and sources")
def config(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.config_payload(db, p)


@router.get("/marketing/analytics", summary="Funnel, spend, ROI and trends computed from the real CRM records")
def analytics(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.analytics(db, p, dict(request.query_params))


@router.get("/marketing/export", summary="CSV export of campaign or source results")
def export(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return PlainTextResponse(svc.export_csv(db, p, dict(request.query_params)), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=marketing.csv"})


# ---- lead sources (the React app calls them /lead-sources) -----------------------------------------------------------------
@router.get("/lead-sources")
def list_sources(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.list_sources(db, p, dict(request.query_params))


@router.get("/lead-sources/options", summary="The active lead sources this person can choose from (shared + their branch)")
def source_options(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.source_options(db, p)


@router.get("/lead-sources/categories", summary="The categories a source can have")
def source_categories(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not (svc.perms_of(p)["viewSources"] or p.can("Leads", "view") or p.can("Enquiries", "view")):
        svc.denied(db, p, "Lead source categories", "You do not have access to lead sources.")
    return {"categories": lead_sources.categories(db)}


@router.post("/lead-sources/categories", status_code=201, summary="Add a source category (no code change needed)")
def add_source_category(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"categories": lead_sources.add_category(db, p, payload.get("name"))}


@router.post("/lead-sources", status_code=201)
def create_source(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.create_source(db, p, payload)


@router.get("/lead-sources/{source_id}")
def get_source(source_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.get_source(db, p, source_id)


@router.put("/lead-sources/{source_id}")
def update_source(source_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.update_source(db, p, source_id, payload)


@router.delete("/lead-sources/{source_id}")
def delete_source(source_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.delete_source(db, p, source_id)


# ---- integration mappings: metadata only; "Connected" / "Error" are reported by the Integrations module, never typed here -----------------------
@router.get("/lead-sources/{source_id}/integrations")
def source_integrations(source_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not svc.perms_of(p)["viewSources"]:
        svc.denied(db, p, "Lead source integrations", "You do not have access to lead sources.")
    if svc.find_source(db, source_id) is None:
        raise not_found("Lead source not found.")
    return [lead_sources.integration_json(i) for i in lead_sources.integrations_of(db, source_id)]


@router.post("/lead-sources/{source_id}/integrations", status_code=201)
def add_mapping(source_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return lead_sources.add_mapping(db, p, source_id, payload)


@router.put("/lead-sources/{source_id}/integrations/{mapping_id}")
def update_mapping(source_id: str, mapping_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return lead_sources.update_mapping(db, p, source_id, mapping_id, payload)


@router.delete("/lead-sources/{source_id}/integrations/{mapping_id}")
def remove_mapping(source_id: str, mapping_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return lead_sources.remove_mapping(db, p, source_id, mapping_id)


# ---- campaigns ------------------------------------------------------------------------------------------------------------
@router.get("/campaigns")
def list_campaigns(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.list_campaigns(db, p, dict(request.query_params))


@router.post("/campaigns", status_code=201)
def create_campaign(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.create_campaign(db, p, payload)


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.get_campaign(db, p, campaign_id)


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.update_campaign(db, p, campaign_id, payload)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.delete_campaign(db, p, campaign_id)


def _action(kind: str):
    def handler(campaign_id: str, payload: dict[str, Any] = Body(default={}), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
        return svc.transition(db, p, campaign_id, kind, payload)

    router.post(f"/campaigns/{{campaign_id}}/{kind}", summary=f"{kind.capitalize()} the campaign")(handler)


for _kind in ("schedule", "start", "pause", "resume", "complete", "cancel"):
    _action(_kind)


@router.post("/campaigns/{campaign_id}/spend")
def spend(campaign_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.record_spend(db, p, campaign_id, payload)


@router.post("/campaigns/{campaign_id}/attach-lead")
def attach_lead(campaign_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return svc.attach_lead(db, p, campaign_id, payload)
