# Deleting an employee / user

**Why it was unavailable.** There was no delete control anywhere in Employees or User Management. The only server delete was `DELETE /userAccounts/{id}`, which removed the login but left the employee record behind (a half-deleted person), and the generic `DELETE /employees/{id}` failed on the `users.employee_id` RESTRICT foreign key with a bare 409.

## What happens now

One operation, `services/accounts.py::delete_person`, started from either module:

| Started from | Endpoint | Audit module |
| --- | --- | --- |
| Employees (list row menu, profile page) | `DELETE /employees/{id}` | Employees |
| User Management (list row menu, user page) | `DELETE /userAccounts/{id}` | User Management |

Both: Super Admin only (server-enforced; the UI only hides the button), one transaction, login **and** employee record removed together — so there is never an orphan login or a person without a record. Sessions and reset tokens go with the login (cascade), so the person is signed out at once and can never sign in again.

`GET …/delete-impact` (same two paths) tells the confirmation dialog what the person owns, whether deletion is allowed and why not.

## Refused

* your own account (403)
* the last active Super Admin (409 `LAST_SUPER_ADMIN`); another Super Admin can be deleted while one other active one remains
* unknown person (404); a hand-over target that is the same person, missing, or no longer working (422)

## Business records

Nothing is deleted. Every column that points at an employee as *owner* (leads, enquiries, deals, tasks, quotations, tickets, projects, invoices … discovered from the foreign keys, so new modules are covered automatically) is either handed to the colleague chosen in the dialog (`?reassignTo=`, same branch only) or cleared (`ON DELETE SET NULL`) for a manager to pick up. Task assignee/watcher links pass to the colleague or go away. People who reported to them now report to their manager; teams/departments they led lose that role. Document uploader/sharer links simply lose the name.

The audit entry (`Delete employee`) keeps a snapshot: name, email, branch, role, access level, counts of what they owned, what was handed to whom. `audit_logs` / `document_audit` have no foreign keys to people and are append-only, so history and who-did-what survive.

## Frontend

`pages/Employees/DeletePersonDialog.jsx` is the single confirmation (name in the title, what it affects, optional hand-over picker, success / error messages). After success the org screens (`crm:org-changed`), the User Management list and the name directory used by pickers (`data/users.js`) are refreshed, so the person disappears from lists, search, filters and dropdowns, and stays gone after a reload.

Tests: `backend/tests/test_employee_delete.py`.
