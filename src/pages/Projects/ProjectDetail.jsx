import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Building2, Plus, FolderKanban, ListChecks, FileText as FileTextIcon, Wallet, MessageSquare } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Tabs } from '../../components/common/Tabs'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { Select } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { ChartCard } from '../../components/charts/ChartCard'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { getUserById, USERS } from '../../data/users'
import { getCustomerById } from '../../data/customers'
import { DOCUMENTS } from '../../data/documents'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'

const MILESTONE_STATUSES = ['Pending', 'In Progress', 'Completed']

function timeTrackingData(seed) {
  // Deterministic pseudo-random hours per week — illustrative presentational data only, not wired to a real timer.
  let s = Math.max(1, seed)
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  return Array.from({ length: 8 }).map((_, i) => ({ week: `Week ${i + 1}`, hours: Math.round(10 + rand() * 30) }))
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [tasks, setTasks] = useState([])
  const [expenses, setExpenses] = useState([])
  const [activities, setActivities] = useState([])
  const [newMember, setNewMember] = useState('')
  const [savingTeam, setSavingTeam] = useState(false)

  const loadProject = () => {
    setLoading(true)
    api.get(`/projects/${id}`)
      .then((res) => setProject(res.data))
      .catch(() => setProject(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProject() }, [id])

  useEffect(() => {
    if (!project) return
    api.get('/tasks', { params: { all: true } }).then((res) =>
      setTasks(res.data.filter((t) => t.relatedType === 'Project' && t.relatedId === project.id)))
    api.get('/expenses', { params: { all: true } }).then((res) =>
      setExpenses(res.data.filter((e) => e.projectId === project.id)))
    api.get('/activities', { params: { all: true } }).then((res) =>
      setActivities(res.data.filter((a) => a.relatedId === project.customerId).sort((a, b) => new Date(b.date) - new Date(a.date))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const timeData = useMemo(() => timeTrackingData(project ? project.id.length * 37 : 42), [project?.id])

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }

  if (!project) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="Project not found"
        description="This project may have been deleted, or the link you followed is incorrect."
        action={<Button onClick={() => navigate('/projects')}>Back to Projects</Button>}
      />
    )
  }

  const manager = getUserById(project.manager)
  const customer = getCustomerById(project.customerId)
  const projectDocuments = DOCUMENTS.filter((d) => d.relatedCustomerId === project.customerId)
  const availableUsers = USERS.filter((u) => !project.team.includes(u.id))

  const updateMilestoneStatus = (idx, status) => {
    const milestones = project.milestones.map((m, i) => (i === idx ? { ...m, status } : m))
    api.put(`/projects/${project.id}`, { milestones }).then(() => {
      toast('Milestone updated.', { type: 'success' })
      loadProject()
    })
  }

  const addTeamMember = () => {
    if (!newMember || project.team.includes(newMember)) return
    setSavingTeam(true)
    api.put(`/projects/${project.id}`, { team: [...project.team, newMember] }).then(() => {
      setSavingTeam(false)
      setNewMember('')
      toast('Team member added.', { type: 'success' })
      loadProject()
    })
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'milestones', label: 'Milestones', count: project.milestones.length },
    { value: 'tasks', label: 'Tasks', count: tasks.length },
    { value: 'team', label: 'Team', count: project.team.length },
    { value: 'time', label: 'Time Tracking' },
    { value: 'documents', label: 'Documents', count: projectDocuments.length },
    { value: 'expenses', label: 'Expenses', count: expenses.length },
    { value: 'communication', label: 'Communication' },
    { value: 'activity', label: 'Activity' },
  ]

  return (
    <div>
      <PageHeader
        breadcrumb={<Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />}
        title={project.name}
        description={`${project.id} · for ${customer?.name || project.customerName}`}
      />

      <div className="mb-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              <Building2 size={19} />
            </span>
            <div>
              <p className="text-xs text-ink-400">Client</p>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{customer?.name || project.customerName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={manager?.name || 'Unassigned'} size="md" />
            <div>
              <p className="text-xs text-ink-400">Project Manager</p>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{manager?.name || 'Unassigned'}</p>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-400">Status</p>
            <StatusBadge status={project.status} />
          </div>
          <div>
            <p className="text-xs text-ink-400">Timeline</p>
            <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{formatDate(project.startDate)} — {formatDate(project.deadline)}</p>
          </div>
          <div>
            <p className="text-xs text-ink-400">Budget</p>
            <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{formatCurrency(project.budget)}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${project.progress}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium text-ink-500 dark:text-ink-400">{project.progress}% complete</span>
        </div>
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} className="mb-5" />

      {activeTab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card md:col-span-2 dark:border-ink-800 dark:bg-ink-900">
            <h3 className="mb-2 text-sm font-semibold text-ink-900 dark:text-ink-50">Project Summary</h3>
            <p className="text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              {project.name} is being delivered for {customer?.name || project.customerName}, managed by {manager?.name || 'an unassigned manager'}.
              The engagement started on {formatDate(project.startDate)} with a target completion of {formatDate(project.deadline)}
              {isOverdue(project.deadline) && project.status !== 'Completed'
                ? ', which has now passed — this project may need attention.'
                : '.'}
              {' '}It is currently {project.progress}% complete across {project.team.length} team member{project.team.length === 1 ? '' : 's'}.
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <p className="text-xs text-ink-400">Milestones Completed</p>
              <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{project.milestones.filter((m) => m.status === 'Completed').length} / {project.milestones.length}</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <p className="text-xs text-ink-400">Team Size</p>
              <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{project.team.length} members</p>
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <p className="text-xs text-ink-400">Total Expenses Logged</p>
              <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{formatCurrency(expenses.reduce((s, e) => s + e.amount, 0))}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        project.milestones.length === 0 ? (
          <EmptyState icon={ListChecks} title="No milestones yet" description="This project doesn't have any milestones defined." />
        ) : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <ol className="space-y-0">
              {project.milestones.map((m, idx) => (
                <li key={idx} className="relative flex gap-3 pb-6 last:pb-0">
                  {idx !== project.milestones.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-ink-100 dark:bg-ink-800" />}
                  <span className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    m.status === 'Completed' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                      : m.status === 'In Progress' ? 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400'
                        : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'
                  }`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{m.name}</p>
                        <p className={`text-xs ${isOverdue(m.dueDate) && m.status !== 'Completed' ? 'font-medium text-rose-500' : 'text-ink-400'}`}>Due {formatDate(m.dueDate)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={m.status} />
                        <Select value={m.status} onChange={(e) => updateMilestoneStatus(idx, e.target.value)} className="h-8 w-36 text-xs">
                          {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )
      )}

      {activeTab === 'tasks' && (
        tasks.length === 0 ? (
          <EmptyState icon={ListChecks} title="No tasks linked" description="No tasks have been created for this project yet." />
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div>
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{t.title}</p>
                  <p className="text-xs text-ink-400">Assigned to {getUserById(t.assignedTo)?.name || '—'} · Due {formatDate(t.dueDate)}</p>
                </div>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'team' && (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          {project.team.length === 0 ? (
            <EmptyState title="No team members yet" description="Add members to staff this project." />
          ) : (
            <div className="flex flex-wrap gap-3">
              {project.team.map((uid) => {
                const u = getUserById(uid)
                if (!u) return null
                return (
                  <div key={uid} className="flex items-center gap-2.5 rounded-xl border border-ink-100 px-3 py-2 dark:border-ink-800">
                    <Avatar name={u.name} size="sm" />
                    <div>
                      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{u.name}</p>
                      <p className="text-xs text-ink-400">{u.designation}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
            <Select value={newMember} onChange={(e) => setNewMember(e.target.value)} className="h-9 w-56 text-sm">
              <option value="">Select a team member…</option>
              {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Button size="sm" icon={Plus} onClick={addTeamMember} loading={savingTeam} disabled={!newMember}>Add Member</Button>
          </div>
        </div>
      )}

      {activeTab === 'time' && (
        <ChartCard title="Time Tracking" subtitle="Illustrative hours logged per week — demo data, not connected to a live timer">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={timeData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip formatter={(v) => `${v} hrs`} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="hours" fill="#6366f1" radius={[6, 6, 0, 0]} name="Hours Logged" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {activeTab === 'documents' && (
        projectDocuments.length === 0 ? (
          <EmptyState icon={FileTextIcon} title="No documents linked" description="No documents have been uploaded for this client yet." />
        ) : (
          <div className="space-y-2">
            {projectDocuments.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div>
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{d.name}</p>
                  <p className="text-xs text-ink-400">{d.category} · Uploaded {formatDate(d.uploadedDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'expenses' && (
        expenses.length === 0 ? (
          <EmptyState icon={Wallet} title="No expenses recorded" description="No expenses have been logged against this project yet." />
        ) : (
          <div className="space-y-2">
            {expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div>
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{e.title}</p>
                  <p className="text-xs text-ink-400">{e.category} · {formatDate(e.date)} · {getUserById(e.employee)?.name || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{formatCurrency(e.amount)}</p>
                  <StatusBadge status={e.status} />
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'communication' && (
        activities.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No communication history" description="No calls, emails, or messages have been logged with this client yet." />
        ) : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <ActivityTimeline items={activities} />
          </div>
        )
      )}

      {activeTab === 'activity' && (
        activities.length === 0 ? (
          <EmptyState title="No activity recorded" description="Activity for this project's client will appear here." />
        ) : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <ActivityTimeline items={activities} />
          </div>
        )
      )}
    </div>
  )
}
