// Which figures each on-screen chart was drawn from (filled by ChartCard and the Marketing Analytics cards), so a report export can include them as a table next to the chart picture.
import { Children, isValidElement } from 'react'

const charts = new Map()
export const setChartData = (id, info) => { charts.set(id, info) }
export const dropChartData = (id) => { charts.delete(id) }
export const getChartData = (id) => charts.get(id) || null

const KEYS = ['data', 'rows', 'steps']
const isRows = (d) => Array.isArray(d) && d.length > 0 && d.every((r) => r && typeof r === 'object' && !Array.isArray(r))

/** The figures behind a chart live in the props of the chart element inside its card (<BarChart data=...>, <RankBars rows=...>). Returns the first array of records found, or null. */
export function findChartData(node, depth = 0) {
  if (depth > 12) return null
  let found = null
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return
    for (const k of KEYS) if (isRows(child.props?.[k])) { found = child.props[k]; return }
    found = findChartData(child.props?.children, depth + 1)
  })
  return found
}
