// Excel / CSV import support shared by every module that imports (Leads, Enquiries, Employees). Everything here is driven by the SCHEMA the server publishes for the module
// (GET /imports/<module>/schema: columns, which are required, the allowed values read live from the CRM), so the template people download, the headers read back from their
// file and the checks the server applies are one description - not three lists that can drift apart.
import { buildXlsx, readSpreadsheet, XLSX_MIME } from './xlsx.js'

export const DATA_ROWS = 1000 // rows of the template that carry dropdowns and formats
const LISTS_SHEET = 'Lists'

export const norm = (text) => String(text ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '')

const KIND_LABEL = { text: 'Text', email: 'Email address', phone: 'Phone number', date: 'Date (yyyy-mm-dd)', number: 'Number', choice: 'One of the listed values', suggest: 'Pick from the list or type your own' }

/** Header text shown in the template: required columns carry a star. */
export const headerText = (c) => (c.required ? `${c.header} *` : c.header)

const listRef = (listIndex, size) => `${LISTS_SHEET}!$${columnLetter(listIndex)}$2:$${columnLetter(listIndex)}$${size + 1}`
const columnLetter = (i) => { let n = i + 1; let out = ''; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26) } return out }

/** The template workbook (as bytes): the data sheet with the module's real headers, dropdowns and formats; an Instructions sheet; an Examples sheet; the Lists the dropdowns read. */
export async function buildTemplate(schema) {
  const cols = schema.columns
  const lastRow = DATA_ROWS + 1
  const listed = cols.map((c, i) => ({ c, i })).filter(({ c }) => c.options?.length && (c.kind === 'choice' || c.kind === 'suggest'))
  const listIndex = new Map(listed.map(({ i }, n) => [i, n]))

  const validations = []
  cols.forEach((c, i) => {
    const letter = columnLetter(i)
    const sqref = `${letter}2:${letter}${lastRow}`
    const prompt = [c.help, c.default ? `Empty: ${c.default}.` : ''].filter(Boolean).join(' ')
    if (listIndex.has(i)) {
      const strict = c.kind === 'choice'
      validations.push({ type: 'list', sqref, formula1: listRef(listIndex.get(i), c.options.length), warning: !strict, title: c.header, prompt, errorTitle: strict ? 'Not an allowed value' : 'Not on the list', error: strict ? `Choose one of the listed values for ${c.header}.` : 'This value is not on the list; it will still be accepted.' })
    } else if (c.kind === 'date') {
      validations.push({ type: 'date', operator: 'greaterThanOrEqual', sqref, formula1: '1', title: c.header, prompt: prompt || 'yyyy-mm-dd', errorTitle: 'Not a date', error: `Enter ${c.header} as a date, for example 2026-12-31.` })
    } else if (c.kind === 'number') {
      validations.push({ type: 'decimal', operator: 'greaterThanOrEqual', sqref, formula1: '0', title: c.header, prompt, errorTitle: 'Not a number', error: `${c.header} must be a number of 0 or more.` })
    } else if (c.kind === 'email') {
      validations.push({ type: 'custom', sqref, formula1: `ISNUMBER(FIND("@",${letter}2))`, title: c.header, prompt, errorTitle: 'Not an email', error: `${c.header} must be an email address.` })
    } else if (c.maxLen) {
      validations.push({ type: 'textLength', operator: 'lessThanOrEqual', sqref, formula1: String(c.maxLen), title: c.header, prompt, errorTitle: 'Too long', error: `${c.header} can have at most ${c.maxLen} characters.` })
    }
  })

  const data = {
    name: schema.sheet,
    tabColor: 'FF7C3AED',
    freezeRows: 1,
    rowHeights: { 0: 30 },
    cols: cols.map((c) => ({ width: Math.max(c.width || 18, headerText(c).length + 4), style: c.kind === 'date' ? 'date' : c.kind === 'phone' || c.key === 'employeeId' ? 'text' : c.kind === 'number' ? 'number' : null })),
    rows: [cols.map((c) => ({ v: headerText(c), s: c.required ? 'headerRequired' : 'header' }))],
    validations,
  }

  const exampleCount = Math.max(1, ...cols.map((c) => c.examples?.length || 0))
  const examples = {
    name: 'Examples',
    tabColor: 'FF94A3B8',
    freezeRows: 1,
    cols: data.cols.map((c) => ({ width: c.width })),
    rows: [cols.map((c) => ({ v: headerText(c), s: c.required ? 'headerRequired' : 'header' })), ...Array.from({ length: exampleCount }, (_, n) => cols.map((c) => ({ v: c.examples?.[n] ?? '', s: 'example' })))],
  }

  const how = [
    `1. Fill in the “${schema.sheet}” sheet: one row per record, starting directly under the headers. Do not rename, reorder or delete the header row.`,
    '2. Columns marked with * are required. Columns with a dropdown only accept the listed values (the Lists sheet shows them all).',
    '3. Dates: yyyy-mm-dd (for example 2026-12-31). Numbers: digits only, no currency symbols.',
    '4. Save the file as .xlsx (or .csv) and upload it with the Import button in the CRM. Every row is checked first and you see what would be imported before anything is saved.',
    '5. The “Examples” sheet shows sample rows. They are NOT part of the import: do not leave them in the data sheet.',
  ]
  const instructions = {
    name: 'Instructions',
    tabColor: 'FF10B981',
    cols: [{ width: 26 }, { width: 11 }, { width: 28 }, { width: 70 }, { width: 34 }],
    rows: [
      [{ v: `${schema.label} import template`, s: 'title' }],
      [{ v: 'Generated from the CRM, so the columns and allowed values match what the import accepts today.', s: 'note' }],
      [],
      [{ v: 'How to use this file', s: 'bold' }],
      ...how.map((t) => [{ v: t, s: 'default' }]),
      [],
      [{ v: 'Things to know', s: 'bold' }],
      ...schema.notes.map((t) => [{ v: `• ${t}`, s: 'default' }]),
      [],
      [{ v: 'Columns', s: 'bold' }],
      ['Column', 'Required', 'Format', 'Details', 'Example'].map((v) => ({ v, s: 'header' })),
      ...cols.map((c) => [
        { v: c.header, s: 'bold' },
        { v: c.required ? 'Yes' : 'No', s: 'default' },
        { v: KIND_LABEL[c.kind] || 'Text', s: 'wrap' },
        { v: [c.help, c.default ? `If left empty: ${c.default}.` : '', c.options?.length && c.kind === 'choice' ? `Allowed: ${c.options.slice(0, 12).join(', ')}${c.options.length > 12 ? ', … (see the Lists sheet)' : ''}.` : ''].filter(Boolean).join(' '), s: 'wrap' },
        { v: c.examples?.[0] ?? '', s: 'wrap' },
      ]),
    ],
  }

  const longest = Math.max(0, ...listed.map(({ c }) => c.options.length))
  const lists = {
    name: LISTS_SHEET,
    tabColor: 'FFF59E0B',
    cols: listed.map(({ c }) => ({ width: Math.max(18, c.header.length + 4) })),
    rows: [listed.map(({ c }) => ({ v: c.header, s: 'header' })), ...Array.from({ length: longest }, (_, r) => listed.map(({ c }) => c.options[r] ?? ''))],
  }
  return buildXlsx([data, instructions, examples, ...(listed.length ? [lists] : [])])
}

