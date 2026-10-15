# LAX360 Business CRM (frontend)

A frontend-only CRM built with React 19, Vite, Tailwind CSS and React Router. There is no backend or database: an in-browser mock API (`axios-mock-adapter`) serves bundled demo data and keeps changes in the browser's `localStorage`.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script            | What it does                      |
| ----------------- | --------------------------------- |
| `npm run dev`     | Vite dev server with hot reload   |
| `npm run build`   | Production build into `dist/`     |
| `npm run preview` | Serves the production build       |
| `npm run lint`    | Oxlint                            |

### Sign-in and access control

Only three roles can sign in: **Super Admin**, **Admin** and **Employee**. Sign in with an e-mail address or username and the password - there is no role picker and no second verification step. The **Branch** field defaults to *Automatic*: the role and branch are read from the authenticated account (the Super Admin starts on *All Branches*, Admins and Employees on their assigned branch). If a branch is picked manually it must equal the one assigned to the account, otherwise sign-in is refused.

- Demo accounts use the shared password `Lax@360`: `arjun.mehta@lax360.com` is the Super Admin, `priya.ramanathan@lax360.com` an Admin, every other `@lax360.com` person an Employee.
- Only the Super Admin can add employees, create logins, assign roles, set module permissions (view / create / edit / delete / export per module) and issue or reset passwords - in **User Management**, or from an employee's **Grant CRM access** action. Permission changes apply to the user within seconds.
- A sign-in succeeds only when: the credentials are valid, the account is Active, it has a valid role, a valid and active branch and at least one module it may open, and the picked branch equals the assigned one. Otherwise the form shows a specific message (invalid credentials, inactive / locked account, account not fully set up, inactive branch, or branch mismatch) without revealing the assigned branch. The same assignment check is repeated on page reload and every few seconds while signed in, so removing a branch or all module access signs the person out.
- All-branch access is an explicit setting on the Super Admin account (`branchAccess: 'all'`); it is never implied for Admins or Employees, and nobody can grant it through the API. The Super Admin always lands on the centralised *All branches* dashboard, whatever the form says; Admins and Employees land on their own branch (an Employee without Dashboard access lands on their first permitted module).
- Branch and role of an account can be set and changed only by the Super Admin (User Management, Add User, Grant CRM access, Employees); the mock API refuses everyone else, including changes to one's own branch or role.
- Admins get every module except User Management and Roles & Permissions unless the Super Admin narrows them; Employees get only what they are granted.

To start again from the bundled demo data, clear this site's `localStorage` in the browser.

### Branches (Salem, Mumbai, Bangalore)

Every business record and every account carries a `branch`. The bundled demo data is spread across the three branches by a one-time upgrade (`src/api/branchMigration.js`): companies are the root, and contacts, customers, enquiries, leads, deals, quotations, orders, projects, contracts, invoices, payments, tickets, documents, tasks and activities inherit the branch of the record they belong to, so an enquiry → lead → deal → quotation chain never straddles two branches. New records are stamped the same way.

- **Super Admin** has a *View data for* selector in the header (All branches / Salem / Mumbai / Bangalore). The choice scopes dashboards, tables, search, reports and look-ups, survives navigation, and the current page is reloaded for the new branch. In *All branches* tables gain a Branch column and the Dashboard shows a branch comparison. **Branches** (sidebar → Team) shows per-branch figures, opens a branch, jumps to its users and activates / deactivates a branch. User Management, Add User, Grant CRM access and the Employee form all carry the branch.
- **Admin / Employee** are fixed to the branch on their account: the header shows a read-only "<Branch> branch" chip, there is no selector, other branches' records return "not found", and Branches / User Management stay Super-Admin-only. Existing role and per-module permissions still apply on top of the branch.
- The monthly revenue / sales / customer-growth series is company-wide sample data that is not split by branch; those charts and the Monthly Revenue card say so when a single branch is selected.

**This is presentation-level scoping of demo data, not security.** Hiding controls or filtering records in React does not protect anything: anyone can edit `localStorage` or call the mock API directly. Real branch isolation needs server-side authorization and database-level rules.

## Project structure

```
src/
  api/          mock API (mockServer.js) plus an *Api.js / *Migration.js pair per module
  assets/       images imported by components
  components/   shared UI (common/, charts/, kanban/, layout/)
  context/      Auth, Theme, Sidebar and Toast providers
  data/         bundled demo data, workflow and permission rules
  hooks/        data hooks (useCrud, useProjects, useContracts, ...)
  pages/        one folder per module (Leads, Deals, Projects, Invoices, Documents, ...)
  routes/       route guards, navigation and module access
  utils/        pure helpers and per-module business rules
public/         static files served as-is
```

Business rules live in `src/utils/*Rules.js` and `src/data/*Workflow.js`; each module's mock endpoints and data upgrade steps are in `src/api/`.
