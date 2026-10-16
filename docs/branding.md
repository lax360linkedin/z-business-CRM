# Company logo (branding)

The Super Admin can replace the logo without touching code: **Settings → Company Profile → Company Logo** (preview on light and dark, upload / change, remove). With no custom logo — or if the file cannot be loaded — the built-in LAX360 logo is shown.

## Where it shows
Sidebar, sign-in / forgot-password screens (including mobile), Settings, quotation preview, quotation PDFs and the letterhead designer's "Use company logo", and the browser tab icon. All of them read one place (`frontend/src/hooks/useBranding.js`), so an upload or removal is visible immediately in the session that made it; other sessions pick it up when their tab regains focus or within ~2 minutes. The logo sits on a white plate in the sidebar and sign-in screens, so it is readable in both light and dark themes.

## Server
* `GET /api/v1/branding` and `GET /api/v1/branding/logo` are **public** (the sign-in page needs the logo before anyone is signed in). The file address carries a content hash (`?v=…`) so it is cached for a year and a replacement is fetched afresh; ETag / 304 otherwise.
* `PUT /api/v1/branding/logo` (multipart `file`) and `DELETE /api/v1/branding/logo` are **Super Admin only**, enforced on the server. Every change is audited ("Change company logo" / "Remove company logo").
* Stored in `stored_files` (bytes) with a pointer in the `branding` row of `app_settings` — no migration. Only one logo is kept; replacing or removing deletes the old bytes.
* Accepted: PNG, JPEG, SVG, up to **1 MB**, decided from the file's own bytes (not its name or declared type). SVGs containing scripts, event handlers, `<foreignObject>`, DOCTYPE/entities or links to other files are refused. The file is served `nosniff` with a sandboxing CSP and only ever shown through `<img>`.
* The global `Cache-Control: no-store` middleware now only applies when a route did not set its own header (`app/main.py`).

## Notes
* PDFs cannot embed SVG, so an SVG logo is converted to PNG in the browser first (`frontend/src/utils/logoImage.js`).
* The text next to the sidebar logo ("LAX360 · Business CRM") is unchanged; it is not part of the logo setting.

Tests: `backend/tests/test_branding.py`.
