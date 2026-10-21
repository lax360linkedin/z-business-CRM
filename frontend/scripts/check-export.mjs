// Round-trip check for the export engine (src/utils/exporter.js): the same document is written as CSV, Excel and PDF and read back with independent readers
// (our xlsx reader, pdf.js). Run with `npm run check:export`. Pass a folder as the first argument to also keep the generated files there.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readXlsx } from '../src/utils/xlsx.js'
import { buildCsv, buildXlsxFile, buildPdfFile, listDocument, tableSection, documentFromCsv, describeFilters, filterText, pdfSafe, fileName } from '../src/utils/exporter.js'

const problems = []
const expect = (cond, message) => { if (!cond) problems.push(message) }

const rows = [
  { id: 'LD-0001', name: 'Meera Iyer', company: 'Acme, Inc.', budget: 250000, score: 72.5, note: 'says "call back"\nafter 5', status: 'New' },
  { id: 'LD-0002', name: '=HYPERLINK("http://x")', company: 'Rupee ₹ Traders — “Prime”', budget: 0, score: 10, note: '', status: 'Lost' },
  { id: 'LD-0003', name: 'Dr. Venkatachalapathi Ramanujam Subramaniam Iyer', company: 'International Consolidated Manufacturing and Distribution Holdings Private Limited', budget: 1234567.89, score: 99, note: 'x'.repeat(400), status: 'Qualified' },
]
const columns = [
  { label: 'Lead ID', value: 'id' }, { label: 'Name', value: 'name' }, { label: 'Company', value: 'company' }, { label: 'Budget', value: 'budget', align: 'right' }, { label: 'Score', value: 'score', align: 'right' },
  { label: 'Note', value: 'note' }, { label: 'Status', value: 'status' }, { label: 'Owner', value: () => null }, { label: 'Branch', value: () => 'Salem' },
]
const filters = filterText({ search: 'acme', values: { status: 'Qualified', source: 'all' }, defs: [{ key: 'status', label: 'Statuses', options: [{ value: 'Qualified', label: 'Qualified' }] }], extra: [['Created', '2026-01-01 to …']] })
expect(filters === 'Search: "acme" · Status: Qualified · Created: 2026-01-01 to …', `filter sentence: ${filters}`)
expect(describeFilters([['A', 'all'], ['B', '']]) === 'None (all records you can see)', 'no filters should say so')

const doc = listDocument({ title: 'Leads', columns, rows, filters, user: 'Root Admin', branch: 'Salem' })

// 1. CSV: header + rows, quoting, no formula injection, BOM
const csv = buildCsv(doc)
const lines = csv.replace(/^﻿/, '').split('\r\n')
expect(csv.startsWith('﻿'), 'CSV needs the BOM so Excel reads UTF-8')
expect(lines[0] === 'Lead ID,Name,Company,Budget,Score,Note,Status,Owner,Branch', `CSV header: ${lines[0]}`)
expect(lines[1].startsWith('LD-0001,Meera Iyer,"Acme, Inc.",250000,72.5,"says ""call back"" after 5",New,,Salem'), `CSV row 1: ${lines[1]}`)
expect(lines[2].includes("\"'=HYPERLINK") || lines[2].includes("'=HYPERLINK"), `a cell starting with = must be neutralised: ${lines[2]}`)
expect(lines.filter(Boolean).length === 4, `CSV line count ${lines.filter(Boolean).length}`)

// 2. Excel: data sheet at A1 with typed numbers, details on a second sheet
const xbytes = await buildXlsxFile(doc)
const book = await readXlsx(xbytes.buffer.slice(xbytes.byteOffset, xbytes.byteOffset + xbytes.byteLength))
expect(book.sheets.map((s) => s.name).join('|') === 'Leads|Export details', `sheets: ${book.sheets.map((s) => s.name)}`)
const data = book.sheets[0].rows.map((r) => r.cells)
expect(data[0].join('|') === 'Lead ID|Name|Company|Budget|Score|Note|Status|Owner|Branch', `xlsx header: ${data[0]}`)
expect(data.length === 4, `xlsx rows ${data.length}`)
expect(String(data[1][3]) === '250000' && String(data[1][4]) === '72.5', `numbers stay numbers: ${data[1][3]} ${data[1][4]}`)
expect(data[1][2] === 'Acme, Inc.' && data[2][1] === '=HYPERLINK("http://x")', 'text is kept exactly in Excel (it is stored as text, never as a formula)')
const info = book.sheets[1].rows.map((r) => r.cells.join('='))
expect(info.some((l) => l.startsWith('Exported by=Root Admin')) && info.some((l) => l.startsWith('Filters applied=')) && info.some((l) => l === 'Records=3'), `details sheet: ${info.join(' / ')}`)

// 3. PDF: opens, has the title, headings, rows and a page footer; characters outside WinAnsi do not break it
const pbytes = await buildPdfFile(doc)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(pbytes), useSystemFonts: true, isEvalSupported: false }).promise
const textOf = async (d) => { let out = ''; for (let i = 1; i <= d.numPages; i += 1) { const t = await (await d.getPage(i)).getTextContent(); out += `${t.items.map((x) => x.str).join(' ')}\n` } return out }
const text = await textOf(pdfDoc)
expect(pdfDoc.numPages >= 1, 'PDF has pages')
const flat = (t) => t.replace(/\s+/g, '') // pdf.js splits words at font-metric boundaries
expect(['Leads', 'Exportedby', 'RootAdmin', 'LeadID', 'LD-0001', 'Page1of'].every((w) => flat(text).includes(w)), `PDF text: ${text.slice(0, 300)}`)
expect(pdfSafe('₹ 5 — “x” → ok') === 'Rs. 5 — “x” -> ok', `pdfSafe: ${pdfSafe('₹ 5 — “x” → ok')}`)
expect(flat(text).includes('Rs.Traders'), 'the rupee sign is written as Rs. in the PDF')

