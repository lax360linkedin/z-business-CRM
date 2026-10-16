from datetime import UTC, date, datetime, timedelta

from tests.conftest import headers_of, login, make_account

API = "/api/v1"


def test_the_timer_runs_every_engine_and_isolates_failures(client, sa, monkeypatch):
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.models import Document
    from app.services import scheduler

    make_account(client, sa, first="Dee", last="Doc", level="Admin", branch="Salem", username="dee.doc")
    h = headers_of(login(client, "dee.doc"))
    import io

    pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
    d = client.post(f"{API}/documents", files={"file": ("old.pdf", io.BytesIO(pdf), "application/pdf")}, data={"meta": "{}"}, headers=h).json()
    client.post(f"{API}/documents/{d['id']}/delete", json={}, headers=h)
    with get_session_factory()() as db:
        db.get(Document, d["id"]).purge_after = datetime.now(UTC) - timedelta(days=1)
        db.commit()
    out = scheduler.run_once()
    assert set(out) == {"tasks", "invoices", "contracts", "proposals", "documents", "reminders", "automation"} and out["documents"] == {"purged": 1}
    with get_session_factory()() as db:
        assert db.execute(select(Document)).first() is None
    monkeypatch.setitem(scheduler.JOBS, "invoices", lambda db: 1 / 0)
    broken = scheduler.run_once()
    assert broken["invoices"] == "error: ZeroDivisionError" and broken["documents"] == {"purged": 0} and isinstance(broken["tasks"], dict)
    assert date.today()
