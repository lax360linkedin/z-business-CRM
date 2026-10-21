import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Pencil, Building2, UsersRound, Crown, AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { DEPT_COLORS, isWorking } from '../../utils/employeeRules'
import { saveDepartment, saveTeam, orgErr, orgFields } from './employeeClient'

const LOAD_TONE = { None: 'neutral', Light: 'success', Moderate: 'warning', Heavy: 'danger', Overloaded: 'danger' }

export function DepartmentFormDialog({ department, employees, onClose, onSaved }) {
  const { toast } = useToast()
  const [f, setF] = useState({ name: department?.name || '', code: department?.code || '', description: department?.description || '', color: department?.color || DEPT_COLORS[0], headId: department?.headId || '', status: department?.status || 'Active' })
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const go = () => { setBusy(true); setErrors({}); setError(''); saveDepartment(department?.id, { ...f, headId: f.headId || null, ...(department ? { status: f.status } : {}) }).then((d) => { toast(`Department ${d.name} saved.`, { type: 'success' }); onSaved?.(d); onClose() }).catch((e) => { setErrors(orgFields(e)); setError(orgErr(e)) }).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="md" title={department ? `Edit ${department.name}` : 'Add department'} description="Departments are configuration, not code — add as many service divisions as the company needs." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save department</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && !Object.keys(errors).length && <p role="alert" className="text-sm text-rose-500 sm:col-span-2">{error}</p>}
        <FormField label="Department / service division" required error={errors.name} className="sm:col-span-2"><Input aria-label="Department name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={!!errors.name} /></FormField>
        <FormField label="Code"><Input aria-label="Department code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></FormField>
        <FormField label="Colour" error={errors.color}><input type="color" aria-label="Department colour" className="h-9 w-full rounded-lg border border-ink-200 dark:border-ink-700" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></FormField>
        <FormField label="Department head" error={errors.headId} className="sm:col-span-2"><Select aria-label="Department head" value={f.headId} onChange={(e) => setF({ ...f, headId: e.target.value })}><option value="">No head assigned</option>{employees.filter((e) => isWorking(e.status) || e.id === department?.headId).map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.designation}</option>)}</Select></FormField>
        <FormField label="Description" className="sm:col-span-2"><Textarea aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[56px]" /></FormField>
        {department && <FormField label="Status" className="sm:col-span-2" hint="A department can only be deactivated when no working employee or active team remains in it."><Select aria-label="Department status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Active</option><option>Inactive</option></Select></FormField>}
      </div>
    </Modal>
  )
}

export function TeamFormDialog({ team, presetDepartment, presetParent, org, onClose, onSaved }) {
  const { toast } = useToast()
  const { departments = [], teams = [], employees = [] } = org
  const [f, setF] = useState({ name: team?.name || '', departmentId: team?.departmentId || presetDepartment || '', parentTeamId: team?.parentTeamId || presetParent || '', description: team?.description || '', leaderId: team?.leaderId || '', deputyId: team?.deputyId || '', status: team?.status || 'Active' })
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const candidates = employees.filter((e) => isWorking(e.status) || e.id === team?.leaderId || e.id === team?.deputyId)
  const leaderChanged = team && (team.leaderId || '') !== f.leaderId
  const go = () => { setBusy(true); setErrors({}); setError(''); saveTeam(team?.id, { ...f, parentTeamId: f.parentTeamId || null, leaderId: f.leaderId || null, deputyId: f.deputyId || null, ...(team ? { status: f.status } : {}) }).then((t) => { toast(`Team ${t.name} saved.`, { type: 'success' }); onSaved?.(t); onClose() }).catch((e) => { setErrors(orgFields(e)); setError(orgErr(e)) }).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="md" title={team ? `Edit ${team.name}` : f.parentTeamId ? 'Add sub-team' : 'Add team'} description="The team leader is a real link to an employee. Changing it never alters past records — it is added to the team’s and the people’s history." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save team</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && !Object.keys(errors).length && <p role="alert" className="text-sm text-rose-500 sm:col-span-2">{error}</p>}
        <FormField label="Team name" required error={errors.name} className="sm:col-span-2"><Input aria-label="Team name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={!!errors.name} /></FormField>
        <FormField label="Department" required error={errors.departmentId}><Select aria-label="Department" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, parentTeamId: '' })}><option value="">Select</option>{departments.filter((d) => d.status === 'Active' || d.id === f.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FormField>
        <FormField label="Parent team (makes this a sub-team)" error={errors.parentTeamId}><Select aria-label="Parent team" value={f.parentTeamId} onChange={(e) => setF({ ...f, parentTeamId: e.target.value })}><option value="">None — top-level team</option>{teams.filter((t) => t.departmentId === f.departmentId && !t.parentTeamId && t.id !== team?.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
        <FormField label="Team leader" error={errors.leaderId}><Select aria-label="Team leader" value={f.leaderId} onChange={(e) => setF({ ...f, leaderId: e.target.value })}><option value="">Vacant</option>{candidates.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.designation}</option>)}</Select></FormField>
        <FormField label="Deputy / assistant leader" error={errors.deputyId}><Select aria-label="Deputy leader" value={f.deputyId} onChange={(e) => setF({ ...f, deputyId: e.target.value })}><option value="">None</option>{candidates.filter((e) => e.id !== f.leaderId).map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.designation}</option>)}</Select></FormField>
        <FormField label="Description" className="sm:col-span-2"><Textarea aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[56px]" /></FormField>
        {team && <FormField label="Status" className="sm:col-span-2" hint="A team can only be deactivated when no working employee or active sub-team remains in it."><Select aria-label="Team status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Active</option><option>Inactive</option></Select></FormField>}
        {leaderChanged && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />The leader change is recorded (old → new). Existing tasks, deals and projects keep their original owners; new assignments use the new leader.</p>}
      </div>
    </Modal>
  )
}

