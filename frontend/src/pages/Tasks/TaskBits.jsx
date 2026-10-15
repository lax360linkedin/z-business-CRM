import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Flag, AlertTriangle, Repeat, GitBranch, Paperclip, Bell, Lock } from 'lucide-react'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { formatDate } from '../../utils/format'
import { taskRelatedHref } from '../../utils/taskLinks'
import { todayStr, isOpenTask } from '../../utils/taskRules'
import { getUserById } from '../../data/users'

const PRIORITY = {
  Urgent: { cls: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500', bar: 'bg-rose-500' },
  High: { cls: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500', bar: 'bg-amber-400' },
  Medium: { cls: 'text-sky-600 dark:text-sky-400', dot: 'bg-sky-500', bar: 'bg-sky-400' },
  Low: { cls: 'text-ink-500 dark:text-ink-400', dot: 'bg-ink-300', bar: 'bg-ink-300' },
}
export const priorityBar = (p) => PRIORITY[p]?.bar || 'bg-ink-300'

/** Quiet priority marker: a flag only for High/Urgent, a dot otherwise — keeps rows uncluttered. */
export function PriorityMark({ priority, label = true, className }) {
  const s = PRIORITY[priority] || PRIORITY.Medium
  const flag = priority === 'Urgent' || priority === 'High'
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', s.cls, className)} title={`${priority} priority`}>
      {flag ? <Flag size={13} className="fill-current" /> : <span className={clsx('h-2 w-2 rounded-full', s.dot)} />}
      {label && priority}
    </span>
  )
}

export const TaskStatus = ({ status, className }) => <StatusBadge status={status} className={className} />

export function dueInfo(t) {
  if (!t.dueDate) return { text: 'No due date', tone: 'muted' }
  const today = todayStr()
  const tm = new Date(); tm.setDate(tm.getDate() + 1)
  const tomorrow = tm.toISOString().slice(0, 10)
  const time = t.dueTime ? ` · ${t.dueTime}` : ''
  if (!isOpenTask(t)) return { text: `${formatDate(t.dueDate)}${time}`, tone: 'muted' }
  if (t.overdue) return { text: t.overdueLabel || 'Overdue', sub: `${formatDate(t.dueDate)}${time}`, tone: 'danger' }
  if (t.dueDate === today) return { text: `Today${time}`, tone: 'warning' }
  if (t.dueDate === tomorrow) return { text: `Tomorrow${time}`, tone: 'normal' }
  return { text: `${formatDate(t.dueDate)}${time}`, tone: 'normal' }
}

export function DueLabel({ task, className }) {
  const d = dueInfo(task)
  const tone = d.tone === 'danger' ? 'font-semibold text-rose-600 dark:text-rose-400' : d.tone === 'warning' ? 'font-medium text-amber-600 dark:text-amber-400' : d.tone === 'muted' ? 'text-ink-400' : 'text-ink-600 dark:text-ink-300'
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap text-xs', tone, className)} title={d.sub}>
      {d.tone === 'danger' && <AlertTriangle size={12} />}
      {d.text}
    </span>
  )
}

export function UserChip({ id, name, size = 'xs', className }) {
  const n = name || getUserById(id)?.name || (id === 'SYSTEM' ? 'Automation' : id)
  if (!n) return <span className="text-xs text-ink-400">Unassigned</span>
  return <span className={clsx('inline-flex items-center gap-1.5 text-xs text-ink-700 dark:text-ink-200', className)}><Avatar name={n} size={size} />{n}</span>
}

export function AssigneeStack({ ids = [], max = 3 }) {
  if (!ids.length) return <span className="text-xs italic text-ink-400">Unassigned</span>
  const names = ids.map((i) => getUserById(i)?.name || i)
  return (
    <span className="inline-flex items-center" title={names.join(', ')}>
      <span className="flex -space-x-1.5">{names.slice(0, max).map((n) => <Avatar key={n} name={n} size="xs" ringed />)}</span>
      <span className="ml-2 max-w-[8rem] truncate text-xs text-ink-700 dark:text-ink-200">{names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`}</span>
    </span>
  )
}

export function RelatedLink({ type, id, name, className }) {
  if (!type || !id) return <span className="text-xs text-ink-400">—</span>
  const href = taskRelatedHref(type, id)
  const body = <><span className="text-ink-400">{type}</span> <span className="font-medium">{name}</span></>
  return href
    ? <Link to={href} onClick={(e) => e.stopPropagation()} className={clsx('text-xs text-brand-700 hover:underline dark:text-brand-300', className)}>{body}</Link>
    : <span className={clsx('text-xs', className)}>{body}</span>
}

/** Tiny flags (subtasks, recurring, attachments, reminder, private) shown beside a title. */
export function TaskFlags({ task }) {
  const bits = []
  if (task.subtaskCount) bits.push([GitBranch, `${task.subtasksDone}/${task.subtaskCount}`, 'Subtasks'])
  if (task.recurrence?.frequency && task.recurrence.frequency !== 'none') bits.push([Repeat, null, `Repeats ${task.recurrence.frequency}`])
  if (task.attachments?.length) bits.push([Paperclip, task.attachments.length, 'Attachments'])
  if (task.reminderAt && !task.remindedAt && isOpenTask(task)) bits.push([Bell, null, 'Reminder set'])
  if (task.visibility === 'Private') bits.push([Lock, null, 'Private'])
  if (!bits.length) return null
  return (
    <span className="inline-flex items-center gap-2 text-ink-400">
      {bits.map(([Icon, n, title]) => <span key={title} title={title} className="inline-flex items-center gap-0.5 text-[11px]"><Icon size={12} />{n}</span>)}
    </span>
  )
}

export function ProgressBar({ done, total, className }) {
  if (!total) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
      <span className="text-[11px] font-medium text-ink-500">{done}/{total}</span>
    </div>
  )
}
