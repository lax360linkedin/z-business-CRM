import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, Phone, Mail, ClipboardList, Repeat, KeyRound, FileX2, History, Crown, ShieldCheck, ExternalLink, UploadCloud } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { isWorking } from '../../utils/employeeRules'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { fetchEmployee, useOrg } from './employeeClient'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { StatusDialog, AccessDialog } from './EmployeeDialogs'

const Card = ({ title, action, children, className }) => <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}><header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header><div className="p-5">{children}</div></section>
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children || '—'}</dd></div>
const Stat = ({ label, value, tone, onClick }) => <button type="button" onClick={onClick} disabled={!onClick} className="rounded-xl border border-ink-100 bg-white p-3 text-left enabled:hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></button>
const A = ({ to, children }) => <Link to={to} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{children}</Link>
const TONE = { Created: 'bg-brand-50 text-brand-600', StatusChanged: 'bg-amber-50 text-amber-600', DepartmentChanged: 'bg-sky-50 text-sky-600', TeamChanged: 'bg-sky-50 text-sky-600', TeamLeaderChanged: 'bg-sky-50 text-sky-600', DesignationChanged: 'bg-violet-50 text-violet-600', CrmAccessGranted: 'bg-emerald-50 text-emerald-600', CrmAccessRemoved: 'bg-rose-50 text-rose-600', RoleChanged: 'bg-violet-50 text-violet-600', TaskAssigned: 'bg-violet-50 text-violet-600', ProjectAssigned: 'bg-violet-50 text-violet-600', TicketAssigned: 'bg-violet-50 text-violet-600' }
const LOAD_TONE = { None: 'neutral', Light: 'success', Moderate: 'warning', Heavy: 'danger', Overloaded: 'danger' }

