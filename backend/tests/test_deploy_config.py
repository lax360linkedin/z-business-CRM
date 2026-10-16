"""Deployment configuration: the browser origins are normalised (a pasted trailing slash must not break CORS) and /health says WHY a setting is unusable - never its value."""
from app.core.config import Settings
from tests.conftest import ROOT_EMAIL  # noqa: F401  (imported so the test database fixtures are active)


def test_cors_origins_are_normalised(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", ' "https://z-business-crm.vercel.app/" , http://localhost:5173/ ,, ')
    assert Settings(_env_file=None).cors_origins == ["https://z-business-crm.vercel.app", "http://localhost:5173"]


def test_problems_explain_the_reason_without_leaking_values(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "short-secret-value")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("SUPABASE_URL", "https://YOUR_PROJECT.supabase.co")
    problems = Settings(_env_file=None).configuration_problems()
    assert problems["JWT_SECRET_KEY"].startswith("too short") and problems["DATABASE_URL"] == "not set" and problems["SUPABASE_URL"] == "still a placeholder"
    assert "short-secret-value" not in str(problems) and "YOUR_PROJECT" not in str(problems)


def test_health_reports_configuration_state_publicly(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and "problems" in body and isinstance(body["cors_origins"], list)
    assert all(isinstance(reason, str) for reason in body["problems"].values())
