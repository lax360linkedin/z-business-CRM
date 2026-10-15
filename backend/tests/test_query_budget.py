"""Round trips to the database are what a request costs on a hosted PostgreSQL (hundreds of milliseconds each from far away), so the hot paths have a fixed budget of statements.
A new query on one of these paths has to be a conscious decision: raise the number here only when the extra statement is worth it."""
import pytest
from sqlalchemy import event

from app.db.session import get_engine
from tests.conftest import PASSWORD, ROOT_EMAIL, ROOT_PASSWORD, headers_of, login, make_account

API = "/api/v1"


class Counter:
    def __init__(self):
        self.statements: list[str] = []

    def __enter__(self):
        event.listen(get_engine(), "before_cursor_execute", self._hook)
        return self

    def __exit__(self, *exc):
        event.remove(get_engine(), "before_cursor_execute", self._hook)

    def _hook(self, _conn, _cursor, statement, *_a):
        self.statements.append(statement.strip().split("\n")[0][:110])

    @property
    def n(self) -> int:
        return len(self.statements)


@pytest.fixture
def staff(client, sa):
    make_account(client, sa, first="Sam", last="Seller", level="Employee", role="Sales Manager", branch="Salem", username="sam.seller")
    return headers_of(login(client, "sam.seller", PASSWORD))


def spent(client, method, path, headers, **kw):
    with Counter() as c:
        r = getattr(client, method)(f"{API}{path}", headers=headers, **kw)
    assert r.status_code == 200, (path, r.text[:200])
    return c


BUDGET = {"/auth/me": 1, "/directory/people": 2, "/directory/departments": 2, "/notifications?all=true": 2, "/lead-sources/options": 2, "/leads?all=true": 2, "/enquiries?all=true": 2, "/deals?all=true": 2,
          "/customers?all=true": 2, "/reports/monthly-performance": 6}


def test_hot_paths_stay_within_their_statement_budget(client, sa, staff):
    """Who-is-calling costs ONE statement (session + account in a single query; settings, role templates and the branch list come from the in-process cache), so a plain list is two."""
    for label, headers in (("super admin", sa), ("branch user", staff)):
        spent(client, "get", "/auth/me", headers)  # warm the configuration cache, as any real session does
        for path, limit in BUDGET.items():
            c = spent(client, "get", path, headers)
            assert c.n <= limit, f"{label} {path}: {c.n} statements (budget {limit})\n" + "\n".join(c.statements)


def test_configuration_changes_are_seen_at_once(client, sa, staff):
    """The cache never serves a stale answer after a change made through this process: a deactivated branch ends its people's sessions on their very next request."""
    assert client.get(f"{API}/leads", headers=staff).status_code == 200  # cached: the branch is Active
    branches = client.get(f"{API}/branches", headers=sa).json()
    salem = next(b for b in branches if b["name"] == "Salem")
    assert client.put(f"{API}/branches/{salem['id']}", json={"status": "Inactive"}, headers=sa).status_code in (200, 409, 422)
    after = client.get(f"{API}/leads", headers=staff)
    assert after.status_code in (200, 401, 403)  # whatever the branch rules say, the answer must match a fresh read, never an old cached one
    fresh = client.get(f"{API}/auth/branches").json()
    assert ("Salem" in {b["name"] for b in fresh}) == (after.status_code == 200)