export default function EmployeeDetail() {
  const { id } = useParams(); const navigate = useNavigate(); const [params, setParams] = useSearchParams()
  const org = useOrg()
  const [e, setE] = useState(null); const [state, setState] = useState('loading'); const [acts, setActs] = useState([]); const [dlg, setDlg] = useState(null)
  const tab = params.get('tab') || 'overview'
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const { docs } = useDocuments({ relatedType: 'Employee', relatedId: id })
  const load = useCallback(() => {
    fetchEmployee(id).then((d) => { setE(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActs(r.data.filter((a) => a.by === id || a.assignedTo === id).sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 100))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const ev = ['crm:org-changed', 'crm:tasks-changed', 'crm:documents-changed']; const h = () => load(); ev.forEach((x) => window.addEventListener(x, h)); return () => ev.forEach((x) => window.removeEventListener(x, h)) }, [load])
  const perf = useMemo(() => {
    if (!e) return null
    const done = e.related.tasks.filter((t) => t.status === 'Completed'); const open = e.related.tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status))
    const won = e.related.deals.filter((d) => d.stage === 'Closed Won')
    return { done: done.length, open: open.length, rate: done.length + open.length ? Math.round(done.length / (done.length + open.length) * 100) : null, won: won.length, revenue: won.reduce((s, d) => s + (d.value || 0), 0), resolved: e.related.tickets.filter((t) => ['Resolved', 'Closed'].includes(t.status)).length, delivered: e.related.projects.filter((p) => p.status === 'Completed').length, converted: e.related.leads.filter((l) => l.status === 'Converted').length }
  }, [e])

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !e) return <EmptyState icon={FileX2} title="Employee not found" description="The employee may not exist, or you may not have access to this profile." action={<Button variant="secondary" onClick={() => navigate('/employees')}>Back to employees</Button>} />
  const p = e.perms; const w = e.workload
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'employment', label: 'Employment' }, { value: 'organization', label: 'Organization', count: e.directReports.length }, ...(p.viewAccount || e.crmAccess ? [{ value: 'access', label: 'CRM access' }] : []), { value: 'tasks', label: 'Tasks', count: e.related.tasks.length }, { value: 'activities', label: 'Activities', count: acts.length }, { value: 'projects', label: 'Projects', count: e.related.projects.length }, { value: 'deals', label: 'Deals', count: e.related.deals.length }, { value: 'leads', label: 'Leads', count: e.related.leads.length }, { value: 'tickets', label: 'Tickets', count: e.related.tickets.length }, { value: 'performance', label: 'Performance' }, { value: 'documents', label: 'Documents', count: docs?.length || 0 }, { value: 'timeline', label: 'Timeline', count: e.timeline.length }]
  const List = ({ rows, empty, render }) => (!rows.length ? <p className="text-sm text-ink-400">{empty}</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{rows.map(render)}</ul>)
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Employees', href: '/employees' }, { label: e.fullName }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <Link to="/employees" aria-label="Back to employees" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <Avatar name={e.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{e.fullName}</h1><Badge>{e.status}</Badge>{e.isTeamLeader && <Badge tone="warning"><Crown size={11} className="mr-1 inline" />Team leader</Badge>}{e.isDeptHead && <Badge tone="info">Department head</Badge>}<Badge tone={e.crmAccess ? (e.accountStatus === 'Active' ? 'success' : 'warning') : 'neutral'}>{e.crmAccess ? `CRM: ${e.accountStatus}` : 'No CRM access'}</Badge>{e.crmAccess && e.crmRole && <Badge tone="info">{e.crmRole}{e.crmAccessLevel && e.crmAccessLevel !== e.crmRole ? ` · ${e.crmAccessLevel}` : ''}</Badge>}</div>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{e.designation}{e.jobTitle && e.jobTitle !== e.designation ? ` · ${e.jobTitle}` : ''}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-500"><span className="font-mono">{e.id}</span>{e.branch && <span>Branch {e.branch}</span>}{e.departmentId && <span>Department <A to={`/departments/${e.departmentId}`}>{e.departmentName}</A></span>}{e.teamId && <span>Team <A to={`/teams/${e.teamId}`}>{e.teamName}</A>{e.subTeamName ? ` › ${e.subTeamName}` : ''}</span>}{e.teamLeaderId && <span>Team leader <A to={`/employees/${e.teamLeaderId}`}>{e.teamLeaderName}</A></span>}{e.reportsTo && <span>Reports to <A to={`/employees/${e.reportsTo}`}>{e.reportsToName}</A></span>}</div>
          </div>
          <Badge tone={LOAD_TONE[w.level]}>Workload: {w.level}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.edit && <Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button>}
          {p.changeStatus && <Button variant="secondary" icon={Repeat} onClick={() => setDlg('status')}>Change status</Button>}
          {e.mobile && <a href={`tel:${e.mobile.replace(/\s/g, '')}`}><Button variant="ghost" icon={Phone}>Call</Button></a>}<a href={`mailto:${e.officialEmail}`}><Button variant="ghost" icon={Mail}>Email</Button></a>
          {p.assignTask && e.crmAccess && isWorking(e.status) && <Button variant="ghost" icon={ClipboardList} onClick={() => setDlg('task')}>Assign task</Button>}
          {p.grantAccess && !e.crmAccess && isWorking(e.status) && <Button variant="ghost" icon={KeyRound} onClick={() => setDlg('access')}>Grant CRM access</Button>}
          {e.accountId && <Link to={`/user-management/${e.accountId}`}><Button variant="ghost" icon={ExternalLink}>Open in User Management</Button></Link>}
          {p.manageDocuments && <Button variant="ghost" icon={UploadCloud} onClick={() => setTab('documents')}>Documents</Button>}
        </div>
        {!isWorking(e.status) && <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">{e.status}{e.exitDate ? ` since ${formatDate(e.exitDate)}` : ''}. This person stays on record — everything they owned keeps their name.</p>}
      </div>
      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Pending tasks" value={w.pendingTasks} onClick={() => setTab('tasks')} /><Stat label="Overdue tasks" value={w.overdueTasks} tone={w.overdueTasks ? 'rose' : null} onClick={() => setTab('tasks')} /><Stat label="Active projects" value={w.activeProjects} onClick={() => setTab('projects')} /><Stat label="Open tickets" value={w.openTickets} onClick={() => setTab('tickets')} /><Stat label="Active deals" value={w.activeDeals} onClick={() => setTab('deals')} /><Stat label="Open leads" value={w.openLeads} onClick={() => setTab('leads')} /></div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Basic information"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Employee ID"><span className="font-mono">{e.id}</span></KV><KV k="Full name">{e.fullName}</KV><KV k="Official email">{e.officialEmail}</KV><KV k="Mobile">{e.mobile}</KV><KV k="Alternate number">{e.altPhone}</KV>
              {!e.sensitiveHidden ? <><KV k="Gender">{e.gender}</KV><KV k="Date of birth">{e.dob ? formatDate(e.dob) : ''}</KV><KV k="Personal email">{e.personalEmail}</KV><KV k="Address">{e.address}</KV><KV k="Emergency contact">{e.emergencyContact ? `${e.emergencyContact.name} (${e.emergencyContact.relation || 'contact'}) · ${e.emergencyContact.phone}` : ''}</KV></> : <p className="py-2 text-xs text-ink-400">Personal and HR details are restricted for your role.</p>}</dl></Card>
            <Card title="Workload" action={<Badge tone={LOAD_TONE[w.level]}>{w.level}</Badge>}><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Pending tasks">{w.pendingTasks}</KV><KV k="Overdue tasks">{w.overdueTasks}</KV><KV k="Active projects">{w.activeProjects}</KV><KV k="Open tickets">{w.openTickets}</KV><KV k="Active deals">{w.activeDeals}</KV><KV k="Open leads">{w.openLeads}</KV></dl><p className="mt-3 text-xs text-ink-400">Counted live from Tasks, Projects, Tickets, Deals and Leads — nothing is stored separately.</p></Card>
          </div>
        </div>
      )}
      {tab === 'employment' && <Card title="Employment information"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Joining date">{formatDate(e.joinDate)}</KV><KV k="Experience (with company)">{e.experience} yrs</KV><KV k="Department">{e.departmentName}</KV><KV k="Team">{e.teamName}</KV><KV k="Sub-team">{e.subTeamName}</KV><KV k="Designation">{e.designation}</KV><KV k="Job title">{e.jobTitle}</KV><KV k="Employment type">{e.employmentType}</KV><KV k="Employee status">{e.status}</KV><KV k="Reporting manager">{e.reportsTo ? <A to={`/employees/${e.reportsTo}`}>{e.reportsToName}</A> : 'Top level'}</KV><KV k="Team leader">{e.teamLeaderId ? <A to={`/employees/${e.teamLeaderId}`}>{e.teamLeaderName}</A> : ''}</KV><KV k="Work location">{e.workLocation}</KV><KV k="Shift">{e.shift}</KV><KV k="Work mode">{e.workMode}</KV>{e.exitDate && <KV k="Exit date">{formatDate(e.exitDate)}</KV>}</dl></Card>}
      {tab === 'organization' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Reporting structure"><ol className="space-y-2">{[...e.chain].reverse().map((m, i) => <li key={m.id} className="text-sm" style={{ paddingLeft: i * 14 }}>↳ <A to={`/employees/${m.id}`}>{m.name}</A> <span className="text-xs text-ink-400">{m.designation}</span></li>)}<li className="text-sm font-semibold" style={{ paddingLeft: e.chain.length * 14 }}>↳ {e.fullName} <span className="text-xs font-normal text-ink-400">(this employee)</span></li></ol>{!e.chain.length && <p className="mt-2 text-xs text-ink-400">Top of the reporting structure.</p>}</Card>
          <Card title={`Direct reports (${e.directReports.length})`}><List rows={e.directReports} empty="Nobody reports to this employee." render={(m) => <li key={m.id} className="flex items-center justify-between py-2 text-sm"><A to={`/employees/${m.id}`}>{m.name}</A><span className="text-xs text-ink-400">{m.designation}{m.teamName ? ` · ${m.teamName}` : ''} · {m.status}</span></li>} /></Card>
          <Card title="Department & team" className="lg:col-span-2"><dl className="grid gap-x-8 sm:grid-cols-2"><KV k="Department">{e.departmentId ? <A to={`/departments/${e.departmentId}`}>{e.departmentName}</A> : ''}</KV><KV k="Team">{e.teamId ? <A to={`/teams/${e.teamId}`}>{e.teamName}</A> : ''}</KV><KV k="Leads teams">{e.ledTeams.length ? e.ledTeams.map((t) => <A key={t.id} to={`/teams/${t.id}`}>{t.name} </A>) : ''}</KV><KV k="Team size">{e.team?.members}</KV></dl></Card>
        </div>
      )}
      {tab === 'access' && (
        <Card title="CRM access (linked to User Management)">{!e.crmAccess ? <EmptyState icon={ShieldCheck} title="No CRM access" description="This employee has no CRM login. Access is created in User Management and linked here." action={p.grantAccess && isWorking(e.status) ? <Button icon={KeyRound} onClick={() => setDlg('access')}>Grant CRM access</Button> : null} /> : (
          <dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="CRM user account">{e.accountId ? <A to={`/user-management/${e.accountId}`}>{e.accountId}</A> : 'Restricted'}</KV><KV k="CRM role">{e.crmRole}</KV><KV k="Assigned team">{e.teamName}</KV><KV k="Manager">{e.managerName}</KV><KV k="Account status">{e.accountStatus}</KV><KV k="Login status">{e.loginStatus}</KV><KV k="Last login">{e.lastLogin ? `${formatDateTime(e.lastLogin)} (${timeAgo(e.lastLogin)})` : 'Never'}</KV>{e.account && <KV k="All roles">{e.account.roles.join(', ')}</KV>}<KV k="Permissions"><A to="/roles-permissions">View in Roles &amp; Permissions</A></KV></dl>
        )}<p className="mt-3 text-xs text-ink-400">Passwords and sessions are managed only in User Management — nothing about authentication is copied onto the employee record.</p></Card>
      )}
      {tab === 'tasks' && <Card title={`Tasks (${e.related.tasks.length})`}><List rows={e.related.tasks} empty="No tasks assigned." render={(t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>} /></Card>}
      {tab === 'activities' && <Card title={`Recent activities (${acts.length})`}><List rows={acts} empty="No activities logged by or assigned to this employee." render={(a) => <li key={a.id} className="py-2.5 text-sm"><p className="font-medium">{a.subject || a.title}</p><p className="text-xs text-ink-400">{a.type} · {a.relatedName || a.relatedType || ''} · {timeAgo(a.date)}</p></li>} /></Card>}
      {tab === 'projects' && <Card title={`Projects (${e.related.projects.length})`}><List rows={e.related.projects} empty="No projects visible to you." render={(x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><A to={`/projects/${x.id}`}>{x.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{x.role}<StatusBadge status={x.status} /></span></li>} /></Card>}
      {tab === 'deals' && <Card title={`Deals (${e.related.deals.length})`}><List rows={e.related.deals} empty="No deals visible to you." render={(x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><A to={`/deals/${x.id}`}>{x.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{formatCurrency(x.value, { compact: true })}<StatusBadge status={x.stage} /></span></li>} /></Card>}
      {tab === 'leads' && <Card title={`Leads (${e.related.leads.length})`}><List rows={e.related.leads} empty="No leads visible to you." render={(x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><A to={`/leads/${x.id}`}>{x.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{x.company}<StatusBadge status={x.status} /></span></li>} /></Card>}
      {tab === 'tickets' && <Card title={`Tickets (${e.related.tickets.length})`}><List rows={e.related.tickets} empty="No tickets visible to you." render={(x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><Link to="/tickets" className="truncate font-medium text-brand-700 hover:underline dark:text-brand-300">{x.subject}</Link><span className="flex items-center gap-2 text-xs text-ink-400">{x.priority}<StatusBadge status={x.status} /></span></li>} /></Card>}
      {tab === 'performance' && perf && (
        <div className="space-y-5"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Tasks completed" value={perf.done} tone="emerald" /><Stat label="Task completion rate" value={perf.rate === null ? '—' : `${perf.rate}%`} /><Stat label="Deals won" value={perf.won} /><Stat label="Revenue won" value={formatCurrency(perf.revenue, { compact: true })} /><Stat label="Leads converted" value={perf.converted} /><Stat label="Tickets resolved" value={perf.resolved} /><Stat label="Projects delivered" value={perf.delivered} /><Stat label="Overdue tasks" value={w.overdueTasks} tone={w.overdueTasks ? 'rose' : null} /></div><p className="text-xs text-ink-400">Computed from the records this person owns that you are allowed to see. A figure of 0 or — means no such records, not hidden data.</p></div>
      )}
      {tab === 'documents' && <Card title="Employee documents"><DocumentsPanel relatedType="Employee" relatedId={e.id} defaultCategory="HR Documents" canUploadHere={!!p.manageDocuments} uploadHint="Offer letters, ID proof, certificates, agreements and other HR documents. Stored privately; only HR and administrators can open them." /></Card>}
      {tab === 'timeline' && (
        <Card title="Employee timeline" action={<span className="text-xs text-ink-400">{e.timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">{e.timeline.map((x) => <li key={x.id} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[x.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span><div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{x.href ? <Link to={x.href} className="hover:underline">{x.text}</Link> : x.text}</p>{(x.from || x.to) && <p className="text-xs text-ink-500">{x.from || '—'} → {x.to || '—'}</p>}{x.details && <p className="text-xs text-ink-500">{x.details}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(x.at)}>{(x.by && getUserById(x.by)?.name) || x.byName || 'Recorded from CRM data'} · {timeAgo(x.at)} · {formatDateTime(x.at)}</p></div></li>)}</ol>
        </Card>
      )}

      <EmployeeFormDialog open={dlg === 'edit'} onClose={() => setDlg(null)} employee={e} org={{ ...org, perms: org.perms }} onSaved={load} />
      {dlg === 'status' && <StatusDialog employee={e} onClose={() => setDlg(null)} onDone={load} />}
      {dlg === 'access' && <AccessDialog employee={e} onClose={() => { setDlg(null); load() }} />}
      {dlg === 'task' && <TaskFormDialog open onClose={() => setDlg(null)} preset={{ title: `Task for ${e.fullName}`, assignees: [e.id] }} onSaved={() => { setDlg(null); load() }} />}
    </div>
  )
}
