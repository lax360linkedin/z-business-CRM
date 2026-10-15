"""Alembic environment: connection string comes from settings (DATABASE_URL), metadata from the app's models.

DB_SEARCH_PATH (a schema name) lets a migration be rehearsed inside a throw-away schema instead of `public`."""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, event, pool

from app.core.config import get_settings
from app.db.base import Base, UTCDateTime
from app import models as _models  # noqa: F401  (importing the package registers every model on Base.metadata)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
if not settings.database_configured:
    raise SystemExit("DATABASE_URL is not configured. Fill in backend/.env before running migrations.")
# `%` must be doubled for ConfigParser interpolation
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url.replace("%", "%%"))

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    """Custom column types are written as their plain SQLAlchemy equivalent so migrations never import application code."""
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False


def run_migrations_offline() -> None:
    context.configure(url=settings.sqlalchemy_url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, compare_type=True, render_item=render_item)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool, connect_args={"prepare_threshold": None})
    search_path = os.environ.get("DB_SEARCH_PATH")
    if search_path:

        @event.listens_for(connectable, "connect")
        def _set_search_path(dbapi_conn, _):
            previous = dbapi_conn.autocommit
            dbapi_conn.autocommit = True
            dbapi_conn.execute(f'SET search_path TO "{search_path}"')
            dbapi_conn.autocommit = previous

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_item=render_item)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
