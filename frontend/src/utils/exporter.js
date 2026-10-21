// One export engine for the whole CRM: every list and report is turned into the same small document model and written as Excel (.xlsx), CSV or PDF.
//
//   doc = { title, subtitle?, meta: [[label, value]], sections: [section] }
//   section = { type: 'table', title?, note?, columns: [{ label, align? }], rows: [[cell]] }      cell: string | number | null
//           | { type: 'stats', title?, items: [{ label, value }] }                                  (a report's key figures)
//           | { type: 'image', title?, subtitle?, png: Uint8Array, width, height }                   (a chart; PDF only - the Excel and CSV files carry the chart's data as a table)
//
// Nothing here talks to the server: pages hand over the rows the signed-in person is allowed to see, exactly as filtered on screen, so a file can never hold more than the screen.
import { buildXlsx, parseCsvRows, XLSX_MIME } from './xlsx.js'

export const FORMATS = [
  { key: 'xlsx', label: 'Excel (.xlsx)', ext: 'xlsx' },
  { key: 'csv', label: 'CSV (.csv)', ext: 'csv' },
  { key: 'pdf', label: 'PDF (.pdf)', ext: 'pdf' },
]

const isBlank = (v) => v === null || v === undefined || v === '' || v === 'all'

/** "Status: New · Source: Website · Search: “acme”" - what was applied, written into the file so it explains itself. Pairs with an empty value or 'all' are left out. */
export function describeFilters(pairs) {
  const parts = pairs.filter(([, v]) => !isBlank(v) && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
  return parts.length ? parts.join(' · ') : 'None (all records you can see)'
}

const plain = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isFinite(v) ? v : '') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).replace(/\s*\n\s*/g, ' ').trim())

/** A table section from record objects and column definitions: [{ label, value: 'key' | (row) => cell, align? }]. */
export function tableSection(columns, rows, { title, note } = {}) {
  return {
    type: 'table', title, note,
    columns: columns.map((c) => ({ label: c.label, align: c.align })),
    rows: rows.map((row) => columns.map((c) => { const v = typeof c.value === 'function' ? c.value(row) : row[c.value]; return typeof v === 'number' ? v : plain(v) })),
  }
}

/** A list export: one table plus a few lines saying who exported it, when, and with which filters. */
export function listDocument({ title, columns, rows, filters, user, branch, extraMeta = [] }) {
  const now = new Date()
  return {
    title,
    meta: [
      ['Exported by', user || '—'],
      ['Exported on', now.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })],
      ...(branch ? [['Branch', branch]] : []),
      ['Filters applied', filters || 'None (all records you can see)'],
      ['Records', String(rows.length)],
      ...extraMeta,
    ],
    sections: [tableSection(columns, rows)],
  }
}

/** Table cells from a header row and body rows that came back as CSV text (the few exports the server writes itself). */
export function tableFromRows(header, body, { title } = {}) {
  return { type: 'table', title, columns: header.map((label) => ({ label })), rows: body.map((r) => header.map((_, i) => (r[i] === undefined ? '' : r[i]))) }
}

