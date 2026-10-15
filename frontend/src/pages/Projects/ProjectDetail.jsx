import { ExpensesPanel } from '../Expenses/ExpensesPanel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, Pencil, Trash2, Play, PauseCircle, CheckCircle2, XCircle, RotateCcw, ShieldAlert, FolderKanban, Plus, UserMinus, Phone, CalendarPlus, ExternalLink, Package, Receipt, Wallet,
  Flag, CalendarDays, MessageSquare, History, Users, FileText, ClipboardList, Briefcase, AlertTriangle,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Input, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS, getUserById } from '../../data/users'
import { useProjectsData, useProjectAccess, logProjectActivity, emitProjectsChanged } from '../../hooks/useProjects'
import { TEAM_ROLES, PROJECT_TRANSITIONS, effectiveProgress, projectBilling, taskStats, isOpenProject, isOverdueProject, daysUntil } from '../../utils/projectRules'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { localDate } from '../../utils/calendarRules'
import { PriorityMark } from '../Tasks/TaskBits'
import { ProgressBar, EndDate } from './ProjectBits'
import { ProjectFormDialog } from './ProjectFormDialog'
import { ProjectStatusDialog } from './ProjectStatusDialog'
import { ProjectTasksTab } from './ProjectTasksTab'
import { ProjectDocuments } from './ProjectDocuments'
import { ProjectContracts } from './ProjectContracts'
import { RecordContractButton } from '../Contracts/RecordContractButton'
import { ProjectActivityDialog } from './ProjectActivityDialog'
import { errText } from './projectActions'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 text-right font-medium text-ink-900 dark:text-ink-50">{children}</dd></div>
const Chip = ({ to, label, value }) => value ? <Link to={to} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{label}</span><span className="truncate font-medium">{value}</span></Link> : null
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>

