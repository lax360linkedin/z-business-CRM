# Starts the API against the LOCAL throw-away PostgreSQL (see scripts/dev_postgres.py) with test-only settings that apply to this process alone.
# Usage:  powershell -File scripts/dev_api.ps1 [-Port 8000] [-PgPort 59742] [-Database crm_dev]
param([int]$Port = 8000, [int]$PgPort = 59742, [string]$Database = "crm_dev")
$env:DATABASE_URL = "postgresql+psycopg://postgres:@127.0.0.1:$PgPort/$Database"
$env:STORAGE_BACKEND = "database"
$env:SCHEDULER_ENABLED = "false"
$env:CORS_ORIGINS = "http://localhost:5178,http://127.0.0.1:5178"
$env:APP_ENV = "development"
$env:DEBUG = "true"
Set-Location (Join-Path $PSScriptRoot "..")
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --port $Port
