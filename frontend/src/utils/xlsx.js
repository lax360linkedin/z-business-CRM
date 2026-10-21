// A small .xlsx writer and reader (an .xlsx file is a zip of XML parts; JSZip does the zipping). Written for the import templates: header styling, frozen header, column widths, default column
// formats, dropdown / date / number validation, and reading back what Excel, LibreOffice or Google Sheets saved. No DOM is used, so it also runs under Node (scripts/check-import-kit.mjs).
import JSZip from 'jszip'

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

// ---- writing ---------------------------------------------------------------------------------------------------------------------------
// style name -> cellXfs index in the stylesheet below
const STYLE = { default: 0, header: 1, headerRequired: 2, text: 3, date: 4, title: 5, bold: 6, wrap: 7, example: 8, number: 9, note: 10, int: 11 }

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="11"/><color rgb="FF475569"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF5B21B6"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7C3AED"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5B21B6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colName(index) {
  let n = index + 1
  let out = ''
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26) }
  return out
}

const esc = (value) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function cellXml(ref, cell) {
  const spec = cell !== null && typeof cell === 'object' ? cell : { v: cell }
  const s = STYLE[spec.s] ?? 0
  const attr = s ? ` s="${s}"` : ''
  if (spec.v === null || spec.v === undefined || spec.v === '') return s ? `<c r="${ref}"${attr}/>` : ''
  if (typeof spec.v === 'number' && Number.isFinite(spec.v)) return `<c r="${ref}"${attr}><v>${spec.v}</v></c>`
  return `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${esc(spec.v)}</t></is></c>`
}

function validationXml(v) {
  const attrs = [`type="${v.type}"`]
  if (v.operator) attrs.push(`operator="${v.operator}"`)
  attrs.push(`errorStyle="${v.warning ? 'warning' : 'stop'}"`, 'allowBlank="1"', 'showInputMessage="1"', 'showErrorMessage="1"')
  if (v.title) attrs.push(`promptTitle="${esc(v.title.slice(0, 32))}"`)
  if (v.prompt) attrs.push(`prompt="${esc(v.prompt.slice(0, 255))}"`)
  if (v.errorTitle) attrs.push(`errorTitle="${esc(v.errorTitle.slice(0, 32))}"`)
  if (v.error) attrs.push(`error="${esc(v.error.slice(0, 255))}"`)
  attrs.push(`sqref="${v.sqref}"`)
  return `<dataValidation ${attrs.join(' ')}><formula1>${esc(v.formula1)}</formula1>${v.formula2 ? `<formula2>${esc(v.formula2)}</formula2>` : ''}</dataValidation>`
}

/** sheet: { name, rows: [[cell | { v, s }]], cols: [{ width, style }], freezeRows, validations: [{ type, sqref, formula1, ... }], tabColor } */
function sheetXml(sheet) {
  const rows = sheet.rows || []
  const cols = (sheet.cols || []).map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"${c.style && STYLE[c.style] ? ` style="${STYLE[c.style]}"` : ''}/>`).join('')
  const freeze = sheet.freezeRows ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` : ''
  const data = rows.map((row, r) => {
    const height = sheet.rowHeights?.[r] ? ` ht="${sheet.rowHeights[r]}" customHeight="1"` : ''
    return `<row r="${r + 1}"${height}>${row.map((cell, c) => cellXml(`${colName(c)}${r + 1}`, cell)).join('')}</row>`
  }).join('')
  const validations = sheet.validations?.length ? `<dataValidations count="${sheet.validations.length}">${sheet.validations.map(validationXml).join('')}</dataValidations>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${REL_NS}">${sheet.tabColor ? `<sheetPr><tabColor rgb="${sheet.tabColor}"/></sheetPr>` : ''}<sheetViews><sheetView workbookViewId="0"${sheet.selected ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${validations}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
}

