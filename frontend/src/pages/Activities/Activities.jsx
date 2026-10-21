import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LayoutList, History, Eye, CheckCircle2, ListChecks, CalendarClock, AlertTriangle, CalendarDays, UserCheck } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { Badge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { getUserById, USERS } from '../../data/users'
import { formatDateTime } from '../../utils/format'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { ACTIVITY_TYPE_NAMES, RELATED_TYPES, RELATED_BY_TYPE, canonicalType, effectiveStatus, relatedHref, isSystemEvent } from '../../utils/activityRules'
import { LogActivityDialog, useCrmLookup } from './LogActivityDialog'
import ActivityDetailDialog from './ActivityDetailDialog'

const PAGE_SIZE = 15
const TIMELINE_STEP = 50
const TYPE_TONE = { Call: 'info', Email: 'neutral', WhatsApp: 'success', SMS: 'success', Meeting: 'warning', 'Follow-up': 'danger', Task: 'success', Note: 'neutral', 'System event': 'neutral' }
const STATUS_TONE = { Scheduled: 'info', Overdue: 'danger', Completed: 'success', Cancelled: 'neutral' }
const sel = 'h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const EMPTY = { type: 'all', status: 'all', relatedType: 'all', user: 'all', company: 'all', customer: 'all', deal: 'all', source: 'all', from: '', to: '', mine: false }

export default function Activities() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [f, setF] = useState(EMPTY)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const [view, setView] = useState('timeline')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [timelineLimit, setTimelineLimit] = useState(TIMELINE_STEP)
  const [logOpen, setLogOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const { data: lookup, find } = useCrmLookup(true)

  const filterFn = useCallback((a) => {
    if (f.type !== 'all' && canonicalType(a) !== f.type) return false
    if (f.status !== 'all' && effectiveStatus(a) !== f.status) return false
    if (f.relatedType !== 'all' && a.relatedType !== f.relatedType) return false
    if (f.user !== 'all' && a.by !== f.user && a.assignedTo !== f.user) return false
    if (f.mine && a.by !== user?.id && a.assignedTo !== user?.id) return false
    if (f.company !== 'all' && a.links?.companyId !== f.company) return false
    if (f.customer !== 'all' && a.links?.customerId !== f.customer) return false
    if (f.deal !== 'all' && a.links?.dealId !== f.deal) return false
    if (f.source === 'manual' && isSystemEvent(a)) return false
    if (f.source === 'system' && !isSystemEvent(a)) return false
    if (f.from && new Date(a.date) < new Date(f.from)) return false
    if (f.to && new Date(a.date) > new Date(`${f.to}T23:59:59`)) return false
    return true
  }, [f, user?.id])
  const crud = useCrud('activities', { searchFields: ['subject', 'relatedName', 'notes', 'type', 'relatedType'], pageSize: PAGE_SIZE, filterFn })
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1); setTimelineLimit(TIMELINE_STEP) }, [crud.search, f])

  const all = crud.allItems
  const stats = useMemo(() => {
    const now = Date.now()
    const today = new Date().toDateString()
    const week = now - 7 * 86400000
    return {
      total: all.length,
      today: all.filter((a) => new Date(a.date).toDateString() === today && a.status !== 'Cancelled').length,
      upcoming: all.filter((a) => a.status === 'Scheduled' && new Date(a.date).getTime() >= now).length,
      overdue: all.filter((a) => effectiveStatus(a, now) === 'Overdue').length,
      done: all.filter((a) => a.status === 'Completed' && new Date(a.date).getTime() >= week).length,
      mine: all.filter((a) => a.assignedTo === user?.id && a.status === 'Scheduled').length,
    }
  }, [all, user?.id])

  const sorted = useMemo(() => [...crud.allFiltered].sort((a, b) => new Date(b.date) - new Date(a.date)), [crud.allFiltered])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const tableRows = useMemo(() => {
    const rows = crud.sort?.field ? crud.allFiltered : sorted
    return rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  }, [crud.allFiltered, crud.sort, sorted, current])

  const ids = (key) => [...new Set(all.map((a) => a.links?.[key]).filter(Boolean))]
  const nameOf = (col, id) => find(col, id)?.name || id
  const activeCount = Object.entries(f).filter(([k, v]) => v && v !== 'all' && k !== 'mine').length + (f.mine ? 1 : 0)
  const refresh = () => crud.refresh?.()

  const quickComplete = (a) => api.post(`/activities/${a.id}/complete`, {}).then(() => { toast('Marked complete.', { type: 'success' }); refresh() }).catch((e) => toast(e?.response?.data?.message || 'Could not update.', { type: 'error' }))

  const columns = [
    { key: 'type', width: 140, header: 'Type', render: (r) => <Badge tone={TYPE_TONE[canonicalType(r)] || 'info'}>{canonicalType(r) === 'System event' ? r.type : canonicalType(r)}</Badge> },
    { key: 'subject', width: 280, header: 'Subject', sortable: true, render: (r) => <span className="line-clamp-1 max-w-[260px] font-medium text-ink-800 dark:text-ink-100">{r.subject}</span> },
    {
      key: 'relatedName', width: 220, header: 'Related to',
      render: (r) => (
        <button onClick={(e) => { e.stopPropagation(); const h = relatedHref(r.relatedType, r.relatedId); if (h) navigate(h) }} className="inline-flex max-w-[220px] items-center gap-1.5 text-left text-xs font-medium text-ink-700 hover:text-brand-600 dark:text-ink-200">
          <Badge tone="neutral">{r.relatedType}</Badge><span className="truncate">{r.relatedName}</span>
        </button>
      ),
    },
    { key: 'links', width: 100, header: 'Linked', render: (r) => { const n = Object.keys(r.links || {}).length; return <span className="text-xs text-ink-500" title={Object.keys(r.links || {}).join(', ')}>{n} record{n === 1 ? '' : 's'}</span> } },
    { key: 'by', width: 160, header: 'Logged by', render: (r) => getUserById(r.by)?.name || (r.by ? r.by : 'System') },
    { key: 'assignedTo', width: 150, header: 'Assigned', render: (r) => getUserById(r.assignedTo)?.name.split(' ')[0] || '—' },
    { key: 'date', width: 170, header: 'Date', sortable: true, render: (r) => formatDateTime(r.date) },
    { key: 'status', width: 130, header: 'Status', render: (r) => <Badge tone={STATUS_TONE[effectiveStatus(r)] || 'neutral'}>{effectiveStatus(r)}</Badge> },
    {
      key: 'actions', width: 88, header: '', headerClassName: 'w-20',
      render: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {r.source === 'manual' && r.status === 'Scheduled' && <IconButton icon={CheckCircle2} size="sm" aria-label="Mark complete" className="hover:text-emerald-600" onClick={() => quickComplete(r)} />}
          <IconButton icon={Eye} size="sm" aria-label="View activity" onClick={() => setDetailId(r.id)} />
        </div>
      ),
    },
  ]

  // Export: every activity that matches the search and filters on screen (all pages), newest first unless a sort is chosen
  const exportColumns = [
    { label: 'Type', value: (a) => canonicalType(a) }, { label: 'Subject', value: 'subject' }, { label: 'Related type', value: 'relatedType' }, { label: 'Related to', value: 'relatedName' },
    { label: 'Linked records', value: (a) => Object.keys(a.links || {}).join(' ') }, { label: 'Logged by', value: (a) => getUserById(a.by)?.name || (a.by ? a.by : 'System') },
    { label: 'Assigned to', value: (a) => getUserById(a.assignedTo)?.name || '' }, { label: 'Date', value: (a) => formatDateTime(a.date) }, { label: 'Status', value: (a) => effectiveStatus(a) }, { label: 'Notes', value: 'notes' },
  ]
  const exportFilters = describeFilters([
    ['Search', crud.search && `"${crud.search}"`], ['Type', f.type], ['Status', f.status], ['Related to', f.relatedType], ['User', f.user !== 'all' && (getUserById(f.user)?.name || f.user)],
    ['Company', f.company !== 'all' && nameOf('companies', f.company)], ['Customer', f.customer !== 'all' && nameOf('customers', f.customer)], ['Deal', f.deal !== 'all' && nameOf('deals', f.deal)],
    ['Source', f.source], ['From', f.from], ['To', f.to], ['Only mine', f.mine && 'Yes'],
  ])

  return (
    <div>
      <PageHeader
        title="Activities"
        description="Every call, email, meeting, task and system event — each tied to the real records it concerns."
        actions={<><ExportMenu title="Activities" noun="activity" columns={exportColumns} rows={() => (crud.sort?.field ? crud.allFiltered : sorted)} filters={exportFilters} /><Button icon={Plus} onClick={() => setLogOpen(true)}>Log Activity</Button></>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total activities" value={stats.total} icon={ListChecks} tone="brand" />
        <StatCard label="Today" value={stats.today} icon={CalendarDays} tone="sky" onClick={() => set({ from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })} />
        <StatCard label="Upcoming" value={stats.upcoming} icon={CalendarClock} tone="violet" onClick={() => set({ status: 'Scheduled' })} />
        <StatCard label="Overdue" value={stats.overdue} icon={AlertTriangle} tone="rose" onClick={() => set({ status: 'Overdue' })} />
        <StatCard label="Completed (7 days)" value={stats.done} icon={CheckCircle2} tone="emerald" onClick={() => set({ status: 'Completed' })} />
        <StatCard label="My open items" value={stats.mine} icon={UserCheck} tone="amber" onClick={() => set({ mine: true, status: 'Scheduled' })} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search subject, record or notes…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeCount} onClick={() => setFiltersOpen((o) => !o)} />
        <label className="flex items-center gap-1.5 text-xs text-ink-600 dark:text-ink-300"><input type="checkbox" checked={f.mine} onChange={(e) => set({ mine: e.target.checked })} /> My activities</label>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900">
          <Button variant={view === 'timeline' ? 'subtle' : 'ghost'} size="sm" icon={History} onClick={() => setView('timeline')}>Timeline</Button>
          <Button variant={view === 'table' ? 'subtle' : 'ghost'} size="sm" icon={LayoutList} onClick={() => setView('table')}>Table</Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          <select aria-label="Type" value={f.type} onChange={(e) => set({ type: e.target.value })} className={sel}><option value="all">All types</option>{ACTIVITY_TYPE_NAMES.map((t) => <option key={t}>{t}</option>)}<option value="System event">System events</option></select>
          <select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} className={sel}><option value="all">All statuses</option>{['Scheduled', 'Overdue', 'Completed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Related to" value={f.relatedType} onChange={(e) => set({ relatedType: e.target.value })} className={sel}><option value="all">Any record type</option>{RELATED_TYPES.map((r) => <option key={r.type}>{r.type}</option>)}</select>
          <select aria-label="User" value={f.user} onChange={(e) => set({ user: e.target.value })} className={sel}><option value="all">Any user</option>{[...new Set(all.flatMap((a) => [a.by, a.assignedTo]).filter(Boolean))].map((id) => <option key={id} value={id}>{USERS.find((u) => u.id === id)?.name || id}</option>)}</select>
          <select aria-label="Company" value={f.company} onChange={(e) => set({ company: e.target.value })} className={sel}><option value="all">Any company</option>{ids('companyId').map((id) => <option key={id} value={id}>{nameOf('companies', id)}</option>)}</select>
          <select aria-label="Customer" value={f.customer} onChange={(e) => set({ customer: e.target.value })} className={sel}><option value="all">Any customer</option>{ids('customerId').map((id) => <option key={id} value={id}>{nameOf('customers', id)}</option>)}</select>
          <select aria-label="Deal" value={f.deal} onChange={(e) => set({ deal: e.target.value })} className={sel}><option value="all">Any deal</option>{ids('dealId').map((id) => <option key={id} value={id}>{nameOf('deals', id)}</option>)}</select>
          <select aria-label="Source" value={f.source} onChange={(e) => set({ source: e.target.value })} className={sel}><option value="all">Logged + system</option><option value="manual">Logged by users</option><option value="system">System events</option></select>
          <label className="flex items-center gap-1 text-xs text-ink-500">From <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className={sel} /></label>
          <label className="flex items-center gap-1 text-xs text-ink-500">To <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className={sel} /></label>
          {activeCount > 0 && <Button variant="ghost" size="sm" onClick={() => setF(EMPTY)}>Clear ({activeCount})</Button>}
        </div>
      )}

      {view === 'timeline' ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          {crud.loading ? <p className="py-10 text-center text-sm text-ink-400">Loading activity feed…</p> : sorted.length === 0 ? <p className="py-10 text-center text-sm text-ink-400">No activities match these filters.</p> : (
            <>
              <ActivityTimeline items={sorted.slice(0, timelineLimit)} showRelated />
              {sorted.length > timelineLimit && <div className="mt-4 flex justify-center"><Button variant="secondary" size="sm" onClick={() => setTimelineLimit((n) => n + TIMELINE_STEP)}>Load more</Button></div>}
            </>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns} data={tableRows} loading={crud.loading} onRowClick={(r) => setDetailId(r.id)}
          sort={crud.sort} onSortChange={crud.setSort} page={current} totalPages={totalPages} onPageChange={setPage} total={sorted.length} pageSize={PAGE_SIZE}
          emptyTitle="No activities found" emptyDescription="Try adjusting your search or filters — or log a new activity."
        />
      )}

      <LogActivityDialog open={logOpen} onClose={() => setLogOpen(false)} onLogged={refresh} />
      <ActivityDetailDialog activityId={detailId} lookup={lookup} find={find} onClose={() => setDetailId(null)} onChanged={refresh} />
    </div>
  )
}
