import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, FileX2, Plus, Crown } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { formatCurrency, formatDateTime } from '../../utils/format'
import { fetchDepartment, fetchTeam, useOrg } from './employeeClient'
import { DepartmentFormDialog, TeamFormDialog } from './OrgStructure'

const LOAD_TONE = { None: 'neutral', Light: 'success', Moderate: 'warning', Heavy: 'danger', Overloaded: 'danger' }
const Card = ({ title, action, children, className }) => <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}><header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header><div className="p-5">{children}</div></section>
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>
const A = ({ to, children }) => <Link to={to} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{children}</Link>

function Members({ members }) {
  return !members.length ? <p className="text-sm text-ink-400">No employees yet.</p> : (
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2">Employee</th><th className="pb-2">Designation</th><th className="pb-2">Status</th><th className="pb-2">Workload</th><th className="pb-2 text-right">Pending</th><th className="pb-2 text-right">Overdue</th><th className="pb-2 text-right">Projects</th></tr></thead>
      <tbody>{members.map((m) => <tr key={m.id} className={clsx('border-b border-ink-50 dark:border-ink-800/60', !m.working && 'opacity-60')}><td className="py-2"><span className="inline-flex items-center gap-2"><Avatar name={m.fullName} size="xs" /><A to={`/employees/${m.id}`}>{m.fullName}</A>{m.isTeamLeader && <Crown size={11} className="text-amber-500" />}</span></td><td className="text-xs">{m.designation}</td><td className="text-xs">{m.status}</td><td><Badge tone={LOAD_TONE[m.workload.level]}>{m.workload.level}</Badge></td><td className="text-right">{m.workload.pendingTasks}</td><td className={clsx('text-right', m.workload.overdueTasks > 0 && 'font-semibold text-rose-600')}>{m.workload.overdueTasks}</td><td className="text-right">{m.workload.activeProjects}</td></tr>)}</tbody></table></div>
  )
}

export function DepartmentDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const org = useOrg()
  const [d, setD] = useState(null); const [state, setState] = useState('loading'); const [dlg, setDlg] = useState(null)
  const load = useCallback(() => fetchDepartment(id).then((x) => { setD(x); setState('ok') }).catch(() => setState('missing')), [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const h = () => load(); window.addEventListener('crm:org-changed', h); return () => window.removeEventListener('crm:org-changed', h) }, [load])
  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-72" /></div>
  if (state === 'missing' || !d) return <EmptyState icon={FileX2} title="Department not found" description="It may have been removed, or you may not have access." action={<Button variant="secondary" onClick={() => navigate('/employees?view=departments')}>Back to departments</Button>} />
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Employees', href: '/employees' }, { label: 'Departments', href: '/employees?view=departments' }, { label: d.name }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link to="/employees?view=departments" aria-label="Back" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><i className="h-3 w-3 rounded-full" style={{ background: d.color }} /><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{d.name}</h1><Badge tone={d.status === 'Active' ? 'success' : 'neutral'}>{d.status}</Badge><Badge tone={LOAD_TONE[d.workloadLevel]}>Workload: {d.workloadLevel}</Badge></div><p className="mt-1 text-sm text-ink-500">{d.headId ? <>Head <A to={`/employees/${d.headId}`}>{d.headName}</A></> : 'No department head'}{d.description ? ` · ${d.description}` : ''}</p></div>
        {d.perms.manageOrg && <><Button variant="secondary" icon={Plus} onClick={() => setDlg('team')}>Add team</Button><Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button></>}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Total employees" value={d.total} /><Stat label="Active" value={d.active} tone="emerald" /><Stat label="On leave" value={d.onLeave} /><Stat label="Inactive" value={d.inactive} /><Stat label="Teams" value={d.teamCount} /><Stat label="Team leaders" value={d.leaderCount} /><Stat label="Open tasks" value={d.openTasks} /><Stat label="Overdue tasks" value={d.overdueTasks} tone={d.overdueTasks ? 'rose' : null} /><Stat label="Active projects" value={d.activeProjects} /><Stat label="Open tickets" value={d.openTickets} /></div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card title={`Teams (${d.teams.length})`}>{!d.teams.length ? <p className="text-sm text-ink-400">No teams yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{d.teams.map((t) => <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><div className="min-w-0"><A to={`/teams/${t.id}`}>{t.parentTeamName ? `${t.parentTeamName} › ` : ''}{t.name}</A><p className="text-[11px] text-ink-400">{t.leaderName ? `Leader: ${t.leaderName}` : 'Vacant leader'}</p></div><span className="shrink-0 text-xs text-ink-500">{t.size} member{t.size === 1 ? '' : 's'}</span></li>)}</ul>}</Card>
        <Card title={`Employees (${d.members.length})`}><Members members={d.members} /></Card>
      </div>
      {dlg === 'edit' && <DepartmentFormDialog department={d} employees={org.employees || []} onClose={() => setDlg(null)} onSaved={load} />}
      {dlg === 'team' && <TeamFormDialog team={null} presetDepartment={d.id} org={org} onClose={() => setDlg(null)} onSaved={load} />}
    </div>
  )
}

