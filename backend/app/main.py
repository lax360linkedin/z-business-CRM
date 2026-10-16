"""FastAPI application factory."""
import logging
import time
import uuid

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.core.config import get_settings
from app.core.errors import install_handlers, unhandled_response
from app.routers import api_router, health
from app.services import scheduler

log = logging.getLogger("app")


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        problems = settings.configuration_problems()
        if problems:  # visible in the host's log from the first second, instead of surfacing later as an opaque 500 on sign-in
            log.error("CONFIGURATION INCOMPLETE - sign-in cannot work until these environment variables are fixed: %s", "; ".join(f"{k} ({v})" for k, v in problems.items()))
        log.info("environment=%s, allowed browser origins=%s", settings.app_env, ", ".join(settings.cors_origins))
        sched = scheduler.maybe_start()
        yield
        if sched is not None:
            sched.stop()

    app = FastAPI(
        lifespan=lifespan,
        title=settings.app_name,
        version="1.0.0",
        description="FastAPI + SQLAlchemy 2 + Supabase PostgreSQL. Authentication, permissions and branch isolation are enforced here, not in the browser.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)  # record lists are large, repetitive JSON: a fraction of the bytes over the wire
    install_handlers(app)

    @app.middleware("http")
    async def _headers_and_log(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # an unanticipated error: answered here, INSIDE the CORS layer below, so the browser can read it instead of reporting a network failure
            response = unhandled_response()
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if "cache-control" not in response.headers:  # API answers are never cached - except what a route deliberately marks (the versioned company logo)
            response.headers["Cache-Control"] = "no-store"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        log.info("%s %s -> %s %.0fms rid=%s", request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000, rid)
        return response

    # Registered last = outermost (Starlette wraps in reverse order): a browser's OPTIONS preflight is answered here before any other layer sees it, and every response - errors included - carries the CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # tokens travel in the Authorization header, never in cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-Branch-Scope", "X-Device-Id"],
        expose_headers=["X-Request-ID", "X-File-Name", "X-File-Version", "Content-Disposition"],
        max_age=600,
    )

    app.include_router(health.router)
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
