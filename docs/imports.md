# Excel / CSV imports and templates

## Which pages import
Checked in the code, not assumed: **Leads**, **Enquiries** and **Employees** are the only modules with an import. Contacts, Companies, Customers, Deals, Products, Invoices and the rest have none, and none was added.

Each of the three now has **Import** and **Download Excel Template** side by side in the page header (the second reads "Excel Template" on narrower screens).

## How it works
1. **Download Excel Template** builds an `.xlsx` from the module's *live schema* (`GET /api/v1/imports/<module>/schema`):
   * sheet 1 (named after the module) is the data sheet: the real column headers (required ones carry a `*` and a darker header), frozen header row, formats (dates `yyyy-mm-dd`, phones and IDs as text, numbers), and dropdowns / validation on 1,000 rows;
   * **Instructions**: how to use it, the module's rules, and every column with required / format / allowed values / example;
   * **Examples**: sample rows (kept off the data sheet so they are never imported by accident);
   * **Lists**: the allowed values the dropdowns read. Fixed-value columns (Source, Priority, Department, Status, Employment Type …) only accept listed values; "pick or type" columns (Industry, City, Service, Work Location) warn but accept your own text.
   The allowed values come from the CRM itself (active lead sources of your branch, option lists, departments, branches, the catalogue), so the template matches the system today.
2. **Import** accepts the saved `.xlsx` or a `.csv` (quotes, commas and line breaks inside fields, UTF-8 BOM and semicolon-separated files are handled). Headers are matched by their text, key or a known alias (case-insensitive; the `*` and anything in brackets are ignored), so the template, the older CSV layouts and reordered columns all work. Dates may be `yyyy-mm-dd`, `dd/mm/yyyy` or real Excel dates; values are matched to the lists ignoring case; older source names ("Website", "Referral") still map to the current ones.
3. Every row is **checked first, nothing saved** (`POST /imports/<module>/preview`): required values, email / phone / date / number formats, lengths, allowed values, owner lookup (Employee ID, email or full name of a working employee in the branch) and **duplicates** (same email or phone as an existing record in the branch, or as an earlier row of the file; the record id is only shown to people who may see that record).
4. The dialog shows rows in the file / ready / with problems, each row's reasons, lets you correct cells in place and check again, and offers **Download rows to fix (.xlsx)**.
5. **Import** (`POST /imports/<module>/commit`): Leads and Enquiries save every valid row, 10 at a time with a progress bar, through the same record engine as the Add form (module rules, audit entries, branch stamping, n8n events). A row the real create refuses is reported with its reason. Imported records are marked created via **Import**. Employees are **all or nothing**, as before. The result screen lists what was created and what was not, with reasons.

## Columns
| Module | Required | Notes |
| --- | --- | --- |
| Leads | Contact Name | company, designation, email, phone, website, industry, city, Source (default *Import*), source detail, service, requirement, budget, expected purchase date, priority (default Medium), Assigned To, next follow-up. Status always starts as New. |
| Enquiries | Name | company, designation, email, phone, city, state, country (default India), Source (default *Import*), enquiry type, priority (Critical/High/Medium/Low, default Medium), interested service, requirement type / description, expected purchase date, preferred contact method, Assigned To (then the enquiry starts as Assigned), next follow-up. A company that does not exist is created in Companies; existing ones are matched by name. |
| Employees | Full Name, Official Email, Designation, Department, Joining Date (+ **Branch** for the Super Admin) | optional ID (EMP-001), mobile, job title, team, sub-team, team leader, reports-to, employment type, status (working statuses only), work mode, work location (Office / Remote / Hybrid or your own text), shift, gender, date of birth, personal email, address. Departments, teams and people must already exist. |

**Related records.** Leads and enquiries link to people by *Assigned To* (Employee ID, email or full name); enquiries link to a company by *Company name*; employees link to department / team / manager / leader by name, ID or email. The Instructions sheet says so for each module.

## Rules that are kept
* **Branch isolation and roles.** The same permissions apply as for the Add form (`create` on the module; Employees: the import right). Records go to the branch you are working in; the Super Admin must pick one branch first for leads and enquiries (the dialog says so), and names the branch on each employee row. Duplicate checks only look inside the branch; owner scope (Own / Team) decides whether a duplicate's record id is shown.
* Up to **500 rows** and 2 MB per file; a commit request carries at most 100 rows.
* A leads import shares ownerless leads equally among the branch's sales team (the previous behaviour, now an option you can switch off in the dialog). Enquiries stay unassigned unless the file names an owner.

## Fixed along the way
* The Employees import had no `branch` column, so the Super Admin (who must name a branch per row) could never import; the template now has it.
* Leads / Enquiries used to create "Unnamed Lead" records for rows without a name, ignore the file's source / priority / owner, and report refusals only as a count.

## Code
`backend/app/services/imports.py` (schemas, cleaning, checks, import), `backend/app/routers/imports.py`; `frontend/src/utils/xlsx.js` (writer / reader on JSZip), `utils/importKit.js` (template, file reading), `components/import/{ImportDialog,TemplateButton}.jsx`. Tests: `backend/tests/test_imports.py`; `npm run check:import` round-trips the workbook code. Adding an import to another module = one `ImportModule` definition plus its create/commit hook.
