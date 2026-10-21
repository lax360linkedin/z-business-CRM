import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Upload, Printer, Users2, UserCheck, CalendarOff, Building2, UsersRound, Crown, LayoutList, LayoutGrid, Network, X, Save, Bookmark, Columns3, Phone, Mail, ClipboardList, Eye, Pencil, Repeat, MoreHorizontal, AlertTriangle, KeyRound, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '../../components/common/Dropdown'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, WORK_MODES, WORKLOAD_LEVELS, isWorking } from '../../utils/employeeRules'
import { formatDate, timeAgo } from '../../utils/format'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { useOrg } from './employeeClient'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { StatusDialog, AccessDialog, BulkDialog } from './EmployeeDialogs'
import { ImportDialog } from '../../components/import/ImportDialog'
import { TemplateButton } from '../../components/import/TemplateButton'
import { DeletePersonDialog } from './DeletePersonDialog'
import { employeeColumns, printRows } from './employeeExport'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { OrgChart } from './OrgChart'
import { DepartmentsTab, TeamsTab } from './OrgStructure'

const EMPTY = { dept: '', team: '', sub: '', leader: '', manager: '', designation: '', role: '', type: '', status: '', location: '', mode: '', joinFrom: '', joinTo: '', expMin: '', expMax: '', active: '', access: '', load: '' }
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const STATUS_DOT = { Active: 'bg-emerald-500', Probation: 'bg-amber-500', 'On Leave': 'bg-sky-500', Remote: 'bg-violet-500', Suspended: 'bg-rose-500', Resigned: 'bg-ink-400', Terminated: 'bg-rose-600', Inactive: 'bg-ink-400' }
const LOAD_TONE = { None: 'bg-ink-300', Light: 'bg-emerald-500', Moderate: 'bg-amber-500', Heavy: 'bg-orange-500', Overloaded: 'bg-rose-500' }
const QUICK = [['all', 'All'], ['working', 'Working'], ['leave', 'On leave'], ['probation', 'Probation'], ['leaders', 'Team leaders'], ['noaccess', 'No CRM access'], ['left', 'Left / inactive']]
const COLUMNS = [
  { key: 'employee', label: 'Employee', fixed: true }, { key: 'id', label: 'Employee ID' }, { key: 'designation', label: 'Designation' }, { key: 'department', label: 'Department' }, { key: 'team', label: 'Team' },
  { key: 'branch', label: 'Branch' }, { key: 'leader', label: 'Team leader' }, { key: 'manager', label: 'Manager' }, { key: 'status', label: 'Status' }, { key: 'role', label: 'CRM role' }, { key: 'mode', label: 'Work mode' }, { key: 'joined', label: 'Joining date' },
  { key: 'login', label: 'Last login' }, { key: 'workload', label: 'Workload', off: true }, { key: 'email', label: 'Official email', off: true }, { key: 'phone', label: 'Phone', off: true }, { key: 'location', label: 'Location', off: true }, { key: 'type', label: 'Employment type', off: true }, { key: 'exp', label: 'Experience', off: true },
]
// px width of each directory column: the table is laid out at these (table-layout: fixed), so no value can stretch a column
const COL_W = { employee: 260, id: 120, designation: 190, department: 170, team: 190, branch: 140, leader: 170, manager: 170, status: 130, role: 160, mode: 130, joined: 140, login: 130, workload: 150, email: 250, phone: 150, location: 150, type: 150, exp: 110 }
const SORT = { employee: (e) => e.fullName, id: (e) => e.id, designation: (e) => e.designation, department: (e) => e.departmentName || '', team: (e) => e.teamName || '', leader: (e) => e.teamLeaderName || '', manager: (e) => e.managerName || '', status: (e) => e.status, role: (e) => e.crmRole || '', mode: (e) => e.workMode, joined: (e) => e.joinDate, login: (e) => e.lastLogin || '', workload: (e) => e.workload.score, exp: (e) => e.experience, email: (e) => e.officialEmail, phone: (e) => e.mobile || '', location: (e) => e.workLocation, type: (e) => e.employmentType }
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

function WorkloadBar({ w }) { return <span className="inline-flex items-center gap-1.5 text-xs" title={`${w.pendingTasks} pending · ${w.overdueTasks} overdue · ${w.activeProjects} projects · ${w.openTickets} tickets · ${w.activeDeals} deals`}><i className={clsx('h-2 w-2 rounded-full', LOAD_TONE[w.level])} />{w.level}<span className="text-ink-400">({w.pendingTasks}t)</span></span> }

