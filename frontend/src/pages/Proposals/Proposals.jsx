import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Settings2, FileSignature, FilePen, Send, SearchCheck, CheckCircle2, XCircle, Timer, IndianRupee, Hourglass, Handshake } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { Modal } from '../../components/common/Modal'
import { Input, Select } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { PROPOSAL_STATUSES } from '../../data/constants'
import { salesUsers, getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { PR_OPEN, PR_SENT_STATES } from '../../utils/proposalCalc'
import { sweepExpired } from './proposalClient'

const sel = 'h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const todayStr = () => new Date().toISOString().slice(0, 10)

/** Open deals — a proposal always starts from one, so the client/deal links are never typed in. */
function DealPicker({ open, onClose, onPick }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    setRows(null)
    Promise.all([api.get('/deals', { params: { all: true } }), api.get('/proposals', { params: { all: true } })]).then(([d, p]) => {
      const openDeals = new Set(p.data.filter((x) => PR_OPEN.includes(x.status)).map((x) => x.dealId))
      setRows(d.data.filter((x) => !String(x.stage).startsWith('Closed')).map((x) => ({ ...x, hasOpen: openDeals.has(x.id) })))
    })
  }, [open])
  const list = (rows || []).filter((x) => `${x.name} ${x.id} ${x.companyName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60)
  return (
    <Modal open={open} onClose={onClose} title="New proposal" description="Choose the deal this proposal is for — client, requirement, services and budget are carried over." size="lg">
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by deal, company or ID…" />
        {rows === null ? <p className="py-8 text-center text-sm text-ink-400">Loading deals…</p> : !list.length ? <EmptyState icon={Handshake} title="No open deals found" description="Proposals start from an open deal." /> : (
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            {list.map((d) => (
              <li key={d.id}><button type="button" onClick={() => onPick(d)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-50 dark:hover:bg-ink-800/50">
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{d.name}</span><span className="block text-xs text-ink-400">{d.id} · {d.stage}{d.hasOpen ? ' · has an open proposal' : ''}</span></span>
                <span className="text-sm font-medium text-ink-700 dark:text-ink-200">{formatCurrency(d.value, { compact: true })}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default function Proposals() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [f, setF] = useState({ number: '', status: 'all', owner: 'all', company: 'all', deal: 'all', contact: 'all', from: '', to: '', min: '', max: '', expiry: 'all' })
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const [swept, setSwept] = useState(false)
  useEffect(() => { sweepExpired().finally(() => setSwept(true)) }, [])

  const filterFn = useCallback((p) => {
    if (f.number && !p.number.toLowerCase().includes(f.number.toLowerCase())) return false
    if (f.status !== 'all' && p.status !== f.status) return false
    if (f.owner !== 'all' && p.ownerId !== f.owner) return false
    if (f.company !== 'all' && p.companyId !== f.company) return false
    if (f.deal !== 'all' && p.dealId !== f.deal) return false
    if (f.contact !== 'all' && p.contactId !== f.contact) return false
    if (f.from && p.createdDate < f.from) return false
    if (f.to && p.createdDate > f.to) return false
    if (f.min !== '' && p.value < Number(f.min)) return false
    if (f.max !== '' && p.value > Number(f.max)) return false
    if (f.expiry !== 'all') {
      const days = Math.ceil((new Date(p.validUntil) - new Date(todayStr())) / 86400000)
      if (f.expiry === 'expired' && p.status !== 'Expired') return false
      if (f.expiry === 'week' && !(PR_OPEN.includes(p.status) && days >= 0 && days <= 7)) return false
      if (f.expiry === 'month' && !(PR_OPEN.includes(p.status) && days >= 0 && days <= 30)) return false
      if (f.expiry === 'valid' && !(PR_OPEN.includes(p.status) && days >= 0)) return false
    }
    return true
  }, [f])
  const crud = useCrud('proposals', { searchFields: ['number', 'title', 'customerName', 'dealName'], pageSize: 10, filterFn })
  useEffect(() => { if (swept) crud.refresh?.() }, [swept]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = crud.allItems
  const stats = useMemo(() => {
    const sum = (list) => list.reduce((s, p) => s + (p.value || 0), 0)
    const c = (st) => all.filter((p) => p.status === st).length
    return {
      total: all.length, draft: c('Draft'), review: c('Internal Review'), sent: all.filter((p) => ['Sent', 'Viewed', 'Revision Requested'].includes(p.status)).length,
      accepted: c('Accepted'), rejected: c('Rejected'), expired: c('Expired'),
      totalValue: sum(all), acceptedValue: sum(all.filter((p) => p.status === 'Accepted')), pendingValue: sum(all.filter((p) => PR_OPEN.includes(p.status))),
    }
  }, [all])

  const companies = useMemo(() => [...new Map(all.map((p) => [p.companyId, p.customerName])).entries()].filter(([id]) => id), [all])
  const deals = useMemo(() => [...new Map(all.map((p) => [p.dealId, p.dealName || p.dealId])).entries()].filter(([id]) => id), [all])
  const contacts = useMemo(() => [...new Map(all.map((p) => [p.contactId, p.clientSnapshot?.contactName])).entries()].filter(([id]) => id), [all])
  const active = Object.entries(f).filter(([k, v]) => v && v !== 'all').length
  const clear = () => setF({ number: '', status: 'all', owner: 'all', company: 'all', deal: 'all', contact: 'all', from: '', to: '', min: '', max: '', expiry: 'all' })

  const columns = [
    { key: 'number', width: 170, header: 'Proposal', sortable: true, render: (r) => <span className="font-medium text-ink-800 dark:text-ink-100">{r.number}<span className="ml-1.5 text-[10px] font-semibold text-brand-600">v{r.version}</span></span> },
    { key: 'title', width: 250, header: 'Title', sortable: true, render: (r) => <span className="line-clamp-1 max-w-[240px]">{r.title}</span> },
    { key: 'customerName', width: 200, header: 'Client', sortable: true },
    { key: 'dealId', width: 110, header: 'Deal', render: (r) => (r.dealId ? <button onClick={(e) => { e.stopPropagation(); navigate(`/deals/${r.dealId}`) }} className="text-brand-600 hover:underline dark:text-brand-400">{r.dealId}</button> : <span className="text-ink-400">—</span>) },
    { key: 'value', width: 140, header: 'Value', sortable: true, render: (r) => <span className="font-medium">{formatCurrency(r.value)}</span> },
    { key: 'createdDate', width: 130, header: 'Created', sortable: true, render: (r) => formatDate(r.createdDate) },
    { key: 'validUntil', width: 130, header: 'Expiry', sortable: true, render: (r) => <span className={PR_OPEN.includes(r.status) && r.validUntil < todayStr() ? 'font-medium text-rose-500' : ''}>{formatDate(r.validUntil)}</span> },
    { key: 'status', width: 130, header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'ownerId', width: 140, header: 'Owner', render: (r) => getUserById(r.ownerId)?.name.split(' ')[0] || '—' },
    { key: 'actions', header: '', headerClassName: 'w-10', render: (r) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><IconButton icon={Eye} size="sm" aria-label="Open" onClick={() => navigate(`/proposals/${r.id}`)} /></div> },
  ]

  // Export: every proposal that matches the search and filters on screen
  const exportColumns = [
    { label: 'Proposal #', value: 'number' }, { label: 'Version', value: 'version' }, { label: 'Title', value: 'title' }, { label: 'Client', value: 'customerName' },
    { label: 'Deal', value: 'dealId' }, { label: 'Value', value: (r) => Number(r.value) || 0, align: 'right' }, { label: 'Created', value: 'createdDate' }, { label: 'Expiry', value: 'validUntil' },
    { label: 'Status', value: 'status' }, { label: 'Owner', value: (r) => getUserById(r.ownerId)?.name || '' }, { label: 'Branch', value: 'branch' },
  ]
  const exportFilters = describeFilters([['Search', crud.search && `"${crud.search}"`], ['Number', f.number], ['Status', f.status], ['Owner', f.owner !== 'all' && (getUserById(f.owner)?.name || f.owner)], ['Company', f.company], ['Deal', f.deal], ['Contact', f.contact], ['Created from', f.from], ['Created to', f.to], ['Value from', f.min], ['Value to', f.max], ['Expiry', f.expiry]])

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Solution proposals created from deals — present scope, approach and indicative pricing, then turn them into quotations."
        actions={<>
          <Button variant="secondary" icon={Settings2} onClick={() => navigate('/proposal-templates')}>Manage Templates</Button>
          <ExportMenu title="Proposals" noun="proposal" columns={exportColumns} rows={() => crud.allFiltered} filters={exportFilters} />
          {hasPermission('Proposals', 'create') && <Button icon={Plus} onClick={() => setPickerOpen(true)}>New Proposal</Button>}
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4 2xl:grid-cols-8">
        <StatCard label="Total" value={stats.total} icon={FileSignature} tone="brand" />
        <StatCard label="Draft" value={stats.draft} icon={FilePen} tone="ink" />
        <StatCard label="Internal review" value={stats.review} icon={SearchCheck} tone="amber" />
        <StatCard label="Sent / open" value={stats.sent} icon={Send} tone="sky" />
        <StatCard label="Accepted" value={stats.accepted} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Rejected" value={stats.rejected} icon={XCircle} tone="rose" />
        <StatCard label="Expired" value={stats.expired} icon={Timer} tone="ink" />
        <StatCard label="Total value" value={formatCurrency(stats.totalValue, { compact: true })} icon={IndianRupee} tone="violet" />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Accepted proposal value" value={formatCurrency(stats.acceptedValue, { compact: true })} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Pending proposal value" value={formatCurrency(stats.pendingValue, { compact: true })} icon={Hourglass} tone="amber" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by number, title, client or deal…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={active} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input value={f.number} onChange={(e) => set({ number: e.target.value })} placeholder="Proposal no." aria-label="Proposal number" className={`${sel} w-32`} />
          <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status" className={sel}><option value="all">All statuses</option>{PROPOSAL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={f.company} onChange={(e) => set({ company: e.target.value })} aria-label="Company" className={sel}><option value="all">All companies</option>{companies.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select value={f.contact} onChange={(e) => set({ contact: e.target.value })} aria-label="Client contact" className={sel}><option value="all">All clients</option>{contacts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select value={f.deal} onChange={(e) => set({ deal: e.target.value })} aria-label="Deal" className={sel}><option value="all">All deals</option>{deals.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select value={f.owner} onChange={(e) => set({ owner: e.target.value })} aria-label="Owner" className={sel}><option value="all">All owners</option>{salesUsers().map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select value={f.expiry} onChange={(e) => set({ expiry: e.target.value })} aria-label="Expiry" className={sel}><option value="all">Any expiry</option><option value="valid">Still valid</option><option value="week">Expiring in 7 days</option><option value="month">Expiring in 30 days</option><option value="expired">Expired</option></select>
          <label className="flex items-center gap-1 text-xs text-ink-500">From <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className={sel} /></label>
          <label className="flex items-center gap-1 text-xs text-ink-500">To <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className={sel} /></label>
          <input type="number" min="0" value={f.min} onChange={(e) => set({ min: e.target.value })} placeholder="Min value" aria-label="Minimum value" className={`${sel} w-28`} />
          <input type="number" min="0" value={f.max} onChange={(e) => set({ max: e.target.value })} placeholder="Max value" aria-label="Maximum value" className={`${sel} w-28`} />
          {active > 0 && <Button variant="ghost" size="sm" onClick={clear}>Clear ({active})</Button>}
        </div>
      )}

      <DataTable
        columns={columns} data={crud.items} loading={crud.loading} onRowClick={(r) => navigate(`/proposals/${r.id}`)}
        sort={crud.sort} onSortChange={crud.setSort} page={crud.page} totalPages={crud.totalPages} onPageChange={crud.setPage} total={crud.total} pageSize={10}
        emptyTitle="No proposals found" emptyDescription="Adjust your search or filters — or start a new proposal from an open deal."
      />

      <DealPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(d) => { setPickerOpen(false); navigate(`/proposals/new?dealId=${d.id}`) }} />
    </div>
  )
}