export function DepartmentsTab({ org }) {
  const navigate = useNavigate()
  const { departments, employees = [], perms } = org
  const [dlg, setDlg] = useState(null)
  if (!departments) return null
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-ink-500">Every figure is counted from the live employee, task, project, ticket and deal records.</p>{perms.manageOrg && <Button icon={Plus} onClick={() => setDlg({})}>Add department</Button>}</div>
      {!departments.length ? <EmptyState icon={Building2} title="No departments yet" description="Add the first department or service division." /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{departments.map((d) => (
          <div key={d.id} className={clsx('rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900', d.status !== 'Active' && 'opacity-60')} style={{ borderTop: `4px solid ${d.color}` }}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><button type="button" onClick={() => navigate(`/departments/${d.id}`)} className="block max-w-full truncate text-left text-base font-semibold text-ink-900 hover:underline dark:text-ink-50">{d.name}</button><p className="text-xs text-ink-500">{d.headName ? `Head: ${d.headName}${d.headInactive ? ' (inactive)' : ''}` : 'No department head'}</p></div>{d.status !== 'Active' && <Badge>Inactive</Badge>}{perms.manageOrg && <button type="button" aria-label={`Edit ${d.name}`} onClick={() => setDlg(d)} className="rounded p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><Pencil size={14} /></button>}</div>
            <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">{[['Total', d.total], ['Active', d.active], ['On leave', d.onLeave], ['Inactive', d.inactive], ['Teams', d.teamCount], ['Leaders', d.leaderCount], ['Open tasks', d.openTasks], ['Overdue', d.overdueTasks], ['Projects', d.activeProjects], ['Tickets', d.openTickets]].map(([k, v]) => <div key={k} className="rounded-lg bg-ink-50 py-1.5 dark:bg-ink-800/50"><dd className={clsx('text-sm font-bold', k === 'Overdue' && v > 0 ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50')}>{v}</dd><dt className="text-[10px] text-ink-400">{k}</dt></div>)}</dl>
            <div className="mt-3 flex items-center justify-between"><Badge tone={LOAD_TONE[d.workloadLevel]}>Workload: {d.workloadLevel}</Badge><Button size="sm" variant="ghost" onClick={() => navigate(`/departments/${d.id}`)}>Open</Button></div>
          </div>))}</div>
      )}
      {dlg && <DepartmentFormDialog department={dlg.id ? dlg : null} employees={employees} onClose={() => setDlg(null)} onSaved={() => org.reload()} />}
    </div>
  )
}

export function TeamsTab({ org }) {
  const navigate = useNavigate()
  const { teams, departments = [], perms } = org
  const [dept, setDept] = useState(''); const [dlg, setDlg] = useState(null)
  if (!teams) return null
  const list = teams.filter((t) => !dept || t.departmentId === dept)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><select aria-label="Department" className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs dark:border-ink-700 dark:bg-ink-900" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><span className="text-xs text-ink-400">{list.length} team{list.length === 1 ? '' : 's'} (including sub-teams)</span>{perms.manageOrg && <Button className="ml-auto" icon={Plus} onClick={() => setDlg({})}>Add team</Button>}</div>
      {!list.length ? <EmptyState icon={UsersRound} title="No teams" description="Add a team to a department." /> : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900"><table className="crm-table w-full min-w-[860px] text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2.5">Team</th><th className="px-3">Department</th><th className="px-3">Team leader</th><th className="px-3 text-right">Members</th><th className="px-3 text-right">Active</th><th className="px-3 text-right">Open tasks</th><th className="px-3 text-right">Overdue</th><th className="px-3">Workload</th><th className="px-3">Status</th><th className="w-12" /></tr></thead>
          <tbody>{list.map((t) => (
            <tr key={t.id} className={clsx('border-b border-ink-50 last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/30', t.status !== 'Active' && 'opacity-60')}>
              <td className="px-4 py-3"><button type="button" onClick={() => navigate(`/teams/${t.id}`)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{t.parentTeamName ? `${t.parentTeamName} › ` : ''}{t.name}</button><p className="font-mono text-[10px] text-ink-400">{t.id}{t.subTeamCount ? ` · ${t.subTeamCount} sub-team(s)` : ''}</p></td>
              <td className="px-3 text-xs">{t.departmentName}</td><td className="px-3 text-xs">{t.leaderName ? <span className="inline-flex items-center gap-1"><Crown size={11} className="text-amber-500" />{t.leaderName}{t.leaderInactive && <Badge tone="danger">inactive</Badge>}</span> : <span className="text-ink-400">Vacant</span>}</td>
              <td className="px-3 text-right">{t.size}</td><td className="px-3 text-right">{t.active}</td><td className="px-3 text-right">{t.openTasks}</td><td className={clsx('px-3 text-right', t.overdueTasks > 0 && 'font-semibold text-rose-600')}>{t.overdueTasks}</td><td className="px-3"><Badge tone={LOAD_TONE[t.workloadLevel]}>{t.workloadLevel}</Badge></td><td className="px-3 text-xs">{t.status}</td>
              <td className="px-2 text-right">{perms.manageOrg && <button type="button" aria-label={`Edit ${t.name}`} onClick={() => setDlg(t)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><Pencil size={14} /></button>}</td></tr>))}</tbody></table></div>
      )}
      {dlg && <TeamFormDialog team={dlg.id ? dlg : null} presetDepartment={dept} org={org} onClose={() => setDlg(null)} onSaved={() => org.reload()} />}
    </div>
  )
}
