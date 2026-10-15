import os

# Settings must be in place before the app (and its engine) is imported. The suite never reads backend/.env's database or secrets.
import tempfile  # noqa: E402

# a file in the system temp folder (not in OneDrive: file syncing makes SQLite crawl)
TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "sqlite:///" + os.path.join(tempfile.gettempdir(), "crm_backend_test.db").replace("\\", "/"))
if "supabase" in TEST_DB_URL.lower():  # the suite DROPS and rebuilds the schema: it must never point at a real project
    raise RuntimeError("TEST_DATABASE_URL must be a disposable database, never Supabase.")
os.environ.update(
    APP_ENV="test", DEBUG="true", DATABASE_URL=TEST_DB_URL, JWT_SECRET_KEY="test-secret-test-secret-test-secret-123456", SUPABASE_URL="", SUPABASE_ANON_KEY="",
    SUPABASE_SERVICE_ROLE_KEY="", CORS_ORIGINS="http://localhost:5178", SCHEDULER_ENABLED="false", SUPERADMIN_EMAIL="root@lax360.com", SUPERADMIN_PASSWORD="Root@Pass123",
    SUPERADMIN_NAME="Root Admin", MAX_FAILED_LOGINS="5", LOCKOUT_MINUTES="15", ACCESS_TOKEN_EXPIRE_MINUTES="60",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pwdlib import PasswordHash  # noqa: E402
from pwdlib.hashers.argon2 import Argon2Hasher  # noqa: E402

from app.core import security  # noqa: E402

security._hasher = PasswordHash((Argon2Hasher(time_cost=1, memory_cost=8, parallelism=1),))  # cheap hashing for the test run only
import app.services.auth_service as auth_service  # noqa: E402

auth_service._DUMMY_HASH = security.hash_password("not-a-real-password-Aa1!")

from app.db.base import Base  # noqa: E402
from app.db.session import get_engine, get_session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app import models as _models  # noqa: E402,F401
from app.services.seed import seed_reference_data, seed_super_admin  # noqa: E402

ROOT_EMAIL, ROOT_PASSWORD = "root@lax360.com", "Root@Pass123"
PASSWORD = "Test@Pass123"


@pytest.fixture(scope="session", autouse=True)
def schema():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def fresh_db(schema):
    """Every test starts from the seeded reference data + the Super Admin only: rows are cleared, the schema is built once per run."""
    engine = get_engine()
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            for table in Base.metadata.tables.values():
                conn.execute(table.delete())
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        else:
            names = ", ".join(f'"{t}"' for t in Base.metadata.tables)
            conn.exec_driver_sql(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    from app.core import config_cache

    config_cache.clear()  # the rows were just wiped: nothing remembered from the previous test may survive
    with get_session_factory()() as db:
        seed_reference_data(db)
        seed_super_admin(db, email=ROOT_EMAIL, name="Root Admin", password=ROOT_PASSWORD)
        db.commit()
    yield


@pytest.fixture
def client():
    return TestClient(app)


def login(client, identifier, password=PASSWORD, branch=None, expect=200):
    body = {"identifier": identifier, "password": password}
    if branch is not None:
        body["branch"] = branch
    r = client.post("/api/v1/auth/login", json=body)
    assert r.status_code == expect, r.text
    return r


def headers_of(response, scope=None):
    h = {"Authorization": "Bearer " + response.json()["tokens"]["accessToken"]}
    if scope:
        h["X-Branch-Scope"] = scope
    return h


@pytest.fixture
def sa(client):
    """Super Admin headers (all branches)."""
    return headers_of(login(client, ROOT_EMAIL, ROOT_PASSWORD))


def make_account(client, sa_headers, *, first="Test", last="User", level="Employee", branch="Salem", role="Employee", permissions=None, username=None, password=PASSWORD, **extra):
    username = username or f"{first}.{last}".lower()
    body = {"firstName": first, "lastName": last, "email": f"{username}@lax360.com", "username": username, "password": password, "accessLevel": level, "role": role,
            "branch": branch, "department": "Sales", "forcePasswordChange": False, **extra}
    if permissions is not None:
        body["permissions"] = permissions
    r = client.post("/api/v1/userAccounts", json=body, headers=sa_headers)
    assert r.status_code == 201, r.text
    return r.json()


FULL = {"view": True, "create": True, "edit": True, "delete": True, "export": True}


def perms(**modules):
    """A permission set granting full access to the named modules (underscores stand for spaces: Sales_Orders)."""
    return {name.replace("_", " "): dict(FULL if grant is True else grant) for name, grant in modules.items()}


@pytest.fixture
def salem_admin(client, sa):
    make_account(client, sa, first="Priya", last="Salem", level="Admin", branch="Salem", username="priya.salem")
    return headers_of(login(client, "priya.salem"))


@pytest.fixture
def mumbai_admin(client, sa):
    make_account(client, sa, first="Vikram", last="Mumbai", level="Admin", branch="Mumbai", username="vikram.mumbai")
    return headers_of(login(client, "vikram.mumbai"))
