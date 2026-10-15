"""Create / drop a throw-away schema on the configured database, for rehearsing migrations and integration runs without touching `public`.

    python -m scripts.scratch_schema create itest_ab12cd
    python -m scripts.scratch_schema drop itest_ab12cd
"""
import re
import sys

from sqlalchemy import text

from app.db.session import get_engine


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("create", "drop") or not re.fullmatch(r"itest_[a-z0-9]{4,12}", argv[1]):
        print("usage: python -m scripts.scratch_schema create|drop itest_<4-12 lowercase letters/digits>")
        return 2
    action, name = argv
    with get_engine().begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{name}"' if action == "create" else f'DROP SCHEMA IF EXISTS "{name}" CASCADE'))
    print(f"{action}d schema {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
