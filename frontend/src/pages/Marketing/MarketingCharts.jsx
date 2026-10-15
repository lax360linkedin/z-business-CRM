import clsx from 'clsx'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Cell } from 'recharts'
import { formatCurrency } from '../../utils/format'

export const PALETTE = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#8b5cf6', '#ec4899', '#64748b', '#84cc16']
const tip = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
const axis = { fontSize: 11, fill: '#94a3b8' }
export const fmtMoney = (v) => (v === null || v === undefined ? '—' : formatCurrency(v, { compact: true }))
export const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`)

export function NoData({ children = 'No data for the selected filters.' }) { return <div className="flex h-48 items-center justify-center text-sm text-ink-400">{children}</div> }

/** Conversion funnel with the drop-off between stages (counts only — rupee stages are shown as figures underneath). */
export function Funnel({ steps }) {
  const counts = steps.filter((s) => !s.name.includes('₹')); const money = steps.filter((s) => s.name.includes('₹'))
  const max = Math.max(1, ...counts.map((s) => s.value))
  if (counts.every((s) => !s.value)) return <NoData />
  return (
    <div className="space-y-2" role="img" aria-label="Conversion funnel">
      {counts.map((s, i) => { const prev = i ? counts[i - 1].value : null; return (
        <div key={s.name}><div className="mb-0.5 flex justify-between text-xs"><span className="text-ink-600 dark:text-ink-300">{s.name}</span><span className="font-semibold text-ink-800 dark:text-ink-100">{s.value}{prev ? <span className="ml-1.5 font-normal text-ink-400">{Math.round(s.value / prev * 100)}% of {counts[i - 1].name.toLowerCase()}</span> : null}</span></div>
          <div className="h-5 rounded bg-ink-100 dark:bg-ink-800"><div className="h-5 rounded" style={{ width: `${Math.max(2, s.value / max * 100)}%`, background: PALETTE[i % PALETTE.length] }} /></div></div>) })}
      {money.length > 0 && <div className="flex flex-wrap gap-4 border-t border-ink-100 pt-2 text-xs dark:border-ink-800">{money.map((s) => <span key={s.name}><span className="text-ink-400">{s.name.replace(' (₹)', '')}</span> <b className="text-ink-800 dark:text-ink-100">{formatCurrency(s.value, { compact: true })}</b></span>)}</div>}
    </div>
  )
}

export function TrendChart({ data, lines, money }) {
  if (!data?.length || data.every((d) => lines.every((l) => !d[l.key]))) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money ? (v) => formatCurrency(v, { compact: true }) : undefined} allowDecimals={false} />
        <Tooltip contentStyle={tip} formatter={(v, n) => [money ? formatCurrency(v) : v, n]} /><Legend wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l, i) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color || PALETTE[i]} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Horizontal comparison bars (one metric, top N rows). */
export function RankBars({ rows, valueKey, label = 'name', format = (v) => v, onClick, color }) {
  const list = rows.filter((r) => (r[valueKey] || 0) !== 0).slice(0, 8)
  if (!list.length) return <NoData />
  const max = Math.max(...list.map((r) => Math.abs(r[valueKey])), 1)
  return (
    <ul className="space-y-1.5">{list.map((r, i) => (
      <li key={r.id || r[label]} className="text-xs"><div className="flex justify-between gap-2"><button type="button" disabled={!onClick} onClick={() => onClick?.(r)} className={clsx('truncate text-left', onClick && 'hover:underline')}>{r[label]}</button><b className={clsx(r[valueKey] < 0 && 'text-rose-600')}>{format(r[valueKey])}</b></div>
        <div className="mt-0.5 h-1.5 rounded bg-ink-100 dark:bg-ink-800"><div className="h-1.5 rounded" style={{ width: `${Math.abs(r[valueKey]) / max * 100}%`, background: r[valueKey] < 0 ? '#f43f5e' : color || PALETTE[i % PALETTE.length] }} /></div></li>))}</ul>
  )
}

export function SpendVsRevenue({ rows }) {
  const data = rows.filter((r) => r.spend || r.collected).slice(0, 8).map((r) => ({ name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name, Spend: r.spend || 0, Revenue: r.collected || 0 }))
  if (!data.length) return <NoData>No spend or revenue recorded yet.</NoData>
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={55} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} />
        <Tooltip contentStyle={tip} formatter={(v) => formatCurrency(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Spend" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart>
    </ResponsiveContainer>
  )
}

export function ComparisonBars({ rows, valueKey, name = 'name', money, percent }) {
  const data = rows.filter((r) => r[valueKey] !== null && r[valueKey] !== undefined && r[valueKey] !== 0).slice(0, 10).map((r) => ({ name: String(r[name]).length > 16 ? `${String(r[name]).slice(0, 15)}…` : r[name], value: r[valueKey] }))
  if (!data.length) return <NoData />
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={55} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={money ? (v) => formatCurrency(v, { compact: true }) : percent ? (v) => `${v}%` : undefined} allowDecimals={false} />
        <Tooltip contentStyle={tip} formatter={(v) => (money ? formatCurrency(v) : percent ? `${v}%` : v)} /><Bar dataKey="value" radius={[4, 4, 0, 0]}>{data.map((d, i) => <Cell key={d.name} fill={d.value < 0 ? '#f43f5e' : PALETTE[i % PALETTE.length]} />)}</Bar></BarChart>
    </ResponsiveContainer>
  )
}
void ComposedChart
