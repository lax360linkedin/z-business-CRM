# AI Insights and n8n workflow automation

## AI Insights (`/ai-insights`, `GET /api/v1/insights`)
Computed on the server from the records the caller may see: inside their branch and their record scope (Own / Team / Organization, the same rules as the module screens), and only for modules they can open. It is **rule-based analytics, not a language model**, and the screen says so.

| Finding | Rule |
| --- | --- |
| High-scoring leads waiting | open, score ≥ 70, not contacted for 3+ days |
| Overdue follow-ups | open leads whose follow-up date has passed (oldest first) |
| Stalled / slipping deals | open deals untouched for 14+ days; past their expected closing date |
| Closing this month, win-rate trend | open deals due this month; last 90 days vs the 90 before |
| Quotations waiting | sent / viewed / negotiating for 7+ days |
| Money | overdue invoices (outstanding amount), invoices due within 7 days, revenue vs last month |
| Support | open tickets breached or within 8 h of their deadline |
| Operations | contracts ending within 30 days, overdue tasks |
| Marketing | lead inflow ±30% week on week, best converting source |

Findings are ranked (critical → needs attention → good to know → going well, then by impact), carry the records behind them with links, and are grouped by category. The page also shows KPIs (open leads, pipeline, weighted forecast, win rate, overdue invoices, open tickets) and charts (pipeline by stage, revenue vs target, lead sources, lead score distribution).

## n8n integration (Settings → Automation)
**Out:** the CRM POSTs a signed JSON message to the webhook of an n8n workflow when something happens; **back:** n8n may report how the run ended.

* **Connection** (Super Admin): n8n address, a shared secret (≥ 16 characters, stored encrypted, never sent to a browser), header name (default `X-CRM-Key`), timeout, optional public API address (added to messages as `callbackUrl`). *Test connection* calls `<n8n>/healthz`. In production the address must be https and public (no private / loopback / link-local addresses).
* **Workflows:** each listens to one event and has the webhook address of its n8n *Webhook* node (full URL, or just the path when the n8n address is set). Optional "only when the new value is …" for status / stage changes; optional "waits for callback"; on / off.
* **Events:** created / status (stage) changed for Leads, Enquiries, Deals (plus `deal.won`, `deal.lost`), Quotations, Invoices, Tickets; Customers created; and `insight.*` — an AI Insight sent on request with the *Send to n8n* button (the server sends what it computed, never what a browser claims). They fire from the standard record screens and API, in the same transaction as the save (a rejected save sends nothing).
* **Message:** `event`, `runId`, `attempt`, `occurredAt`, `branch`, `actor`, `record {type, id, label, data}`, `changes`, `callbackUrl`. Headers: the secret in the configured header, `X-CRM-Signature: sha256=<HMAC of the body>`, `X-CRM-Run-Id`, `X-CRM-Event`, `X-CRM-Timestamp`.
* **Status and errors:** every message is a run — Queued → Running → Success / Failed — with attempts, HTTP code, duration and a plain-language reason (wrong URL / inactive workflow, rejected credentials, timeout, unreachable, off, deleted …). Network trouble, timeouts and 5xx are retried automatically (3 attempts: now, +1 min, +5 min); 4xx are not (fix the address, then *Retry*). Runs waiting for a callback close as Failed after 15 minutes. Sending happens in a background thread, so a slow or broken n8n never slows or fails a save in the CRM.
* **Callback:** `POST /api/v1/automation/callback` with the same secret (header or `Authorization: Bearer`) and `{ "runId", "status": "success" | "failed", "message" }`.
* **Access:** the Super Admin configures; Admins see runs of their own branch, can send tests, retry and send insights; everyone else has no access. Changes are audited.

## Deployment notes
* New table `automation_runs`: run `alembic upgrade head` (migration `a91c3d27e5b4`, tested up and down on PostgreSQL) before using the feature on Supabase.
* New requirements: `httpx`, `cryptography` (already installed with the existing dependencies; now listed explicitly).
* The secret is encrypted with a key derived from `JWT_SECRET_KEY`; if that key is ever changed, the secret must be entered again (the screen says so).
* Not built: n8n calling *into* the CRM to create or change records (only status callbacks are accepted), and events for tasks, contracts and payments.

Tests: `backend/tests/test_automation.py`.
