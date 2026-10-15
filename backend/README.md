# LAX360 Business CRM - backend

Python 3.12+ / FastAPI / SQLAlchemy 2.0 + psycopg 3 / Alembic / Supabase PostgreSQL (Storage for files).

The API serves every CRM module under `/api/v1` (Swagger at `/docs`, health at `/health` and `/healthz`). The React app in `../frontend` talks to it through a real HTTP client; there is no mock layer.

## What the server owns

The browser only sends what a person entered. The server decides and records the rest: ids and numbers, who did what and when, workflow transitions, derived values, notifications, timelines and audit trails.

- **Auth**: access JWT bound to a session, rotating hashed refresh tokens, lockout, forced password change, session list / revoke, password policy (needs a special character).
- **Authorization**: per-module capability tables, record-level data scope (Own / Team), and branch isolation applied to every query (a branch user can never read or write another branch; the Super Admin chooses a branch with `X-Branch-Scope`).
- **Records**: a generic record engine (`services/records.py`, `services/modules.py`) with per-module hooks. Highlights: lead score (`services/lead_score.py`), deal stage history and Closed-Won customer link, quotation -> sales order -> invoice -> payment chain with computed totals, contract lifecycle with approval details and an audit trail written by the server, project timeline, ticket SLA / timeline / conversation (`POST /tickets/{id}/messages`), product price history, enquiry company find-or-create.
- **Files**: Documents module with versions, sharing and audit; bytes in the private Supabase Storage bucket `crm-documents` (or the database when Storage is not configured).
- **Background work**: a scheduler thread (advisory locks) for reminders, contract expiry, overdue sweeps.
- **Not connected**: no e-mail / WhatsApp delivery. Replies and logged messages are recorded, never sent; the screens say so.

## Branches and admins

- **Every login and employee belongs to exactly one branch** (Salem, Mumbai or Bangalore); the branch is mandatory when the Super Admin creates an Admin, an Employee or an employee record (and on every row of an employee import). Only the Super Admin has all-branch access.
- **The server isolates branches.** Every read of branch data is filtered to the caller's branch, new records are stamped with it, and a record can never be linked to another branch's record. Spoofing `X-Branch-Scope` or a `branch` field does not widen a branch user's reach. Teams are branch-owned too (their leader and members must work in that branch); a person moved to another branch loses their old team, manager and the teams they led.
- **Several admins per branch.** A branch is run by two to three Admin logins that share that branch's data and see nothing else. `GET /branches` (Super Admin) returns each branch's admins and a coverage state (`none`, `low`, `ok`, `high`); adding a fourth admin needs an explicit `confirmExtraAdmin`. Only the Super Admin creates logins, resets passwords and changes roles or branches.
- Tests: `tests/test_branch_matrix.py` builds three branches with admins and staff and proves nobody lists, opens, changes, deletes or searches another branch's data.

## Sessions and inactivity

A session ends after `IDLE_TIMEOUT_MINUTES` (default 30; the Super Admin can change it in Settings -> Security, 5 to 480) of **no activity**, and after `SESSION_DAYS` at the latest. Activity is the person typing, clicking, scrolling or returning to the tab: the browser sends a heartbeat (`POST /auth/activity`, at most once a minute). Background polling and token renewals do not count, so an abandoned open tab times out while someone using the CRM never does. The server enforces it on every request and on refresh (`SESSION_IDLE`); the browser shows a one-minute "Stay signed in" warning, then signs out to the login page with the reason and returns the person to the page they were on after they sign in again.

## Lead sources

`GET /lead-sources/options` lists the active sources a person may choose (shared by all branches, plus their own branch's). Leads and enquiries must name a configured, active source available in their branch; the id and name are kept in step, and the source follows the record enquiry -> lead -> deal -> customer. Shared sources (no branch) are managed by the Super Admin; a branch's marketing users manage that branch's own sources. Source results (Lead Sources screen, Marketing analytics, Reports) count only the branch the caller can see.

## Layout

```
backend/
  app/
    main.py            app factory (CORS, error handlers, routers, scheduler lifespan)
    core/              config (pydantic-settings), security, errors, permissions
    db/                Base, engine / session, branch scope, ids / numbers
    models/            SQLAlchemy models
    services/          business rules, one module per area
    routers/           REST endpoints (extra routers are mounted before the generic CRUD routers)
    api/               shared dependencies (principal, permissions)
  alembic/             migrations (RLS on every table, append-only audit trigger)
  scripts/             seed, dev_postgres, dev_api.ps1, scratch_schema
  tests/               pytest + httpx
  .env.example         placeholders only - copy to .env
```

## Run it

Against Supabase (reads `backend/.env`):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
alembic upgrade head
python -m scripts.seed          # first Super Admin from SUPERADMIN_* (password must meet the policy)
python -m scripts.seed --allow-weak-bootstrap   # same, but a .env password that does not meet it is accepted ONCE and must be changed at first sign-in
uvicorn app.main:app --reload --port 8000
```

Against a local throw-away PostgreSQL (nothing touches Supabase):

```bash
python -m scripts.dev_postgres                 # terminal 1: starts PostgreSQL (data outside OneDrive)
powershell -File scripts/dev_api.ps1           # terminal 2: API on :8000 against it
```

Frontend: `cd ../frontend && npm install && npm run dev -- --port 5178` (proxies `/api` to `http://127.0.0.1:8000`).

## Tests

End-to-end sign-in / employee-management check against a running API (sign in, add employees with roles and permissions, create their logins, sign them in, prove they only reach what they are allowed, edit permissions, deactivate):

```bash
python -m scripts.e2e_employee_flow http://127.0.0.1:8010 <super-admin-email> <super-admin-password>   # creates records: use a scratch schema / throw-away DB
```

```bash
pytest                                                    # SQLite, temp file
TEST_DATABASE_URL=postgresql+psycopg://postgres:@127.0.0.1:<port>/crm_test pytest   # real PostgreSQL (disposable DB only)
```

The suite refuses to run against Supabase. To rehearse migrations on Supabase without touching `public`: `python -m scripts.scratch_schema create itest_abc123`, then `DB_SEARCH_PATH=itest_abc123 alembic upgrade head`, then `... drop itest_abc123`.

## Configuration

All configuration comes from environment variables, read from `backend/.env` locally (see `.env.example`). `.env` is git-ignored; no secret belongs in source code. Variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only), `JWT_SECRET_KEY`, `CORS_ORIGINS`, `STORAGE_BACKEND`, first Super Admin seed values, and pool settings.
