// Turns an open report page into an export document: its key figures, its charts (as pictures for the PDF and as the table of figures behind them) and its tables, in the
// order they appear. It reads what is on screen, so a file always matches the page the person is looking at (same data, same branch, same permissions).
import { getChartData } from './chartData'
import { svgToPng, tableSection } from './exporter'

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
// plain numbers become numbers (so Excel can add them up); anything with a symbol, unit or leading zero stays text exactly as shown
const asCell = (s) => (/^-?(0|[1-9]\d{0,2}(,\d{3})*|[1-9]\d*)(\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : s)

function readTable(table) {
  const headCells = [...table.querySelectorAll('thead tr:first-child th')]
  const body = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.getAttribute('aria-hidden') !== 'true')
  const rows = body.map((tr) => [...tr.children].map((td) => asCell(clean(td.textContent))))
  const width = Math.max(headCells.length, ...rows.map((r) => r.length), 0)
  const columns = Array.from({ length: width }, (_, i) => ({ label: clean(headCells[i]?.textContent) || (headCells.length ? `Column ${i + 1}` : i === 0 ? 'Item' : 'Value') }))
  return { columns, rows: rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? '' : r[i]))) }
}

const label = (key) => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** root: the element that holds the whole report. */
export async function captureReport(root, { title, subtitle, user, branch, withCharts = false }) {
  const sections = []
  let stats = null
  const flushStats = () => { if (stats?.items.length) sections.push(stats); stats = null }
  const nodes = [...root.querySelectorAll('[data-stat], [data-card]')].filter((n) => !n.parentElement.closest('[data-card]') || n.hasAttribute('data-card'))
  for (const node of nodes) {
    if (node.hasAttribute('data-stat')) {
      if (node.closest('[data-card]')) continue
      stats = stats || { type: 'stats', title: 'Key figures', items: [] }
      stats.items.push({ label: clean(node.querySelector('[data-stat-label]')?.textContent), value: clean(node.querySelector('[data-stat-value]')?.textContent) })
      continue
    }
    flushStats()
    const cardTitle = clean(node.querySelector('[data-card-title]')?.textContent) || 'Details'
    const cardSub = clean(node.querySelector('[data-card-subtitle]')?.textContent)
    const info = getChartData(node.getAttribute('data-chart-id'))
    const svg = node.querySelector('svg.recharts-surface')
    if (svg && withCharts) {
      const pic = await svgToPng(svg)
      if (pic) sections.push({ type: 'image', title: cardTitle, subtitle: cardSub, ...pic })
    }
    const tables = [...node.querySelectorAll('table')]
    if (svg && info?.data) {
      const keys = Object.keys(info.data[0])
      sections.push(tableSection(keys.map((k) => ({ label: label(k), value: k })), info.data, { title: svg && withCharts ? `${cardTitle} - figures` : cardTitle, note: cardSub || undefined }))
    }
    tables.forEach((t, i) => {
      const { columns, rows } = readTable(t)
      if (rows.length) sections.push({ type: 'table', title: tables.length > 1 ? `${cardTitle} (${i + 1})` : cardTitle, note: cardSub || undefined, columns, rows })
    })
  }
  flushStats()
  // tables that sit outside any card (a plain list in the page)
  for (const t of root.querySelectorAll('table')) {
    if (t.closest('[data-card]')) continue
    const { columns, rows } = readTable(t)
    if (rows.length) sections.push({ type: 'table', title: 'Details', columns, rows })
  }
  const now = new Date()
  return {
    title,
    subtitle,
    meta: [['Exported by', user || '—'], ['Exported on', now.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })], ...(branch ? [['Branch', branch]] : [])],
    sections,
  }
}