// 4. A report: key figures + table + chart picture. Excel gets a Summary and one sheet per table, the PDF gets all of it, the CSV is sectioned.
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const report = {
  title: 'Sales Reports', subtitle: 'Pipeline health', meta: [['Exported by', 'Root Admin'], ['Branch', 'Salem']],
  sections: [
    { type: 'stats', title: 'Key figures', items: [{ label: 'Total Deals', value: 17 }, { label: 'Pipeline Value', value: '₹12.4L' }] },
    { type: 'image', title: 'Deals by Stage', subtitle: 'Funnel', png, width: 400, height: 200 },
    tableSection([{ label: 'Stage', value: 'stage' }, { label: 'Count', value: 'count' }], [{ stage: 'Negotiation', count: 5 }, { stage: 'Closed Won', count: 2 }], { title: 'Deals by Stage - figures' }),
  ],
}
const rcsv = buildCsv(report).replace(/^﻿/, '')
expect(rcsv.startsWith('Sales Reports') && rcsv.includes('Metric,Value') && rcsv.includes('Total Deals,17') && rcsv.includes('Stage,Count') && rcsv.includes('Negotiation,5') && !rcsv.includes('PNG'), `report CSV: ${rcsv.slice(0, 200)}`)
const rbook = await readXlsx((await buildXlsxFile(report)).buffer.slice(0))
expect(rbook.sheets.map((s) => s.name).join('|') === 'Summary|Deals by Stage - figures', `report sheets: ${rbook.sheets.map((s) => s.name)}`)
expect(rbook.sheets[0].rows.some((r) => r.cells[0] === 'Total Deals' && String(r.cells[1]) === '17'), 'summary sheet holds the key figures')
const rtext = await textOf(await pdfjs.getDocument({ data: new Uint8Array(await buildPdfFile(report)), useSystemFonts: true, isEvalSupported: false }).promise)
expect(['Keyfigures', 'TotalDeals', 'DealsbyStage', 'Negotiation'].every((w) => flat(rtext).includes(w)), `report PDF: ${rtext.slice(0, 300)}`)

// 5. Big lists: many pages, header repeated on each, the 3,000-row cap says so
const big = listDocument({ title: 'Big', columns: [{ label: 'N', value: 'n' }, { label: 'Name', value: 'name' }], rows: Array.from({ length: 3200 }, (_, i) => ({ n: i + 1, name: `Row ${i + 1}` })), filters: '', user: 'x' })
const bigPdf = await pdfjs.getDocument({ data: new Uint8Array(await buildPdfFile(big)), useSystemFonts: true, isEvalSupported: false }).promise
const bigText = await textOf(bigPdf)
expect(bigPdf.numPages > 20, `big PDF pages ${bigPdf.numPages}`)
expect(flat(bigText).includes('Onlythefirst3,000of3,200rows'), 'the PDF must say it was cut at 3,000 rows')
expect(!flat(bigText).includes('Row3200') && flat(bigText).includes('Row3000'), 'rows past the cap are not drawn')
expect(buildCsv(big).split('\r\n').filter(Boolean).length === 3201, 'CSV carries every row')

// 6. a CSV the server wrote -> the same document, only the rows kept
const server = '﻿Invoice number,Customer,Grand total,Paid\nINV-1,Acme,"1,000.00",0\nINV-2,Beta,2500,2500\nINV-3,Gamma,300.5,\n'
const kept = documentFromCsv({ title: 'Invoices', csv: server, keep: new Set(['INV-2', 'INV-3']), filters: 'Status: Paid', user: 'Root', branch: 'Salem' })
expect(kept.sections[0].rows.length === 2 && kept.sections[0].rows[0][2] === 2500 && kept.sections[0].rows[1][2] === 300.5, `server CSV rows: ${JSON.stringify(kept?.sections[0].rows)}`)
expect(documentFromCsv({ title: 'x', csv: server, keep: new Set(['none']) }) === null, 'nothing left -> null')
expect(/^invoices-\d{4}-\d{2}-\d{2}\.xlsx$/.test(fileName('Invoices', 'xlsx')), `file name ${fileName('Invoices', 'xlsx')}`)

if (process.argv[2]) {
  mkdirSync(process.argv[2], { recursive: true })
  writeFileSync(path.join(process.argv[2], 'leads.xlsx'), xbytes); writeFileSync(path.join(process.argv[2], 'leads.pdf'), pbytes); writeFileSync(path.join(process.argv[2], 'leads.csv'), csv)
  writeFileSync(path.join(process.argv[2], 'report.pdf'), await buildPdfFile(report)); writeFileSync(path.join(process.argv[2], 'report.xlsx'), await buildXlsxFile(report))
}
if (problems.length) { console.error(`Export check FAILED:\n- ${problems.join('\n- ')}`); process.exit(1) }
console.log('Export check passed: CSV, Excel and PDF of a list, a report and a 3,200-row list, server CSV filtering.')