/** Builds a workbook. Sheet names: at most 31 characters, none of  \ / ? * [ ] : */
export async function buildXlsx(sheets) {
  const zip = new JSZip()
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`)
  zip.file('xl/styles.xml', STYLES_XML)
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml({ ...s, selected: i === 0 })))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: MIME })
}

export const XLSX_MIME = MIME

// ---- reading ---------------------------------------------------------------------------------------------------------------------------
const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const attrOf = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : null }
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')

function colIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() || 'A'
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const looksLikeDate = (code) => /[dmyhs]/i.test(String(code).replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, ''))

/** Excel serial day number -> yyyy-mm-dd (1900 date system) */
export function serialToIso(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(serial)) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

async function readPart(zip, path) {
  const file = zip.file(path.replace(/^\//, ''))
  return file ? file.async('string') : null
}

/** An .xlsx file -> { sheets: [{ name, rows: [{ n, cells: [string] }] }] } (n = the row number in the spreadsheet; dates come back as yyyy-mm-dd) */
export async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const workbook = await readPart(zip, 'xl/workbook.xml')
  if (!workbook) throw new Error('This is not an Excel (.xlsx) workbook.')
  const rels = (await readPart(zip, 'xl/_rels/workbook.xml.rels')) || ''
  const targets = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attrOf(m[0], 'Id'), attrOf(m[0], 'Target')]))
  const shared = [...((await readPart(zip, 'xl/sharedStrings.xml')) || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  const styles = (await readPart(zip, 'xl/styles.xml')) || ''
  const customFormats = Object.fromEntries([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [attrOf(m[0], 'numFmtId'), attrOf(m[0], 'formatCode')]))
  const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || ''
  const dateStyle = [...xfBlock.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrOf(m[0], 'numFmtId') || 0)
    return BUILTIN_DATE_FORMATS.has(id) || (customFormats[id] !== undefined && looksLikeDate(customFormats[id]))
  })

  const sheets = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attrOf(m[0], 'name')
    const target = targets[attrOf(m[0], 'r:id')]
    if (!target) continue
    const xml = await readPart(zip, target.startsWith('/') ? target : `xl/${target}`)
    if (!xml) continue
    const rows = []
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const n = Number(attrOf(rm[1], 'r')) || rows.length + 1
      const cells = []
      let next = 0
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attrOf(cm[1], 'r')
        const at = ref ? colIndex(ref) : next
        next = at + 1
        const type = attrOf(cm[1], 't')
        const body = cm[2] || ''
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
        let value = ''
        if (type === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] || '')
        else if (raw === undefined) value = ''
        else if (type === 's') value = shared[Number(raw)] ?? ''
        else if (type === 'str' || type === 'd') value = decode(raw)
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'e') value = ''
        else value = dateStyle[Number(attrOf(cm[1], 's') || 0)] && Number.isFinite(Number(raw)) ? serialToIso(raw) : decode(raw)
        cells[at] = value
      }
      rows.push({ n, cells: Array.from(cells, (c) => c ?? '') })
    }
    sheets.push({ name, rows })
  }
  return { sheets }
}

// ---- CSV -------------------------------------------------------------------------------------------------------------------------------
/** RFC 4180 CSV text (quoted fields, doubled quotes, commas and line breaks inside quotes) -> [{ n, cells }]. Semicolon-separated files (some Excel locales) are recognised. */
export function parseCsvRows(text) {
  const s = text.replace(/^﻿/, '')
  const firstLine = s.split(/\r?\n/, 1)[0] || ''
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = []
  let cur = ''
  let quoted = false
  let line = 1
  let startLine = 1
  const push = () => { row.push(cur); cur = '' }
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i += 1 } else if (ch === '"') quoted = false
      else { cur += ch; if (ch === '\n') line += 1 }
    } else if (ch === '"') quoted = true
    else if (ch === sep) push()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1
      push(); rows.push({ n: startLine, cells: row.map((c) => c.trim()) }); row = []; line += 1; startLine = line
    } else cur += ch
  }
  if (cur !== '' || row.length) { push(); rows.push({ n: startLine, cells: row.map((c) => c.trim()) }) }
  return rows
}

/** A chosen file (.xlsx or .csv) -> { sheets: [{ name, rows }] } */
export async function readSpreadsheet(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer.slice(0, 4))
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK": an .xlsx / .xlsm package
  if (isZip) return readXlsx(buffer)
  if (/\.xls$/i.test(file.name || '')) throw new Error('This is an old Excel (.xls) file. Open it in Excel and use Save As → Excel Workbook (.xlsx), then upload that.')
  return { sheets: [{ name: 'CSV', rows: parseCsvRows(new TextDecoder('utf-8').decode(buffer)) }] }
}
