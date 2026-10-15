import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Download, Wallet, CalendarCheck, CalendarDays, Clock3, CheckCircle2, XCircle, Banknote, AlertTriangle, X, Receipt, Users, Building2, FolderKanban, HandCoins, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { Tabs } from '../../components/common/Tabs'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useToast } from '../../context/ToastContext'
import { EXPENSE_STATUSES, EXPENSE_KINDS, KIND_LABEL, expenseMetrics, todayKey } from '../../utils/expenseRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadBlob } from '../Invoices/invoiceClient'
import { useExpenses, useExpenseConfig, useVendors, exportExpensesCsv, expErr } from './expenseClient'
import { ExpenseFormDialog } from './ExpenseFormDialog'
import { VendorsTab, CategoriesTab, PolicyTab } from './ExpenseManage'

const EMPTY = { status: 'all', kind: 'all', category: 'all', vendor: 'all', employee: 'all', customer: 'all', company: 'all', project: 'all', deal: 'all', pay: 'all', creator: 'all', from: '', to: '', min: '', max: '' }
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' }
const link = 'font-medium text-brand-600 hover:underline dark:text-brand-400'
const COLS = 'xl:grid-cols-[1.1fr_1.6fr_1fr_1.2fr_1.2fr_6rem_6.5rem_6.5rem]'
const PAY_STATUSES = ['Unpaid', 'Partially Paid', 'Paid', 'Reimbursement pending', 'Partly reimbursed', 'Reimbursed', 'Not approved yet', 'Not payable']
const uniq = (rows, id, label) => [...new Map(rows.filter((r) => r[id]).map((r) => [r[id], r[label] || r[id]])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))

