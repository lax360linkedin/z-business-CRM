import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Settings2, ListChecks, UserCheck, CalendarDays, CalendarClock, AlertTriangle, Flag, Loader, CheckCircle2, UserX, Bookmark, X, Lightbulb, Bell } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { useAuth } from '../../context/AuthContext'
import { useNotifications, markManyRead, markNotificationRead } from '../../hooks/useNotifications'
import { useBranch } from '../../context/BranchContext'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { Modal } from '../../components/common/Modal'
import { Input, Select, FormField } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { TaskFormDialog } from './TaskFormDialog'
import { useTaskActions } from './TaskActions'
import { ListView, KanbanView, CalendarView, TeamView } from './TaskViews'
import { useTasks, useTaskMeta, useTaskLookup, useOnTasksChanged, errMsg, emitTasksChanged } from './taskClient'
import { TASK_STATUS_LIST, TASK_PRIORITIES, TASK_TYPES, isOpenTask, todayStr } from '../../utils/taskRules'
import { TASK_RELATED_BY_KEY } from '../../utils/taskLinks'
import { departmentNames } from '../../utils/orgLookup'
import { USERS } from '../../data/users'

const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const EMPTY = { assignee: 'all', createdBy: 'all', team: 'all', department: 'all', status: 'all', priority: 'all', taskType: 'all', dueFrom: '', dueTo: '', overdue: false, branch: 'all', relatedType: 'all', relatedText: '', createdFrom: '', createdTo: '', completedFrom: '', completedTo: '' }
const VIEWS = [
  { id: 'my', label: 'My Tasks' }, { id: 'list', label: 'List' }, { id: 'kanban', label: 'Kanban' }, { id: 'calendar', label: 'Calendar' }, { id: 'team', label: 'Team' },
  { id: 'overdue', label: 'Overdue' }, { id: 'today', label: "Today" }, { id: 'upcoming', label: 'Upcoming' }, { id: 'completed', label: 'Completed' }, { id: 'unassigned', label: 'Unassigned' },
]
const METRICS = [
  { key: 'total', label: 'Total tasks', icon: ListChecks, tone: 'brand', view: 'list' }, { key: 'mine', label: 'My tasks', icon: UserCheck, tone: 'sky', view: 'my' },
  { key: 'dueToday', label: 'Due today', icon: CalendarDays, tone: 'amber', view: 'today' }, { key: 'upcoming', label: 'Upcoming', icon: CalendarClock, tone: 'violet', view: 'upcoming' },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'rose', view: 'overdue' }, { key: 'highPriority', label: 'High priority', icon: Flag, tone: 'amber', view: 'list', filter: { priority: 'High' } },
  { key: 'inProgress', label: 'In progress', icon: Loader, tone: 'brand', view: 'list', filter: { status: 'In Progress' } }, { key: 'completed', label: 'Completed', icon: CheckCircle2, tone: 'emerald', view: 'completed' },
  { key: 'unassigned', label: 'Unassigned', icon: UserX, tone: 'ink', view: 'unassigned' },
]
const TONE = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400', ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
}
const inRange = (iso, from, to) => { if (!from && !to) return true; if (!iso) return false; const d = iso.slice(0, 10); return (!from || d >= from) && (!to || d <= to) }

