# Administration

Everything that configures or controls the CRM itself now lives under **Administration** (sidebar section at the bottom, and the profile menu). **Settings** keeps only the person's own preferences.

## What is where
| Group | Pages (address) | Needs |
| --- | --- | --- |
| Organization | Company Profile `/administration/company-profile`, Branches `/administration/branches`, Departments & Teams (opens Employees `?view=departments`), Tax Settings `/administration/tax-settings` | Settings (Branches: Super Admin) |
| Users & Access | User Management `/administration/users` (`/:id`), Roles & Permissions `/administration/roles-permissions`, Security `/administration/security` | Super Admin / Settings |
| Module Configuration | `/administration/modules/<leads, enquiries, companies, deals, quotations, products, invoices, contracts, documents, tickets, campaigns, expenses, tasks>` | Settings |
| Communication & Automation | Notification Settings, Email Settings, WhatsApp Settings, Automation (`/administration/<notification-settings, email-settings, whatsapp-settings, automation>`) | Settings |
| Monitoring & Audit | Login History `/administration/login-history`, Audit Logs `/administration/audit-logs` | Settings |

`/administration` is an overview of these groups (cards) with the same menu on the left. Branches, User Management and Roles & Permissions keep their own full-width pages (reached from the sidebar, the overview or the menu) with an *Administration › …* breadcrumb.

**Settings** (`/settings`, profile menu): Appearance (theme and accent colour, stored in this browser), links to My profile and Change password, and - for people who may open Administration - a link to it. Every signed-in person can open it.

## What changed
* The two pointer pages that only linked elsewhere ("Settings → Users" → Employees, "Settings → Departments" → Employees) were removed; the menu links straight to the real pages, so nothing is shown twice.
* Sidebar: the *Team* section keeps Employees and Teams; the new *Administration* section has Administration, Branches, User Management and Roles & Permissions. The old bottom "Settings" entry became Administration; personal Settings is in the profile menu.
* Old addresses still work and forward (`/branches`, `/user-management[/:id]`, `/roles-permissions`, `/settings/company-profile|tax-settings|security|login-history|audit-logs|notification-settings|email-settings|whatsapp-settings|automation|modules/<key>`, `/settings/users`, `/settings/departments`, and the older `/settings/invoice-settings`-style aliases). Query strings and ids are kept.
* Browser tab titles follow the page (`Administration · Security · LAX360 Business CRM`); breadcrumbs and page help (`?`) were updated, as were links inside other pages (Dashboard, Employees, Documents, AI Insights, Branch cards).
* Files: `pages/Administration/` (Administration.jsx, ModuleSettings, OptionListsPanel, LogoSettings, AutomationSettings), `pages/Settings/Settings.jsx` (personal), `routes/navConfig.js` (`NAV_SECTIONS`, `ADMIN_CATEGORIES`).

## Access (unchanged rules)
Permission modules and stored role permissions are untouched: *Settings* guards every `/administration/…` page except the three Super-Admin-only modules (*Branches*, *User Management*, *Roles & Permissions*), which no stored permission can grant. A role without *Settings* does not see the Administration menu and gets Access Denied from the address bar; the server still checks every request. Panels keep their own read-only mode for non-administrators.

Adding an administration page: add the route inside `Administration.jsx`, an entry in `ADMIN_CATEGORIES`, and help text in `help/content/admin.js` (`npm run check:help`).
