# Settings & configuration audit

What can be configured, where, and what deliberately cannot.

## 1. Dropdown Options (Settings → Modules → the module that uses them; Super Admin)

Each module has its own page under Settings → Modules (Leads, Enquiries, Companies & Customers, Deals, Quotations & Sales Orders, Products & Services, Invoices & Payments, Contracts, Documents, Support Tickets, Campaigns, Expenses, Tasks). A page shows only that module's lists, its fixed workflow (read-only) and the settings that live on its own screen. A list used by several modules (industries, cities, business needs, purchase timelines, payment terms) is the same list everywhere, and its card says so.

Stored on the server (`app_settings`, key `options:<list>`; no table of its own), read by every screen through `useOptions()` (`frontend/src/hooks/useOptions.js`), rules in `backend/app/services/option_lists.py`. Each list has built-in defaults until someone edits it. Per option: add, rename, switch on/off, reorder, delete; usage count per option; reset to defaults.

Rules the server enforces: only the Super Admin writes; names are unique ignoring case and spacing; **an option that records use cannot be deleted (409) - switch it off instead** (it is no longer offered for new records, existing records keep it); a **rename is carried to every record** that holds the old value (values kept in plain columns); a value kept inside a record's free-form details cannot be carried, so it can only be renamed while unused; "reset" keeps any value still in use as a switched-off option. Everything is written to the audit log.

| Group | List | Where the value is stored | Used by |
| --- | --- | --- | --- |
| CRM | Industries | companies, customers, leads (industry), enquiries (category) | company / customer / lead / enquiry forms, list filters |
| CRM | Cities | companies (city), leads (location), enquiries (city) | forms, Leads / Enquiries filters |
| CRM | Enquiry types, Requirement types, Preferred contact methods, Assigned teams | enquiries | enquiry form, assign dialog |
| CRM | Lead unqualified reasons, Lead lost reasons | leads | the mark-unqualified / mark-lost dialogs |
| CRM | Company sizes, Business needs, Purchase timelines, Purchase intent levels | inside lead / enquiry / deal details | the qualification dialogs, deal form |
| Sales | Deal lost reasons | deals | change-stage dialog |
| Sales | Payment terms | quotations | quotation builder, sales order form |
| Products & Services | Product types, Units of sale, Billing cycles | products | product form, filters |
| Marketing | Campaign channels | campaigns | campaign form |
| Support | Ticket categories, Ticket sources | tickets | ticket form, filter |

## 2. Configurable elsewhere (unchanged, linked from Settings → Configuration Overview)

Lead sources and their categories (Lead Sources) · product & service categories (Products & Services → Categories) · departments, teams, branches (Employees) · roles and permissions (Roles & Permissions) · payment methods, receiving accounts, invoice numbering (Settings → Invoice Settings) · document categories, file types, retention (Settings → Documents) · contract settings (Settings → Contracts) · expense categories and vendors (Expenses) · company profile, tax, notifications, security (Settings).

## 3. Fixed on purpose (not options)

These drive server rules, automations, reports or integrations, so they are workflows, not dropdown values. Changing them freely would break existing records.

* Lead statuses, deal stages and their probabilities; enquiry, quotation, proposal, sales order, invoice, payment, task, ticket, project, contract and campaign statuses.
* Priorities (server-validated), activity types, call outcomes (a "Connected" call moves a lead to Contacted), meeting / follow-up types and reminder offsets.
* Notification event types, access levels, login roles, permission modules, data scopes, GST slabs used in calculations (`TAX_RATES`).

## 4. Hardcoded data removed in this pass

Built-in industry / city / reason / type lists in `data/constants.js`; the leftover `departments` fallback; the unused localStorage "custom roles" helpers; unused expense / document category constants; the demo company, bank account and GSTIN that the invoice screens used as a fallback before settings loaded (they now start empty and the saved settings fill them).

## 5. Known remaining items

* Server-side validation that a submitted value is an active option is **not** enforced (these fields were always free text; existing records and imports stay valid). The picker, rename-carry, usage and delete protection are enforced.
* Values inside free-form details (qualification fields) are counted by their text, so an option name that also appears as ordinary note text counts as "in use" (errs on the safe side).
* Template-editor previews still use clearly-labelled sample text (that is what a preview is).
