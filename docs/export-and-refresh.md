# Export and Refresh

## Refresh
A small square icon button at the **end of every page's action row** (same icon, size and place everywhere). Pages without a header of their own (record pages, Settings) get the same button in a slim row above their content. It is hidden on forms and editors (new / edit pages, template editors), where a refresh could throw work away.

What it does (`api/refresh.js`, `context/RefreshContext.jsx`, `components/common/RefreshButton.jsx`):
1. empties the short read cache, so nothing old is served;
2. sends the "something changed" signals the screens already listen to (tasks, invoices, marketing …), so every mounted list re-reads its data;
3. re-fetches the shared collections the page uses and runs every loader a page registered with `useRefreshHandler()` (`useCrud`, the dashboard / report / audit hooks do this themselves) - lists keep their search, filters, sort, page and branch, and keep showing their rows while the new ones load;
4. counts every GET this starts (`trackReads` in `api/http.js`); the button spins until they have all answered. It reports a failure only when a read really failed (no answer or a 5xx), as a toast; a 4xx ("you may not see this list") is a normal answer.

A page that made no read of its own is re-opened in place by the layout, so the button never pretends. A record's detail page is always re-opened in place (there is no filter worth keeping there).

To make a new page refreshable: use `useCrud` / the existing data hooks, or call `useRefreshHandler(load)` next to the page's own `load`.

## Export
One menu, `components/common/ExportMenu.jsx`: **Excel (.xlsx)**, **CSV (.csv)**, **PDF (.pdf)**. Engine: `utils/exporter.js` (no server round trip; Excel on the existing JSZip writer, PDF on `pdf-lib`).

* **What goes in a file:** every row that matches the page's search, quick view, filters and dates (all pages of the list, not only the visible one), for the branch being viewed. A header block (PDF / the "Export details" sheet) says who exported, when, the branch, the filters in words and the number of records. CSV is the plain table (UTF-8 with BOM; cells starting with `= + - @` are neutralised).
* **Who sees it:** only roles with the *Export* right on the module (Roles & Permissions), except pages whose right comes from the server (Invoices, Payments, Expenses, Campaigns, Lead Sources, Marketing Analytics). Data is what the person's own API calls returned, so a file can never hold more than the screen could show. Finance exports (invoices, payments, expenses) and the marketing sheets still come from the server's export endpoints (right checked, export audited) and are cut down to the rows on screen. User Management never exports passwords.
* **Pages:** Leads, Enquiries, Contacts, Companies, Customers, Deals, Quotations, Sales Orders, Proposals, Activities, Tasks, Tickets, Products & Services, Projects, Contracts, Documents (the register, not the files), Invoices, Payments, Expenses, Campaigns, Lead Sources, Marketing Analytics, Communication History, Employees (also Print), User Management, Login History, Audit Logs, the six Reports, Dashboard, Sales Pipeline, Branches.
* **Reports and dashboards** (`components/common/PageExport.jsx`, `utils/reportCapture.js`): built from the page as it is on screen - key figures (`StatCard`), charts (`ChartCard`) and tables. Excel: a Summary sheet plus one sheet per table / chart's figures. PDF: the same plus the chart pictures. CSV: the sections one after another.
* **Limits:** PDFs stop at 3,000 rows (and say so; Excel and CSV carry every row). Chart pictures are PDF-only. Settings logs export the latest 100 entries the page loads. Calendar, Notifications, AI Insights, Roles & Permissions and record pages have no export.

Adding it to a page: `<ExportMenu title="Leads" columns={[{ label, value: 'key' | (row) => cell, align? }]} rows={() => crud.allFiltered} filters={filterText({...})} />`; for a report-like page `<PageExport rootRef={ref} title="…" />`.

Check: `npm run check:export` writes a list, a report and a 3,200-row list in all three formats and reads them back.
