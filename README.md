# LAX360 Business CRM

```
BusinessCRM/
  frontend/   React 19 + Vite + Tailwind app (currently on an in-browser mock API)   -> frontend/README.md
  backend/    Python 3.12 FastAPI + SQLAlchemy + Supabase PostgreSQL                  -> backend/README.md
```

## Run

```bash
# frontend  (http://localhost:5173)
cd frontend
npm install
npm run dev

# backend   (http://localhost:8000/docs)
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

## Status

- **Phase 1 (done):** project split into `frontend/` and `backend/`; backend scaffold and `.env` placeholders created.
- **Phase 2 (waiting on Supabase credentials in `backend/.env`):** database connection, schema and migrations, then the module APIs and the frontend integration.

Secrets live only in `backend/.env`, which is git-ignored. Copy `backend/.env.example` for the list of variables.
