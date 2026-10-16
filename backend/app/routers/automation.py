"""n8n workflow automation (see services/automation.py). Administrators see runs of their branch; the Super Admin configures the connection and the workflows. The callback is called by n8n,
not by a signed-in person: it is authenticated by the shared secret instead."""
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, current_principal, require
from app.db.session import get_db
from app.services import automation, insights

router = APIRouter(tags=["Automation"])


@router.get("/insights", summary="AI Insights: prioritised findings, KPIs and chart data for the caller's branch and record scope")
def get_insights(p: Principal = Depends(require("AI Insights", "view")), db: Session = Depends(get_db)):
    data = insights.compute(db, p)
    st = automation.state(db)
    on = bool(st["cfg"].get("enabled")) and p.level in ("Super Admin", "Admin")  # which workflows are waiting for an insight (so the screen can offer "Send to n8n")
    for i in data["insights"]:
        i["workflows"] = [{"id": w["id"], "name": w["name"]} for w in st["workflows"] if on and w.get("enabled") and w["event"] == i["automation"]] if i["automation"] else []
    return data


@router.get("/automation/overview", summary="Connection state, workflows, event list and the last 24 hours of runs (administrators)")
def overview(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.overview(db, p)


@router.put("/automation/config", summary="Change the n8n connection (Super Admin)")
def put_config(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.put_config(db, p, payload)


@router.post("/automation/test-connection", summary="Check that n8n answers (Super Admin)")
def test_connection(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.test_connection(db, p)


@router.get("/automation/workflows", summary="Workflows (administrators)")
def workflows(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.list_workflows(db, p)


@router.post("/automation/workflows", status_code=201, summary="Add a workflow (Super Admin)")
def add_workflow(payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.create_workflow(db, p, payload)


@router.put("/automation/workflows/{workflow_id}", summary="Change a workflow (Super Admin)")
def change_workflow(workflow_id: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.update_workflow(db, p, workflow_id, payload)


@router.delete("/automation/workflows/{workflow_id}", summary="Delete a workflow; its past runs stay as history (Super Admin)")
def remove_workflow(workflow_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.delete_workflow(db, p, workflow_id)


@router.post("/automation/workflows/{workflow_id}/test", summary="Send a test message to a workflow (administrators)")
def test_workflow(workflow_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.run_manually(db, p, workflow_id)


@router.get("/automation/runs", summary="Run history (status, workflowId, page, pageSize)")
def runs(request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.list_runs(db, p, dict(request.query_params))


@router.post("/automation/runs/{run_id}/retry", summary="Send a failed run again")
def retry(run_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.retry_run(db, p, run_id)


@router.post("/automation/insights/{key}/run", summary="Send an AI Insight to a workflow that listens to it")
def run_insight(key: str, payload: dict[str, Any] = Body(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return automation.run_insight(db, p, key, str(payload.get("workflowId", "")))


@router.post("/automation/callback", summary="n8n reports how a run ended (authenticated with the shared secret)")
def callback(request: Request, payload: dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    return automation.callback(db, request.headers, payload)
