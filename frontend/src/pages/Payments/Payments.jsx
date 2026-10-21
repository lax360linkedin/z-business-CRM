import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Wallet, CalendarCheck, CalendarDays, Clock3, CheckCircle2, XCircle, Undo2, AlertTriangle, X, CreditCard, HandCoins, Hash, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters, documentFromCsv } from '../../utils/exporter'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { PAYMENT_STATUS_OPTIONS, paymentMetrics, todayKey } from '../../utils/invoiceRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { useInvoices } from '../Invoices/invoiceClient'
import { exportPaymentsCsv, usePaymentConfig, payErr } from './paymentClient'

const EMPTY = { status: 'all', method: 'all', customer: 'all', company: 'all', owner: 'all', deal: 'all', order: 'all', project: 'all', from: '', to: '', min: '', max: '' }
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' }
const link = 'font-medium text-brand-600 hover:underline dark:text-brand-400'
const COLS = 'xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_5.5rem_6rem_6.5rem_6.5rem]'
const uniq = (rows, id, label) => [...new Map(rows.filter((r) => r[id]).map((r) => [r[id], r[label] || r[id]])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))

export default function Payments() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { invoices, payments, error, reload } = useInvoices()
  const { methods, caps } = usePaymentConfig()
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(1)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { setPage(1) }, [search, f, sort])

  const hidden = !!payments && payments.length > 0 && payments.every((p) => p.financialHidden)
  const m = useMemo(() => paymentMetrics(payments || [], invoices || [], todayKey()), [payments, invoices])
  const opts = useMemo(() => ({ customers: uniq(payments || [], 'customerId', 'customerName'), companies: uniq(payments || [], 'companyId', 'companyName'), deals: uniq(payments || [], 'dealId', 'dealName'), orders: uniq(payments || [], 'salesOrderId', 'salesOrderNumber'), projects: uniq(payments || [], 'projectId', 'projectName') }), [payments])
  const ownerOpts = useMemo(() => { const ids = new Set((invoices || []).map((i) => i.ownerId).filter(Boolean)); return USERS.filter((u) => ids.has(u.id)) }, [invoices])
  const ownerOf = useMemo(() => new Map((invoices || []).map((i) => [i.id, i.ownerId])), [invoices])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (payments || []).filter((p) => {
      if (q && !`${p.number} ${p.id} ${p.invoiceNumber} ${p.customerName} ${p.companyName || ''} ${p.reference} ${p.salesOrderNumber || ''} ${p.dealName || ''} ${p.projectName || ''}`.toLowerCase().includes(q)) return false
      if (f.status !== 'all' && p.status !== f.status) return false
      if (f.method !== 'all' && p.method !== f.method) return false
      if (f.customer !== 'all' && p.customerId !== f.customer) return false
      if (f.company !== 'all' && p.companyId !== f.company) return false
      if (f.deal !== 'all' && p.dealId !== f.deal) return false
      if (f.order !== 'all' && p.salesOrderId !== f.order) return false
      if (f.project !== 'all' && p.projectId !== f.project) return false
      if (f.owner !== 'all' && ownerOf.get(p.invoiceId) !== f.owner) return false
      const d = String(p.date).slice(0, 10)
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
      if (f.min !== '' && (p.amount ?? 0) < Number(f.min)) return false
      if (f.max !== '' && (p.amount ?? 0) > Number(f.max)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (p) => (sort.key === 'amount' ? p.amount ?? 0 : sort.key === 'number' ? p.number || '' : sort.key === 'customer' ? p.customerName || '' : sort.key === 'status' ? p.status : String(p.date))
    return list.sort((a, b) => { const x = val(a); const y = val(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return c * dir || String(b.number).localeCompare(String(a.number)) })
  }, [payments, search, f, sort, ownerOf])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const active = Object.entries(f).filter(([, v]) => v !== '' && v !== 'all').length
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'amount' || key === 'date' ? 'desc' : 'asc' }))
  // Export: the server's payment register (Export right checked and audited there); only the payments matching the search and filters on screen are kept
  const exportFilters = describeFilters([
    ['Search', search.trim() && `"${search.trim()}"`], ['Status', f.status], ['Method', f.method], ['Customer', f.customer], ['Company', f.company], ['Deal', f.deal], ['Sales order', f.order], ['Project', f.project],
    ['Owner', f.owner !== 'all' && (USERS.find((u) => u.id === f.owner)?.name || f.owner)], ['From', f.from], ['To', f.to], ['Amount from', f.min], ['Amount to', f.max],
  ])
  const exportDoc = async (_format, ctx) => documentFromCsv({ title: 'Payments', csv: await exportPaymentsCsv(), keep: new Set(filtered.map((p) => p.number)), filters: exportFilters, ...ctx })
  const Sort = ({ k, children, right }) => <button type="button" onClick={() => toggle(k)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-ink-800', right && 'justify-end')}>{children}{sort.key === k ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}</button>

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load payments" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const money = (v) => (hidden ? '—' : formatCurrency(v))
  const cards = [['Total received', money(m.received), Wallet, 'emerald'], ['Received today', money(m.today), CalendarCheck, 'brand'], ['Received this month', money(m.month), CalendarDays, 'sky'], ['Outstanding receivables', money(m.receivables), HandCoins, 'rose'], ['Pending', `${m.pendingCount}${hidden ? '' : ` · ${formatCurrency(m.pendingAmount)}`}`, Clock3, 'amber'], ['Completed', m.completedCount, CheckCircle2, 'emerald'], ['Failed', m.failedCount, XCircle, 'rose'], ['Refunded', money(m.refunded), Undo2, 'violet'], ['Transactions', m.transactions, Hash, 'brand']]
  return (
    <div>
      <PageHeader title="Payments" description="Money received against your invoices — recorded from the invoice, frozen once completed, corrected only by cancellation or refund." actions={<ExportMenu title="Payments" noun="payment" permission={caps.includes('export')} getDocument={exportDoc} />} />
      {!payments ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map(([label, value, Icon, tone]) => <div key={label} className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div><p className="mt-1.5 truncate text-xl font-bold text-ink-900 dark:text-ink-50">{value}</p></div>)}
          </div>
          {!hidden && m.methods.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs shadow-card dark:border-ink-800 dark:bg-ink-900"><span className="font-semibold text-ink-500">Collection by method</span>{m.methods.map(([k, v]) => <button key={k} type="button" onClick={() => set({ method: f.method === k ? 'all' : k })} className={clsx('rounded-full px-2.5 py-1', f.method === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-brand-50 dark:bg-ink-800 dark:text-ink-200')}>{k} · <b>{formatCurrency(v)}</b></button>)}</div>}
        </>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search payment no., invoice, customer, company, reference…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={active} onClick={() => setFiltersOpen((o) => !o)} />
        {active > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
      </div>
      {filtersOpen && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          {[['Status', 'status', PAYMENT_STATUS_OPTIONS.map((s) => [s, s])], ['Method', 'method', (methods.length ? methods : []).map((s) => [s, s])], ['Customer', 'customer', opts.customers], ['Company', 'company', opts.companies], ['Salesperson', 'owner', ownerOpts.map((u) => [u.id, u.name])], ['Deal', 'deal', opts.deals], ['Sales order', 'order', opts.orders], ['Project', 'project', opts.projects]].map(([label, key, list]) => (
            <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          ))}
          <label className="text-xs font-medium text-ink-500">From<input aria-label="From" type="date" className={clsx(sel, 'mt-1')} value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="text-xs font-medium text-ink-500">To<input aria-label="To" type="date" className={clsx(sel, 'mt-1')} value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
          <label className="text-xs font-medium text-ink-500">Min amount<input aria-label="Min amount" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.min} onChange={(e) => set({ min: e.target.value })} /></label>
          <label className="text-xs font-medium text-ink-500">Max amount<input aria-label="Max amount" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.max} onChange={(e) => set({ max: e.target.value })} /></label>
        </div>
      )}
      {!payments ? <CardSkeleton className="h-64" /> : filtered.length === 0 ? <EmptyState icon={CreditCard} title="No payments found" description="Try adjusting your search or filters. Payments are recorded from an invoice’s page." /> : (
        <>
          <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div role="row" className={clsx('hidden gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-500 xl:grid dark:border-ink-800 dark:bg-ink-800/40', COLS)}><Sort k="number">Payment</Sort><span className="uppercase">Invoice</span><Sort k="customer">Customer</Sort><span className="uppercase">Linked to</span><span className="uppercase">Method</span><Sort k="date">Date</Sort><Sort k="amount" right>Amount</Sort><Sort k="status">Status</Sort></div>
            {rows.map((p) => (
              <div key={p.id} role="row" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/payments/${p.id}`) }} onClick={(e) => { if (!e.target.closest('button,a')) navigate(`/payments/${p.id}`) }} className={clsx('grid cursor-pointer grid-cols-1 items-center gap-1.5 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 xl:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30', COLS, ['Cancelled', 'Failed'].includes(p.status) && 'opacity-60')}>
                <div className="min-w-0"><button type="button" className={clsx(link, 'block max-w-full truncate text-left')} onClick={() => navigate(`/payments/${p.id}`)}>{p.number}</button><p className="truncate font-mono text-[11px] text-ink-400">{p.reference || 'no reference'}</p></div>
                <button type="button" className={clsx(link, 'text-left')} onClick={() => navigate(`/invoices/${p.invoiceId}`)}>{p.invoiceNumber}</button>
                <div className="min-w-0"><button type="button" className={clsx(link, 'block max-w-full truncate text-left')} onClick={() => navigate(`/customers/${p.customerId}`)}>{p.customerName}</button>{p.companyName && p.companyName !== p.customerName && <p className="truncate text-[11px] text-ink-400">{p.companyName}</p>}</div>
                <div className="min-w-0 truncate text-xs text-ink-500">{p.salesOrderId ? <button type="button" className={link} onClick={() => navigate(`/sales-orders/${p.salesOrderId}`)}>{p.salesOrderNumber || p.salesOrderId}</button> : '—'}{p.dealName ? <span> · <button type="button" className={link} onClick={() => navigate(`/deals/${p.dealId}`)}>{p.dealName}</button></span> : null}</div>
                <span className="text-xs text-ink-600 dark:text-ink-300">{p.method}</span><span className="text-xs text-ink-600 dark:text-ink-300">{formatDate(p.date)}</span>
                <span className="text-right font-medium text-ink-800 dark:text-ink-100">{p.amount === null ? '—' : formatCurrency(p.amount)}{p.refundedAmount > 0 && <span className="block text-[11px] font-normal text-amber-600">−{formatCurrency(p.refundedAmount)} refunded</span>}</span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      )}
    </div>
  )
}
