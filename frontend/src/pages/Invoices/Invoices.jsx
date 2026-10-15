import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Download, FileText, Wallet, HandCoins, AlertTriangle, Receipt, CheckCircle2, CircleDollarSign, Clock3, CalendarDays, Percent, X, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { INVOICE_STATUS_LIST, PAYMENT_STATUS_LIST, invoiceMetrics, todayKey } from '../../utils/invoiceRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { useInvoices, useInvoiceConfig, exportInvoicesCsv, downloadBlob, invErr } from './invoiceClient'
import { InvoiceFormDialog } from './InvoiceFormDialog'

const EMPTY = { status: 'all', pay: 'all', customer: 'all', company: 'all', owner: 'all', deal: 'all', order: 'all', project: 'all', issueFrom: '', issueTo: '', dueFrom: '', dueTo: '', min: '', max: '' }
const QUICK = [['all', 'All invoices'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['partial', 'Partially paid'], ['paid', 'Paid'], ['draft', 'Drafts'], ['closed', 'Cancelled / void'], ['mine', 'My invoices']]
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30', ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800' }
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' })

export default function Invoices() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { invoices, payments, error, reload } = useInvoices()
  const { perms, me } = useInvoiceConfig()
  const [quick, setQuick] = useState('all')
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState({ key: 'issueDate', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [preset, setPreset] = useState(null)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { setPage(1) }, [search, f, quick, sort])
  useEffect(() => {
    if (params.get('create') !== '1') return
    setPreset({ salesOrderId: params.get('salesOrderId') || undefined }); setFormOpen(true)
    setParams((p) => { const n = new URLSearchParams(p); ['create', 'salesOrderId'].forEach((k) => n.delete(k)); return n }, { replace: true })
  }, [params, setParams])

  const m = useMemo(() => invoiceMetrics(invoices || [], payments), [invoices, payments])
  const hidden = !!invoices && invoices.length > 0 && !m.hasFinancial

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (invoices || []).filter((i) => {
      if (quick === 'unpaid' && !(['Sent', 'Viewed', 'Overdue', 'Partially Paid'].includes(i.status))) return false
      if (quick === 'overdue' && i.status !== 'Overdue') return false
      if (quick === 'partial' && i.paymentStatus !== 'Partially Paid') return false
      if (quick === 'paid' && i.status !== 'Paid') return false
      if (quick === 'draft' && i.status !== 'Draft') return false
      if (quick === 'closed' && !['Cancelled', 'Void'].includes(i.status)) return false
      if (quick === 'mine' && i.ownerId !== me?.id && i.createdBy !== me?.id) return false
      if (q && !`${i.number} ${i.customerName} ${i.companyName || ''} ${i.salesOrderNumber || ''} ${i.dealName || ''} ${i.projectName || ''} ${i.quotationNumber || ''} ${i.contactName || ''}`.toLowerCase().includes(q)) return false
      if (f.status !== 'all' && i.status !== f.status) return false
      if (f.pay !== 'all' && i.paymentStatus !== f.pay) return false
      if (f.customer !== 'all' && i.customerId !== f.customer) return false
      if (f.company !== 'all' && i.companyId !== f.company) return false
      if (f.owner !== 'all' && i.ownerId !== f.owner) return false
      if (f.deal !== 'all' && i.dealId !== f.deal) return false
      if (f.order !== 'all' && i.salesOrderId !== f.order) return false
      if (f.project !== 'all' && i.projectId !== f.project) return false
      if (f.issueFrom && String(i.issueDate).slice(0, 10) < f.issueFrom) return false
      if (f.issueTo && String(i.issueDate).slice(0, 10) > f.issueTo) return false
      if (f.dueFrom && String(i.dueDate).slice(0, 10) < f.dueFrom) return false
      if (f.dueTo && String(i.dueDate).slice(0, 10) > f.dueTo) return false
      if (f.min !== '' && (i.amount ?? 0) < Number(f.min)) return false
      if (f.max !== '' && (i.amount ?? 0) > Number(f.max)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (i) => (['number', 'customerName', 'issueDate', 'dueDate', 'status'].includes(sort.key) ? String(i[sort.key] ?? '') : Number(i[sort.key]) || 0)
    return list.sort((a, b) => { const x = val(a); const y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.number.localeCompare(b.number) })
  }, [invoices, quick, search, f, sort, me?.id])

  const uniq = (key, label) => { const o = new Map(); (invoices || []).forEach((i) => { if (i[key]) o.set(i[key], label(i)) }); return [...o] }
  const customers = useMemo(() => uniq('customerId', (i) => i.customerName), [invoices]) // eslint-disable-line react-hooks/exhaustive-deps
  const companies = useMemo(() => uniq('companyId', (i) => i.companyName || i.companyId), [invoices]) // eslint-disable-line react-hooks/exhaustive-deps
  const deals = useMemo(() => uniq('dealId', (i) => i.dealName || i.dealId), [invoices]) // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useMemo(() => uniq('salesOrderId', (i) => i.salesOrderNumber || i.salesOrderId), [invoices]) // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useMemo(() => uniq('projectId', (i) => i.projectName || i.projectId), [invoices]) // eslint-disable-line react-hooks/exhaustive-deps
  const owners = useMemo(() => USERS.filter((u) => (invoices || []).some((i) => i.ownerId === u.id)), [invoices])

  const activeFilters = Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).length
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const money = (v) => (v === null || v === undefined ? '—' : formatCurrency(v, { compact: true }))
  const cards = [
    ['Total invoiced', money(m.totalInvoiced), FileText, 'brand', () => setQuick('all')], ['Total paid', money(m.totalPaid), Wallet, 'emerald', () => setQuick('paid')], ['Outstanding', money(m.outstanding), HandCoins, 'amber', () => setQuick('unpaid')],
    ['Overdue amount', money(m.overdueAmount), AlertTriangle, 'rose', () => setQuick('overdue')], ['Invoices', m.count, Receipt, 'violet', () => { setQuick('all'); setF(EMPTY) }], ['Paid invoices', m.paidCount, CheckCircle2, 'emerald', () => setQuick('paid')],
    ['Partially paid', m.partiallyPaid, CircleDollarSign, 'amber', () => setQuick('partial')], ['Unpaid', m.unpaid, Clock3, 'sky', () => setQuick('unpaid')], ['Collected this month', money(m.collectedThisMonth), CalendarDays, 'emerald'], ['Collection rate', `${m.collectionRate}%`, Percent, 'violet'],
  ]
  const maxMonth = Math.max(1, ...m.monthly.map((x) => Math.max(x.invoiced, x.collected)))
  const maxAge = Math.max(1, ...m.aging.map((x) => x.amount))
  const head = (key, label, cls) => (
    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))} className={clsx('inline-flex items-center gap-1 text-left uppercase tracking-wide', cls)} aria-label={`Sort by ${label}`}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}
    </button>
  )
  const doExport = () => exportInvoicesCsv().then((csv) => { downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `invoices-${todayKey()}.csv`); toast('Invoices exported.', { type: 'success' }) }).catch((e) => toast(invErr(e), { type: 'error' }))

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load invoices" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />

  return (
    <div>
      <PageHeader title="Invoices" description="Billing and collections — raised from confirmed sales orders, tracked through every payment."
        actions={<>{perms.export && <Button variant="secondary" icon={Download} onClick={doExport}>Export</Button>}{perms.create && <Button icon={Plus} onClick={() => { setPreset(null); setFormOpen(true) }}>New invoice</Button>}</>} />

      {!invoices ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          {hidden && <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Financial figures are hidden for your role.</p>}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Invoice metrics">
            {cards.map(([label, value, Icon, tone, click]) => (
              <button key={label} type="button" onClick={click} disabled={!click} className={clsx('rounded-xl border border-ink-100 bg-white p-3 text-left shadow-card dark:border-ink-800 dark:bg-ink-900', click ? 'transition-shadow hover:shadow-card-hover' : 'cursor-default')}>
                <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div>
                <p className={clsx('mt-1.5 text-xl font-bold', label === 'Overdue amount' && m.overdueAmount ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-ink-50')}>{value}</p>
              </button>
            ))}
          </div>
          {m.hasFinancial && (
            <div className="mb-5 grid gap-4 lg:grid-cols-3">
              <section className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Monthly revenue</h3><span className="flex items-center gap-3 text-[11px] text-ink-500"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-300" />Invoiced</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Collected</span></span></div>
                <div className="flex h-36 items-end gap-3" role="img" aria-label="Invoiced and collected per month">
                  {m.monthly.map((x) => (
                    <div key={x.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthLabel(x.month)}: invoiced ${formatCurrency(x.invoiced)}, collected ${formatCurrency(x.collected)}`}>
                      <div className="flex h-28 w-full items-end justify-center gap-1"><span className="w-1/3 rounded-t bg-brand-300" style={{ height: `${(x.invoiced / maxMonth) * 100}%`, minHeight: x.invoiced ? 3 : 0 }} /><span className="w-1/3 rounded-t bg-emerald-500" style={{ height: `${(x.collected / maxMonth) * 100}%`, minHeight: x.collected ? 3 : 0 }} /></div>
                      <span className="text-[11px] text-ink-500">{monthLabel(x.month)}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Collection summary</h3>
                <div className="mb-3 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.collectionRate}%` }} /></div><span className="text-xs font-semibold text-ink-700 dark:text-ink-200">{m.collectionRate}%</span></div>
                <dl className="space-y-1.5 text-xs"><div className="flex justify-between"><dt className="text-ink-500">Collected</dt><dd className="font-medium">{money(m.totalPaid)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">Still to collect</dt><dd className="font-medium">{money(m.outstanding)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">Average days to pay</dt><dd className="font-medium">{m.avgDaysToPay === null ? '—' : `${m.avgDaysToPay} days`}</dd></div></dl>
                <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Overdue ageing</p>
                <ul className="space-y-1">{m.aging.map((a) => <li key={a.label} className="flex items-center gap-2 text-xs"><span className="w-20 shrink-0 text-ink-500">{a.label}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><span className="block h-full rounded-full bg-rose-400" style={{ width: `${(a.amount / maxAge) * 100}%` }} /></span><span className="w-16 text-right font-medium">{a.count ? money(a.amount) : '—'}</span></li>)}</ul>
              </section>
            </div>
          )}
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Invoice groups">
          {QUICK.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={quick === k} onClick={() => setQuick(k)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium', quick === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300')}>{l}</button>)}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search number, customer, company, order, deal, project…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
        {activeFilters > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
      </div>
      {filtersOpen && invoices && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          {[['Status', 'status', INVOICE_STATUS_LIST.map((s) => [s, s])], ['Payment status', 'pay', PAYMENT_STATUS_LIST.map((s) => [s, s])], ['Customer', 'customer', customers], ['Company', 'company', companies], ['Salesperson', 'owner', owners.map((u) => [u.id, u.name])], ['Deal', 'deal', deals], ['Sales order', 'order', orders], ['Project', 'project', projects]].map(([label, key, opts]) => (
            <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          ))}
          {[['Invoice date from', 'issueFrom'], ['Invoice date to', 'issueTo'], ['Due from', 'dueFrom'], ['Due to', 'dueTo']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="date" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
          {m.hasFinancial && [['Min amount', 'min'], ['Max amount', 'max']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="number" min="0" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
        </div>
      )}

      {!invoices ? <CardSkeleton className="h-72" /> : filtered.length === 0 ? (
        <EmptyState icon={Receipt} title={invoices.length ? 'No invoices match' : 'No invoices yet'} description={invoices.length ? 'Change the group, search or filters.' : 'Invoices are raised from a confirmed sales order.'} action={!invoices.length && perms.create && <Button icon={Plus} onClick={() => setFormOpen(true)}>New invoice</Button>} />
      ) : (
        <>
          <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div role="row" className="hidden grid-cols-[1.6fr_1.2fr_1fr_6.5rem_6.5rem_6.5rem_6.5rem_7rem] gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold text-ink-500 lg:grid dark:border-ink-800 dark:bg-ink-800/40">
              {head('number', 'Invoice')}<span className="uppercase tracking-wide">Linked to</span><span className="uppercase tracking-wide">Owner</span>{head('issueDate', 'Date')}{head('dueDate', 'Due')}{head('amount', 'Total', 'justify-end w-full')}{head('balance', 'Balance', 'justify-end w-full')}{head('status', 'Status')}
            </div>
            {rows.map((i) => (
              <div key={i.id} role="row" tabIndex={0} onClick={() => navigate(`/invoices/${i.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/invoices/${i.id}`)} className="grid cursor-pointer grid-cols-1 items-center gap-1.5 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 lg:grid-cols-[1.6fr_1.2fr_1fr_6.5rem_6.5rem_6.5rem_6.5rem_7rem] lg:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30">
                <div className="min-w-0"><p className="truncate font-medium text-ink-900 dark:text-ink-50">{i.number}</p><p className="truncate text-xs text-ink-400">{i.customerName}{i.companyName && i.companyName !== i.customerName ? ` · ${i.companyName}` : ''}</p></div>
                <div className="min-w-0 truncate text-xs text-ink-500">{i.salesOrderNumber || '—'}{i.dealName ? ` · ${i.dealName}` : ''}</div>
                <span className="flex items-center gap-1.5 truncate text-xs text-ink-600 dark:text-ink-300"><Avatar name={i.ownerName} size="xs" />{i.ownerName}</span>
                <span className="text-xs text-ink-600 dark:text-ink-300">{formatDate(i.issueDate)}</span>
                <span className={clsx('text-xs', i.status === 'Overdue' ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-ink-600 dark:text-ink-300')}>{formatDate(i.dueDate)}{i.overdueDays ? <span className="block text-[10px]">{i.overdueDays}d overdue</span> : null}</span>
                <span className="text-right text-sm font-medium text-ink-800 dark:text-ink-100">{i.amount === null ? '—' : formatCurrency(i.amount)}</span>
                <span className={clsx('text-right text-sm font-medium', i.balance > 0 && ['Overdue'].includes(i.status) ? 'text-rose-600 dark:text-rose-400' : 'text-ink-800 dark:text-ink-100')}>{i.balance === null ? '—' : ['Cancelled', 'Void', 'Draft'].includes(i.status) ? '—' : formatCurrency(i.balance)}</span>
                <span><StatusBadge status={i.status} /></span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      )}
      <InvoiceFormDialog open={formOpen} onClose={() => setFormOpen(false)} preset={preset} onSaved={(inv) => navigate(`/invoices/${inv.id}`)} />
    </div>
  )
}