export function TeamDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const org = useOrg()
  const [t, setT] = useState(null); const [state, setState] = useState('loading'); const [dlg, setDlg] = useState(null)
  const load = useCallback(() => fetchTeam(id).then((x) => { setT(x); setState('ok') }).catch(() => setState('missing')), [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const h = () => load(); window.addEventListener('crm:org-changed', h); return () => window.removeEventListener('crm:org-changed', h) }, [load])
  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-72" /></div>
  if (state === 'missing' || !t) return <EmptyState icon={FileX2} title="Team not found" description="It may have been removed, or you may not have access." action={<Button variant="secondary" onClick={() => navigate('/employees?view=teams')}>Back to teams</Button>} />
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Employees', href: '/employees' }, { label: 'Teams', href: '/employees?view=teams' }, { label: t.name }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link to="/employees?view=teams" aria-label="Back" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{t.parentTeamName ? `${t.parentTeamName} › ` : ''}{t.name}</h1><Badge tone={t.status === 'Active' ? 'success' : 'neutral'}>{t.status}</Badge><Badge tone={LOAD_TONE[t.workloadLevel]}>Workload: {t.workloadLevel}</Badge></div>
          <p className="mt-1 text-sm text-ink-500"><span className="font-mono">{t.id}</span> · <A to={`/departments/${t.departmentId}`}>{t.departmentName}</A> · {t.leaderId ? <>Leader <A to={`/employees/${t.leaderId}`}>{t.leaderName}</A>{t.leaderInactive ? ' (inactive)' : ''}</> : 'Vacant leader'}{t.deputyId ? <> · Deputy <A to={`/employees/${t.deputyId}`}>{t.deputyName}</A></> : null}{t.description ? ` · ${t.description}` : ''}</p></div>
        {t.perms.manageOrg && <><Button variant="secondary" icon={Plus} onClick={() => setDlg('sub')}>Add sub-team</Button><Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit / change leader</Button></>}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Total members" value={t.size} /><Stat label="Active members" value={t.active} tone="emerald" /><Stat label="Pending tasks" value={t.openTasks} /><Stat label="Completed tasks" value={t.completedTasks} /><Stat label="Overdue tasks" value={t.overdueTasks} tone={t.overdueTasks ? 'rose' : null} /><Stat label="Active projects" value={t.activeProjects} /><Stat label="Open tickets" value={t.openTickets} /><Stat label="Active deals" value={t.activeDeals} /><Stat label="Revenue won" value={formatCurrency(t.revenueWon, { compact: true })} /><Stat label="Task performance" value={t.completionRate === null ? '—' : `${t.completionRate}%`} /><Stat label="On-time open tasks" value={t.onTimeRate === null ? '—' : `${t.onTimeRate}%`} /><Stat label="Created" value={String(t.createdAt).slice(0, 10)} /></div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-5">
          <Card title={`Members (${t.members.length})`}><Members members={t.members} /></Card>
          {t.subTeams.length > 0 && <Card title={`Sub-teams (${t.subTeams.length})`}><ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{t.subTeams.map((s) => <li key={s.id} className="flex items-center justify-between py-2.5 text-sm"><A to={`/teams/${s.id}`}>{s.name}</A><span className="text-xs text-ink-500">{s.leaderName || 'Vacant leader'} · {s.size} member{s.size === 1 ? '' : 's'}</span></li>)}</ul></Card>}
        </div>
        <Card title="Team history"><ol className="space-y-3">{t.history.length === 0 && <li className="text-sm text-ink-400">No changes recorded.</li>}{t.history.map((h) => <li key={h.id} className="text-sm"><p className="text-ink-800 dark:text-ink-100">{h.text}{h.from !== undefined || h.to !== undefined ? <span className="text-ink-500"> — {h.from || '—'} → {h.to || '—'}</span> : null}</p><p className="text-[11px] text-ink-400">{h.byName || 'System'} · {formatDateTime(h.at)}</p></li>)}</ol></Card>
      </div>
      {dlg === 'edit' && <TeamFormDialog team={t} org={org} onClose={() => setDlg(null)} onSaved={load} />}
      {dlg === 'sub' && <TeamFormDialog team={null} presetDepartment={t.departmentId} presetParent={t.id} org={org} onClose={() => setDlg(null)} onSaved={load} />}
    </div>
  )
}
