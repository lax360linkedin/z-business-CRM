# Settings and Administration

Two separate areas with different purposes:

* **Settings** (`/settings`) - how the workspace is set up and how *I* want the CRM to look. Sidebar entry "Settings" (bottom), gear icon in the top bar, profile menu.
* **Administration** (`/administration`) - running the organisation: Branches, User Management, Roles & Permissions. Sidebar section "Administration", Super Admin only.

## Settings
| Group | Pages (`/settings/…`) | Needs |
| --- | --- | --- |
| Workspace | Company Profile `company-profile`, **Personalization** `personalization` (was Appearance; see `personalization.md`), Tax Settings `tax-settings` | Settings (Appearance: everyone) |
| Modules | `modules/<leads, enquiries, companies, deals, quotations, products, invoices, contracts, documents, tickets, campaigns, expenses, tasks>` | Settings |
| People & Access | Users `users`, Roles & Permissions (link to Administration), Departments `departments`, Security `security`, Login History `login-history`, Audit Logs `audit-logs` | Settings |
| Communication & Automation | `notification-settings`, `email-settings`, `whatsapp-settings`, `automation` | Settings |
| My account | My profile, Change password | everyone |

Personalization (mode, accent colour, interface style, contrast, surfaces, text size and density) is stored in this browser per signed-in person and applies across the whole CRM. The personal pages (`/settings`, `/settings/personalization`; `/settings/appearance` forwards there) are open to every signed-in person; everything else needs the *Settings* permission, otherwise the address redirects to Personalization.

The old aliases (`lead-statuses`, `deal-stages`, `services`, `options`, `overview`, `contracts`, `documents`, `invoice-settings`) still forward to the right page.

## Administration
`/administration` is a small hub; the pages are `/administration/branches`, `/administration/users` (`/:id`) and `/administration/roles-permissions`. Departments & Teams opens Employees. These three modules are Super Admin only (no stored permission can grant them); the server enforces the same on every request. Old addresses (`/branches`, `/user-management`, `/roles-permissions`) forward, and any other `/administration/<page>` forwards to `/settings/<page>`.

## Top bar
A gear icon (tooltip "Settings") sits with the quick actions, next to the theme toggle, on desktop and mobile. It opens `/settings`, or Personalization for someone without the *Settings* permission. The profile menu shows Administration only to people who may open it.

## Files
`pages/Settings/` (Settings.jsx shell and panels, PersonalizationPanel, ModuleSettings, OptionListsPanel, LogoSettings, AutomationSettings), `pages/Administration/Administration.jsx`, `routes/navConfig.js` (`NAV_SECTIONS`, `ADMIN_CATEGORIES`), `routes/moduleAccess.js`, `components/layout/Header.jsx`. Permission module labels are unchanged, so stored role permissions keep working. Page help: `help/content/admin.js` (`npm run check:help`).
