import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine

log = logging.getLogger("app.health")
router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness and configuration status (names of unset settings only)")
def health() -> dict:
    settings = get_settings()
    missing = settings.missing_configuration()
    return {"status": "ok", "app": settings.app_name, "environment": settings.app_env, "configured": not missing, "missing_settings": missing, "problems": settings.configuration_problems(),
            "cors_origins": settings.cors_origins}  # names and reasons only - never a secret value; the allowed origins are public by nature


@router.get("/healthz", summary="Readiness: can the API reach its database?")
def healthz():
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # never echo the driver message: it can contain host / user details
        log.error("database health check failed: %s", type(exc).__name__)
        return JSONResponse(status_code=503, content={"status": "database_unavailable", "code": "DATABASE_UNAVAILABLE"})
    return {"status": "ok"}
