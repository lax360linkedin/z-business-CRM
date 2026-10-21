import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, FileSignature, FileText, ShieldCheck, Hourglass, TimerOff, RefreshCcw, Ban, IndianRupee, Wallet, HandCoins, CalendarClock, AlertTriangle, X, LayoutList, KanbanSquare, CalendarDays, ChevronLeft, ChevronRight, FilePen, ClipboardCheck, Layers } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
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
import { USERS, getUserById } from '../../data/users'
import { useContractsData, useContractAccess, useContractSettings } from '../../hooks/useContracts'
import { CONTRACT_STATUS_LIST, CONTRACT_LIVE, effectiveStatus, allowedTransitions, contractBilling, daysUntil } from '../../utils/contractRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { localDate } from '../../utils/calendarRules'
import { ContractFormDialog } from './ContractFormDialog'
import { ContractStatusDialog } from './ContractStatusDialog'

const EMPTY = { type: 'all', status: 'all', customer: 'all', company: 'all', owner: 'all', project: 'all', startFrom: '', startTo: '', endFrom: '', endTo: '', renewFrom: '', renewTo: '', minValue: '', maxValue: '' }
const VIEWS = [['list', 'List', LayoutList], ['kanban', 'Kanban', KanbanSquare], ['calendar', 'Calendar', CalendarDays]]
const QUICK = [['all', 'All contracts'], ['my', 'My contracts'], ['team', 'Team contracts'], ['active', 'Active'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['pipeline', 'Renewal pipeline']]
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30', ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800' }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/** End date with a "42d left" / "Expired 3d ago" cue. */
export function Countdown({ contract, status, className }) {
  if (!contract.endDate) return <span className="text-ink-400">—</span>
  const left = daysUntil(contract.endDate)
  if (['Renewed', 'Terminated', 'Cancelled'].includes(status)) return <span className={clsx('text-xs text-ink-400', className)}>{formatDate(contract.endDate)}</span>
  const over = left < 0
  const soon = !over && left <= 60 && CONTRACT_LIVE.includes(status)
  return (
    <span className={clsx('inline-flex flex-col text-xs', over ? 'font-semibold text-rose-600 dark:text-rose-400' : soon ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-ink-600 dark:text-ink-300', className)}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">{over && <AlertTriangle size={12} />}{formatDate(contract.endDate)}</span>
      {(over || CONTRACT_LIVE.includes(status)) && <span className="text-[10px] opacity-80">{over ? `Expired ${-left}d ago` : left === 0 ? 'Ends today' : `${left}d left`}</span>}
    </span>
  )
}

function ContractCalendar({ rows, onOpen }) {
  const [cursor, setCursor] = useState(() => new Date())
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()))
  const byDay = useMemo(() => {
    const m = {}
    const put = (d, e) => { if (d) (m[d.slice(0, 10)] = m[d.slice(0, 10)] || []).push(e) }
    rows.forEach(({ c, status }) => {
      put(c.startDate, { c, kind: 'start', text: `Starts: ${c.number}` })
      if (['Active', 'Expiring Soon', 'Signed', 'Sent', 'Approved'].includes(status)) put(c.renewalDate, { c, kind: 'renewal', text: `Renewal: ${c.number}` })
      put(c.endDate, { c, kind: 'end', text: `Ends: ${c.number}` })
    })
    return m
  }, [rows])
  const todayK = localDate(new Date())
  const style = { start: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', end: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', renewal: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' }
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{cursor.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h3>
        <div className="flex items-center gap-1"><button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setCursor(new Date())} className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">Today</button>
          <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronRight size={16} /></button></div>
      </div>
      <div className="grid grid-cols-7 border-b border-ink-100 text-center text-[11px] font-semibold uppercase text-ink-400 dark:border-ink-800">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((d) => { const k = localDate(d); const ev = byDay[k] || []; const inMonth = d.getMonth() === cursor.getMonth()
          return (
            <div key={k} className={clsx('min-h-[88px] border-b border-r border-ink-50 p-1.5 dark:border-ink-800/60', !inMonth && 'bg-ink-50/40 dark:bg-ink-950/30')}>
              <span className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', k === todayK ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink-700 dark:text-ink-200' : 'text-ink-300 dark:text-ink-600')}>{d.getDate()}</span>
              <div className="mt-0.5 space-y-0.5">{ev.slice(0, 3).map((e, i) => <button key={i} type="button" onClick={() => onOpen(e.c)} title={`${e.text} — ${e.c.title}`} className={clsx('block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium', style[e.kind])}>{e.text}</button>)}{ev.length > 3 && <p className="px-1 text-[10px] text-ink-400">+{ev.length - 3} more</p>}</div>
            </div>
          ) })}
      </div>
      <p className="flex flex-wrap items-center gap-4 border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500 dark:border-ink-800"><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-sky-300" />Start</span><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-300" />Renewal</span><span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-rose-300" />End</span></p>
    </div>
  )
}

