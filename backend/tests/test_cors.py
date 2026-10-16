"""CORS for the deployed frontend (https://z-business-crm.vercel.app -> the Render API): the preflight a browser sends before the sign-in POST must succeed with the exact headers the app
uses, other origins and headers must stay refused, errors must still carry the CORS headers (otherwise the browser hides them as a "network error"), and no credentials are enabled."""
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app

PROD = "https://z-business-crm.vercel.app"
LOGIN = "/api/v1/auth/login"
# what the frontend really sends on a request: Content-Type (JSON body), X-Device-Id (sign-in), and once signed in Authorization + X-Branch-Scope
SENT = "authorization,content-type,x-branch-scope,x-device-id"


@pytest.fixture
def production_app(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", PROD)
    get_settings.cache_clear()
    app = create_app()
    app.add_api_route("/__boom", lambda: 1 / 0, methods=["GET"])  # an unanticipated error, to prove even a 500 is readable by the browser
    yield TestClient(app, raise_server_exceptions=False)
    get_settings.cache_clear()


def preflight(client, origin=PROD, method="POST", headers=SENT, path=LOGIN):
    return client.options(path, headers={"Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers})


def test_the_default_allow_list_contains_the_production_frontend(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert PROD in Settings(_env_file=None).cors_origins


def test_the_preflight_for_sign_in_succeeds_with_the_exact_origin(production_app):
    r = preflight(production_app)
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == PROD  # the exact origin, never "*"
    assert "POST" in r.headers["access-control-allow-methods"]
    allowed = {h.strip().lower() for h in r.headers["access-control-allow-headers"].split(",")}
    assert {"content-type", "x-device-id", "authorization", "x-branch-scope"} <= allowed
    assert "access-control-allow-credentials" not in r.headers  # the API uses bearer tokens, not cookies
    assert int(r.headers["access-control-max-age"]) > 0


def test_the_preflight_works_for_every_method_the_app_uses(production_app):
    for method in ("GET", "POST", "PUT", "DELETE", "PATCH"):
        assert preflight(production_app, method=method, path="/api/v1/leads").status_code == 200, method


def test_other_origins_and_unknown_headers_are_still_refused(production_app):
    assert preflight(production_app, origin="https://evil.example").status_code == 400
    assert preflight(production_app, origin="https://z-business-crm.vercel.app.evil.example").status_code == 400  # not a prefix match
    assert preflight(production_app, origin="http://z-business-crm.vercel.app").status_code == 400  # scheme matters
    assert preflight(production_app, headers="content-type,x-evil").status_code == 400


def test_the_answers_to_real_requests_carry_the_cors_headers(production_app):
    wrong = production_app.post(LOGIN, json={"identifier": "nobody@example.invalid", "password": "x"}, headers={"Origin": PROD})
    assert wrong.status_code == 401 and wrong.json()["code"] == "INVALID_CREDENTIALS"
    assert wrong.headers["access-control-allow-origin"] == PROD and "access-control-allow-credentials" not in wrong.headers
    assert "x-request-id" in {k.lower() for k in wrong.headers}


def test_a_server_error_is_readable_by_the_browser_not_a_network_failure(production_app):
    r = production_app.get("/__boom", headers={"Origin": PROD})
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL_ERROR"
    assert r.headers["access-control-allow-origin"] == PROD  # without this header the page would only say "Cannot reach the server"


def test_a_request_from_a_refused_origin_gets_no_cors_header(production_app):
    r = production_app.get("/health", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize("configured", [
    "https://z-business-crm.vercel.app",
    "z-business-crm.vercel.app",  # pasted without its scheme (what the Render dashboard held): would never match the browser's Origin, so the scheme is added
    "https://z-business-crm.vercel.app/",  # trailing slash
    ' "https://z-business-crm.vercel.app" ',  # quotes and spaces
    '["https://z-business-crm.vercel.app"]',  # JSON array form
    "http://localhost:5173, https://z-business-crm.vercel.app",  # several, comma separated
])
def test_every_reasonable_way_of_writing_the_origin_gives_a_working_preflight(monkeypatch, configured):
    monkeypatch.setenv("CORS_ORIGINS", configured)
    get_settings.cache_clear()
    try:
        r = preflight(TestClient(create_app()))
    finally:
        get_settings.cache_clear()
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == PROD


def test_the_400_is_the_cors_layers_own_answer_for_an_origin_that_is_not_listed(monkeypatch):
    """Not a TrustedHost / custom middleware: Starlette's CORSMiddleware answers a preflight from an unlisted origin with 400 and this exact text."""
    monkeypatch.setenv("CORS_ORIGINS", "https://some-other-site.example")
    get_settings.cache_clear()
    try:
        r = preflight(TestClient(create_app()))
    finally:
        get_settings.cache_clear()
    assert r.status_code == 400 and r.text == "Disallowed CORS origin"
