import { useMemo, useState } from 'react'
import { UsersRound, Handshake, FolderKanban, LifeBuoy, Users2, Mail, Phone } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Avatar } from '../../components/common/Avatar'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { Drawer } from '../../components/common/Drawer'
import { USERS } from '../../data/users'
import { DEALS } from '../../data/deals'
import { PROJECTS } from '../../data/projects'
import { TICKETS } from '../../data/tickets'
import { formatCurrency } from '../../utils/format'

const DEPT_TONES = { Sales: 'success', Marketing: 'warning', Projects: 'info', Finance: 'neutral', Support: 'danger', Management: 'info', HR: 'warning' }

function pickManager(members) {
  const priorityWords = ['chief', 'head', 'senior', 'manager', 'lead']
  for (const word of priorityWords) {
    const found = members.find((m) => m.designation.toLowerCase().includes(word))
    if (found) return found
  }
  return members[0]
}

function metricFor(department, memberIds) {
  if (department === 'Sales') {
    const won = DEALS.filter((d) => d.stage === 'Closed Won' && memberIds.includes(d.salesperson))
    return { icon: Handshake, label: 'Revenue Won', value: formatCurrency(won.reduce((s, d) => s + d.value, 0), { compact: true }), sub: `${won.length} deal(s) closed` }
  }
  if (department === 'Projects') {
    const active = PROJECTS.filter((p) => p.status === 'In Progress' && memberIds.includes(p.manager))
    return { icon: FolderKanban, label: 'Active Projects', value: active.length, sub: `${PROJECTS.filter((p) => memberIds.includes(p.manager)).length} project(s) total` }
  }
  if (department === 'Support') {
    const resolved = TICKETS.filter((t) => t.status === 'Resolved' && memberIds.includes(t.assignedStaff))
    return { icon: LifeBuoy, label: 'Tickets Resolved', value: resolved.length, sub: `${TICKETS.filter((t) => memberIds.includes(t.assignedStaff)).length} ticket(s) handled` }
  }
  return { icon: Users2, label: 'Team Size', value: memberIds.length, sub: 'members on this team' }
}

function buildTeams() {
  const byDept = {}
  USERS.forEach((u) => {
    if (!byDept[u.department]) byDept[u.department] = []
    byDept[u.department].push(u)
  })
  return Object.entries(byDept).map(([department, members]) => {
    const memberIds = members.map((m) => m.id)
    const manager = pickManager(members)
    return {
      id: department,
      name: `${department} Team`,
      department,
      manager,
      members,
      metric: metricFor(department, memberIds),
    }
  })
}

function TeamCard({ team, onView }) {
  const visible = team.members.slice(0, 5)
  const extra = team.members.length - visible.length
  return (
    <div className="flex flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
              <UsersRound size={16} />
            </span>
            <h3 className="text-base font-bold text-ink-900 dark:text-ink-50">{team.name}</h3>
          </div>
          <Badge tone={DEPT_TONES[team.department] || 'neutral'}>{team.department}</Badge>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded-xl bg-ink-50 px-3.5 py-3 dark:bg-ink-800/50">
        <Avatar name={team.manager.name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{team.manager.name}</p>
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">{team.manager.designation}</p>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Members ({team.members.length})</p>
        <div className="flex items-center">
          {visible.map((m, i) => (
            <Avatar key={m.id} name={m.name} size="sm" ringed className={i > 0 ? '-ml-2' : ''} />
          ))}
          {extra > 0 && (
            <span className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-600 ring-2 ring-white dark:bg-ink-700 dark:text-ink-300 dark:ring-ink-900">
              +{extra}
            </span>
          )}
        </div>
      </div>

      <div className="mb-5 flex items-center gap-3 rounded-xl border border-ink-100 px-3.5 py-3 dark:border-ink-800">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
          <team.metric.icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-ink-500 dark:text-ink-400">{team.metric.label}</p>
          <p className="truncate text-sm font-bold text-ink-900 dark:text-ink-50">{team.metric.value}</p>
        </div>
      </div>

      <Button variant="secondary" className="mt-auto" onClick={() => onView(team)}>View Team</Button>
    </div>
  )
}

function TeamDrawer({ team, open, onClose }) {
  if (!team) return null
  return (
    <Drawer open={open} onClose={onClose} title={team.name} subtitle={`${team.members.length} member(s) · Managed by ${team.manager.name}`} size="md">
      <div className="mb-6 flex items-center gap-3 rounded-xl bg-brand-50 px-4 py-3.5 dark:bg-brand-900/20">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-ink-900 dark:text-brand-400">
          <team.metric.icon size={16} />
        </span>
        <div>
          <p className="text-xs text-ink-500 dark:text-ink-400">{team.metric.label}</p>
          <p className="text-base font-bold text-ink-900 dark:text-ink-50">{team.metric.value}</p>
          {team.metric.sub && <p className="text-xs text-ink-400">{team.metric.sub}</p>}
        </div>
      </div>

      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Team Members</p>
      <div className="flex flex-col divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
        {team.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={m.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">
                {m.name} {m.id === team.manager.id && <span className="ml-1 text-xs font-normal text-brand-600 dark:text-brand-400">(Manager)</span>}
              </p>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">{m.designation}</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <p className="flex items-center gap-1 text-xs text-ink-400"><Mail size={11} /> {m.email}</p>
              <p className="flex items-center justify-end gap-1 text-xs text-ink-400"><Phone size={11} /> {m.phone}</p>
            </div>
            <StatusBadge status={m.status} />
          </div>
        ))}
      </div>
    </Drawer>
  )
}

export default function Teams() {
  const teams = useMemo(() => buildTeams(), [])
  const [activeTeam, setActiveTeam] = useState(null)

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Teams are derived from departments — each department forms one working team with a manager, members, and live performance."
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} onView={setActiveTeam} />
        ))}
      </div>

      <TeamDrawer team={activeTeam} open={!!activeTeam} onClose={() => setActiveTeam(null)} />
    </div>
  )
}
