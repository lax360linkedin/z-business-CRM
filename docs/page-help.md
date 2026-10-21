# Page help and the `?` button

## What was wrong
The `?` button in the top bar (`components/layout/Header.jsx`) was a plain icon button with **no click handler**, so it did nothing. It was also hidden below 640 px wide, so phones never had it.

## What it does now
* The `?` button opens a **help panel for the page you are on** (right-hand side panel; full width on a phone). It closes with the X button, the Escape key, or a click on the dimmed background; keyboard focus stays inside while open and returns to the button on close. Pressing `?` on the keyboard opens and closes it too (except while typing in a field).
* On phones the icon is replaced by **Help for this page** in the menu under your avatar.
* The first time someone opens a kind of page, a small dismissible **"About this page"** note explains its purpose (*How to use it* opens the panel; *Turn off page tips* silences them all). Dismissals are remembered per browser.
* Light and dark themes both work; the panel is rendered into `<body>` so the blurred top bar cannot clip it.

## Content
Each panel has: *What this page is for*, *What you can do here*, *Buttons, filters and forms* (what each control does), step-by-step *workflows* for the complex pages (leads, enquiries, deals, quotations → sales orders → invoices, proposals, expenses, tickets, onboarding an employee, giving someone access, connecting n8n …), *Good to know*, and links to *Related pages*.

74 routes are covered by 76 entries, including every detail page, the template editors, each Settings section and each `Settings → module` page, and the six reports. Nothing is shared: no two pages have the same purpose text.

## Where things live
| Piece | File |
| --- | --- |
| Page text | `frontend/src/help/content/{crm,sales,work,finance,marketing,admin}.js` |
| Route → text table, `getPageHelp()` | `frontend/src/help/helpContent.js` |
| State, `?` shortcut | `frontend/src/help/HelpContext.jsx` (provided inside `AppLayout`) |
| Panel / first-visit note | `frontend/src/components/help/{HelpPanel,PageGuide}.jsx` |
| Coverage check | `frontend/scripts/check-help.mjs` (`npm run check:help`) |

## Adding a page
Write its entry in the right content file, add one line to `ROUTES` in `helpContent.js`, run `npm run check:help`. The check fails if a route in `App.jsx` has no help, an entry lacks a purpose / features / actions, a related link is malformed, an entry is unused, or two entries share the same purpose.

The text describes what the screens actually offer (statuses, buttons, views); if a screen's behaviour changes, update its entry too.