export function downloadBytes(bytes, filename, mime = XLSX_MIME) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const templateFileName = (schema) => `LAX360-${schema.label.replace(/\s+/g, '-')}-Import-Template.xlsx`

/**
 * An uploaded file (.xlsx or .csv) -> { rows, problem, unknownHeaders }. `rows` are objects keyed by the schema's column keys, each with `_row` (the row number in the spreadsheet).
 * Headers are matched by their text, key or known alias, ignoring case, the required star and anything in brackets.
 */
export async function readImportFile(file, schema) {
  const book = await readSpreadsheet(file)
  const byName = book.sheets.find((s) => norm(s.name) === norm(schema.sheet)) || null
  const candidates = byName ? [byName, ...book.sheets.filter((s) => s !== byName)] : book.sheets
  const names = schema.columns.map((c) => [c.key, new Set([c.header, c.key, ...(c.aliases || [])].map(norm))])
  const recognised = (cells) => cells.filter((h) => names.some(([, set]) => set.has(norm(h)))).length
  const sheet = candidates.find((s) => s.rows[0] && recognised(s.rows[0].cells) >= 1) || null
  if (!sheet) return { rows: [], problem: `No sheet in this file has the ${schema.label.toLowerCase()} column headers. Start from the downloaded Excel template and keep its header row.`, unknownHeaders: [] }

  const head = sheet.rows[0].cells
  const keyAt = head.map((h) => names.find(([, set]) => set.has(norm(h)))?.[0] || null)
  const missing = schema.columns.filter((c) => c.required && c.key !== 'branch' && !keyAt.includes(c.key)).map((c) => c.header)
  if (missing.length) return { rows: [], problem: `The file has no “${missing.join('”, “')}” column. Required columns must be present: start from the Excel template.`, unknownHeaders: [] }
  const unknownHeaders = head.filter((h, i) => String(h).trim() && !keyAt[i])

  const rows = []
  for (const r of sheet.rows.slice(1)) {
    const values = { _row: r.n }
    let any = false
    keyAt.forEach((key, i) => {
      if (!key) return
      const v = String(r.cells[i] ?? '').trim()
      values[key] = v
      if (v) any = true
    })
    if (any) rows.push(values)
  }
  if (!rows.length) return { rows: [], problem: 'The file has headers but no data rows.', unknownHeaders }
  if (rows.length > schema.maxRows) return { rows: [], problem: `The file has ${rows.length} rows; at most ${schema.maxRows} can be imported at a time. Split it into smaller files.`, unknownHeaders }
  return { rows, problem: '', unknownHeaders }
}

/** The rows that did not import, with the reason beside each, as a workbook in the template's own layout (fix the rows, delete the Problem column, upload again). */
export async function buildProblemReport(schema, rows, problemsByRow) {
  const cols = schema.columns
  return buildXlsx([{
    name: 'Rows to fix',
    freezeRows: 1,
    cols: [...cols.map((c) => ({ width: c.width || 18, style: c.kind === 'phone' ? 'text' : null })), { width: 70 }],
    rows: [
      [...cols.map((c) => ({ v: headerText(c), s: c.required ? 'headerRequired' : 'header' })), { v: 'Problem (delete this column before uploading again)', s: 'header' }],
      ...rows.filter((r) => problemsByRow.get(r._row)?.length).map((r) => [...cols.map((c) => r[c.key] ?? ''), { v: problemsByRow.get(r._row).join('; '), s: 'wrap' }]),
    ],
  }])
}
