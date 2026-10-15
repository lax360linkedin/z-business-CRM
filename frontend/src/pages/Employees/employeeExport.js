import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { downloadBlob } from '../Invoices/invoiceClient'

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

export function exportCsv(rows, canSensitive) {
  const c = cols(canSensitive)
  downloadBlob(new Blob([`﻿${[c.map((x) => esc(x[0])).join(','), ...rows.map((r) => c.map((x) => esc(x[1](r))).join(','))].join('\n')}`], { type: 'text/csv;charset=utf-8' }), `employees-${stamp()}.csv`)
}
const htmlTable = (rows, canSensitive) => { const c = cols(canSensitive); const h = (s) => cell(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); return `<table border="1"><thead><tr>${c.map((x) => `<th>${h(x[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${c.map((x) => `<td>${h(x[1](r))}</td>`).join('')}</tr>`).join('')}</tbody></table>` }
/** Excel opens this HTML table directly (.xls). */
export function exportExcel(rows, canSensitive) {
  downloadBlob(new Blob([`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${htmlTable(rows, canSensitive)}</body></html>`], { type: 'application/vnd.ms-excel' }), `employees-${stamp()}.xls`)
}
export function printRows(rows, canSensitive, title = 'Employee directory') {
  const w = window.open('', '_blank', 'width=1100,height=800'); if (!w) return false
  w.document.write(`<html><head><title>${title}</title><style>body{font:11px Arial;margin:20px}h1{font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}</style></head><body><h1>${title} — ${rows.length} employee(s) · ${stamp()}</h1>${htmlTable(rows, canSensitive)}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return true
}
const safe = (s) => cell(s).replace(/[^\x20-\x7E]/g, (ch) => ({ '₹': 'Rs.', '–': '-', '—': '-', '’': "'", '•': '*' }[ch] || '?'))
export async function exportPdf(rows, canSensitive) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const c = [['Employee ID', 52, (e) => e.id], ['Name', 100, (e) => e.fullName], ['Designation', 110, (e) => e.designation], ['Department', 80, (e) => e.departmentName], ['Team', 100, (e) => e.teamName], ['Team leader', 90, (e) => e.teamLeaderName], ['Status', 52, (e) => e.status], ['Work mode', 50, (e) => e.workMode], ['Joined', 55, (e) => e.joinDate], ['CRM role', 70, (e) => e.crmRole || '-']]
  void canSensitive
  const W = 842; const H = 595; const m = 28; const rowH = 16
  let page; let y
  const header = () => { page = pdf.addPage([W, H]); page.drawText(`Employee directory - ${rows.length} employee(s) - ${stamp()}`, { x: m, y: H - m, size: 12, font: bold }); y = H - m - 24; let x = m; c.forEach(([t, w]) => { page.drawText(t, { x, y, size: 7, font: bold, color: rgb(0.3, 0.35, 0.45) }); x += w }); y -= 10; page.drawLine({ start: { x: m, y }, end: { x: W - m, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.86) }); y -= rowH - 4 }
  header()
  rows.forEach((r) => { if (y < m + 10) header(); let x = m; c.forEach(([, w, f]) => { page.drawText(safe(f(r)).slice(0, Math.floor(w / 3.4)), { x, y, size: 7.5, font }); x += w }); y -= rowH })
  const bytes = await pdf.save(); downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `employees-${stamp()}.pdf`)
}

// ---- import template / parsing ---------------------------------------------------------------------------------------
export const IMPORT_FIELDS = ['employeeId', 'fullName', 'officialEmail', 'mobile', 'designation', 'department', 'team', 'subTeam', 'teamLeader', 'reportsTo', 'joinDate', 'employmentType', 'status', 'workMode', 'workLocation', 'shift']
export const IMPORT_TEMPLATE = `${IMPORT_FIELDS.join(',')}\n,Jane Doe,jane.doe@lax360.com,+91 90000 00000,Software Engineer,IT / Tech Services,Web Development Team,,,,2026-10-01,Full-time,Active,Hybrid,Chennai HQ,General (9:00–18:00)\n`
const ALIAS = { 'employee id': 'employeeId', id: 'employeeId', name: 'fullName', 'full name': 'fullName', email: 'officialEmail', 'official email': 'officialEmail', phone: 'mobile', mobile: 'mobile', 'mobile number': 'mobile', designation: 'designation', department: 'department', team: 'team', 'sub-team': 'subTeam', 'sub team': 'subTeam', subteam: 'subTeam', 'team leader': 'teamLeader', 'reports to': 'reportsTo', manager: 'reportsTo', 'joining date': 'joinDate', 'join date': 'joinDate', 'employment type': 'employmentType', status: 'status', 'work mode': 'workMode', 'work location': 'workLocation', shift: 'shift' }
/** CSV text → row objects keyed by import field (headers are matched case-insensitively, with common aliases). */
export function parseEmployeeCsv(text) {
  const lines = []; let cur = ''; let q = false; const rows = []; let row = []
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i += 1) { const ch = s[i]; if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i += 1 } else if (ch === '"') q = false; else cur += ch } else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = '' } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cur); cur = ''; rows.push(row); row = [] } else cur += ch }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  void lines
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()))
  if (!head) return []
  const keys = head.map((h) => ALIAS[h.trim().toLowerCase()] || IMPORT_FIELDS.find((f) => f.toLowerCase() === h.trim().toLowerCase()) || null)
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()]).filter(([k]) => k)))
}