const ACTIVITY_TONE = { Meeting: 'bg-emerald-50 text-emerald-600', Call: 'bg-sky-50 text-sky-600', Email: 'bg-brand-50 text-brand-600', WhatsApp: 'bg-emerald-50 text-emerald-600', Note: 'bg-ink-100 text-ink-600', StatusChange: 'bg-violet-50 text-violet-600', Assignment: 'bg-sky-50 text-sky-600', Attachment: 'bg-ink-100 text-ink-600', Created: 'bg-brand-50 text-brand-600', Updated: 'bg-ink-100 text-ink-600', Task: 'bg-emerald-50 text-emerald-600', Invoice: 'bg-amber-50 text-amber-600', Payment: 'bg-emerald-50 text-emerald-600' }

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data, error, reload } = useProjectsData()
  const { user, can, canView } = useProjectAccess()
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [calEvents, setCalEvents] = useState([])
  const [edit, setEdit] = useState(false)
  const [statusTo, setStatusTo] = useState(null)
  const [logOpen, setLogOpen] = useState(null)
  const [delOpen, setDelOpen] = useState(false)
  const [addUser, setAddUser] = useState('')
  const [addRole, setAddRole] = useState('Developer')
  const [busy, setBusy] = useState(false)
  const [prodPick, setProdPick] = useState('')

  const project = data?.projects.find((p) => p.id === id)
  const loadExtra = useCallback(() => {
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data)).catch(() => {})
    api.get('/calendar/events').then((r) => setCalEvents(r.data.events)).catch(() => {})
  }, [])
  useEffect(() => { loadExtra() }, [loadExtra, id])
  useEffect(() => { const h = () => loadExtra(); window.addEventListener('crm:projects-changed', h); window.addEventListener('crm:tasks-changed', h); return () => { window.removeEventListener('crm:projects-changed', h); window.removeEventListener('crm:tasks-changed', h) } }, [loadExtra])

  const view = useMemo(() => {
    if (!data || !project) return null
    const tasks = data.tasks.filter((t) => t.links?.projectId === id || (t.relatedType === 'Project' && t.relatedId === id))
    const perms = can(project)
    const so = data.salesOrders.find((s) => s.id === project.salesOrderId)
    const billing = perms.viewFinancial ? projectBilling(project, data.invoices, data.payments) : null
    const progress = effectiveProgress(project, tasks)
    return { tasks, perms, so, billing, progress, stats: taskStats(tasks), customer: data.customers.find((c) => c.id === project.customerId), company: data.companies.find((c) => c.id === project.companyId), contact: data.contacts.find((c) => c.id === project.contactId), deal: data.deals.find((d) => d.id === project.dealId), proposal: data.proposals.find((p) => p.id === project.proposalId), quotation: data.quotations.find((q) => q.id === project.quotationId) }
  }, [data, project, id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => activities.filter((a) => (a.relatedType === 'Project' && a.relatedId === id) || a.links?.projectId === id), [activities, id])
  const events = useMemo(() => calEvents.filter((e) => (e.relatedType === 'Project' && e.relatedId === id) || e.related?.some((r) => r.type === 'Project' && r.id === id)).filter((e) => e.kind !== 'deadline' || e.state !== 'done'), [calEvents, id])

  const timeline = useMemo(() => {
    if (!view) return []
    const out = []
    const logged = mine.filter((a) => a.source !== 'task')
    logged.forEach((a) => out.push({ key: a.id, at: a.date, type: a.type, text: a.subject || a.type, by: a.by, note: a.notes }))
    if (!logged.some((a) => a.type === 'Created')) out.push({ key: 'created', at: project.createdAt, type: 'Created', text: 'Project created', by: project.createdBy })
    view.tasks.forEach((t) => {
      out.push({ key: `tc-${t.id}`, at: t.createdAt, type: 'Task', text: `${t.taskType === 'Milestone' ? 'Milestone' : 'Task'} created: ${t.title}`, by: t.createdBy, href: `/tasks/${t.id}` })
      if (t.completedAt) out.push({ key: `td-${t.id}`, at: t.completedAt, type: 'Task', text: `${t.taskType === 'Milestone' ? 'Milestone completed' : 'Task completed'}: ${t.title}`, by: t.completedBy, href: `/tasks/${t.id}` })
    })
    if (view.billing) {
      view.billing.invoices.filter((i) => i.status !== 'Draft').forEach((i) => out.push({ key: `iv-${i.id}`, at: i.createdAt || `${i.issueDate}T09:00:00Z`, type: 'Invoice', text: `Invoice created: ${i.number} (${formatCurrency(i.amount)})`, by: i.createdBy, href: `/invoices/${i.id}` }))
      view.billing.payments.forEach((p) => out.push({ key: `pm-${p.id}`, at: p.date && p.date.length === 10 ? `${p.date}T12:00:00Z` : p.date, type: 'Payment', text: `Payment recorded: ${formatCurrency(p.amount)} on ${p.invoiceNumber}`, by: p.recordedBy, href: `/invoices/${p.invoiceId}` }))
    }
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [view, mine, project])

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load the project" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  if (!data) return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (!project) return <EmptyState icon={FolderKanban} title="Project not found" description={`${id} doesn’t exist — it may have been deleted.`} action={<Button variant="secondary" onClick={() => navigate('/projects')}>Back to projects</Button>} />
  if (!canView(project)) return <EmptyState icon={ShieldAlert} title="You don’t have access to this project" description="Projects are visible to their manager, team and the roles your organisation has granted. Ask the project manager to add you." action={<Button variant="secondary" onClick={() => navigate('/projects')}>Back to projects</Button>} />

  const { perms, tasks, billing, progress, stats, so, customer, company, contact, deal, proposal, quotation } = view
  const done = (m) => { if (m) toast(m, { type: 'success' }); emitProjectsChanged(); reload() }
  const fail = (e) => toast(errText(e), { type: 'error' })
  const teamIds = [...new Set([project.manager, ...(project.team || [])])]
  const nextStatuses = (PROJECT_TRANSITIONS[project.status] || []).filter((s) => (project.status === 'Completed' ? perms.reopen : s === 'Completed' ? perms.complete : perms.changeStatus))
  const notify = (userId, message) => api.post('/notifications', { id: `NTF-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`, type: 'Project Update', userId, relatedType: 'Project', relatedId: project.id, message, date: new Date().toISOString(), read: false }).catch(() => null)

  const saveTeam = (team, teamRoles, log) => api.put(`/projects/${project.id}`, { team, teamRoles, updatedAt: new Date().toISOString() }).then(() => log && logProjectActivity(project, user.id, { type: 'Assignment', subject: log }))
  const addMember = () => {
    if (!addUser) return
    setBusy(true)
    const name = getUserById(addUser)?.name
    saveTeam([...teamIds, addUser], { ...project.teamRoles, [addUser]: { role: addRole, responsibility: '' } }, `Team member added: ${name} (${addRole})`)
      .then(() => notify(addUser, `${getUserById(user.id)?.name} added you to “${project.name}” as ${addRole}.`)).then(() => { setAddUser(''); done(`${name} added to the team.`) }).catch(fail).finally(() => setBusy(false))
  }
  const removeMember = (uid) => {
    const open = tasks.filter((t) => t.assignees?.includes(uid) && !['Completed', 'Cancelled'].includes(t.status)).length
    if (open && !window.confirm(`${getUserById(uid)?.name} still has ${open} open task(s) on this project. Remove anyway? The tasks stay assigned.`)) return
    const roles = { ...project.teamRoles }; delete roles[uid]
    saveTeam(teamIds.filter((x) => x !== uid), roles, `Team member removed: ${getUserById(uid)?.name}`).then(() => done('Team member removed.')).catch(fail)
  }
  const setRole = (uid, patch) => saveTeam(teamIds, { ...project.teamRoles, [uid]: { ...(project.teamRoles?.[uid] || {}), ...patch } }, patch.role ? `Role changed: ${getUserById(uid)?.name} → ${patch.role}` : null).then(() => done()).catch(fail)
  const setProgress = (v) => api.put(`/projects/${project.id}`, { progress: Number(v), updatedAt: new Date().toISOString() }).then(() => done()).catch(fail)
  const saveProducts = (ids, msg) => api.put(`/projects/${project.id}`, { productIds: ids, updatedAt: new Date().toISOString() }).then(() => logProjectActivity(project, user.id, { type: 'Updated', subject: msg })).then(() => done(msg)).catch(fail)
  const remove = () => {
    const blockers = [tasks.length && `${tasks.length} task(s)`, billing?.invoices.length && `${billing.invoices.length} invoice(s)`, data.documents.some((d) => d.projectId === id) && 'documents'].filter(Boolean)
    if (blockers.length) { setDelOpen(false); toast(`This project has ${blockers.join(', ')} — cancel it instead of deleting.`, { type: 'error' }); return }
    api.delete(`/projects/${project.id}`).then(() => { toast('Project deleted.', { type: 'success' }); emitProjectsChanged(); navigate('/projects') }).catch(fail)
  }

  const products = (project.productIds || []).map((pid) => data.products.find((p) => p.id === pid)).filter(Boolean)
  const lineOf = (pid) => so?.items?.filter((i) => i.productId === pid) || []
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'tasks', label: 'Tasks', count: stats.total }, { value: 'milestones', label: 'Milestones', count: stats.milestones }, { value: 'team', label: 'Team', count: teamIds.length }, { value: 'products', label: 'Products & services', count: products.length },
    { value: 'documents', label: 'Documents', count: data.documents.filter((d) => d.projectId === id).length }, { value: 'contracts', label: 'Contracts', count: data.contracts.filter((c) => c.projectId === id).length },
    ...(billing ? [{ value: 'billing', label: 'Billing', count: billing.invoices.length }] : []), { value: 'expenses', label: 'Expenses' }, { value: 'calendar', label: 'Calendar', count: events.length }, { value: 'activities', label: 'Activities', count: mine.length }, { value: 'timeline', label: 'Timeline' }]
  const next = events.filter((e) => e.date >= localDate(new Date()) && e.state !== 'done').slice(0, 5)
  const upcomingMilestones = tasks.filter((t) => t.taskType === 'Milestone' && !['Completed', 'Cancelled'].includes(t.status)).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).slice(0, 4)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: project.id }]} />
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/projects" aria-label="Back to projects" className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{project.id}</span>
            <StatusBadge status={project.status} /><PriorityMark priority={project.priority} /><Badge>{project.projectType}</Badge>{isOverdueProject(project) && <Badge tone="danger">Overdue {-daysUntil(project.deadline)}d</Badge>}
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-500">
            <span>Customer <Link to={`/customers/${project.customerId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{project.customerName}</Link></span>
            {company && <span>Company <Link to={`/companies/${company.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{company.name}</Link></span>}
            <span className="inline-flex items-center gap-1.5">Manager <Avatar name={getUserById(project.manager)?.name} size="xs" /><b className="font-medium text-ink-800 dark:text-ink-100">{getUserById(project.manager)?.name}</b></span>
            <span>{formatDate(project.startDate)} → <EndDate project={project} className="!text-sm" /></span>
          </div>
          <ProgressBar value={progress} className="mt-3 max-w-md" />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {perms.edit && <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}
          <RecordContractButton kind="project" record={project} />
          {nextStatuses.map((s) => {
            const reopen = project.status === 'Completed' && s === 'Active'
            const Icon = reopen ? RotateCcw : { Active: Play, 'On Hold': PauseCircle, Completed: CheckCircle2, Cancelled: XCircle, Planned: RotateCcw }[s]
            return <Button key={s} variant={s === 'Cancelled' ? 'ghost' : s === 'Completed' ? 'primary' : 'secondary'} icon={Icon} onClick={() => setStatusTo(s)}>{reopen ? 'Reopen' : s === 'Active' ? (project.status === 'On Hold' ? 'Resume' : 'Start') : s === 'On Hold' ? 'Put on hold' : s === 'Completed' ? 'Complete' : s === 'Cancelled' ? 'Cancel' : 'Restore'}</Button>
          })}
          {perms.edit && <Button variant="secondary" icon={CalendarPlus} onClick={() => setLogOpen('Meeting')}>Log activity</Button>}
          {perms.delete && <Button variant="ghost" icon={Trash2} onClick={() => setDelOpen(true)} aria-label="Delete project" />}
        </div>
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Progress" value={`${progress}%`} /><Stat label="Tasks done" value={`${stats.done}/${stats.total}`} /><Stat label="Milestones" value={`${stats.milestonesDone}/${stats.milestones}`} /><Stat label="Overdue tasks" value={stats.overdue} tone={stats.overdue ? 'rose' : null} />
            {billing && <><Stat label="Project value" value={formatCurrency(billing.value, { compact: true })} /><Stat label="Outstanding" value={formatCurrency(billing.outstanding, { compact: true })} tone={billing.outstanding > 0 ? 'rose' : null} /></>}
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <Card title="About this project">
                <p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{project.description || 'No description.'}</p>
                {(project.objectives || []).length > 0 && <div className="mt-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Objectives</p><ul className="list-disc space-y-1 pl-5 text-sm text-ink-700 dark:text-ink-200">{project.objectives.map((o) => <li key={o}>{o}</li>)}</ul></div>}
                {project.statusReason && <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">Last status note: {project.statusReason}</p>}
              </Card>
              <Card title="Progress" action={project.progressMode === 'manual' && perms.edit ? <span className="text-xs text-ink-400">manual</span> : <span className="text-xs text-ink-400">from tasks &amp; milestones</span>}>
                {project.progressMode === 'manual' && perms.edit ? (
                  <div className="flex items-center gap-3"><input type="range" min="0" max="100" step="5" defaultValue={project.progress} aria-label="Progress percentage" onMouseUp={(e) => setProgress(e.target.value)} onKeyUp={(e) => setProgress(e.target.value)} className="flex-1" /><span className="w-10 text-right text-sm font-semibold">{project.progress}%</span></div>
                ) : <ProgressBar value={progress} />}
                <p className="mt-2 text-xs text-ink-400">{project.progressMode === 'manual' ? 'Set by hand on this page.' : stats.total ? `${stats.done} of ${stats.total} tasks and milestones are done; tasks with subtasks count their finished share.` : 'No tasks yet — add tasks and milestones to track progress automatically.'}</p>
              </Card>
              <div className="grid gap-5 sm:grid-cols-2">
                <Card title="Next milestones" action={<button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setTab('milestones')}>All</button>}>
                  {upcomingMilestones.length ? <ul className="space-y-2">{upcomingMilestones.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 text-sm hover:underline"><span className="flex min-w-0 items-center gap-1.5"><Flag size={12} className="shrink-0 text-amber-500" /><span className="truncate">{t.title}</span></span><span className={clsx('shrink-0 text-xs', t.overdue ? 'font-semibold text-rose-600' : 'text-ink-400')}>{t.dueDate ? formatDate(t.dueDate) : '—'}</span></Link></li>)}</ul> : <p className="text-sm text-ink-400">No open milestones.</p>}
                </Card>
                <Card title="Coming up" action={<Link to={`/calendar?relatedType=Project&relatedId=${project.id}`} className="text-xs font-medium text-brand-600 hover:underline">Calendar</Link>}>
                  {next.length ? <ul className="space-y-2">{next.map((e) => <li key={e.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{e.title}</span><span className="shrink-0 text-xs text-ink-400">{formatDate(e.date)}{e.time ? ` · ${e.time}` : ''}</span></li>)}</ul> : <p className="text-sm text-ink-400">Nothing scheduled.</p>}
                </Card>
              </div>
            </div>
            <div className="space-y-5">
              <Card title="Details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
                <KV k="Project manager">{getUserById(project.manager)?.name}</KV><KV k="Type">{project.projectType}</KV><KV k="Priority">{project.priority}</KV>
                <KV k="Start date">{formatDate(project.startDate)}</KV><KV k="Expected end">{formatDate(project.deadline)}</KV><KV k="Actual completion">{project.actualEndDate ? formatDate(project.actualEndDate) : '—'}</KV>
                {billing && <KV k="Project value">{formatCurrency(billing.value)}</KV>}<KV k="Team size">{teamIds.length}</KV><KV k="Created">{project.createdAt ? formatDate(project.createdAt) : '—'}</KV>
              </dl></Card>
              <Card title="Linked records"><div className="flex flex-wrap gap-1.5">
                <Chip to={`/customers/${project.customerId}`} label="Customer" value={project.customerName} /><Chip to={`/companies/${project.companyId}`} label="Company" value={company?.name} /><Chip to={`/contacts/${project.contactId}`} label="Contact" value={contact?.name} />
                <Chip to={`/deals/${project.dealId}`} label="Deal" value={deal?.name} /><Chip to={`/proposals/${project.proposalId}`} label="Proposal" value={proposal?.number} /><Chip to={`/quotations/${project.quotationId}`} label="Quotation" value={quotation?.number} />
                {billing && <Chip to={`/sales-orders/${project.salesOrderId}`} label="Order" value={so?.number} />}
                {!deal && !so && !quotation && <p className="text-sm text-ink-400">Created manually — not tied to a deal or order.</p>}
              </div></Card>
              {billing && project.billing && (project.billing.paymentTerms || project.billing.gstin || project.billing.billingAddress) && <Card title="Billing information"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Payment terms">{project.billing.paymentTerms || '—'}</KV><KV k="GSTIN">{project.billing.gstin || '—'}</KV><KV k="Billing address"><span className="whitespace-pre-line">{project.billing.billingAddress || '—'}</span></KV></dl></Card>}
            </div>
          </div>
        </div>
      )}

      {tab === 'tasks' && <ProjectTasksTab project={project} tasks={tasks} perms={perms} user={user} onChanged={() => done()} />}
      {tab === 'milestones' && <ProjectTasksTab key="ms" project={project} tasks={tasks} perms={perms} user={user} onChanged={() => done()} initialFilter="milestones" />}

      {tab === 'team' && (
        <div className="space-y-4">
          {perms.manageTeam && isOpenProject(project) && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
              <Select aria-label="Add team member" value={addUser} onChange={(e) => setAddUser(e.target.value)} className="h-9 !w-auto min-w-[14rem] flex-1 text-sm"><option value="">Add a team member…</option>{USERS.filter((u) => u.status !== 'Inactive' && !teamIds.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</Select>
              <Select aria-label="Project role" value={addRole} onChange={(e) => setAddRole(e.target.value)} className="h-9 !w-48 text-sm">{TEAM_ROLES.map((r) => <option key={r}>{r}</option>)}</Select>
              <Button icon={Plus} disabled={!addUser} loading={busy} onClick={addMember}>Add</Button>
            </div>
          )}
          <ul className="divide-y divide-ink-50 rounded-2xl border border-ink-100 bg-white shadow-card dark:divide-ink-800/60 dark:border-ink-800 dark:bg-ink-900">
            {teamIds.map((uid) => { const u = getUserById(uid); const r = project.teamRoles?.[uid] || { role: uid === project.manager ? 'Project Manager' : 'Team Member', responsibility: '' }
              const mt = tasks.filter((t) => t.assignees?.includes(uid)); const open = mt.filter((t) => !['Completed', 'Cancelled'].includes(t.status))
              return (
                <li key={uid} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={u?.name} size="md" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{u?.name}{uid === project.manager && <Badge tone="info" className="ml-2">Manager</Badge>}</p><p className="text-xs text-ink-400">{u?.designation} · {u?.department}</p></div>
                    {perms.manageTeam ? <Select aria-label={`Role of ${u?.name}`} value={r.role} onChange={(e) => setRole(uid, { role: e.target.value })} className="h-8 !w-44 text-xs">{[...new Set([r.role, ...TEAM_ROLES])].map((x) => <option key={x}>{x}</option>)}</Select> : <Badge>{r.role}</Badge>}
                    <span className="text-xs text-ink-500">{open.length} open · {mt.length - open.length} done{open.some((t) => t.overdue) ? <span className="ml-1 font-semibold text-rose-600">· overdue</span> : ''}</span>
                    {perms.manageTeam && uid !== project.manager && <button type="button" aria-label={`Remove ${u?.name}`} onClick={() => removeMember(uid)} className="rounded-lg p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"><UserMinus size={16} /></button>}
                  </div>
                  {(perms.manageTeam || r.responsibility) && <div className="mt-2 pl-[3.25rem]">{perms.manageTeam ? <Input aria-label={`Responsibility of ${u?.name}`} defaultValue={r.responsibility} placeholder="Responsibilities on this project…" className="h-8 text-xs" onBlur={(e) => e.target.value !== (r.responsibility || '') && setRole(uid, { responsibility: e.target.value })} /> : <p className="text-xs text-ink-500">{r.responsibility}</p>}</div>}
                  {open.length > 0 && <ul className="mt-2 space-y-0.5 pl-[3.25rem]">{open.slice(0, 4).map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 text-xs text-ink-600 hover:underline dark:text-ink-300"><span className="truncate">{t.title}</span><span className={clsx('shrink-0', t.overdue && 'font-semibold text-rose-600')}>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}{open.length > 4 && <li className="text-xs text-ink-400">+{open.length - 4} more</li>}</ul>}
                </li>
              ) })}
          </ul>
        </div>
      )}

      {tab === 'products' && (
        <div className="space-y-4">
          {perms.edit && isOpenProject(project) && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
              <Select aria-label="Add product or service" value={prodPick} onChange={(e) => setProdPick(e.target.value)} className="h-9 !w-auto min-w-[16rem] flex-1 text-sm"><option value="">Add from the catalog…</option>{data.products.filter((p) => p.status !== 'Inactive' && !(project.productIds || []).includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select>
              <Button icon={Plus} disabled={!prodPick} onClick={() => { const p = data.products.find((x) => x.id === prodPick); setProdPick(''); saveProducts([...(project.productIds || []), prodPick], `Service added: ${p.name}`) }}>Add</Button>
            </div>
          )}
          {!products.length ? <EmptyState icon={Package} title="No products or services" description="Products come from the sales order, or add them from the catalog." /> : (
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
              <table className="w-full text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2.5">Item</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5 text-right">Ordered</th>{billing && <th className="px-3 py-2.5 text-right">Order value</th>}<th className="w-10" /></tr></thead>
                <tbody>{products.map((p) => { const lines = lineOf(p.id); const qty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0); const val = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discount) || 0) / 100), 0)
                  return <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-4 py-3"><Link to={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{p.name}</Link><p className="font-mono text-[11px] text-ink-400">{p.code}</p></td><td className="px-3 py-3 text-ink-600 dark:text-ink-300">{p.category}</td><td className="px-3 py-3 text-right">{lines.length ? `${qty} ${p.unit}` : '—'}</td>{billing && <td className="px-3 py-3 text-right">{lines.length ? formatCurrency(val) : '—'}</td>}<td className="px-2">{perms.edit && isOpenProject(project) && <button type="button" aria-label={`Remove ${p.name}`} onClick={() => saveProducts((project.productIds || []).filter((x) => x !== p.id), `Service removed: ${p.name}`)} className="rounded p-1 text-ink-300 hover:text-rose-600"><XCircle size={15} /></button>}</td></tr> })}</tbody></table>
            </div>
          )}
          {so && <p className="text-xs text-ink-400">Quantities and values come from sales order <Link className="text-brand-600 hover:underline" to={`/sales-orders/${so.id}`}>{so.number}</Link>.</p>}
        </div>
      )}

      {tab === 'documents' && <ProjectDocuments project={project} data={data} perms={perms} user={user} onChanged={() => done()} />}
      {tab === 'contracts' && <ProjectContracts project={project} data={data} perms={perms} user={user} onChanged={() => done()} />}

      {tab === 'billing' && billing && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Project value" value={formatCurrency(billing.value, { compact: true })} /><Stat label="Invoiced" value={formatCurrency(billing.invoiced, { compact: true })} /><Stat label="Paid" value={formatCurrency(billing.paid, { compact: true })} tone="emerald" />
            <Stat label="Outstanding" value={formatCurrency(billing.outstanding, { compact: true })} tone={billing.outstanding > 0 ? 'rose' : null} /><Stat label="Not yet invoiced" value={formatCurrency(billing.unbilled, { compact: true })} /><Stat label="Payment status" value={billing.paymentStatus} />
          </div>
          <p className="text-xs text-ink-400">“Paid” counts only payments actually recorded against the invoices — raising an invoice never marks anything as paid.</p>
          <Card title="Sales order" action={so && <Link to={`/sales-orders/${so.id}`} className="text-xs font-medium text-brand-600 hover:underline">Open</Link>}>
            {so ? <div className="flex flex-wrap items-center gap-4 text-sm"><Link to={`/sales-orders/${so.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">{so.number}</Link><StatusBadge status={so.status} /><span>{formatCurrency(so.amount)} incl. tax</span><span className="text-ink-400">{(so.items || []).length} line(s)</span>{!billing.invoices.some((i) => i.status !== 'Cancelled') && ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled'].includes(so.status) && <Link to={`/sales-orders/${so.id}`}><Button size="sm" variant="secondary" icon={Receipt}>Create invoice on the order</Button></Link>}</div> : <p className="text-sm text-ink-400">This project isn’t linked to a sales order, so there is nothing to invoice from here.</p>}
          </Card>
          <Card title={`Invoices (${billing.invoices.length})`}>
            {billing.invoices.length ? <table className="w-full text-sm"><thead><tr className="text-left text-xs font-semibold uppercase text-ink-400"><th className="pb-2">Invoice</th><th className="pb-2">Status</th><th className="pb-2">Due</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Paid</th></tr></thead><tbody>{billing.invoices.map((i) => <tr key={i.id} className="border-t border-ink-50 dark:border-ink-800/60"><td className="py-2.5"><Link to={`/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{i.number}</Link></td><td><StatusBadge status={i.status} /></td><td className="text-ink-500">{formatDate(i.dueDate)}</td><td className="text-right">{formatCurrency(i.amount)}</td><td className="text-right">{formatCurrency(i.paidAmount || 0)}</td></tr>)}</tbody></table> : <p className="text-sm text-ink-400">No invoices yet.</p>}
          </Card>
          <Card title={`Payments (${billing.payments.length})`}>
            {billing.payments.length ? <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{billing.payments.map((p) => <li key={p.id}><Link to={`/invoices/${p.invoiceId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="flex items-center gap-2"><Wallet size={14} className="text-emerald-500" />{p.reference} · {p.invoiceNumber}<span className="text-xs text-ink-400">{p.method}</span></span><span className="flex items-center gap-3"><span className="text-xs text-ink-400">{formatDate(p.date)}</span><b>{formatCurrency(p.amount)}</b></span></Link></li>)}</ul> : <p className="text-sm text-ink-400">No payments recorded yet.</p>}
          </Card>
        </div>
      )}

      {tab === 'expenses' && <ExpensesPanel relatedType="Project" relatedId={project.id} budget={Number(project.budget) || 0} revenue={billing ? { label: 'Invoiced', value: billing.invoiced } : null} />}

      {tab === 'calendar' && (
        <Card title="Project calendar" action={<Link to={`/calendar?relatedType=Project&relatedId=${project.id}`}><Button size="sm" variant="secondary" icon={ExternalLink}>Open in Calendar</Button></Link>}>
          <p className="mb-3 text-xs text-ink-400">Task due dates, milestones, client meetings, reminders and the project deadline — read live from the Calendar, so a date changed on a task or meeting changes here too.</p>
          <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
            <li className="flex items-center justify-between py-2.5 text-sm"><span className="flex items-center gap-2"><Flag size={14} className="text-rose-500" />Project deadline</span><span className={clsx('text-xs', isOverdueProject(project) ? 'font-semibold text-rose-600' : 'text-ink-500')}>{formatDate(project.deadline)}</span></li>
            {[...events].filter((e) => e.kind !== 'deadline' || e.type !== 'Project deadline').sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)).map((e) => (
              <li key={e.id}><Link to={e.href || '#'} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="flex min-w-0 items-center gap-2"><CalendarDays size={14} className="shrink-0 text-brand-500" /><span className="truncate">{e.title}</span><Badge>{e.kind}</Badge></span><span className={clsx('shrink-0 text-xs', e.state === 'overdue' ? 'font-semibold text-rose-600' : 'text-ink-500')}>{formatDate(e.date)}{e.time ? ` · ${e.time}` : ''}</span></Link></li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'activities' && (
        <div className="space-y-4">
          {perms.edit && <div className="flex gap-2"><Button icon={CalendarPlus} onClick={() => setLogOpen('Meeting')}>Client meeting</Button><Button variant="secondary" icon={Phone} onClick={() => setLogOpen('Call')}>Log communication</Button></div>}
          {!mine.length ? <EmptyState icon={MessageSquare} title="No activity yet" description="Meetings, calls, emails and task completions on this project appear here." /> : (
            <ul className="divide-y divide-ink-50 rounded-2xl border border-ink-100 bg-white shadow-card dark:divide-ink-800/60 dark:border-ink-800 dark:bg-ink-900">
              {[...mine].sort((a, b) => new Date(b.meetingDate ? `${b.meetingDate}T${b.meetingStartTime || '00:00'}` : b.date) - new Date(a.meetingDate ? `${a.meetingDate}T${a.meetingStartTime || '00:00'}` : a.date)).map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3"><span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', ACTIVITY_TONE[a.type] || 'bg-ink-100 text-ink-600')}><Briefcase size={14} /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink-900 dark:text-ink-50">{a.subject}</p>{a.notes && <p className="text-xs text-ink-500">{a.notes}</p>}<p className="mt-0.5 text-xs text-ink-400">{a.type}{a.meetingDate ? ` · ${formatDate(a.meetingDate)} ${a.meetingStartTime || ''}` : ''} · {getUserById(a.by)?.name || '—'} · {timeAgo(a.date)}{a.meetingStatus ? ` · ${a.meetingStatus}` : ''}</p></div>
                  {a.meetingLink && a.meetingStatus === 'Scheduled' && <Link to={a.meetingLink}><Button size="sm" variant="secondary">Join</Button></Link>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'timeline' && (
        <Card title="Project timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => (
              <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', ACTIVITY_TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span>
                <div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{getUserById(e.by)?.name || (e.by === 'SYSTEM' ? 'Automation' : '—')} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ProjectFormDialog open={edit} onClose={() => setEdit(false)} project={project} data={data} onSaved={() => reload()} />
      <ProjectStatusDialog project={statusTo ? project : null} to={statusTo} openTasks={stats.open} onClose={() => setStatusTo(null)} onDone={() => { reload(); loadExtra() }} />
      <ProjectActivityDialog open={!!logOpen} presetType={logOpen || 'Meeting'} onClose={() => setLogOpen(null)} project={project} userId={user.id} onSaved={() => { reload(); loadExtra() }} />
      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} onConfirm={remove} title={`Delete ${project.id}?`} description="Only a project with no tasks, invoices or documents can be deleted — otherwise cancel it so its history is kept." confirmLabel="Delete project" />
    </div>
  )
}
