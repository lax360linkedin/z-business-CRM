"""Starts a disposable local PostgreSQL (pgserver) for running the test-suite and migrations against a real PostgreSQL. Data lives OUTSIDE OneDrive (file locks stall PostgreSQL).

    python -m scripts.dev_postgres            # prints the connection URL and keeps the server up until Ctrl+C
Then:  TEST_DATABASE_URL=<url> python -m pytest
"""
import pathlib
import signal
import sys
import time

import pgserver


def main() -> int:
    data = pathlib.Path.home() / ".crm_pg_test"
    server = pgserver.get_server(data, cleanup_mode=None)
    uri = server.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
    print(uri, flush=True)
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    sys.exit(main())
