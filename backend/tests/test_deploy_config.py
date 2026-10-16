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


def test_the_environment_variables_that_decide_production_are_these_exact_names(monkeypatch):
    """What the hosting dashboard must contain: JWT_SECRET_KEY (>= 32 characters), APP_ENV (one of development / staging / production / test), CORS_ORIGINS."""
    monkeypatch.setenv("JWT_SECRET_KEY", "k" * 40)
    monkeypatch.setenv("APP_ENV", "production")
    s = Settings(_env_file=None)
    assert s.jwt_configured and s.is_production and "JWT_SECRET_KEY" not in s.configuration_problems()
    monkeypatch.delenv("APP_ENV")
    monkeypatch.delenv("JWT_SECRET_KEY")
    s = Settings(_env_file=None)
    assert not s.is_production and s.configuration_problems()["JWT_SECRET_KEY"] == "not set"  # exactly what the Render log printed
