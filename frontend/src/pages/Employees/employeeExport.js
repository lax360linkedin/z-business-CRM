
// What leaves the building is exactly what is on screen: the caller passes the filtered rows; personal / HR fields are included only when the user may see them.
export const EXPORT_COLUMNS = [
  ['Employee ID', (e) => e.id], ['Name', (e) => e.fullName], ['Official email', (e) => e.officialEmail], ['Mobile', (e) => e.mobile], ['Designation', (e) => e.designation], ['Department', (e) => e.departmentName],
  ['Team', (e) => e.teamName], ['Sub-team', (e) => e.subTeamName], ['Team leader', (e) => e.teamLeaderName], ['Reports to', (e) => e.reportsToName], ['Status', (e) => e.status], ['Employment type', (e) => e.employmentType],
  ['Work mode', (e) => e.workMode], ['Work location', (e) => e.workLocation], ['Joining date', (e) => e.joinDate], ['CRM role', (e) => e.crmRole || 'No CRM access'], ['Pending tasks', (e) => e.workload?.pendingTasks], ['Active projects', (e) => e.workload?.activeProjects],
]
const sensitive = [['Gender', (e) => e.gender], ['Date of birth', (e) => e.dob], ['Personal email', (e) => e.personalEmail]]
const cols = (canSensitive) => (canSensitive ? [...EXPORT_COLUMNS.slice(0, 4), ...sensitive, ...EXPORT_COLUMNS.slice(4)] : EXPORT_COLUMNS)
const cell = (v) => (v === null || v === undefined ? '' : String(v))
const esc = (v) => { const s = cell(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const stamp = () => new Date().toISOString().slice(0, 10)

const htmlTable = (rows, canSensitive) => { const c = cols(canSensitive); const h = (s) => cell(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); return `<table border="1"><thead><tr>${c.map((x) => `<th>${h(x[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${c.map((x) => `<td>${h(x[1](r))}</td>`).join('')}</tr>`).join('')}</tbody></table>` }
export function printRows(rows, canSensitive, title = 'Employee directory') {
  const w = window.open('', '_blank', 'width=1100,height=800'); if (!w) return false
  w.document.write(`<html><head><title>${title}</title><style>body{font:11px Arial;margin:20px}h1{font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}</style></head><body><h1>${title} — ${rows.length} employee(s) · ${stamp()}</h1>${htmlTable(rows, canSensitive)}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return true
}

/** The directory's columns for the shared export (Excel / CSV / PDF): the same fields as before, personal ones only for people who may see them. */
export const employeeColumns = (canSensitive) => cols(canSensitive).map(([label, value]) => ({ label, value }))
