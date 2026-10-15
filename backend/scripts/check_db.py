"""Verify the configured database connection without ever printing credentials.

    python -m scripts.check_db
"""
import sys

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine


def main() -> int:
    settings = get_settings()
    if not settings.database_configured:
        print("DATABASE_URL is not configured.")
        return 2
    secrets = [settings.database_url, settings.sqlalchemy_url]
    try:
        with get_engine().connect() as conn:
            version = conn.execute(text("select version()")).scalar_one()
            database, user = conn.execute(text("select current_database(), current_user")).one()
            tables = [r[0] for r in conn.execute(text("select table_name from information_schema.tables where table_schema = 'public' order by 1"))]
        print(f"connected: {version.split(',')[0]}")
        print(f"database={database} user={user.split('.')[0]}.***")
        print(f"public tables ({len(tables)}): {', '.join(tables) if tables else '(none)'}")
        return 0
    except Exception as exc:  # report the failure class and a scrubbed message only
        message = str(exc)
        for secret in secrets:
            message = message.replace(secret, "***")
        print(f"CONNECTION FAILED: {type(exc).__name__}: {message[:400]}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
