"""Background engines. The same sweeps an administrator can run by hand run on a timer, so reminders, overdue states and retention do not depend on someone clicking a button.
Each job gets its own session and transaction and a failure in one never stops the others. With several API instances only one runs a given job at a time (a PostgreSQL
transaction-level advisory lock); on SQLite (tests) there is a single process, so no lock is needed."""
import logging
import threading

from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_session_factory

log = logging.getLogger("app.scheduler")
LOCK_KEYS = {"tasks": 71001, "invoices": 71002, "contracts": 71003, "proposals": 71004, "documents": 71005, "reminders": 71006, "automation": 71007}


def _tasks(db):
    from app.services import tasks

    return tasks.run_engine(db)


def _invoices(db):
    from app.services import billing

    return {"overdue": billing.refresh_overdue(db)}


def _contracts(db):
    from app.services import operations

    return {"changed": operations.refresh_contract_statuses(db)}


def _proposals(db):
    from app.services import sales_docs

    return sales_docs.proposal_expire_sweep(db)


def _documents(db):
    from app.services import documents

    return {"purged": documents.purge_expired(db)}


def _reminders(db):
    from app.services import reminders

    return reminders.run(db)


def _automation(db):
    from app.services import automation

    return automation.sweep(db)


JOBS = {"tasks": _tasks, "invoices": _invoices, "contracts": _contracts, "proposals": _proposals, "documents": _documents, "reminders": _reminders, "automation": _automation}


def run_once() -> dict:
    """Runs every job once; returns each job's result (or its error name)."""
    results: dict = {}
    for name, job in JOBS.items():
        try:
            with get_session_factory()() as db:
                if db.get_bind().dialect.name == "postgresql" and not db.execute(text("select pg_try_advisory_xact_lock(:k)"), {"k": LOCK_KEYS[name]}).scalar():
                    results[name] = "skipped (another instance is running it)"
                    continue
                results[name] = job(db)
                db.commit()
        except Exception as exc:  # noqa: BLE001  - one failing sweep must not stop the rest
            log.exception("scheduler job %s failed", name)
            results[name] = f"error: {type(exc).__name__}"
    return results


class Scheduler:
    def __init__(self, interval: int):
        self.interval = max(30, interval)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="crm-scheduler", daemon=True)
            self._thread.start()
            log.info("scheduler started (every %ss)", self.interval)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        if self._stop.wait(15):  # let the app finish starting
            return
        while not self._stop.is_set():
            run_once()
            self._stop.wait(self.interval)


def maybe_start() -> Scheduler | None:
    s = get_settings()
    if not s.scheduler_enabled or s.is_test or not s.database_configured:
        return None
    sched = Scheduler(s.scheduler_interval_seconds)
    sched.start()
    return sched