// ---- file names ------------------------------------------------------------------------------------------------------------------------------
export const fileStem = (name) => String(name || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export'
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
export const fileName = (name, ext) => `${fileStem(name)}-${stamp()}.${ext}`

// ---- CSV -------------------------------------------------------------------------------------------------------------------------------------
// A cell that starts with = + - @ would be run as a formula by Excel; a leading apostrophe-free guard (a tab is not used because it shows in the cell) keeps it text.
const guard = (s) => (/^[=+\-@]/.test(s) && !/^[+-]?\d+([.,]\d+)?%?$/.test(s) ? `'${s}` : s)
const csvCell = (v) => { const s = guard(String(plain(v))); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csvRow = (cells) => cells.map(csvCell).join(',')

export function buildCsv(doc) {
  const out = []
  const tables = doc.sections.filter((s) => s.type === 'table')
  const onlyTable = doc.sections.length === 1 && tables.length === 1
  if (onlyTable) { // a plain list: header + rows, ready to open or re-import
    out.push(csvRow(tables[0].columns.map((c) => c.label)), ...tables[0].rows.map(csvRow))
  } else { // a report: the title, who made it, then each part with its own heading
    out.push(csvRow([doc.title]), ...(doc.meta || []).map(csvRow), '')
    for (const s of doc.sections) {
      if (s.type === 'image') continue
      if (s.title) out.push(csvRow([s.title]))
      if (s.type === 'stats') out.push(csvRow(['Metric', 'Value']), ...s.items.map((i) => csvRow([i.label, i.value])))
      else out.push(csvRow(s.columns.map((c) => c.label)), ...s.rows.map(csvRow))
      out.push('')
    }
  }
  return `﻿${out.join('\r\n')}\r\n` // the BOM makes Excel read it as UTF-8
}

// ---- Excel -----------------------------------------------------------------------------------------------------------------------------------
const widthOf = (values, min = 10, max = 48) => Math.max(min, Math.min(max, Math.ceil(values.reduce((n, v) => Math.max(n, String(plain(v)).length), 0) * 1.15) + 2))

function sheetName(name, used) {
  let base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet'
  let n = base; let i = 2
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 27)} ${i++}`
  used.add(n.toLowerCase())
  return n
}

function dataSheet(name, section) {
  const head = section.columns.map((c) => ({ v: c.label, s: 'header' }))
  const body = section.rows.map((r) => r.map((v) => (typeof v === 'number' ? { v, s: Number.isInteger(v) ? 'int' : 'number' } : plain(v))))
  return {
    name,
    rows: [head, ...body],
    cols: section.columns.map((c, i) => ({ width: widthOf([c.label, ...section.rows.slice(0, 500).map((r) => r[i])]) })),
    freezeRows: 1,
    rowHeights: { 0: 24 },
  }
}

export async function buildXlsxFile(doc) {
  const used = new Set()
  const sheets = []
  const tables = doc.sections.filter((s) => s.type === 'table')
  const stats = doc.sections.filter((s) => s.type === 'stats')
  const onlyTable = doc.sections.length === 1 && tables.length === 1
  const infoRows = [[{ v: doc.title, s: 'title' }], ...(doc.subtitle ? [[{ v: doc.subtitle, s: 'note' }]] : []), [], ...(doc.meta || []).map(([k, v]) => [{ v: k, s: 'bold' }, plain(v)])]
  if (onlyTable) { // the data first, at A1, so it can be sorted / filtered / pivoted straight away; the details on a second sheet
    sheets.push(dataSheet(sheetName(tables[0].title || doc.title, used), tables[0]))
    sheets.push({ name: sheetName('Export details', used), rows: infoRows, cols: [{ width: 20 }, { width: 70 }] })
  } else { // a report: Summary first (title, details, key figures), then every table / chart data on its own sheet
    const summary = [...infoRows]
    for (const s of stats) { summary.push([], ...(s.title ? [[{ v: s.title, s: 'bold' }]] : []), [{ v: 'Metric', s: 'header' }, { v: 'Value', s: 'header' }], ...s.items.map((i) => [i.label, typeof i.value === 'number' ? { v: i.value, s: Number.isInteger(i.value) ? 'int' : 'number' } : plain(i.value)])) }
    const charts = doc.sections.filter((s) => s.type === 'image').map((s) => s.title).filter(Boolean)
    if (charts.length) summary.push([], [{ v: 'Charts in this report', s: 'bold' }], ...charts.map((c) => [c]), [{ v: 'The chart pictures are in the PDF export; their figures are on the sheets of this workbook.', s: 'note' }])
    sheets.push({ name: sheetName('Summary', used), rows: summary, cols: [{ width: 34 }, { width: 30 }] })
    for (const t of tables) sheets.push(dataSheet(sheetName(t.title || 'Table', used), t))
  }
  return buildXlsx(sheets)
}

// ---- PDF -------------------------------------------------------------------------------------------------------------------------------------
// WinAnsi is what the standard PDF fonts can draw; anything else is written in plain letters rather than failing.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''))
const REPLACE = { '₹': 'Rs.', '→': '->', '←': '<-', '↑': '^', '↓': 'v', '✓': 'Yes', '✔': 'Yes', '✗': 'No', '×': 'x', '·': '·', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '≥': '>=', '≤': '<=', '›': '>', '‹': '<' }
export function pdfSafe(text) {
  let out = ''
  for (const ch of String(plain(text))) {
    const code = ch.codePointAt(0)
    if (REPLACE[ch] !== undefined) out += REPLACE[ch]
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) out += ch
    else if (code === 9) out += ' '
    else if (code < 32) out += ''
    else out += '?'
  }
  return out
}

const MAX_PDF_ROWS = 3000
export async function buildPdfFile(doc) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const tables = doc.sections.filter((s) => s.type === 'table')
  const widest = Math.max(0, ...tables.map((t) => t.columns.length))
  const landscape = widest > 6
  const PAGE = landscape ? [841.89, 595.28] : [595.28, 841.89]
  const M = 36 // margin
  const W = PAGE[0] - M * 2
  const ink = rgb(0.06, 0.09, 0.16); const muted = rgb(0.39, 0.45, 0.55); const brand = rgb(0.486, 0.227, 0.929); const line = rgb(0.89, 0.91, 0.94); const band = rgb(0.972, 0.976, 0.984)
  const pages = []
  let page; let y
  const newPage = () => { page = pdf.addPage(PAGE); pages.push(page); y = PAGE[1] - M - 14 }
  const need = (h) => { if (y - h < M + 18) newPage() }
  const width = (t, f, size) => f.widthOfTextAtSize(t, size)
  const fit = (text, f, size, max) => { // one line that fits: cut with an ellipsis
    let t = pdfSafe(text)
    if (width(t, f, size) <= max) return t
    while (t.length > 1 && width(`${t}...`, f, size) > max) t = t.slice(0, -1)
    return `${t}...`
  }
  const wrap = (text, f, size, max, maxLines) => { // greedy word wrap, long words broken; at most maxLines, the last ends with "..."
    const words = pdfSafe(text).split(/\s+/).filter(Boolean)
    const lines = []; let cur = ''
    const push = (l) => lines.push(l)
    for (let w of words) {
      while (width(w, f, size) > max) { // a word wider than the cell
        let cut = w.length
        while (cut > 1 && width(w.slice(0, cut), f, size) > max) cut -= 1
        if (cur) { push(cur); cur = '' }
        push(w.slice(0, cut)); w = w.slice(cut)
      }
      const next = cur ? `${cur} ${w}` : w
      if (width(next, f, size) <= max) cur = next
      else { push(cur); cur = w }
    }
    if (cur || !lines.length) push(cur)
    if (lines.length > maxLines) { const kept = lines.slice(0, maxLines); kept[maxLines - 1] = fit(`${kept[maxLines - 1]}...`, f, size, max); return kept }
    return lines
  }
  const text = (t, x, yy, { f = font, size = 9, color = ink } = {}) => page.drawText(pdfSafe(t), { x, y: yy, font: f, size, color })

  newPage()
  // heading
  text(doc.title, M, y, { f: bold, size: 17, color: ink }); y -= 8
  page.drawRectangle({ x: M, y: y - 3, width: 44, height: 2.5, color: brand }); y -= 16
  if (doc.subtitle) { for (const l of wrap(doc.subtitle, font, 9.5, W, 2)) { text(l, M, y, { size: 9.5, color: muted }); y -= 12 } y -= 2 }
  for (const [k, v] of doc.meta || []) {
    const lines = wrap(String(plain(v)), font, 8.5, W - 82, 3)
    need(lines.length * 11)
    text(`${k}`, M, y, { f: bold, size: 8.5, color: muted })
    lines.forEach((l, i) => text(l, M + 82, y - i * 11, { size: 8.5, color: ink }))
    y -= lines.length * 11
  }
  y -= 8

  for (let section of doc.sections) {
    if (section.title) { need(34); text(section.title, M, y, { f: bold, size: 11.5 }); y -= 6; if (section.subtitle) { y -= 8; text(pdfSafe(section.subtitle), M, y, { size: 8.5, color: muted }) } y -= 12 }
    if (section.type === 'stats') {
      const cols = landscape ? 4 : 3; const gap = 8; const bw = (W - gap * (cols - 1)) / cols; const bh = 42
      for (let i = 0; i < section.items.length; i += cols) {
        need(bh + gap)
        section.items.slice(i, i + cols).forEach((it, j) => {
          const x = M + j * (bw + gap)
          page.drawRectangle({ x, y: y - bh, width: bw, height: bh, color: band, borderColor: line, borderWidth: 0.6 })
          text(fit(it.label, font, 8, bw - 14), x + 7, y - 14, { size: 8, color: muted })
          text(fit(String(plain(it.value)), bold, 13, bw - 14), x + 7, y - 33, { f: bold, size: 13 })
        })
        y -= bh + gap
      }
      y -= 6
    } else if (section.type === 'image') {
      const img = await pdf.embedPng(section.png)
      const w = Math.min(W, section.width * 0.75); const h = (w / section.width) * section.height
      need(h + 10)
      page.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 12
    } else {
      const capped = section.rows.length > MAX_PDF_ROWS
      if (capped) section = { ...section, rows: section.rows.slice(0, MAX_PDF_ROWS), note: `Only the first ${MAX_PDF_ROWS.toLocaleString('en-IN')} of ${section.rows.length.toLocaleString('en-IN')} rows are shown here. Use the Excel or CSV export for every row.` }
      const cols = section.columns; const n = cols.length; const size = 8; const padX = 4
      // natural width of every column (capped), then scaled to the page
      const natural = cols.map((c, i) => Math.min(190, Math.max(width(pdfSafe(c.label), bold, size) + padX * 2 + 2, ...section.rows.slice(0, 200).map((r) => width(pdfSafe(r[i]), font, size) + padX * 2))))
      // a column never gets narrower than its longest unbroken word (ids, amounts, dates stay whole); the rest of the page is shared out in proportion to how much more room each column wants
      const cellText = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(plain(v)))
      const wordMax = (t, f) => Math.max(0, ...pdfSafe(t).split(/\s+/).map((w) => width(w, f, size)))
      const longest = (i) => Math.min(120, Math.max(wordMax(cols[i].label, bold), ...section.rows.slice(0, 200).map((r) => wordMax(cellText(r[i]), font))) + padX * 2 + 2)
      const mins = cols.map((_, i) => longest(i))
      const total = natural.reduce((a, b) => a + b, 0)
      let cw
      if (total <= W) cw = natural.map((w) => w + (W - total) / n)
      else {
        const minSum = mins.reduce((a, b) => a + b, 0)
        if (minSum >= W) cw = mins.map((w) => (w / minSum) * W)
        else {
          const want = natural.map((w, i) => Math.max(0, w - mins[i])); const wantSum = want.reduce((a, b) => a + b, 0) || 1
          cw = mins.map((m, i) => m + ((W - minSum) * want[i]) / wantSum)
        }
      }
      const numeric = cols.map((c, i) => c.align === 'right' || (section.rows.length > 0 && section.rows.slice(0, 50).every((r) => typeof r[i] === 'number' || r[i] === '' || r[i] === null)))
      const drawHeader = () => {
        need(26)
        page.drawRectangle({ x: M, y: y - 17, width: W, height: 19, color: brand })
        let x = M
        cols.forEach((c, i) => { const t = fit(c.label, bold, size, cw[i] - padX * 2); text(t, numeric[i] ? x + cw[i] - padX - width(t, bold, size) : x + padX, y - 11, { f: bold, size, color: rgb(1, 1, 1) }); x += cw[i] })
        y -= 19
      }
      if (!section.rows.length) { need(20); text('No rows.', M, y - 10, { size: 9, color: muted }); y -= 22 } else {
        drawHeader()
        section.rows.forEach((row, ri) => {
          const cells = row.map((v, i) => wrap(cellText(v), font, size, cw[i] - padX * 2, 3))
          const lines = Math.max(1, ...cells.map((c) => c.length)); const rh = lines * 10 + 6
          if (y - rh < M + 18) { newPage(); drawHeader() }
          if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - rh, width: W, height: rh, color: band })
          let x = M
          cells.forEach((c, i) => { c.forEach((l, li) => text(l, numeric[i] ? x + cw[i] - padX - width(l, font, size) : x + padX, y - 10 - li * 10, { size })); x += cw[i] })
          y -= rh
          page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.3, color: line })
        })
      }
      if (section.note) { y -= 4; for (const l of wrap(section.note, font, 8, W, 2)) { need(11); text(l, M, y - 8, { size: 8, color: muted }); y -= 11 } }
      y -= 14
    }
  }
  // footer on every page
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 6 }, end: { x: M + W, y: M + 6 }, thickness: 0.4, color: line })
    p.drawText('LAX360 Business CRM', { x: M, y: M - 6, font, size: 7.5, color: muted })
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: M + W - font.widthOfTextAtSize(label, 7.5), y: M - 6, font, size: 7.5, color: muted })
  })
  pdf.setTitle(pdfSafe(doc.title)); pdf.setCreator('LAX360 Business CRM'); pdf.setProducer('LAX360 Business CRM')
  return pdf.save()
}

// ---- charts to pictures (PDF) -----------------------------------------------------------------------------------------------------------------
/** Draws an <svg> (a Recharts chart) onto a white canvas and returns { png, width, height }, or null if the browser cannot. */
export async function svgToPng(svg, scale = 2) {
  try {
    const box = svg.getBoundingClientRect()
    const width = Math.max(10, Math.round(box.width)); const height = Math.max(10, Math.round(box.height))
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', width); clone.setAttribute('height', height)
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
    clone.querySelectorAll('[class]').forEach((n) => { if (/stroke-ink|fill-ink/.test(n.getAttribute('class') || '')) n.setAttribute('stroke', '#e2e8f0') }) // grid lines lose their utility classes outside the page
    clone.style.fontFamily = 'Helvetica, Arial, sans-serif'
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const canvas = document.createElement('canvas'); canvas.width = width * scale; canvas.height = height * scale
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? { png: new Uint8Array(await blob.arrayBuffer()), width, height } : null
  } catch { return null }
}

// ---- save ------------------------------------------------------------------------------------------------------------------------------------
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Builds the file for `format` and downloads it. Resolves with the file name. */
export async function exportDocument(doc, format, name) {
  const base = name || doc.title
  if (format === 'csv') { saveBlob(new Blob([buildCsv(doc)], { type: 'text/csv;charset=utf-8' }), fileName(base, 'csv')); return fileName(base, 'csv') }
  if (format === 'xlsx') { saveBlob(new Blob([await buildXlsxFile(doc)], { type: XLSX_MIME }), fileName(base, 'xlsx')); return fileName(base, 'xlsx') }
  if (format === 'pdf') { saveBlob(new Blob([await buildPdfFile(doc)], { type: 'application/pdf' }), fileName(base, 'pdf')); return fileName(base, 'pdf') }
  throw new Error('Unknown export format')
}

// ---- filters in words ------------------------------------------------------------------------------------------------------------------------
const singular = (w) => (/(ses|ches|shes|xes)$/i.test(w) ? w.slice(0, -2) : /ies$/i.test(w) ? `${w.slice(0, -3)}y` : /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w)
/**
 * What a list was filtered by, as one sentence for the file: the search box, the dropdown filters (`values` keyed like the FilterPanel `defs`, so ids become names) and any extra
 * [label, value] pairs (date ranges ...).
 */
export function filterText({ search, values = {}, defs = [], extra = [] }) {
  const pairs = []
  if (search && String(search).trim()) pairs.push(['Search', `"${String(search).trim()}"`])
  for (const [key, value] of Object.entries(values)) {
    if (isBlank(value)) continue
    const def = defs.find((d) => d.key === key)
    const option = def?.options?.find((o) => String(o.value) === String(value))
    pairs.push([def ? singular(def.label) : key, option ? option.label : value])
  }
  return describeFilters([...pairs, ...extra])
}

// ---- CSV that the server wrote (invoices, payments, expenses, the marketing reports) ------------------------------------------------------------
/**
 * The server writes these exports itself (it checks the Export right, hides what the role may not see and records the export in the audit log). The page asks for that CSV and
 * keeps only the rows it is showing: `keep` is a Set of the values of column `keyColumn` (e.g. the invoice numbers on screen). Columns that hold only plain numbers become numbers.
 * Returns null when nothing is left.
 */
export function documentFromCsv({ title, csv, keep, keyColumn = 0, filters, user, branch }) {
  const all = parseCsvRows(csv).map((r) => r.cells).filter((r) => r.some((c) => c !== ''))
  if (all.length < 2) return null
  const [head, ...body] = all
  const rows = keep ? body.filter((r) => keep.has(r[keyColumn])) : body
  if (!rows.length) return null
  const labelsKeepText = /number|reference|code|phone|\bid\b|date|invoice|sales order|project|deal|customer|company|name|source/i
  const numeric = head.map((h, i) => !labelsKeepText.test(h) && rows.every((r) => r[i] === '' || /^-?(0|[1-9]\d*)(\.\d+)?$/.test(r[i])) && rows.some((r) => r[i] !== ''))
  const cells = rows.map((r) => head.map((_, i) => (numeric[i] && r[i] !== '' ? Number(r[i]) : r[i] === undefined ? '' : r[i])))
  const doc = listDocument({ title, columns: [], rows: [], filters, user, branch })
  doc.meta = doc.meta.map(([k, v]) => (k === 'Records' ? [k, String(cells.length)] : [k, v]))
  doc.sections = [{ type: 'table', columns: head.map((label, i) => ({ label, align: numeric[i] ? 'right' : undefined })), rows: cells }]
  return doc
}
