import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, FolderKanban, Activity, CheckCircle2, AlertTriangle, IndianRupee, PauseCircle, CalendarClock, Wallet, Receipt, HandCoins, Layers, X, LayoutList, KanbanSquare, GanttChartSquare, CalendarDays, ChevronLeft, ChevronRight, Flag, Play } from 'lucide-react'
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
import { api } from '../../api/mockServer'
import { USERS, getUserById } from '../../data/users'
import { useProjectsData, useProjectAccess } from '../../hooks/useProjects'
import { PROJECT_STATUS_LIST, PROJECT_TYPES, PROJECT_PRIORITIES, PROJECT_TRANSITIONS, isOpenProject, isOverdueProject, effectiveProgress, projectBilling, taskStats } from '../../utils/projectRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { localDate } from '../../utils/calendarRules'
import { PriorityMark } from '../Tasks/TaskBits'
import { ProgressBar, EndDate } from './ProjectBits'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectStatusDialog } from './ProjectStatusDialog'

const EMPTY = { manager: 'all', team: 'all', customer: 'all', company: 'all', status: 'all', priority: 'all', type: 'all', startFrom: '', startTo: '', endFrom: '', endTo: '' }
const VIEWS = [['list', 'List', LayoutList], ['kanban', 'Kanban', KanbanSquare], ['timeline', 'Timeline', GanttChartSquare], ['calendar', 'Calendar', CalendarDays]]
const QUICK = [['all', 'All projects'], ['my', 'My projects'], ['team', 'Team projects'], ['active', 'Active'], ['completed', 'Completed'], ['overdue', 'Overdue']]
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30', ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800' }
const dayKey = (s) => new Date(`${s}T00:00:00`)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

