// Round-trip check for the Excel import kit (src/utils/xlsx.js + importKit.js): build a template from a schema, read it back, and read files the way Excel / CSV save them.
// Run with `npm run check:import`. Pass a folder as the first argument to also write the generated template there (used to open it with an independent library).
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildTemplate, readImportFile, buildProblemReport, norm } from '../src/utils/importKit.js'
import { buildXlsx, readXlsx, parseCsvRows, serialToIso } from '../src/utils/xlsx.js'

const schema = {
  module: 'leads', label: 'Leads', sheet: 'Leads', mode: 'partial', maxRows: 500, blocked: null, notes: ['Every imported lead starts with the status New.'],
  columns: [
    { key: 'name', header: 'Contact Name', kind: 'text', required: true, options: null, examples: ['Meera Iyer', 'Arjun Rao'], help: 'The person to contact.', aliases: ['name'], default: '', width: 24, maxLen: 160 },
    { key: 'email', header: 'Email', kind: 'email', required: false, options: null, examples: ['meera@example.com'], help: '', aliases: [], default: '', width: 28, maxLen: 0 },
    { key: 'phone', header: 'Phone', kind: 'phone', required: false, options: null, examples: ['+91 98400 12345'], help: '', aliases: [], default: '', width: 20, maxLen: 0 },
    { key: 'source', header: 'Source', kind: 'choice', required: false, options: ['Website Enquiry Form', 'Customer Referral', 'Phone Call'], examples: ['Phone Call'], help: '', aliases: [], default: 'Import', width: 20, maxLen: 0 },
    { key: 'industry', header: 'Industry', kind: 'suggest', required: false, options: ['Manufacturing', 'Logistics'], examples: [''], help: '', aliases: [], default: '', width: 20, maxLen: 120 },
    { key: 'budget', header: 'Budget (INR)', kind: 'number', required: false, options: null, examples: ['250000'], help: '', aliases: [], default: '', width: 20, maxLen: 0 },
    { key: 'nextFollowUp', header: 'Next Follow-up', kind: 'date', required: false, options: null, examples: ['2026-11-03'], help: '', aliases: [], default: '', width: 20, maxLen: 0 },
  ],
}
const problems = []
const expect = (cond, message) => { if (!cond) problems.push(message) }

// 1. the template: right sheets, headers (required ones starred), validations, lists
const bytes = await buildTemplate(schema)
const book = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
expect(book.sheets.map((s) => s.name).join('|') === 'Leads|Instructions|Examples|Lists', `sheet names: ${book.sheets.map((s) => s.name)}`)
const header = book.sheets[0].rows[0].cells
expect(header.join('|') === 'Contact Name *|Email|Phone|Source|Industry|Budget (INR)|Next Follow-up', `headers: ${header}`)
expect(book.sheets[0].rows.length === 1, 'the data sheet must contain only the header row (examples live on their own sheet)')
expect(book.sheets[2].rows[1].cells[0] === 'Meera Iyer' && book.sheets[3].rows[0].cells.join('|') === 'Source|Industry', 'examples / lists sheets')
if (process.argv[2]) writeFileSync(path.join(process.argv[2], 'template.xlsx'), bytes)

// 2. what a person saves from the template (re-written by "Excel": shared strings, numeric dates) is read back with the right values
const filled = await buildXlsx([{ name: 'Leads', rows: [header.map((h) => h), ['Asha Verma', 'asha@example.com', '9840012345', 'phone call', 'Logistics', 125000, '2026-12-01'], ['', '', '', '', '', '', ''], ['Row Three', '', '', '', '', '', '']] }])
const asFile = (data, name) => new File([data], name)
let read = await readImportFile(asFile(filled, 'filled.xlsx'), schema)
expect(!read.problem && read.rows.length === 2, `filled file: ${read.problem} / ${read.rows.length} rows`)
expect(read.rows[0].name === 'Asha Verma' && read.rows[0].budget === '125000' && read.rows[0]._row === 2 && read.rows[1]._row === 4, `values: ${JSON.stringify(read.rows)}`)

// 3. CSV: quotes, commas and line breaks inside fields, BOM, aliases and a different header order
const csv = '﻿Phone,name,Budget,Notes\r\n"+91 98400, 12345","Meera ""M"" Iyer, Esq.",250000,ignored\r\n9876543210,"Two\nLine",,x\r\n'
read = await readImportFile(asFile(csv, 'leads.csv'), schema)
expect(read.rows.length === 2 && read.rows[0].name === 'Meera "M" Iyer, Esq.' && read.rows[0].phone === '+91 98400, 12345' && read.rows[1].name === 'Two\nLine', `csv rows: ${JSON.stringify(read.rows)}`)
expect(read.unknownHeaders.join() === 'Notes' && read.rows[0].budget === '250000', 'csv headers: aliases and unknown columns')
expect(parseCsvRows('a;b\n1;2').at(1).cells.join() === '1,2', 'semicolon-separated CSV')

// 4. things that must be refused plainly
read = await readImportFile(asFile('Foo,Bar\n1,2\n', 'x.csv'), schema)
expect(/column headers/.test(read.problem), `unrelated file: ${read.problem}`)
read = await readImportFile(asFile('Email,Phone\na@b.com,123\n', 'x.csv'), schema)
expect(/Contact Name/.test(read.problem), `missing required column: ${read.problem}`)
read = await readImportFile(asFile('name\n', 'x.csv'), schema)
expect(/no data rows/.test(read.problem), `headers only: ${read.problem}`)
read = await readImportFile(asFile(`name\n${Array.from({ length: 501 }, (_, i) => `L${i}`).join('\n')}`, 'x.csv'), schema)
expect(/501 rows/.test(read.problem), `row limit: ${read.problem}`)
let oldExcel = ''
try { await readImportFile(asFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'old.xls'), schema) } catch (e) { oldExcel = e.message }
expect(/\.xlsx/.test(oldExcel), `old .xls: ${oldExcel}`)

// 5. helpers
expect(norm('Budget (INR)') === 'budget' && norm('Next Follow-up *') === 'nextfollowup' && norm('nextFollowUp') === 'nextfollowup', 'header normalising')
expect(serialToIso(46387) === '2026-12-31' && serialToIso(45292) === '2024-01-01', 'Excel serial dates')
const report = await buildProblemReport(schema, [{ _row: 5, name: 'Bad', email: 'x' }], new Map([[5, ['Email “x” is not a valid email address']]]))
const back = await readXlsx(report.buffer.slice(report.byteOffset, report.byteOffset + report.byteLength))
expect(back.sheets[0].rows[1].cells.at(-1).includes('not a valid email') && back.sheets[0].rows[1].cells[0] === 'Bad', 'problem report')

if (problems.length) { console.error(`Import kit check FAILED (${problems.length}):\n - ${problems.join('\n - ')}`); process.exit(1) }
console.log('Import kit check passed: template layout, .xlsx and .csv reading, problem report.')