export default function Expenses() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { expenses, error, reload } = useExpenses()
  const { categories, perms } = useExpenseConfig()
  const { vendors } = useVendors()
  const [tab, setTab] = useState('expenses')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { setPage(1) }, [search, f, sort, tab])

  const hidden = !!expenses && expenses.length > 0 && expenses.every((e) => e.financialHidden)
  const m = useMemo(() => expenseMetrics(expenses || [], todayKey(), { projectName: (id) => (expenses || []).find((e) => e.projectId === id)?.projectName }), [expenses])
  const opts = useMemo(() => { const r = expenses || []; return { customers: uniq(r, 'customerId', 'customerName'), companies: uniq(r, 'companyId', 'companyName'), projects: uniq(r, 'projectId', 'projectName'), deals: uniq(r, 'dealId', 'dealName'), employees: uniq(r, 'employeeId', 'employeeName'), creators: uniq(r, 'createdBy', 'createdByName') } }, [expenses])
  const queue = useMemo(() => (expenses || []).filter((e) => e.perms.approve || e.perms.review || e.perms.reject), [expenses])
  const toPay = useMemo(() => (expenses || []).filter((e) => e.perms.pay), [expenses])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = tab === 'approvals' ? queue : tab === 'payable' ? toPay : (expenses || [])
    const list = base.filter((e) => {
      if (q && !`${e.number} ${e.description} ${e.categoryName} ${e.vendorName || ''} ${e.employeeName || ''} ${e.vendorBillNumber || ''} ${e.projectName || ''} ${e.customerName || ''} ${e.paymentReference || ''}`.toLowerCase().includes(q)) return false
      const eq = [['status', 'status'], ['kind', 'kind'], ['category', 'categoryId'], ['vendor', 'vendorId'], ['employee', 'employeeId'], ['customer', 'customerId'], ['company', 'companyId'], ['project', 'projectId'], ['deal', 'dealId'], ['pay', 'paymentStatus'], ['creator', 'createdBy']]
      if (eq.some(([k, field]) => f[k] !== 'all' && e[field] !== f[k])) return false
      const d = String(e.date).slice(0, 10)
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
      if (f.min !== '' && (e.total ?? 0) < Number(f.min)) return false
      if (f.max !== '' && (e.total ?? 0) > Number(f.max)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (e) => (sort.key === 'total' ? e.total ?? 0 : sort.key === 'number' ? e.number : sort.key === 'status' ? e.status : sort.key === 'category' ? e.categoryName || '' : String(e.date))
    return list.sort((a, b) => { const x = val(a); const y = val(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y)); return c * dir || String(b.number).localeCompare(String(a.number)) })
  }, [expenses, queue, toPay, tab, search, f, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const active = Object.entries(f).filter(([, v]) => v !== '' && v !== 'all').length
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'total' || key === 'date' ? 'desc' : 'asc' }))
  const exportCsv = () => exportExpensesCsv().then((csv) => { downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'expenses.csv'); toast('Expenses exported.', { type: 'success' }) }).catch((e) => toast(expErr(e), { type: 'error' }))
  const Sort = ({ k, children, right }) => <button type="button" onClick={() => toggle(k)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-ink-800', right && 'justify-end')}>{children}{sort.key === k ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}</button>

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load expenses" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const money = (v) => (hidden ? '—' : formatCurrency(v))
  const cards = [['Total expenses', money(m.total), Wallet, 'brand'], ['Today', money(m.today), CalendarCheck, 'sky'], ['This month', money(m.month), CalendarDays, 'sky'], ['Pending approval', `${m.pendingCount}${hidden ? '' : ` · ${formatCurrency(m.pendingAmount)}`}`, Clock3, 'amber'],
    ['Approved (unpaid)', `${m.approvedCount}${hidden ? '' : ` · ${formatCurrency(m.approvedAmount)}`}`, CheckCircle2, 'emerald'], ['Rejected', m.rejectedCount, XCircle, 'rose'], ['Paid / reimbursed', money(m.paidAmount), Banknote, 'emerald'], ['Reimbursement pending', money(m.reimbursementPending), HandCoins, 'amber'],
    ['Vendor expenses', money(m.vendor), Building2, 'violet'], ['Employee expenses', money(m.employee), Users, 'violet'], ['Project expenses', money(m.project), FolderKanban, 'brand'], ['Vendor payable', money(m.vendorPayable), Receipt, 'rose']]
  const maxMonth = Math.max(1, ...m.months.map((x) => x.value))
  const tabs = [{ value: 'expenses', label: 'Expenses', count: (expenses || []).length }, { value: 'approvals', label: 'Approvals', count: queue.length }, ...(toPay.length ? [{ value: 'payable', label: 'To pay', count: toPay.length }] : []), { value: 'vendors', label: 'Vendors' }, { value: 'categories', label: 'Categories' }, { value: 'policy', label: 'Policy' }]
  return (
    <div>
      <PageHeader title="Expenses" description="Money the business spends — vendor bills, employee claims and company costs. Kept separate from customer invoices and payments (revenue)." actions={<>{perms.export && <Button variant="secondary" icon={Download} onClick={exportCsv}>Export</Button>}{perms.create && <Button icon={Plus} onClick={() => setFormOpen(true)}>New expense</Button>}</>} />
      {!expenses ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {cards.map(([label, value, Icon, tone]) => <div key={label} className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div><p className="mt-1.5 break-words text-base font-bold xl:text-lg text-ink-900 dark:text-ink-50">{value}</p></div>)}
          </div>
          {!hidden && (
            <div className="mb-5 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Expense by month</p>
                <div className="flex h-24 items-end gap-1.5" role="img" aria-label="Expense by month">{m.months.map((x) => <div key={x.key} className="flex h-full flex-1 flex-col justify-end items-center gap-1" title={`${x.label}: ${formatCurrency(x.value)}`}><div className="w-full rounded-t bg-brand-500/80" style={{ height: `${Math.max(2, (x.value / maxMonth) * 80)}%` }} /><span className="text-[9px] text-ink-400">{x.label}</span></div>)}</div></div>
              <div className="rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Top categories</p>
                {m.categories.length === 0 ? <p className="text-sm text-ink-400">No approved expenses yet.</p> : <ul className="space-y-1.5">{m.categories.slice(0, 5).map((c) => { const cat = categories.find((x) => x.name === c.name); return <li key={c.name} className="text-xs"><div className="flex justify-between"><button type="button" className="inline-flex items-center gap-1.5 hover:underline" onClick={() => { if (cat) set({ category: cat.id }); setTab('expenses') }}><i className="h-2 w-2 rounded-full" style={{ background: cat?.color }} />{c.name}</button><b>{formatCurrency(c.value)}</b></div><div className="mt-0.5 h-1 rounded bg-ink-100 dark:bg-ink-800"><div className="h-1 rounded" style={{ width: `${(c.value / m.categories[0].value) * 100}%`, background: cat?.color || '#6366f1' }} /></div></li> })}</ul>}</div>
              <div className="rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Expense by project</p>
                {m.projects.length === 0 ? <p className="text-sm text-ink-400">No project expenses yet.</p> : <ul className="space-y-1.5">{m.projects.slice(0, 5).map((p) => <li key={p.id} className="flex justify-between gap-2 text-xs"><button type="button" className="truncate text-left hover:underline" onClick={() => navigate(`/projects/${p.id}`)}>{p.name}</button><b className="shrink-0">{formatCurrency(p.value)}</b></li>)}</ul>}</div>
            </div>
          )}
        </>
      )}
      <Tabs className="mb-4" active={tab} onChange={setTab} tabs={tabs} />
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'categories' && <CategoriesTab expenses={expenses} />}
      {tab === 'policy' && <PolicyTab />}
      {['expenses', 'approvals', 'payable'].includes(tab) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Search number, description, vendor, employee, project…" className="w-full max-w-sm" />
            <FilterToggleButton active={filtersOpen} count={active} onClick={() => setFiltersOpen((o) => !o)} />
            {active > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
          </div>
          {filtersOpen && (
            <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
              {[['Status', 'status', EXPENSE_STATUSES.map((s) => [s, s])], ['Type', 'kind', EXPENSE_KINDS.map((k) => [k.value, k.label])], ['Category', 'category', categories.map((c) => [c.id, c.name])], ['Vendor', 'vendor', (vendors || []).map((v) => [v.id, v.name])], ['Employee', 'employee', opts.employees], ['Customer', 'customer', opts.customers], ['Company', 'company', opts.companies], ['Project', 'project', opts.projects], ['Deal', 'deal', opts.deals], ['Payment status', 'pay', PAY_STATUSES.map((s) => [s, s])], ['Created by', 'creator', opts.creators]].map(([label, key, list]) => (
                <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              ))}
              <label className="text-xs font-medium text-ink-500">From<input aria-label="From" type="date" className={clsx(sel, 'mt-1')} value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">To<input aria-label="To" type="date" className={clsx(sel, 'mt-1')} value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">Min amount<input aria-label="Min amount" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.min} onChange={(e) => set({ min: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">Max amount<input aria-label="Max amount" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.max} onChange={(e) => set({ max: e.target.value })} /></label>
            </div>
          )}
          {!expenses ? <CardSkeleton className="h-64" /> : filtered.length === 0 ? <EmptyState icon={Wallet} title={tab === 'approvals' ? 'Nothing waiting for your approval' : tab === 'payable' ? 'Nothing to pay right now' : 'No expenses found'} description={tab === 'expenses' ? 'Try adjusting your search or filters, or record a new expense.' : 'Submitted claims and approved expenses show up here when they need you.'} action={tab === 'expenses' && perms.create ? <Button icon={Plus} onClick={() => setFormOpen(true)}>New expense</Button> : null} /> : (
            <>
              <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div role="row" className={clsx('hidden gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-500 xl:grid dark:border-ink-800 dark:bg-ink-800/40', COLS)}><Sort k="number">Expense</Sort><span className="uppercase">Description</span><Sort k="category">Category</Sort><span className="uppercase">Payee</span><span className="uppercase">Linked to</span><Sort k="date">Date</Sort><Sort k="total" right>Total</Sort><Sort k="status">Status</Sort></div>
                {rows.map((e) => {
                  const cat = categories.find((c) => c.id === e.categoryId)
                  return (
                    <div key={e.id} role="row" tabIndex={0} onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(`/expenses/${e.id}`) }} onClick={(ev) => { if (!ev.target.closest('button,a')) navigate(`/expenses/${e.id}`) }} className={clsx('grid cursor-pointer grid-cols-1 items-center gap-1.5 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 xl:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30', COLS, ['Cancelled', 'Rejected'].includes(e.status) && 'opacity-60')}>
                      <div className="min-w-0"><button type="button" className={clsx(link, 'block max-w-full truncate text-left')} onClick={() => navigate(`/expenses/${e.id}`)}>{e.number}</button><p className="text-[11px] text-ink-400">{KIND_LABEL[e.kind]}</p></div>
                      <p className="min-w-0 truncate text-ink-800 dark:text-ink-100" title={e.description}>{e.description}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat?.color || '#94a3b8' }} />{e.categoryName}</span>
                      <span className="truncate text-xs text-ink-600 dark:text-ink-300">{e.kind === 'Vendor' ? e.vendorName : e.employeeName || '—'}</span>
                      <div className="min-w-0 truncate text-xs text-ink-500">{e.projectName ? <button type="button" className={link} onClick={() => navigate(`/projects/${e.projectId}`)}>{e.projectName}</button> : e.customerName ? <button type="button" className={link} onClick={() => navigate(`/customers/${e.customerId}`)}>{e.customerName}</button> : '—'}</div>
                      <span className="text-xs text-ink-600 dark:text-ink-300">{formatDate(e.date)}</span>
                      <span className="text-right font-medium text-ink-800 dark:text-ink-100">{e.total === null ? '—' : formatCurrency(e.total)}{e.approvedAmount !== null && e.approvedAmount !== undefined && e.approvedAmount < e.total && <span className="block text-[11px] font-normal text-amber-600">approved {formatCurrency(e.approvedAmount)}</span>}</span>
                      <div className="flex flex-col items-start gap-1"><StatusBadge status={e.status} />{e.status === 'Approved' && !['Unpaid', 'Reimbursement pending'].includes(e.paymentStatus) && <span className="text-[10px] text-ink-400">{e.paymentStatus}</span>}</div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
            </>
          )}
        </>
      )}
      <ExpenseFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={(d) => { reload(); navigate(`/expenses/${d.id}`) }} />
    </div>
  )
}