function Timeline({ rows, today, onOpen }) {
  const dated = rows.filter((r) => r.p.startDate && r.p.deadline)
  if (!dated.length) return <EmptyState icon={GanttChartSquare} title="Nothing to chart" description="Projects with a start and end date appear here." />
  const min = addDays(dayKey(dated.reduce((m, r) => (r.p.startDate < m ? r.p.startDate : m), dated[0].p.startDate)), -7)
  const max = addDays(dayKey(dated.reduce((m, r) => (r.p.deadline > m ? r.p.deadline : m), dated[0].p.deadline)), 14)
  const span = Math.max(30, Math.round((max - min) / 86400000))
  const ppd = span > 420 ? 2 : 3
  const x = (s) => Math.round((dayKey(s) - min) / 86400000) * ppd
  const months = []
  for (let d = new Date(min.getFullYear(), min.getMonth(), 1); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d)
  const width = span * ppd
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="scrollbar-thin overflow-x-auto">
        <div style={{ width: width + 240 }}>
          <div className="sticky top-0 z-10 flex border-b border-ink-100 bg-ink-50/80 text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/60">
            <div className="sticky left-0 z-20 w-60 shrink-0 bg-ink-50 px-4 py-2 dark:bg-ink-800">Project</div>
            <div className="relative h-8 flex-1">{months.map((m) => <span key={m.toISOString()} className="absolute top-2 whitespace-nowrap border-l border-ink-200 pl-1.5 dark:border-ink-700" style={{ left: Math.max(0, x(localDate(m))) }}>{m.toLocaleString('en-IN', { month: 'short', year: '2-digit' })}</span>)}</div>
          </div>
          {dated.map(({ p, progress, milestones }) => (
            <div key={p.id} className="flex border-b border-ink-50 last:border-0 dark:border-ink-800/60">
              <button type="button" onClick={() => onOpen(p)} className="sticky left-0 z-10 w-60 shrink-0 bg-white px-4 py-3 text-left hover:bg-ink-50 dark:bg-ink-900 dark:hover:bg-ink-800">
                <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{p.name}</p><p className="truncate text-xs text-ink-400">{p.id} · {getUserById(p.manager)?.name}</p>
              </button>
              <div className="relative h-14 flex-1">
                <div className="absolute inset-y-0 w-px bg-rose-400/70" style={{ left: x(today) }} title="Today" />
                <button type="button" onClick={() => onOpen(p)} aria-label={`${p.name}: ${formatDate(p.startDate)} to ${formatDate(p.deadline)}, ${progress}% done`}
                  className={clsx('absolute top-4 h-6 overflow-hidden rounded-md text-left', isOverdueProject(p) ? 'bg-rose-200 dark:bg-rose-900/50' : p.status === 'Completed' ? 'bg-emerald-200 dark:bg-emerald-900/50' : 'bg-brand-200 dark:bg-brand-900/50')}
                  style={{ left: x(p.startDate), width: Math.max(12, x(p.deadline) - x(p.startDate)) }}>
                  <span className={clsx('absolute inset-y-0 left-0', isOverdueProject(p) ? 'bg-rose-500' : p.status === 'Completed' ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${progress}%` }} />
                  <span className="relative px-1.5 text-[10px] font-semibold leading-6 text-white mix-blend-normal">{progress}%</span>
                </button>
                {milestones.filter((m) => m.dueDate).map((m) => <span key={m.id} title={`${m.title} · ${formatDate(m.dueDate)} · ${m.status}`} className={clsx('absolute top-5 h-3 w-3 rotate-45 border border-white dark:border-ink-900', m.status === 'Completed' ? 'bg-emerald-500' : m.overdue ? 'bg-rose-500' : 'bg-amber-400')} style={{ left: x(m.dueDate) - 6 }} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-4 border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500 dark:border-ink-800"><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rotate-45 bg-amber-400" />Milestone</span><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rotate-45 bg-emerald-500" />Done</span><span className="inline-flex items-center gap-1"><span className="h-3 w-3 rotate-45 bg-rose-500" />Overdue</span><span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-rose-400" />Today</span></p>
    </div>
  )
}

function ProjectCalendar({ rows, onOpen }) {
  const [cursor, setCursor] = useState(() => new Date())
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()))
  const byDay = useMemo(() => {
    const m = {}
    const put = (d, e) => { if (d) (m[d] = m[d] || []).push(e) }
    rows.forEach(({ p, milestones }) => { put(p.startDate, { p, kind: 'start', text: `Start: ${p.name}` }); put(p.deadline, { p, kind: 'end', text: `Due: ${p.name}` }); milestones.forEach((t) => put(t.dueDate, { p, kind: 'milestone', text: `${t.title} — ${p.name}`, done: t.status === 'Completed' })) })
    return m
  }, [rows])
  const todayK = localDate(new Date())
  const style = { start: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', end: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', milestone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' }
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
              <div className="mt-0.5 space-y-0.5">{ev.slice(0, 3).map((e, i) => <button key={i} type="button" onClick={() => onOpen(e.p)} title={e.text} className={clsx('flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] font-medium', style[e.kind], e.done && 'line-through opacity-60')}>{e.kind === 'end' ? <Flag size={9} /> : e.kind === 'start' ? <Play size={9} /> : <span className="h-1.5 w-1.5 rotate-45 bg-current" />}<span className="truncate">{e.text}</span></button>)}{ev.length > 3 && <p className="px-1 text-[10px] text-ink-400">+{ev.length - 3} more</p>}</div>
            </div>
          ) })}
      </div>
    </div>
  )
}

export default function Projects() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const { data, error, reload } = useProjectsData()
  const { user, can, canView } = useProjectAccess()
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
  const synced = useRef(new Set())

  useEffect(() => {
    if (params.get('create') !== '1') return
    setPreset({ salesOrderId: params.get('salesOrderId') || undefined, dealId: params.get('dealId') || undefined })
    setFormOpen(true)
    setParams((p) => { const n = new URLSearchParams(p); ['create', 'salesOrderId', 'dealId'].forEach((k) => n.delete(k)); return n }, { replace: true })
  }, [params, setParams])
  useEffect(() => { setPage(1) }, [search, f, quick, view])

  const rows = useMemo(() => {
    if (!data) return []
    const byProject = {}
    data.tasks.forEach((t) => { const pid = t.links?.projectId || (t.relatedType === 'Project' ? t.relatedId : null); if (pid) (byProject[pid] = byProject[pid] || []).push(t) })
    return data.projects.filter((p) => canView(p)).map((p) => {
      const tasks = byProject[p.id] || []
      const perms = can(p)
      return { p, tasks, perms, progress: effectiveProgress(p, tasks), stats: taskStats(tasks), billing: perms.viewFinancial ? projectBilling(p, data.invoices, data.payments) : null, milestones: tasks.filter((t) => t.taskType === 'Milestone' && t.status !== 'Cancelled'), companyName: data.companies.find((c) => c.id === p.companyId)?.name || '' }
    })
  }, [data, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the stored % in step with the tasks, so every other screen (reports, customer page…) reads the same figure
  useEffect(() => {
    rows.forEach(({ p, progress, perms }) => {
      if (p.progressMode === 'manual' || p.status === 'Completed' || !perms.edit || Math.round(Number(p.progress) || 0) === progress) return
      const key = `${p.id}:${progress}`
      if (synced.current.has(key)) return
      synced.current.add(key)
      api.put(`/projects/${p.id}`, { progress }).then(() => reload()).catch(() => {})
    })
  }, [rows, reload])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ p, companyName }) => {
      if (quick === 'my' && !(p.manager === user?.id || (p.team || []).includes(user?.id))) return false
      if (quick === 'team' && !(p.team || []).some((id) => id !== p.manager)) return false
      if (quick === 'active' && p.status !== 'Active') return false
      if (quick === 'completed' && p.status !== 'Completed') return false
      if (quick === 'overdue' && !isOverdueProject(p)) return false
      if (q && !`${p.id} ${p.name} ${p.customerName} ${companyName} ${p.projectType}`.toLowerCase().includes(q)) return false
      if (f.manager !== 'all' && p.manager !== f.manager) return false
      if (f.team !== 'all' && !(p.team || []).includes(f.team)) return false
      if (f.customer !== 'all' && p.customerId !== f.customer) return false
      if (f.company !== 'all' && p.companyId !== f.company) return false
      if (f.status !== 'all' && p.status !== f.status) return false
      if (f.priority !== 'all' && p.priority !== f.priority) return false
      if (f.type !== 'all' && p.projectType !== f.type) return false
      if (f.startFrom && p.startDate < f.startFrom) return false
      if (f.startTo && p.startDate > f.startTo) return false
      if (f.endFrom && p.deadline < f.endFrom) return false
      if (f.endTo && p.deadline > f.endTo) return false
      return true
    }).sort((a, b) => (isOverdueProject(b.p) - isOverdueProject(a.p)) || String(a.p.deadline).localeCompare(String(b.p.deadline)))
  }, [rows, quick, search, f, user?.id])

  const m = useMemo(() => {
    const fin = rows.filter((r) => r.billing)
    return {
      total: rows.length, active: rows.filter((r) => r.p.status === 'Active').length, planned: rows.filter((r) => r.p.status === 'Planned').length, hold: rows.filter((r) => r.p.status === 'On Hold').length,
      completed: rows.filter((r) => r.p.status === 'Completed').length, overdue: rows.filter((r) => isOverdueProject(r.p)).length,
      value: fin.reduce((s, r) => s + r.billing.value, 0), invoiced: fin.reduce((s, r) => s + r.billing.invoiced, 0), paid: fin.reduce((s, r) => s + r.billing.paid, 0), outstanding: fin.reduce((s, r) => s + r.billing.outstanding, 0), hasFin: fin.length > 0,
    }
  }, [rows])
  const cards = [
    ['Total projects', m.total, FolderKanban, 'brand', () => setQuick('all')], ['Active', m.active, Activity, 'emerald', () => { setQuick('active') }], ['Planned', m.planned, CalendarClock, 'sky', () => { setQuick('all'); set({ status: 'Planned' }) }],
    ['On hold', m.hold, PauseCircle, 'amber', () => { setQuick('all'); set({ status: 'On Hold' }) }], ['Completed', m.completed, CheckCircle2, 'emerald', () => setQuick('completed')], ['Overdue', m.overdue, AlertTriangle, 'rose', () => setQuick('overdue')],
    ...(m.hasFin ? [['Total value', formatCurrency(m.value, { compact: true }), IndianRupee, 'violet'], ['Invoiced', formatCurrency(m.invoiced, { compact: true }), Receipt, 'sky'], ['Paid', formatCurrency(m.paid, { compact: true }), Wallet, 'emerald'], ['Outstanding', formatCurrency(m.outstanding, { compact: true }), HandCoins, 'rose']] : []),
  ]
  const activeFilters = Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).length
  // Export: every project that matches the quick view, search and filters on screen (List, Kanban, Timeline and Calendar show the same projects); value only for roles that may see money
  const exportColumns = [
    { label: 'Project ID', value: ({ p }) => p.id }, { label: 'Project', value: ({ p }) => p.name }, { label: 'Type', value: ({ p }) => p.projectType }, { label: 'Customer', value: ({ p }) => p.customerName },
    { label: 'Company', value: ({ companyName }) => companyName }, { label: 'Manager', value: ({ p }) => getUserById(p.manager)?.name || '' }, { label: 'Team', value: ({ p }) => (p.team || []).map((id) => getUserById(id)?.name || id).join(', ') },
    { label: 'Status', value: ({ p }) => p.status }, { label: 'Priority', value: ({ p }) => p.priority }, { label: 'Start date', value: ({ p }) => p.startDate }, { label: 'Deadline', value: ({ p }) => p.deadline },
    { label: 'Progress %', value: ({ progress }) => Math.round(progress), align: 'right' }, { label: 'Value', value: ({ billing }) => (billing ? billing.value : ''), align: 'right' }, { label: 'Branch', value: ({ p }) => p.branch },
  ]
  const exportFilters = describeFilters([
    ['View', quick !== 'all' && (QUICK.find((q) => q[0] === quick)?.[1] || quick)], ['Search', search.trim() && `"${search.trim()}"`], ['Manager', f.manager !== 'all' && (getUserById(f.manager)?.name || f.manager)],
    ['Team member', f.team !== 'all' && (getUserById(f.team)?.name || f.team)], ['Customer', f.customer], ['Company', f.company], ['Status', f.status], ['Priority', f.priority], ['Type', f.type],
    ['Start from', f.startFrom], ['Start to', f.startTo], ['End from', f.endFrom], ['End to', f.endTo],
  ])
  const pageRows = filtered.slice((Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))) - 1) * PAGE_SIZE, Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))) * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const today = localDate(new Date())
  const canCreate = can(null).create
  const open = (p) => navigate(`/projects/${p.id}`)

  const dropOn = (status, e) => {
    e.preventDefault(); setOverKanban(null)
    const row = rows.find((r) => r.p.id === e.dataTransfer.getData('text/project'))
    if (!row || row.p.status === status) return
    if (!row.perms.changeStatus && !(row.p.status === 'Completed' && row.perms.reopen)) { toast('You can’t change this project’s status.', { type: 'error' }); return }
    if (!(PROJECT_TRANSITIONS[row.p.status] || []).includes(status)) { toast(`A ${row.p.status} project can’t move to ${status}.`, { type: 'error' }); return }
    setStatusChange({ project: row.p, to: status, openTasks: row.stats.open })
  }

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load projects" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Delivery of what was sold — from the confirmed order to the final payment."
        actions={<><ExportMenu title="Projects" noun="project" columns={exportColumns} rows={() => filtered} filters={exportFilters} />{canCreate && <Button icon={Plus} onClick={() => { setPreset(null); setFormOpen(true) }}>New project</Button>}</>}
      />

      {!data ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Project metrics">
          {cards.map(([label, value, Icon, tone, go]) => (
            <button key={label} type="button" onClick={go} disabled={!go} className={clsx('rounded-xl border border-ink-100 bg-white p-3 text-left shadow-card dark:border-ink-800 dark:bg-ink-900', go ? 'transition-shadow hover:shadow-card-hover' : 'cursor-default')}>
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div>
              <p className={clsx('mt-1.5 text-xl font-bold', label === 'Overdue' && value ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-ink-50')}>{value}</p>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Project groups">
          {QUICK.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={quick === k} onClick={() => setQuick(k)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium', quick === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300')}>{l}</button>)}
        </div>
        <div className="ml-auto flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="View">
          {VIEWS.map(([k, l, Icon]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', view === k ? 'bg-brand-600 text-white' : 'text-ink-500')}><Icon size={14} />{l}</button>)}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, ID, customer, company…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
        {activeFilters > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
      </div>
      {filtersOpen && data && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          {[['Project manager', 'manager', USERS.filter((u) => rows.some((r) => r.p.manager === u.id)).map((u) => [u.id, u.name])], ['Team member', 'team', USERS.filter((u) => rows.some((r) => (r.p.team || []).includes(u.id))).map((u) => [u.id, u.name])],
            ['Customer', 'customer', data.customers.filter((c) => rows.some((r) => r.p.customerId === c.id)).map((c) => [c.id, c.name])], ['Company', 'company', data.companies.filter((c) => rows.some((r) => r.p.companyId === c.id)).map((c) => [c.id, c.name])],
            ['Status', 'status', PROJECT_STATUS_LIST.map((s) => [s, s])], ['Priority', 'priority', PROJECT_PRIORITIES.map((s) => [s, s])], ['Project type', 'type', PROJECT_TYPES.map((s) => [s, s])]].map(([label, key, opts]) => (
            <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          ))}
          {[['Start from', 'startFrom'], ['Start to', 'startTo'], ['End from', 'endFrom'], ['End to', 'endTo']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="date" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
        </div>
      )}

      {!data ? <CardSkeleton className="h-72" /> : filtered.length === 0 ? (
        <EmptyState icon={Layers} title={rows.length ? 'No projects match' : 'No projects yet'} description={rows.length ? 'Change the group, search or filters.' : 'Projects start from a confirmed sales order or a won deal.'} action={!rows.length && canCreate && <Button icon={Plus} onClick={() => setFormOpen(true)}>New project</Button>} />
      ) : view === 'list' ? (
        <>
          <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div role="row" className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_6rem_6rem_8rem_6.5rem_6rem] gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 lg:grid dark:border-ink-800 dark:bg-ink-800/40"><span>Project</span><span>Customer</span><span>Manager</span><span>Status</span><span>Priority</span><span>Progress</span><span>End date</span><span className="text-right">Value</span></div>
            {pageRows.map(({ p, progress, billing }) => (
              <div key={p.id} role="row" tabIndex={0} onClick={() => open(p)} onKeyDown={(e) => e.key === 'Enter' && open(p)} className="grid cursor-pointer grid-cols-1 items-center gap-2 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_6rem_6rem_8rem_6.5rem_6rem] lg:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30">
                <div className="min-w-0"><p className="truncate font-medium text-ink-900 dark:text-ink-50">{p.name}</p><p className="truncate text-xs text-ink-400">{p.id} · {p.projectType}</p></div>
                <span className="truncate text-ink-600 dark:text-ink-300">{p.customerName}</span>
                <span className="flex items-center gap-1.5 truncate text-ink-600 dark:text-ink-300"><Avatar name={getUserById(p.manager)?.name} size="xs" />{getUserById(p.manager)?.name}</span>
                <span><StatusBadge status={p.status} /></span><span><PriorityMark priority={p.priority} /></span>
                <ProgressBar value={progress} /><EndDate project={p} />
                <span className="text-right text-xs font-medium text-ink-800 dark:text-ink-100">{billing ? formatCurrency(billing.value, { compact: true }) : '—'}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      ) : view === 'kanban' ? (
        <div className="scrollbar-thin grid auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-3">
          {PROJECT_STATUS_LIST.map((s) => {
            const col = filtered.filter((r) => r.p.status === s)
            return (
              <section key={s} aria-label={s} onDragOver={(e) => { e.preventDefault(); setOverKanban(s) }} onDragLeave={() => setOverKanban(null)} onDrop={(e) => dropOn(s, e)} className={clsx('flex min-h-[16rem] flex-col rounded-2xl border bg-ink-50/60 p-3 dark:bg-ink-900/40', overKanban === s ? 'border-brand-400' : 'border-ink-100 dark:border-ink-800')}>
                <header className="mb-3 flex items-center gap-2 px-1"><h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{s}</h3><span className="rounded-full bg-white px-1.5 text-xs font-medium text-ink-500 dark:bg-ink-800">{col.length}</span></header>
                <div className="flex flex-1 flex-col gap-2.5">
                  {col.map(({ p, progress, billing }) => (
                    <article key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/project', p.id)} onClick={() => open(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(p)} className="cursor-pointer rounded-xl border border-ink-100 bg-white p-3 shadow-card hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
                      <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-medium text-ink-900 dark:text-ink-50">{p.name}</p><PriorityMark priority={p.priority} label={false} /></div>
                      <p className="mt-0.5 truncate text-xs text-ink-400">{p.id} · {p.customerName}</p>
                      <ProgressBar value={progress} className="mt-2" />
                      <div className="mt-2 flex items-center justify-between"><EndDate project={p} /><span className="flex items-center gap-1.5 text-xs text-ink-500"><Avatar name={getUserById(p.manager)?.name} size="xs" />{billing ? formatCurrency(billing.value, { compact: true }) : ''}</span></div>
                    </article>
                  ))}
                  {!col.length && <p className="px-2 py-6 text-center text-xs text-ink-400">Drop a project here</p>}
                </div>
              </section>
            )
          })}
        </div>
      ) : view === 'timeline' ? <Timeline rows={filtered} today={today} onOpen={open} /> : <ProjectCalendar rows={filtered} onOpen={open} />}

      <ProjectFormDialog open={formOpen} onClose={() => setFormOpen(false)} data={data || { projects: [], salesOrders: [], deals: [], customers: [], products: [], contacts: [], quotations: [], proposals: [] }} preset={preset} onSaved={(p) => navigate(`/projects/${p.id}`)} />
      <ProjectStatusDialog project={statusChange?.project} to={statusChange?.to} openTasks={statusChange?.openTasks} onClose={() => setStatusChange(null)} onDone={reload} />
    </div>
  )
}