export default function Employees() {
  const navigate = useNavigate(); const location = useLocation()
  const { toast } = useToast()
  const { user } = useAuth()
  const org = useOrg()
  const { employees, departments, teams, cfg, perms, error, reload } = org
  const [params, setParams] = useSearchParams()
  const forced = location.pathname.startsWith('/teams') ? 'teams' : null
  const view = forced || (['directory', 'chart', 'departments', 'teams'].includes(params.get('view')) ? params.get('view') : 'directory')
  const setView = (v) => { if (forced) navigate(`/employees?view=${v}`); else setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); return n }, { replace: true }) }
  const [layout, setLayout] = useState(() => lsGet('emp_layout', 'list'))
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [quick, setQuick] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState({ key: 'employee', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [cols, setCols] = useState(() => lsGet('emp_cols', COLUMNS.filter((c) => !c.off).map((c) => c.key)))
  const [selected, setSelected] = useState(new Set())
  const [views, setViews] = useState(() => lsGet(`emp_views_${user?.id}`, []))
  const [dlg, setDlg] = useState(null)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { setPage(1) }, [search, f, quick, sort])
  useEffect(() => { lsSet('emp_layout', layout) }, [layout])
  useEffect(() => { lsSet('emp_cols', cols) }, [cols])
  useEffect(() => { const t = params.get('q'); if (t) setSearch(t) }, [params])

  const list = employees || []
  const opts = useMemo(() => ({
    designations: [...new Set(list.map((e) => e.designation).filter(Boolean))].sort(), roles: [...new Set(list.map((e) => e.crmRole).filter(Boolean))].sort(), locations: [...new Set(list.map((e) => e.workLocation).filter(Boolean))].sort(),
    leaders: list.filter((e) => e.isTeamLeader), managers: list.filter((e) => list.some((x) => x.reportsTo === e.id)),
  }), [list])
  const teamsOf = (teams || []).filter((t) => !t.parentTeamId && (!f.dept || t.departmentId === f.dept))
  const subsOf = (teams || []).filter((t) => t.parentTeamId && (!f.team || t.parentTeamId === f.team))
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = list.filter((e) => {
      if (q && !`${e.fullName} ${e.id} ${e.officialEmail} ${e.mobile || ''} ${e.departmentName || ''} ${e.teamName || ''} ${e.designation} ${e.teamLeaderName || ''} ${e.managerName || ''}`.toLowerCase().includes(q)) return false
      if (quick === 'working' && !['Active', 'Probation', 'Remote'].includes(e.status)) return false
      if (quick === 'leave' && e.status !== 'On Leave') return false
      if (quick === 'probation' && e.status !== 'Probation') return false
      if (quick === 'leaders' && !e.isTeamLeader) return false
      if (quick === 'noaccess' && e.crmAccess) return false
      if (quick === 'left' && isWorking(e.status)) return false
      if (f.dept && e.departmentId !== f.dept) return false
      if (f.team && e.teamId !== f.team) return false
      if (f.sub && e.subTeamId !== f.sub) return false
      if (f.leader && e.teamLeaderId !== f.leader) return false
      if (f.manager && e.reportsTo !== f.manager) return false
      if (f.designation && e.designation !== f.designation) return false
      if (f.role && e.crmRole !== f.role) return false
      if (f.type && e.employmentType !== f.type) return false
      if (f.status && e.status !== f.status) return false
      if (f.location && e.workLocation !== f.location) return false
      if (f.mode && e.workMode !== f.mode) return false
      if (f.joinFrom && e.joinDate < f.joinFrom) return false
      if (f.joinTo && e.joinDate > f.joinTo) return false
      if (f.expMin !== '' && e.experience < Number(f.expMin)) return false
      if (f.expMax !== '' && e.experience > Number(f.expMax)) return false
      if (f.active === 'active' && !isWorking(e.status)) return false
      if (f.active === 'inactive' && isWorking(e.status)) return false
      if (f.access === 'yes' && !e.crmAccess) return false
      if (f.access === 'no' && e.crmAccess) return false
      if (f.load && e.workload.level !== f.load) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1; const g = SORT[sort.key] || SORT.employee
    return out.sort((a, b) => { const x = g(a); const y = g(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir })
  }, [list, search, f, quick, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const active = Object.values(f).filter(Boolean).length + (quick !== 'all' ? 1 : 0)
  const stats = useMemo(() => ({ total: list.length, active: list.filter((e) => ['Active', 'Probation', 'Remote'].includes(e.status)).length, leave: list.filter((e) => e.status === 'On Leave').length, depts: (departments || []).filter((d) => d.status === 'Active').length, teams: (teams || []).filter((t) => t.status === 'Active' && !t.parentTeamId).length, leaders: list.filter((e) => e.isTeamLeader && isWorking(e.status)).length }), [list, departments, teams])
  const clearAll = () => { setF(EMPTY); setQuick('all'); setSearch('') }
  const saveView = () => { const name = window.prompt('Name this view'); if (!name?.trim()) return; const next = [...views.filter((v) => v.name !== name.trim()), { name: name.trim(), f, quick, search, sort }]; setViews(next); lsSet(`emp_views_${user?.id}`, next); toast(`View “${name.trim()}” saved.`, { type: 'success' }) }
  const applyView = (v) => { setF({ ...EMPTY, ...v.f }); setQuick(v.quick || 'all'); setSearch(v.search || ''); setSort(v.sort || { key: 'employee', dir: 'asc' }) }
  const removeView = (name) => { const next = views.filter((v) => v.name !== name); setViews(next); lsSet(`emp_views_${user?.id}`, next) }
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  // Export: every employee that matches the search, quick view and filters on screen; personal / HR fields only for people who may see them
  const exportFilters = describeFilters([
    ['View', quick !== 'all' && (QUICK.find((q) => q[0] === quick)?.[1] || quick)], ['Search', search.trim() && `"${search.trim()}"`],
    ...Object.entries(f).filter(([, v]) => v !== '' && v !== 'all' && v !== false).map(([k, v]) => [k === 'dept' ? 'Department' : k === 'team' ? 'Team' : k === 'sub' ? 'Sub-team' : k === 'leader' ? 'Team leader' : k === 'manager' ? 'Manager' : k, k === 'dept' ? (departments || []).find((d) => d.id === v)?.name || v : k === 'team' || k === 'sub' ? (teams || []).find((t) => t.id === v)?.name || v : k === 'leader' || k === 'manager' ? (employees || []).find((e) => e.id === v)?.fullName || v : v]),
  ])
  const printList = () => { if (!filtered.length) return toast('Nothing to print for the current filters.', { type: 'warning' }); if (!printRows(filtered, perms.viewSensitive)) toast('Allow pop-ups to print.', { type: 'warning' }) }

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load employees" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  if (!employees && !cfg) return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-72" /></div>
  const Sel = ({ label, k, children }) => <label className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })}><option value="">All</option>{children}</select></label>
  const cards = [['Total employees', stats.total, Users2], ['Active', stats.active, UserCheck], ['On leave', stats.leave, CalendarOff], ['Departments', stats.depts, Building2], ['Teams', stats.teams, UsersRound], ['Team leaders', stats.leaders, Crown]]
  const menu = (e) => (
    <Dropdown width="w-56" trigger={<button type="button" aria-label={`Actions for ${e.fullName}`} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><MoreHorizontal size={16} /></button>}>
      <DropdownItem icon={Eye} onClick={() => navigate(`/employees/${e.id}`)}>View profile</DropdownItem>
      {e.mobile && <DropdownItem icon={Phone} onClick={() => { window.location.href = `tel:${e.mobile.replace(/\s/g, '')}` }}>Call</DropdownItem>}
      <DropdownItem icon={Mail} onClick={() => { window.location.href = `mailto:${e.officialEmail}` }}>Email</DropdownItem>
      {perms.assignTask && e.crmAccess && isWorking(e.status) && <DropdownItem icon={ClipboardList} onClick={() => setDlg({ kind: 'task', e })}>Assign task</DropdownItem>}
      <DropdownLabel>Records</DropdownLabel>
      {['tasks', 'projects', 'tickets', 'deals', 'leads'].map((t) => <DropdownItem key={t} onClick={() => navigate(`/employees/${e.id}?tab=${t}`)}>View {t}</DropdownItem>)}
      <DropdownItem onClick={() => navigate(`/employees/${e.id}?tab=performance`)}>View performance</DropdownItem>
      {(perms.edit || perms.changeStatus) && <DropdownDivider />}
      {perms.edit && <DropdownItem icon={Pencil} onClick={() => setDlg({ kind: 'edit', e })}>Edit employee</DropdownItem>}
      {perms.edit && <DropdownItem icon={Repeat} onClick={() => setDlg({ kind: 'edit', e })}>Change team / department</DropdownItem>}
      {perms.changeStatus && <DropdownItem icon={Repeat} onClick={() => setDlg({ kind: 'status', e })}>Change status</DropdownItem>}
      {perms.grantAccess && !e.crmAccess && isWorking(e.status) && <DropdownItem icon={KeyRound} onClick={() => setDlg({ kind: 'access', e })}>Grant CRM access</DropdownItem>}
      {perms.delete && e.id !== user?.id && <><DropdownDivider /><DropdownItem icon={Trash2} danger onClick={() => setDlg({ kind: 'delete', e })}>Delete employee</DropdownItem></>}
    </Dropdown>
  )
  const cell = (c, e) => {
    switch (c) {
      case 'employee': return <div className="flex min-w-0 items-center gap-2.5"><Avatar name={e.fullName} size="sm" /><div className="min-w-0"><button type="button" onClick={() => navigate(`/employees/${e.id}`)} className="block max-w-full truncate text-left text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{e.fullName}</button>{e.isTeamLeader && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600"><Crown size={10} />Team leader</span>}</div></div>
      case 'id': return <span className="font-mono text-xs">{e.id}</span>
      case 'designation': return <span className="text-xs">{e.designation}</span>
      case 'department': return e.departmentId ? <button type="button" className="inline-flex items-center gap-1.5 text-xs hover:underline" onClick={() => navigate(`/departments/${e.departmentId}`)}><i className="h-2 w-2 rounded-full" style={{ background: e.departmentColor }} />{e.departmentName}</button> : '—'
      case 'team': return e.teamId ? <button type="button" className="text-xs hover:underline" onClick={() => navigate(`/teams/${e.teamId}`)}>{e.teamName}{e.subTeamName ? ` › ${e.subTeamName}` : ''}</button> : <span className="text-xs text-ink-400">—</span>
      case 'leader': return e.teamLeaderId ? <button type="button" className="text-xs hover:underline" onClick={() => navigate(`/employees/${e.teamLeaderId}`)}>{e.teamLeaderName}</button> : <span className="text-xs text-ink-400">—</span>
      case 'branch': return <span className="text-xs">{e.branch || <span className="text-ink-400">—</span>}</span>
      case 'manager': return e.reportsTo ? <button type="button" className="text-xs hover:underline" onClick={() => navigate(`/employees/${e.reportsTo}`)}>{e.managerName}</button> : <span className="text-xs text-ink-400">Top level</span>
      case 'status': return <span className="inline-flex items-center gap-1.5 text-xs"><i className={clsx('h-2 w-2 rounded-full', STATUS_DOT[e.status])} />{e.status}</span>
      case 'role': return e.crmAccess ? <span className="text-xs">{e.crmRole}<span className="block text-[10px] text-ink-400">{e.accountStatus}</span></span> : <span className="text-xs text-ink-400">No CRM access</span>
      case 'mode': return <span className="text-xs">{e.workMode}</span>
      case 'joined': return <span className="text-xs">{formatDate(e.joinDate)}</span>
      case 'login': return <span className="text-xs text-ink-500">{e.lastLogin ? timeAgo(e.lastLogin) : e.crmAccess ? 'Never' : '—'}</span>
      case 'workload': return <WorkloadBar w={e.workload} />
      case 'email': return <span className="text-xs">{e.officialEmail}</span>
      case 'phone': return <span className="text-xs">{e.mobile || '—'}</span>
      case 'location': return <span className="text-xs">{e.workLocation}</span>
      case 'type': return <span className="text-xs">{e.employmentType}</span>
      case 'exp': return <span className="text-xs">{e.experience} yrs</span>
      default: return null
    }
  }
  const shown = COLUMNS.filter((c) => c.fixed || cols.includes(c.key))
  return (
    <div>
      <PageHeader title="Employees" description="Employee directory, organisation structure, departments and teams — linked to User Management for CRM access." actions={<>
        <ExportMenu title="Employees" noun="employee" permission={!!perms.export} columns={employeeColumns(perms.viewSensitive)} rows={() => filtered} filters={exportFilters} extraItems={[{ label: 'Print', icon: Printer, onClick: printList }]} />
        {perms.import && <Button variant="secondary" icon={Upload} onClick={() => setDlg({ kind: 'import' })}>Import</Button>}
        {perms.import && <TemplateButton module="employees" />}
        {perms.create && <Button icon={Plus} onClick={() => setDlg({ kind: 'create' })}>Add employee</Button>}</>} />
      {!employees ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([k, v, Icon]) => <div key={k} className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{k}</span><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30"><Icon size={13} /></span></div><p className="mt-1.5 text-xl font-bold text-ink-900 dark:text-ink-50">{v}</p></div>)}</div>
      )}
      <Tabs className="mb-4" active={view} onChange={setView} tabs={[{ value: 'directory', label: 'Directory', count: list.length }, { value: 'chart', label: 'Organization chart' }, { value: 'departments', label: 'Departments', count: stats.depts }, { value: 'teams', label: 'Teams', count: stats.teams }]} />

      {view === 'chart' && <OrgChart employees={list} departments={departments || []} teams={teams || []} />}
      {view === 'departments' && <DepartmentsTab org={org} />}
      {view === 'teams' && <TeamsTab org={org} />}
      {view === 'directory' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Search name, ID, email, phone, department, team, designation, leader…" className="w-full max-w-md" />
            <select aria-label="Department filter" className={clsx(sel, '!w-44')} value={f.dept} onChange={(e) => set({ dept: e.target.value, team: '', sub: '' })}><option value="">All departments</option>{(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select aria-label="Team filter" className={clsx(sel, '!w-44')} value={f.team} onChange={(e) => set({ team: e.target.value, sub: '' })}><option value="">All teams</option>{teamsOf.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select aria-label="Team leader filter" className={clsx(sel, '!w-40')} value={f.leader} onChange={(e) => set({ leader: e.target.value })}><option value="">All team leaders</option>{opts.leaders.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}</select>
            <select aria-label="Status filter" className={clsx(sel, '!w-36')} value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">All statuses</option>{EMPLOYEE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <FilterToggleButton active={filtersOpen} count={active} onClick={() => setFiltersOpen((o) => !o)} />
          </div>
          {filtersOpen && (
            <div className="mb-3 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
              <Sel label="Sub-team" k="sub">{subsOf.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
              <Sel label="Manager" k="manager">{opts.managers.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</Sel>
              <Sel label="Designation" k="designation">{opts.designations.map((d) => <option key={d}>{d}</option>)}</Sel>
              <Sel label="CRM role" k="role">{opts.roles.map((d) => <option key={d}>{d}</option>)}</Sel>
              <Sel label="Employment type" k="type">{EMPLOYMENT_TYPES.map((d) => <option key={d}>{d}</option>)}</Sel>
              <Sel label="Work location" k="location">{opts.locations.map((d) => <option key={d}>{d}</option>)}</Sel>
              <Sel label="Work mode" k="mode">{WORK_MODES.map((d) => <option key={d}>{d}</option>)}</Sel>
              <label className="text-xs font-medium text-ink-500">Active / inactive<select aria-label="Active filter" className={clsx(sel, 'mt-1')} value={f.active} onChange={(e) => set({ active: e.target.value })}><option value="">All</option><option value="active">Active (working)</option><option value="inactive">Inactive (left / suspended)</option></select></label>
              <label className="text-xs font-medium text-ink-500">CRM access<select aria-label="CRM access filter" className={clsx(sel, 'mt-1')} value={f.access} onChange={(e) => set({ access: e.target.value })}><option value="">All</option><option value="yes">Has CRM access</option><option value="no">No CRM access</option></select></label>
              <Sel label="Current workload" k="load">{WORKLOAD_LEVELS.map((d) => <option key={d}>{d}</option>)}</Sel>
              <label className="text-xs font-medium text-ink-500">Joined from<input aria-label="Joined from" type="date" className={clsx(sel, 'mt-1')} value={f.joinFrom} onChange={(e) => set({ joinFrom: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">Joined to<input aria-label="Joined to" type="date" className={clsx(sel, 'mt-1')} value={f.joinTo} onChange={(e) => set({ joinTo: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">Experience min (yrs)<input aria-label="Experience min" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.expMin} onChange={(e) => set({ expMin: e.target.value })} /></label>
              <label className="text-xs font-medium text-ink-500">Experience max (yrs)<input aria-label="Experience max" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.expMax} onChange={(e) => set({ expMax: e.target.value })} /></label>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {QUICK.map(([k, l]) => <button key={k} type="button" aria-pressed={quick === k} onClick={() => setQuick(k)} className={clsx('rounded-full border px-3 py-1 text-xs font-medium', quick === k ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800')}>{l}</button>)}
            {active > 0 && <Button variant="ghost" size="sm" icon={X} onClick={clearAll}>Clear all</Button>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Dropdown width="w-60" trigger={<Button variant="secondary" size="sm" icon={Bookmark}>Saved views{views.length ? ` (${views.length})` : ''}</Button>}>
                <DropdownItem icon={Save} onClick={saveView}>Save current view</DropdownItem>{views.length > 0 && <DropdownDivider />}
                {views.map((v) => <div key={v.name} className="flex items-center justify-between pr-2"><DropdownItem onClick={() => applyView(v)}>{v.name}</DropdownItem><button type="button" aria-label={`Delete view ${v.name}`} onClick={() => removeView(v.name)} className="text-ink-400 hover:text-rose-500"><Trash2 size={13} /></button></div>)}
              </Dropdown>
              {layout === 'list' && <Dropdown width="w-52" trigger={<Button variant="secondary" size="sm" icon={Columns3}>Columns</Button>}>{COLUMNS.filter((c) => !c.fixed).map((c) => <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3.5 py-1.5 text-sm"><input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600" checked={cols.includes(c.key)} onChange={() => setCols((x) => (x.includes(c.key) ? x.filter((k) => k !== c.key) : [...x, c.key]))} />{c.label}</label>)}</Dropdown>}
              <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="Layout">{[['list', LayoutList, 'List'], ['cards', LayoutGrid, 'Cards']].map(([k, Icon, l]) => <button key={k} type="button" aria-pressed={layout === k} aria-label={`${l} view`} onClick={() => setLayout(k)} className={clsx('rounded-md px-2.5 py-1.5', layout === k ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800')}><Icon size={14} /></button>)}<button type="button" aria-label="Organization chart" onClick={() => setView('chart')} className="rounded-md px-2.5 py-1.5 text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800"><Network size={14} /></button></div>
            </div>
          </div>
          {selected.size > 0 && perms.bulk && <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-800 dark:bg-brand-900/20 dark:text-brand-200"><b>{selected.size} selected</b><Button size="sm" onClick={() => setDlg({ kind: 'bulk' })}>Bulk actions</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button></div>}
          {!employees ? <CardSkeleton className="h-64" /> : filtered.length === 0 ? <EmptyState icon={Users2} title="No employees match" description="Adjust the search or filters, or clear them to see everyone." action={<Button variant="secondary" onClick={clearAll}>Clear all filters</Button>} /> : layout === 'cards' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((e) => (
              <div key={e.id} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-start gap-3"><Avatar name={e.fullName} size="md" /><div className="min-w-0 flex-1"><button type="button" onClick={() => navigate(`/employees/${e.id}`)} className="block max-w-full truncate text-left text-sm font-semibold text-ink-900 hover:underline dark:text-ink-50">{e.fullName}</button><p className="truncate text-xs text-ink-500">{e.designation}</p><p className="font-mono text-[11px] text-ink-400">{e.id}</p></div><span className="inline-flex items-center gap-1.5 text-xs"><i className={clsx('h-2 w-2 rounded-full', STATUS_DOT[e.status])} />{e.status}</span></div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs"><div><dt className="text-ink-400">Department</dt><dd className="truncate font-medium">{e.departmentName || '—'}</dd></div><div><dt className="text-ink-400">Team</dt><dd className="truncate font-medium">{e.teamName || '—'}</dd></div><div><dt className="text-ink-400">Team leader</dt><dd className="truncate font-medium">{e.teamLeaderName || '—'}</dd></div><div><dt className="text-ink-400">Work mode</dt><dd className="font-medium">{e.workMode}</dd></div><div className="col-span-2"><dt className="text-ink-400">Official email</dt><dd className="truncate font-medium">{e.officialEmail}</dd></div><div className="col-span-2 flex items-center justify-between"><WorkloadBar w={e.workload} />{e.isTeamLeader && <Badge tone="warning">Team leader</Badge>}</div></dl>
                <div className="mt-3 flex items-center gap-1 border-t border-ink-50 pt-2 dark:border-ink-800/60"><Button size="sm" variant="ghost" icon={Eye} onClick={() => navigate(`/employees/${e.id}`)}>Profile</Button>{e.mobile && <a aria-label={`Call ${e.fullName}`} href={`tel:${e.mobile.replace(/\s/g, '')}`} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Phone size={14} /></a>}<a aria-label={`Email ${e.fullName}`} href={`mailto:${e.officialEmail}`} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Mail size={14} /></a><span className="ml-auto">{menu(e)}</span></div>
              </div>))}</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
              <table className="w-full table-fixed text-sm" style={{ minWidth: shown.reduce((n, c) => n + (COL_W[c.key] || 160), 0) + (perms.bulk ? 44 : 0) + 56 }}><colgroup>{perms.bulk && <col style={{ width: 44 }} />}{shown.map((c) => <col key={c.key} style={{ width: COL_W[c.key] || 160 }} />)}<col style={{ width: 56 }} /></colgroup><thead><tr className="h-11 border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40">
                {perms.bulk && <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all on this page" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n })} /></th>}
                {shown.map((c) => <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="overflow-hidden whitespace-nowrap px-3 py-2"><button type="button" title={c.label} onClick={() => toggleSort(c.key)} className="flex max-w-full items-center gap-1 uppercase hover:text-ink-800"><span className="min-w-0 truncate">{c.label}</span>{sort.key === c.key && <span className="shrink-0">{sort.dir === 'asc' ? '↑' : '↓'}</span>}</button></th>)}<th className="w-14" /></tr></thead>
                <tbody>{rows.map((e) => (
                  <tr key={e.id} className={clsx('h-14 border-b border-ink-50 last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/30', !isWorking(e.status) && 'opacity-70')}>
                    {perms.bulk && <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Select ${e.fullName}`} className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600" checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} /></td>}
                    {shown.map((c) => <td key={c.key} className="px-3 py-1.5"><div className="crm-cell">{cell(c.key, e)}</div></td>)}<td className="px-2 py-1.5 text-right">{menu(e)}</td></tr>))}{rows.length < PAGE_SIZE && totalPages > 1 && <tr aria-hidden="true" style={{ height: (PAGE_SIZE - rows.length) * 56 }}><td colSpan={shown.length + (perms.bulk ? 2 : 1)} /></tr>}</tbody></table>
            </div>
          )}
          {filtered.length > 0 && <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>}
        </>
      )}

      <EmployeeFormDialog open={dlg?.kind === 'create' || dlg?.kind === 'edit'} onClose={() => setDlg(null)} employee={dlg?.kind === 'edit' ? dlg.e : null} org={{ ...org, perms }} onSaved={(emp, wantsLogin) => { reload(); if (wantsLogin && emp) setDlg({ kind: 'access', e: emp }) }} />
      {dlg?.kind === 'status' && <StatusDialog employee={dlg.e} onClose={() => setDlg(null)} onDone={() => reload()} />}
      {dlg?.kind === 'delete' && <DeletePersonDialog employeeId={dlg.e.id} name={dlg.e.fullName} onClose={() => setDlg(null)} onDone={() => { setSelected((s) => { const n = new Set(s); n.delete(dlg.e.id); return n }); reload() }} />}
      {dlg?.kind === 'access' && <AccessDialog employee={dlg.e} onClose={() => { setDlg(null); reload() }} />}
      {dlg?.kind === 'bulk' && <BulkDialog ids={[...selected]} org={org} roles={[]} perms={perms} onClose={() => { setDlg(null); setSelected(new Set()) }} onDone={() => reload()} />}
      {dlg?.kind === 'import' && <ImportDialog module="employees" onClose={() => setDlg(null)} onDone={() => reload()} />}
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={() => setDlg(null)} preset={{ title: `Task for ${dlg.e.fullName}`, assignees: [dlg.e.id] }} onSaved={() => { toast(`Task assigned to ${dlg.e.fullName}.`, { type: 'success' }); setDlg(null); reload() }} />}
    </div>
  )
}
