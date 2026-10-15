# Deployment (Vercel frontend + Render backend + Supabase PostgreSQL)

Authentication is the backend's own: `POST /api/v1/auth/login` checks the password hash stored in PostgreSQL (argon2), applies lockout / branch / role rules and issues its own JWT. **Supabase is used only as the PostgreSQL database (and optionally Storage); Supabase Auth is not involved**, and no Supabase key is ever sent to the browser.

## 1. Render (backend) - Web Service

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Python | 3.12 |
| Health check path | `/health` (liveness) - `/healthz` also tests the database |

Environment variables (names are the real ones read by `app/core/config.py`; never commit their values):

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` |
| `DATABASE_URL` | Supabase -> Project Settings -> Database -> connection string (pooler or direct); the code adds the `postgresql+psycopg://` form itself |
| `JWT_SECRET_KEY` | a random secret of at least 32 characters (`python -c "import secrets; print(secrets.token_urlsafe(64))"`) |
| `CORS_ORIGINS` | `https://z-business-crm.vercel.app` (comma-separate more origins; no trailing slash, no path) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | only if file storage in Supabase Storage is wanted (otherwise `STORAGE_BACKEND=database`) |
| `SCHEDULER_ENABLED` | `true` (default) to run reminders |

`GET https://<backend>/health` lists the names of settings that are still missing, so a half-configured service is visible without logging in.

First-time database setup (once, against the Supabase database, from `backend/`): `alembic upgrade head`, then `python -m scripts.seed` with `SUPERADMIN_EMAIL`, `SUPERADMIN_NAME`, `SUPERADMIN_PASSWORD` set; change that password at the first sign-in.

## 2. Vercel (frontend)

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework | Vite (build `npm run build`, output `dist`) |
| `VITE_API_URL` | `https://z-business-crm.onrender.com` - the backend address only: **no** trailing slash, **no** `/api/v1` (the app adds it) |

`VITE_API_URL` is read when the app is BUILT: after adding or changing it, redeploy (Deployments -> Redeploy). `frontend/vercel.json` makes every page address (`/login`, `/leads/LD-0001` ...) serve the app, but deliberately not `/api/...`.

## 3. Symptoms and what they mean

| Browser shows | Cause |
| --- | --- |
| `404 NOT_FOUND` on `/login` after a refresh | no rewrite to `index.html` (fixed by `frontend/vercel.json`) |
| `Request failed with status code 405` / "not connected to its backend" on sign-in | `VITE_API_URL` was empty when the frontend was built, so the browser POSTed to the Vercel site itself, which only serves pages |
| "Network Error" with a CORS message in the console | the backend `CORS_ORIGINS` does not contain the exact site address |
| `503` / "service is temporarily unavailable" | `DATABASE_URL` missing or unreachable (see `/healthz`) |
| `500` on sign-in | `DATABASE_URL` or `JWT_SECRET_KEY` missing on Render (see `/health`) |
