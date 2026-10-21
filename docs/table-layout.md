# Data tables: one fixed layout

Every list and table in the CRM follows the same rules, so a long name, email or company never moves a column, rows are the same height everywhere and a table too wide for its card scrolls inside the card instead of widening the page.

## What the rules are
| | |
| --- | --- |
| Layout | `table-layout: fixed`. Each column has a width in px; when the card is wider than the columns, the extra room is shared out in proportion. |
| Header | 44 px high, small upper-case semibold text, the same padding (16 px) everywhere. |
| Rows | 56 px high, 16 px side padding, vertically centred. A row never grows with its content. |
| Long text | One line that ends in an ellipsis. The first time the pointer rests on a cell whose text is cut off, the cell gets a `title` with its full text (`frontend/src/utils/truncationTitles.js`, one listener for the whole app). Header labels do the same. |
| Actions | The actions column is 56 px wide, never clipped (so its menu can open), never truncated. |
| Width | The table has a minimum width (the sum of its columns); below that the card scrolls sideways (thin scrollbar, `overscroll-x: contain`). The header is part of the same table, so it scrolls with the columns and always lines up with them. The page itself never scrolls sideways. |
| Pages | Where a list is paged, a short last page is padded to a full page, so the pager under the table does not jump. While loading, placeholder rows of the same height are shown inside the same columns. An empty list keeps its header and shows the empty-state message below it. |
| Themes | Colours come from the same `ink` / `brand` tokens as the rest of the app (light and dark). |

## How a list is built
* **`DataTable`** (`components/common/DataTable.jsx`) is the shared component. Its columns accept:
  `{ key, header, render?, sortable?, width?, align?, truncate?, className?, headerClassName? }`
  * `width` – px. Leave it out and `columnWidth()` picks one from the column's name (email 230, phone 150, dates 140, status/priority/source 130, ids 120, names 200, otherwise 160; `actions` 56).
  * `align` – `'left'` (default), `'center'`, `'right'` (numbers, amounts).
  * `truncate: false` – for a cell that must not be clipped (a select, a stack of avatars). The actions column is never clipped.
  * Sorting, selection, row click, pagination, the Branch column added in All-branches view and the empty state work as before.
* **Hand-built `<table>`s** use the `crm-table` class (`index.css`): the same header height, cell padding, 56 px rows, one-line cells with an ellipsis (cells up to 22 rem wide) and the hover text. Add `crm-table-fixed` and widths on the header cells (`w-40`) to fix the columns too, as Lead Sources does. A cell that contains a field, a select or a menu keeps its overflow so focus rings and dropdowns are never cut off. Free text that has to be read in full inside a dialog (import problems, the proposal before/after list) adds `crm-table-wrap`, so its cells wrap instead of being cut off. Editable line-item tables (invoice, sales order, proposal forms, the import preview) keep their own compact layout.
* **Employees** directory lays itself out the same way (`COL_W` per column, so the column picker keeps working).
* **Card-style lists** (Invoices, Payments, Contracts, Projects, Documents, Products, Campaigns, Expenses) are CSS grids that turn into stacked cards on narrow screens. Their column tracks are now `minmax(0, Nfr)`, so a long value cannot push a column out of the grid.
* The settings and detail-page grids use `minmax(0, 1fr)` tracks for the same reason: a wide table inside a column used to be able to stretch the whole page (it did on Settings → Login history / Audit logs).

## Adding a table
Use `DataTable` and give each column a `width` and, for numbers, `align: 'right'`. Do not put `whitespace-normal`, `min-w-max` or fixed pixel widths on cell content. For a one-off `<table>` use `crm-table` (and `crm-table-fixed` + header widths when the columns are known).