export default function Tasks() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view') : 'my'
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); n.delete('create'); return n }, { replace: true })
  const { tasks, loading, error, reload } = useTasks()
  const { unreadTasks, taskItems } = useNotifications()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const { isGlobal, activeNames } = useBranch()
  const { perms, me } = useTaskMeta()
  const { data: lookup, find } = useTaskLookup(true)
  const actions = useTaskActions({ onChanged: reload })
  const [summary, setSummary] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [saved, setSaved] = useState([])
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1')
  const [preset, setPreset] = useState(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const isAdmin = ['Super Admin', 'Admin'].includes(me?.role)

  const loadSide = useCallback(() => {
    api.get('/tasks/summary').then((r) => setSummary(r.data)).catch(() => {})
    api.get('/tasks/suggestions').then((r) => setSuggestions(r.data)).catch(() => {})
    api.get('/tasks/filters').then((r) => setSaved(r.data)).catch(() => {})
  }, [])
  useEffect(() => { loadSide() }, [loadSide, tasks])
  useOnTasksChanged(loadSide)
  useEffect(() => { setPage(1) }, [search, f, view])
  useEffect(() => { if (params.get('create') === '1') { setCreateOpen(true); setParams((p) => { const n = new URLSearchParams(p); n.delete('create'); return n }, { replace: true }) } }, [params, setParams])

  const hay = useMemo(() => {
    const m = new Map()
    tasks.forEach((t) => {
      const names = ['leadId', 'contactId', 'companyId', 'dealId', 'customerId', 'enquiryId'].map((k) => { const d = TASK_RELATED_BY_KEY[k]; const r = t.links?.[k] && find(d.collection, t.links[k]); return r ? d.label(r) : '' })
      m.set(t.id, `${t.id} ${t.title} ${t.description || ''} ${t.relatedName || ''} ${names.join(' ')}`.toLowerCase())
    })
    return m
  }, [tasks, find])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rt = f.relatedText.trim().toLowerCase()
    return tasks.filter((t) => {
      if (q && !hay.get(t.id)?.includes(q)) return false
      if (f.assignee !== 'all' && !(f.assignee === 'none' ? !(t.assignees || []).length : (t.assignees || []).includes(f.assignee))) return false
      if (f.createdBy !== 'all' && t.createdBy !== f.createdBy) return false
      if (f.team !== 'all' && t.assignedTeam?.value !== f.team) return false
      if (f.department !== 'all' && t.department !== f.department) return false
      if (f.status !== 'all' && t.status !== f.status) return false
      if (f.priority !== 'all' && t.priority !== f.priority) return false
      if (f.taskType !== 'all' && t.taskType !== f.taskType) return false
      if (f.overdue && !t.overdue) return false
      if (f.branch !== 'all' && t.branch !== f.branch) return false
      if (f.relatedType !== 'all' && t.relatedType !== f.relatedType) return false
      if (rt && !`${t.relatedName || ''} ${t.relatedId || ''}`.toLowerCase().includes(rt)) return false
      if (!inRange(t.dueDate, f.dueFrom, f.dueTo)) return false
      if (!inRange(t.createdAt, f.createdFrom, f.createdTo)) return false
      if (!inRange(t.completedAt, f.completedFrom, f.completedTo)) return false
      return true
    })
  }, [tasks, hay, search, f])

  const today = todayStr()
  const sortTasks = (list) => [...list].sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '').localeCompare(b.dueTime || ''))
  const byView = useMemo(() => ({
    my: filtered.filter((t) => isOpenTask(t) && (t.assignees || []).includes(me?.id)),
    list: filtered, kanban: filtered, calendar: filtered, team: filtered,
    overdue: filtered.filter((t) => t.overdue),
    today: filtered.filter((t) => isOpenTask(t) && t.dueDate === today),
    upcoming: filtered.filter((t) => isOpenTask(t) && t.dueDate && t.dueDate > today),
    completed: filtered.filter((t) => t.status === 'Completed'),
    unassigned: filtered.filter((t) => isOpenTask(t) && !(t.assignees || []).length),
  }), [filtered, me?.id, today])
  const shown = view === 'completed' ? [...byView.completed].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')) : sortTasks(byView[view] || [])
  const activeFilters = Object.entries(f).filter(([k, v]) => v && v !== 'all' && v !== EMPTY[k]).length + (search ? 1 : 0)
  const tabs = VIEWS.map((v) => ({ value: v.id, label: v.label, count: ['kanban', 'calendar', 'team'].includes(v.id) ? undefined : byView[v.id].length }))

  const options = useMemo(() => ({
    users: USERS.filter((u) => u.status !== 'Inactive'),
    teams: [...new Set(tasks.map((t) => t.assignedTeam?.value).filter(Boolean))],
    types: [...new Set(tasks.map((t) => t.relatedType).filter(Boolean))],
  }), [tasks])

  // Export: the tasks in the open view (tab) that match the search and filters, in the order shown
  const nameOfUser = (id) => USERS.find((u) => u.id === id)?.name || id
  const exportColumns = [
    { label: 'Task ID', value: 'id' }, { label: 'Title', value: 'title' }, { label: 'Type', value: 'taskType' }, { label: 'Priority', value: 'priority' }, { label: 'Status', value: 'status' },
    { label: 'Due date', value: 'dueDate' }, { label: 'Due time', value: 'dueTime' }, { label: 'Overdue', value: (t) => (t.overdue ? 'Yes' : 'No') }, { label: 'Assigned to', value: (t) => (t.assignees || []).map(nameOfUser).join(', ') },
    { label: 'Department', value: 'department' }, { label: 'Related type', value: 'relatedType' }, { label: 'Related to', value: 'relatedName' }, { label: 'Created', value: (t) => String(t.createdAt || '').slice(0, 10) },
    { label: 'Completed', value: (t) => String(t.completedAt || '').slice(0, 10) }, { label: 'Branch', value: 'branch' },
  ]
  const exportFilters = describeFilters([
    ['View', VIEWS.find((v) => v.id === view)?.label], ['Search', search.trim() && `"${search.trim()}"`], ['Assignee', f.assignee !== 'all' && (f.assignee === 'none' ? 'Unassigned' : nameOfUser(f.assignee))],
    ['Created by', f.createdBy !== 'all' && nameOfUser(f.createdBy)], ['Team', f.team], ['Department', f.department], ['Status', f.status], ['Priority', f.priority], ['Type', f.taskType], ['Overdue only', f.overdue && 'Yes'],
    ['Branch', f.branch], ['Related type', f.relatedType], ['Related to', f.relatedText], ['Due from', f.dueFrom], ['Due to', f.dueTo], ['Created from', f.createdFrom], ['Created to', f.createdTo], ['Completed from', f.completedFrom], ['Completed to', f.completedTo],
  ])

  const saveFilter = () => {
    api.post('/tasks/filters', { name: saveName, view, filters: { ...f, search } }).then(() => { toast(`Saved filter “${saveName.trim()}”.`, { type: 'success' }); setSaveOpen(false); setSaveName(''); setSaveErr(''); loadSide() }).catch((e) => setSaveErr(errMsg(e)))
  }
  const applySaved = (s) => { setF({ ...EMPTY, ...s.filters, search: undefined }); setSearch(s.filters?.search || ''); setView(s.view || 'list'); setShowFilters(true) }
  const dropSaved = (s) => api.delete(`/tasks/filters/${s.id}`).then(loadSide).catch((e) => toast(errMsg(e), { type: 'error' }))
  const clearAll = () => { setF(EMPTY); setSearch('') }
  const openMetric = (m) => { setF({ ...EMPTY, ...(m.filter || {}) }); setSearch(''); setView(m.view) }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={me ? `${summary?.metrics.mine ?? '…'} open task${summary?.metrics.mine === 1 ? '' : 's'} assigned to you · ${summary?.metrics.overdue ?? '…'} overdue in your scope.` : 'Your central work and follow-up list.'}
        actions={<>
          {isAdmin && <Link to="/tasks/settings"><Button variant="secondary" icon={Settings2}>Task settings</Button></Link>}
          <ExportMenu title="Tasks" noun="task" columns={exportColumns} rows={() => shown} filters={exportFilters} />
          {perms.create && <Button icon={Plus} onClick={() => { setPreset(null); setCreateOpen(true) }}>New task</Button>}
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9" aria-label="Task metrics">
        {METRICS.map((m) => (
          <button key={m.key} type="button" onClick={() => openMetric(m)} className={clsx('rounded-xl border bg-white p-3 text-left shadow-card transition-shadow hover:shadow-card-hover dark:bg-ink-900', view === m.view && !m.filter ? 'border-brand-300 dark:border-brand-700' : 'border-ink-100 dark:border-ink-800')}>
            <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500 dark:text-ink-400">{m.label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[m.tone])}><m.icon size={13} /></span></div>
            <p className={clsx('mt-1.5 text-xl font-bold tracking-tight', m.key === 'overdue' && summary?.metrics.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-ink-50')}>{summary ? summary.metrics[m.key] : '–'}</p>
          </button>
        ))}
      </div>

      {unreadTasks > 0 && (
        <div role="status" className="mb-4 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sm dark:border-sky-800/40 dark:bg-sky-900/10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Bell size={16} className="shrink-0 text-sky-600 dark:text-sky-300" />
            <p className="flex-1 text-sky-900 dark:text-sky-200"><span className="font-semibold">{unreadTasks} unread task notification{unreadTasks > 1 ? 's' : ''}</span> - new assignments, changes, reminders or overdue alerts.</p>
            <div className="flex flex-wrap gap-2">
              {hasPermission('Notifications', 'view') && <Link to="/notifications?type=tasks&read=unread"><Button size="sm" variant="secondary">View all</Button></Link>}
              <Button size="sm" variant="ghost" onClick={() => markManyRead(taskItems)}>Mark all read</Button>
            </div>
          </div>
          <ul className="mt-2 divide-y divide-sky-100 dark:divide-sky-800/30">
            {taskItems.filter((n) => !n.read).slice(0, 3).map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => { markNotificationRead(n.id); if (n.relatedId) navigate(`/tasks/${n.relatedId}`) }} className="flex w-full items-start gap-2 py-1.5 text-left text-xs text-sky-900 hover:underline dark:text-sky-100">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" /><span className="min-w-0 flex-1"><span className="font-semibold">{n.type}</span> - {n.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && perms.create && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/10 sm:flex-row sm:items-center">
          <Lightbulb size={16} className="shrink-0 text-amber-600" />
          <p className="flex-1 text-amber-900 dark:text-amber-200"><span className="font-semibold">{suggestions.length} contacted lead{suggestions.length > 1 ? 's' : ''}</span> {suggestions.length > 1 ? 'have' : 'has'} no follow-up scheduled.</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 3).map((s) => <Button key={s.relatedId} size="sm" variant="secondary" onClick={() => { setPreset({ title: `Follow up: ${s.relatedName}`, taskType: 'Follow-up', related: { type: s.relatedType, id: s.relatedId } }); setCreateOpen(true) }}>{s.relatedName}</Button>)}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72"><SearchBar value={search} onChange={setSearch} placeholder="Search ID, title, lead, contact, company, deal…" /></div>
        <FilterToggleButton active={showFilters} onClick={() => setShowFilters((s) => !s)} count={activeFilters} />
        {activeFilters > 0 && <><Button variant="ghost" size="md" icon={X} onClick={clearAll}>Clear</Button><Button variant="subtle" size="md" icon={Bookmark} onClick={() => setSaveOpen(true)}>Save filter</Button></>}
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Saved filters">
            {saved.map((s) => (
              <span key={s.id} className="inline-flex items-center overflow-hidden rounded-full bg-ink-100 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">
                <button type="button" onClick={() => applySaved(s)} className="px-2.5 py-1.5 hover:bg-ink-200 dark:hover:bg-ink-700">{s.name}</button>
                <button type="button" aria-label={`Delete saved filter ${s.name}`} onClick={() => dropSaved(s)} className="px-1.5 py-1.5 text-ink-400 hover:bg-rose-100 hover:text-rose-600"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          <label className="text-xs font-medium text-ink-500">Assigned user<select aria-label="Assigned user" className={clsx(sel, 'mt-1')} value={f.assignee} onChange={(e) => set({ assignee: e.target.value })}><option value="all">Anyone</option><option value="none">Unassigned</option>{options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Created by<select aria-label="Created by" className={clsx(sel, 'mt-1')} value={f.createdBy} onChange={(e) => set({ createdBy: e.target.value })}><option value="all">Anyone</option><option value="SYSTEM">Automation</option>{options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          {isGlobal && <label className="text-xs font-medium text-ink-500">Branch<select aria-label="Branch" className={clsx(sel, 'mt-1')} value={f.branch} onChange={(e) => set({ branch: e.target.value })}><option value="all">All branches</option>{activeNames.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>}
          <label className="text-xs font-medium text-ink-500">Department<select aria-label="Department" className={clsx(sel, 'mt-1')} value={f.department} onChange={(e) => set({ department: e.target.value })}><option value="all">All</option>{departmentNames().map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Team / role assigned<select aria-label="Team" className={clsx(sel, 'mt-1')} value={f.team} onChange={(e) => set({ team: e.target.value })}><option value="all">All</option>{options.teams.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Status<select aria-label="Status" className={clsx(sel, 'mt-1')} value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="all">All</option>{TASK_STATUS_LIST.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Priority<select aria-label="Priority" className={clsx(sel, 'mt-1')} value={f.priority} onChange={(e) => set({ priority: e.target.value })}><option value="all">All</option>{TASK_PRIORITIES.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Task type<select aria-label="Task type" className={clsx(sel, 'mt-1')} value={f.taskType} onChange={(e) => set({ taskType: e.target.value })}><option value="all">All</option>{TASK_TYPES.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Related module<select aria-label="Related module" className={clsx(sel, 'mt-1')} value={f.relatedType} onChange={(e) => set({ relatedType: e.target.value })}><option value="all">All</option>{options.types.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500 sm:col-span-2">Related record<input aria-label="Related record" className={clsx(sel, 'mt-1')} value={f.relatedText} onChange={(e) => set({ relatedText: e.target.value })} placeholder="Name or ID of the lead, deal, invoice…" /></label>
          <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-500"><label>Due from<input aria-label="Due from" type="date" className={clsx(sel, 'mt-1')} value={f.dueFrom} onChange={(e) => set({ dueFrom: e.target.value })} /></label><label>Due to<input aria-label="Due to" type="date" className={clsx(sel, 'mt-1')} value={f.dueTo} onChange={(e) => set({ dueTo: e.target.value })} /></label></div>
          <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-500"><label>Created from<input aria-label="Created from" type="date" className={clsx(sel, 'mt-1')} value={f.createdFrom} onChange={(e) => set({ createdFrom: e.target.value })} /></label><label>Created to<input aria-label="Created to" type="date" className={clsx(sel, 'mt-1')} value={f.createdTo} onChange={(e) => set({ createdTo: e.target.value })} /></label></div>
          <div className="grid grid-cols-2 gap-2 text-xs font-medium text-ink-500"><label>Completed from<input aria-label="Completed from" type="date" className={clsx(sel, 'mt-1')} value={f.completedFrom} onChange={(e) => set({ completedFrom: e.target.value })} /></label><label>Completed to<input aria-label="Completed to" type="date" className={clsx(sel, 'mt-1')} value={f.completedTo} onChange={(e) => set({ completedTo: e.target.value })} /></label></div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" checked={f.overdue} onChange={(e) => set({ overdue: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-brand-600" /> Overdue only</label>
        </div>
      )}

      <div className="mb-4 border-b border-ink-100 dark:border-ink-800">
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Task views">
          {tabs.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={view === t.value} onClick={() => setView(t.value)} className={clsx('relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors', view === t.value ? 'text-brand-600 dark:text-brand-400' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200')}>
              {t.label}
              {t.count !== undefined && <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px]', view === t.value ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400', t.value === 'overdue' && t.count > 0 && 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300')}>{t.count}</span>}
              {view === t.value && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load tasks" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
      ) : view === 'kanban' ? (
        loading ? <div className="h-64 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" /> : <KanbanView tasks={filtered} run={actions.run} toast={toast} />
      ) : view === 'calendar' ? (
        <CalendarView tasks={filtered} />
      ) : view === 'team' ? (
        <TeamView summary={summary} loading={!summary} onPick={(id) => { set({ assignee: id }); setView('list') }} />
      ) : (
        <>
          {!loading && shown.length === 0 && activeFilters === 0 && tasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No tasks yet" description="Create your first task, or log a follow-up on a lead or deal — it lands here automatically." action={perms.create && <Button icon={Plus} onClick={() => setCreateOpen(true)}>New task</Button>} />
          ) : (
            <ListView tasks={shown} loading={loading} run={actions.run} canLog={actions.canLog} page={page} setPage={setPage} />
          )}
        </>
      )}

      <TaskFormDialog open={createOpen} onClose={() => { setCreateOpen(false); setPreset(null) }} onSaved={reload} related={preset?.related} preset={preset ? { title: preset.title, taskType: preset.taskType } : undefined} />
      {actions.dialogs}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} size="sm" title="Save this filter" description="Saved filters are private to you and restore the view, search and every filter." footer={<><Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button><Button onClick={saveFilter}>Save filter</Button></>}>
        <FormField label="Name" error={saveErr}><Input autoFocus value={saveName} onChange={(e) => { setSaveName(e.target.value); setSaveErr('') }} onKeyDown={(e) => e.key === 'Enter' && saveFilter()} placeholder="e.g. Overdue calls this week" maxLength={40} /></FormField>
      </Modal>
    </div>
  )
}