export default function Contracts() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { data, error, reload } = useContractsData()
  const { user, can, canView } = useContractAccess(data?.projects)
  const { types, config } = useContractSettings()
  const [view, setView] = useState('list')
  const [quick, setQuick] = useState('all')
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [preset, setPreset] = useState(null)
  const [statusChange, setStatusChange] = useState(null)
  const [overKanban, setOverKanban] = useState(null)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (params.get('create') !== '1') return
    const keys = ['salesOrderId', 'quotationId', 'projectId', 'dealId']
    setPreset(Object.fromEntries(keys.map((k) => [k, params.get(k) || undefined])))
    setFormOpen(true)
    setParams((p) => { const n = new URLSearchParams(p); ['create', ...keys].forEach((k) => n.delete(k)); return n }, { replace: true })
  }, [params, setParams])
  useEffect(() => { setPage(1) }, [search, f, quick, view])

  const rows = useMemo(() => {
    if (!data) return []
    return data.contracts.filter((c) => canView(c)).map((c) => {
      const perms = can(c)
      const status = effectiveStatus(c, config)
      return { c, status, perms, billing: perms.viewFinancial ? contractBilling(c, data.invoices, data.payments, data.contracts) : null, company: data.companies.find((x) => x.id === c.companyId)?.name || '' }
    })
  }, [data, user?.id, config]) // eslint-disable-line react-hooks/exhaustive-deps

  const horizon = Math.max(...config.reminderDays)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ c, status, company }) => {
      const left = daysUntil(c.endDate)
      if (quick === 'my' && !(c.owner === user?.id || (c.team || []).includes(user?.id))) return false
      if (quick === 'team' && !(c.team || []).some((id) => id !== c.owner)) return false
      if (quick === 'active' && !['Active', 'Expiring Soon', 'Signed'].includes(status)) return false
      if (quick === 'expiring' && status !== 'Expiring Soon') return false
      if (quick === 'expired' && status !== 'Expired') return false
      if (quick === 'pipeline' && !(['Active', 'Expiring Soon'].includes(status) && left !== null && left <= horizon)) return false
      if (q && !`${c.number} ${c.title} ${c.customerName} ${company} ${c.contractType} ${c.projectId || ''} ${c.dealId || ''}`.toLowerCase().includes(q)) return false
      if (f.type !== 'all' && c.contractType !== f.type) return false
      if (f.status !== 'all' && status !== f.status) return false
      if (f.customer !== 'all' && c.customerId !== f.customer) return false
      if (f.company !== 'all' && c.companyId !== f.company) return false
      if (f.owner !== 'all' && c.owner !== f.owner) return false
      if (f.project !== 'all' && c.projectId !== f.project) return false
      if (f.startFrom && (c.startDate || '') < f.startFrom) return false
      if (f.startTo && (c.startDate || '') > f.startTo) return false
      if (f.endFrom && (c.endDate || '') < f.endFrom) return false
      if (f.endTo && (c.endDate || '') > f.endTo) return false
      if (f.renewFrom && (c.renewalDate || '') < f.renewFrom) return false
      if (f.renewTo && (c.renewalDate || '9999') > f.renewTo) return false
      if (f.minValue !== '' && (Number(c.value) || 0) < Number(f.minValue)) return false
      if (f.maxValue !== '' && (Number(c.value) || 0) > Number(f.maxValue)) return false
      return true
    }).sort((a, b) => (quick === 'pipeline' || quick === 'expiring' ? String(a.c.endDate).localeCompare(String(b.c.endDate)) : String(b.c.createdAt || '').localeCompare(String(a.c.createdAt || '')) || b.c.id.localeCompare(a.c.id)))
  }, [rows, quick, search, f, user?.id, horizon])

  const m = useMemo(() => {
    const n = (s) => rows.filter((r) => r.status === s).length
    const fin = rows.filter((r) => r.billing)
    const live = fin.filter((r) => ['Active', 'Expiring Soon'].includes(r.status))
    return {
      total: rows.length, draft: n('Draft'), pending: n('Pending Approval'), active: n('Active'), expiring: n('Expiring Soon'), expired: n('Expired'), renewed: n('Renewed'), terminated: n('Terminated'),
      upcoming: rows.filter((r) => ['Active', 'Expiring Soon'].includes(r.status) && daysUntil(r.c.endDate) >= 0 && daysUntil(r.c.endDate) <= horizon).length,
      value: fin.reduce((s, r) => s + r.billing.value, 0), activeValue: live.reduce((s, r) => s + r.billing.value, 0), outstanding: fin.reduce((s, r) => s + r.billing.outstanding, 0), hasFin: fin.length > 0,
    }
  }, [rows, horizon])
  const go = (q, status = 'all') => { setQuick(q); set({ status }) }
  const cards = [
    ['Total contracts', m.total, FileSignature, 'brand', () => go('all')], ['Draft', m.draft, FilePen, 'ink', () => go('all', 'Draft')], ['Pending approval', m.pending, ClipboardCheck, 'amber', () => go('all', 'Pending Approval')],
    ['Active', m.active, ShieldCheck, 'emerald', () => go('all', 'Active')], ['Expiring soon', m.expiring, Hourglass, 'amber', () => go('expiring')], ['Expired', m.expired, TimerOff, 'rose', () => go('expired')],
    ['Renewed', m.renewed, RefreshCcw, 'sky', () => go('all', 'Renewed')], ['Terminated', m.terminated, Ban, 'rose', () => go('all', 'Terminated')], ['Upcoming renewals', m.upcoming, CalendarClock, 'violet', () => go('pipeline')],
    ...(m.hasFin ? [['Total value', formatCurrency(m.value, { compact: true }), IndianRupee, 'violet'], ['Active value', formatCurrency(m.activeValue, { compact: true }), Wallet, 'emerald'], ['Outstanding', formatCurrency(m.outstanding, { compact: true }), HandCoins, 'rose']] : []),
  ]
  const activeFilters = Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).length
  // Export: every contract that matches the quick view, search and filters on screen; value only for roles that may see money
  const exportColumns = [
    { label: 'Contract #', value: ({ c }) => c.number }, { label: 'Title', value: ({ c }) => c.title }, { label: 'Customer', value: ({ c }) => c.customerName }, { label: 'Owner', value: ({ c }) => getUserById(c.owner)?.name || '' },
    { label: 'Type', value: ({ c }) => c.contractType }, { label: 'Status', value: ({ status }) => status }, { label: 'Start', value: ({ c }) => c.startDate }, { label: 'End', value: ({ c }) => c.endDate },
    { label: 'Renewal of', value: ({ c }) => c.renewedFromId || '' }, { label: 'Value', value: ({ billing }) => (billing ? billing.value : ''), align: 'right' }, { label: 'Branch', value: ({ c }) => c.branch },
  ]
  const exportFilters = describeFilters([['View', quick !== 'all' && quick], ['Search', search.trim() && `"${search.trim()}"`], ...Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).map(([k, v]) => [k, v])])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const pageRows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const canCreate = can(null).create
  const open = (c) => navigate(`/contracts/${c.id}`)
  const templatesAllowed = ['Super Admin', 'Admin', 'Sales Manager', 'Sales Executive'].includes(user?.role)

  const dropOn = (status, e) => {
    e.preventDefault(); setOverKanban(null)
    const row = rows.find((r) => r.c.id === e.dataTransfer.getData('text/contract'))
    if (!row || row.status === status) return
    if (!allowedTransitions(row.c, row.perms, config).includes(status)) { toast(`You can’t move a ${row.status} contract to ${status}.`, { type: 'error' }); return }
    setStatusChange({ row, to: status })
  }

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load contracts" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />

  return (
    <div>
      <PageHeader title="Contracts" description="Agreements from draft to signature, renewal and billing — linked to the deal, order and project they came from."
        actions={<><ExportMenu title="Contracts" noun="contract" columns={exportColumns} rows={() => filtered} filters={exportFilters} />{templatesAllowed && <Button variant="secondary" icon={FileText} onClick={() => navigate('/contracts/templates')}>Templates</Button>}{canCreate && <Button icon={Plus} onClick={() => { setPreset(null); setFormOpen(true) }}>New contract</Button>}</>} />

      {!data ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Contract metrics">
          {cards.map(([label, value, Icon, tone, click]) => (
            <button key={label} type="button" onClick={click} disabled={!click} className={clsx('rounded-xl border border-ink-100 bg-white p-3 text-left shadow-card dark:border-ink-800 dark:bg-ink-900', click ? 'transition-shadow hover:shadow-card-hover' : 'cursor-default')}>
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div>
              <p className={clsx('mt-1.5 text-xl font-bold', ['Expired', 'Outstanding'].includes(label) && value ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-ink-50')}>{value}</p>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Contract groups">
          {QUICK.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={quick === k} onClick={() => setQuick(k)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium', quick === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300')}>{l}</button>)}
        </div>
        <div className="ml-auto flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="View">
          {VIEWS.map(([k, l, Icon]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', view === k ? 'bg-brand-600 text-white' : 'text-ink-500')}><Icon size={14} />{l}</button>)}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by number, title, customer, company…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
        {activeFilters > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
      </div>
      {filtersOpen && data && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          {[['Contract type', 'type', [...new Set([...types, ...rows.map((r) => r.c.contractType)])].map((s) => [s, s])], ['Status', 'status', CONTRACT_STATUS_LIST.map((s) => [s, s])],
            ['Customer', 'customer', data.customers.filter((c) => rows.some((r) => r.c.customerId === c.id)).map((c) => [c.id, c.name])], ['Company', 'company', data.companies.filter((c) => rows.some((r) => r.c.companyId === c.id)).map((c) => [c.id, c.name])],
            ['Owner', 'owner', USERS.filter((u) => rows.some((r) => r.c.owner === u.id)).map((u) => [u.id, u.name])], ['Project', 'project', data.projects.filter((p) => rows.some((r) => r.c.projectId === p.id)).map((p) => [p.id, `${p.id} · ${p.name}`])]].map(([label, key, opts]) => (
            <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          ))}
          {[['Start from', 'startFrom'], ['Start to', 'startTo'], ['End from', 'endFrom'], ['End to', 'endTo'], ['Renewal from', 'renewFrom'], ['Renewal to', 'renewTo']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="date" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
          {m.hasFin && [['Min value', 'minValue'], ['Max value', 'maxValue']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="number" min="0" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
        </div>
      )}

      {!data ? <CardSkeleton className="h-72" /> : filtered.length === 0 ? (
        <EmptyState icon={Layers} title={rows.length ? 'No contracts match' : 'No contracts yet'} description={rows.length ? 'Change the group, search or filters.' : 'Contracts start from a won deal, an accepted quotation, a confirmed order or a project.'} action={!rows.length && canCreate && <Button icon={Plus} onClick={() => setFormOpen(true)}>New contract</Button>} />
      ) : view === 'list' ? (
        <>
          <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div role="row" className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1fr)_8rem_6.5rem_6rem_6.5rem_6rem] gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 lg:grid dark:border-ink-800 dark:bg-ink-800/40"><span>Contract</span><span>Customer</span><span>Owner</span><span>Type</span><span>Status</span><span>Start</span><span>End</span><span className="text-right">Value</span></div>
            {pageRows.map(({ c, status, billing }) => (
              <div key={c.id} role="row" tabIndex={0} onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)} className="grid cursor-pointer grid-cols-1 items-center gap-2 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1fr)_8rem_6.5rem_6rem_6.5rem_6rem] lg:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30">
                <div className="min-w-0"><p className="truncate font-medium text-ink-900 dark:text-ink-50">{c.title}</p><p className="truncate text-xs text-ink-400">{c.number}{c.renewedFromId ? ' · renewal' : ''}</p></div>
                <span className="truncate text-ink-600 dark:text-ink-300">{c.customerName}</span>
                <span className="flex items-center gap-1.5 truncate text-ink-600 dark:text-ink-300"><Avatar name={getUserById(c.owner)?.name} size="xs" />{getUserById(c.owner)?.name}</span>
                <span className="truncate text-xs text-ink-500">{c.contractType}</span>
                <span><StatusBadge status={status} /></span>
                <span className="text-xs text-ink-600 dark:text-ink-300">{formatDate(c.startDate)}</span>
                <Countdown contract={c} status={status} />
                <span className="text-right text-xs font-medium text-ink-800 dark:text-ink-100">{billing ? formatCurrency(billing.value, { compact: true }) : '—'}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      ) : view === 'kanban' ? (
        <>
          <div className="scrollbar-thin grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-3">
            {CONTRACT_STATUS_LIST.map((s) => {
              const col = filtered.filter((r) => r.status === s)
              return (
                <section key={s} aria-label={s} onDragOver={(e) => { e.preventDefault(); setOverKanban(s) }} onDragLeave={() => setOverKanban(null)} onDrop={(e) => dropOn(s, e)} className={clsx('flex min-h-[16rem] flex-col rounded-2xl border bg-ink-50/60 p-3 dark:bg-ink-900/40', overKanban === s ? 'border-brand-400' : 'border-ink-100 dark:border-ink-800')}>
                  <header className="mb-3 flex items-center gap-2 px-1"><h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{s}</h3><span className="rounded-full bg-white px-1.5 text-xs font-medium text-ink-500 dark:bg-ink-800">{col.length}</span></header>
                  <div className="flex flex-1 flex-col gap-2.5">
                    {col.map(({ c, status, billing }) => (
                      <article key={c.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/contract', c.id)} onClick={() => open(c)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(c)} className="cursor-pointer rounded-xl border border-ink-100 bg-white p-3 shadow-card hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
                        <p className="line-clamp-2 text-sm font-medium text-ink-900 dark:text-ink-50">{c.title}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-400">{c.number} · {c.customerName}</p>
                        <div className="mt-2 flex items-center justify-between"><Countdown contract={c} status={status} /><span className="flex items-center gap-1.5 text-xs text-ink-500"><Avatar name={getUserById(c.owner)?.name} size="xs" />{billing ? formatCurrency(billing.value, { compact: true }) : ''}</span></div>
                      </article>
                    ))}
                    {!col.length && <p className="px-2 py-6 text-center text-xs text-ink-400">Drop a contract here</p>}
                  </div>
                </section>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-ink-400">Drag a card to move it along the lifecycle — only moves you’re allowed to make are accepted. Expiring Soon, Expired and Renewed follow the dates and the renewal action.</p>
        </>
      ) : <ContractCalendar rows={filtered} onOpen={open} />}

      <ContractFormDialog open={formOpen} onClose={() => setFormOpen(false)} data={data || { contracts: [], salesOrders: [], deals: [], customers: [], companies: [], quotations: [], proposals: [], projects: [], contacts: [], products: [] }} preset={preset} onSaved={(c) => navigate(`/contracts/${c.id}`)} />
      <ContractStatusDialog contract={statusChange?.row.c} to={statusChange?.to} perms={statusChange?.row.perms} config={config} contact={data?.contacts.find((x) => x.id === statusChange?.row.c.contactId)} onClose={() => setStatusChange(null)} onDone={reload} />
    </div>
  )
}
