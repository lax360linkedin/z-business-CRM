# Performance notes

What made the app slow, what was changed, and how to keep it fast. Numbers are from a local machine with the database next to the API; on a hosted database every statement saved below is a network round trip (hundreds of ms from far away), so the gain there is larger.

## Root causes found

| Where | Cause | Fix |
| --- | --- | --- |
| Browser | Every screen (70+) and every heavy library (charts, PDF tooling) was in ONE 3.9 MB JavaScript file that had to download and run before the login page could do anything. | Each screen is its own lazy chunk (`routes/lazyPage.js`); shared libraries are grouped (`vite.config.js`). First load is ~100 KB of app code + React/animation vendor chunks (~170 KB gzipped in total). |
| Browser | Opening a screen waited for its code, THEN its data. | Code and data are fetched when the pointer/focus/finger reaches the menu entry (`preloadPath`, `api/prefetch.js`), the landing screen's data is requested while sign-in is still finishing, and the rest of the screens' code is fetched when the browser is idle. |
| Browser | The same lists were requested two or three times (several components, React's double effect). Sign-in produced 33 requests. | The HTTP client shares one in-flight request per identical GET and reuses its answer for 8 s (`api/http.js`); any write, sign-out or branch change empties it. Sign-in now makes 19 requests. |
| Browser | Reference data used the full department list, which computes workload figures for every department (18 statements). | `GET /directory/departments` (names only, 2 statements). |
| Browser | Notifications were polled every 20 s, hidden tab included. | 45 s, visible tab only. |
| API | Every request spent 3-7 statements just finding out who was calling (session, idle-timeout setting, user, role templates, branch) before doing any work. | Session + account in ONE query; the idle-timeout setting, role templates and branch list come from a 15 s in-process cache (`core/config_cache.py`) that is cleared the moment a session writes `app_settings` / `branches`. A plain list is now 2 statements (was 4-6). Locked by `tests/test_query_budget.py`. |
| API | `pool_pre_ping` sent a `SELECT 1` before EVERY request. | Only connections idle for 20 s are pinged (`db/session.py`); a dead one is replaced exactly as before. |
| API | Large JSON lists went uncompressed. | GZip for responses over 1 KB. |
| API | `/directory/people` ran three queries. | One joined query. |

## Measured (local, production build)

* Sign-in click → dashboard on screen: 2.0 s → about 1.0 s (of which sign-in itself, deliberately slow password hashing, is ~0.3 s).
* Menu click → screen settled (after the pointer hovered the entry): 50-140 ms.
* Requests after sign-in: 33 → 19. Statements per list request: 4-6 → 2.

## Keeping it fast

* New endpoint on a hot path? Add it to `BUDGET` in `tests/test_query_budget.py`.
* Do not read `app_settings`/`branches` directly per request: use `db.config_events.cached(...)`.
* A new list screen should call the same URL as its prefetch entry in `api/prefetch.js` so the warm-up is reused.
* Deployment: serve the frontend and the API from the same origin (a reverse-proxy / rewrite of `/api` to the API). A cross-origin API makes the browser send a CORS pre-flight before each distinct request URL, which doubles the latency of the first wave. Serve `/assets/*` with `Cache-Control: public, max-age=31536000, immutable` and enable gzip/brotli on the static host. Put the API in the same region as the database.

## Known remaining costs

* Several detail screens download a whole collection (e.g. all activities) and filter it in the browser. They are correct and, with the read cache, warm after the list screen, but should move to server-side filters as data grows.
* The Dashboard still derives its figures from the full lists; a server-side aggregate would remove the largest payloads.
* Screens that generate PDFs pull in ~1 MB of PDF tooling when first opened; making those imports lazy at the point of use would remove a one-off ~300 ms pause.
