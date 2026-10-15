"""Engine and session factory. Nothing connects at import time: the engine is built on first use from DATABASE_URL.

PostgreSQL (Supabase) in production; SQLite is accepted for the fast automated tests. An optional DB_SEARCH_PATH (a schema name) is applied on every
connection - used by the integration run to work inside a throw-away schema without touching `public`."""
import os
import time
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, event, exc as exc_core
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


def make_engine(url: str | None = None) -> Engine:
    settings = get_settings()
    url = url or settings.sqlalchemy_url
    if not url:
        raise RuntimeError("DATABASE_URL is not configured. Fill in backend/.env first.")
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _):  # SQLite ignores foreign keys unless asked
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine

    # prepare_threshold=None: no automatic server-side prepared statements (they break behind a transaction-mode pooler)
    engine = create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=False,  # replaced by `_ping_if_idle` below: a ping on EVERY checkout is a whole extra round trip per request
        pool_recycle=1800,
        echo=settings.db_echo,
        connect_args={"prepare_threshold": None, "connect_timeout": 15},
    )
    _ping_if_idle(engine)
    search_path = os.environ.get("DB_SEARCH_PATH")
    if search_path:

        @event.listens_for(engine, "connect")
        def _set_search_path(dbapi_conn, _):
            previous = dbapi_conn.autocommit
            dbapi_conn.autocommit = True
            dbapi_conn.execute(f'SET search_path TO "{search_path}"')
            dbapi_conn.autocommit = previous

    return engine


IDLE_PING_SECONDS = 20


def _ping_if_idle(engine: Engine) -> None:
    """A pooled connection that has sat unused may have been closed by the database or its pooler. The safe check is a ping before use - but only for connections idle for a while:
    one that was used a moment ago is alive, and skipping its ping saves a full network round trip on nearly every request. A failed ping makes SQLAlchemy discard the connection
    and open a fresh one, exactly as `pool_pre_ping` would."""

    @event.listens_for(engine, "checkin")
    def _stamp(dbapi_conn, record):
        record.info["last_used"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _check(dbapi_conn, record, proxy):
        if time.monotonic() - record.info.get("last_used", 0.0) < IDLE_PING_SECONDS:
            return
        try:
            cursor = dbapi_conn.cursor()
            cursor.execute("SELECT 1")
            cursor.close()
            dbapi_conn.rollback()
        except Exception as exc:
            raise exc_core.DisconnectionError("stale pooled connection") from exc


@lru_cache
def get_engine() -> Engine:
    return make_engine()


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    from app.db import branch, config_events  # noqa: F401  (register the branch-scoping and configuration-cache hooks on Session)

    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def reset_engine() -> None:
    """Drop cached engine / session factory (tests and the integration run re-point the database)."""
    from app.core import config_cache

    config_cache.clear()
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_session_factory.cache_clear()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Services commit explicitly BEFORE returning (the cleanup after a `yield` runs after the
    response has been sent on current FastAPI, which would let a client's next request overtake the commit)."""
    session = get_session_factory()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
