import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { MoreHorizontal, Circle, CheckCircle2, ChevronLeft, ChevronRight, Phone, Mail, MessageCircle, CalendarClock, StickyNote, Eye, Pencil, Play, PauseCircle, UserPlus, GitBranch, Copy, XCircle, Trash2, RotateCcw, CalendarPlus, ListPlus, AlertTriangle, Users } from 'lucide-react'
import { DataTable } from '../../components/common/DataTable'
import { EmptyState } from '../../components/common/EmptyState'
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '../../components/common/Dropdown'
import { Avatar } from '../../components/common/Avatar'
import { PriorityMark, TaskStatus, DueLabel, AssigneeStack, RelatedLink, TaskFlags, ProgressBar, priorityBar } from './TaskBits'
import { TASK_TRANSITIONS } from '../../utils/taskRules'
import { formatDate } from '../../utils/format'

/** The ⋯ menu — only offers what the server will allow for this user on this task. */
export function TaskMenu({ task, run, canLog }) {
  const c = task._can || {}
  const loggable = !!canLog(task)
  const Item = ({ icon, children, ...p }) => <DropdownItem icon={icon} {...p}>{children}</DropdownItem>
  return (
    <Dropdown width="w-56" trigger={<button type="button" aria-label={`Actions for ${task.id}`} onClick={(e) => e.stopPropagation()} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200"><MoreHorizontal size={17} /></button>}>
      <div onClick={(e) => e.stopPropagation()}>
        <Item icon={Eye} onClick={() => run('open', task)}>Open task</Item>
        {c.edit && <Item icon={Pencil} onClick={() => run('edit', task)}>Edit</Item>}
        {c.complete && <Item icon={CheckCircle2} onClick={() => run('complete', task)}>Mark complete</Item>}
        {c.reopen && <Item icon={RotateCcw} onClick={() => run('reopen', task)}>Reopen</Item>}
        {c.status && task.status !== 'In Progress' && <Item icon={Play} onClick={() => run('status', task, 'In Progress')}>Start working</Item>}
        {c.status && task.status !== 'Waiting / On Hold' && <Item icon={PauseCircle} onClick={() => run('status', task, 'Waiting / On Hold')}>Put on hold</Item>}
        {c.changeDueDate && <Item icon={CalendarClock} onClick={() => run('reschedule', task)}>Reschedule</Item>}
        {(c.reassign || c.assign) && <Item icon={UserPlus} onClick={() => run('reassign', task)}>{task.assignees?.length ? 'Reassign' : 'Assign'}</Item>}
        {c.edit && !task.parentId && <Item icon={GitBranch} onClick={() => run('subtask', task)}>Add subtask</Item>}
        {(loggable || c.duplicate) && <DropdownDivider />}
        {loggable && <><DropdownLabel>Log on the record</DropdownLabel>
          <Item icon={Phone} onClick={() => run('log', task, 'Call')}>Call</Item>
          <Item icon={Mail} onClick={() => run('log', task, 'Email')}>Email</Item>
          <Item icon={MessageCircle} onClick={() => run('log', task, 'WhatsApp')}>WhatsApp</Item>
          <Item icon={CalendarPlus} onClick={() => run('log', task, 'Meeting')}>Meeting</Item>
          <Item icon={StickyNote} onClick={() => run('log', task, 'Note')}>Note</Item></>}
        {c.duplicate && task.relatedId && <Item icon={ListPlus} onClick={() => run('followup', task)}>Create follow-up</Item>}
        {c.duplicate && <Item icon={Copy} onClick={() => run('duplicate', task)}>Duplicate</Item>}
        {(c.cancel || c.delete) && <DropdownDivider />}
        {c.cancel && <Item icon={XCircle} danger onClick={() => run('cancel', task)}>Cancel task</Item>}
        {c.delete && <Item icon={Trash2} danger onClick={() => run('delete', task)}>Delete</Item>}
      </div>
    </Dropdown>
  )
}

/** Inline status change right in the row. */
export function StatusSelect({ task, run }) {
  const c = task._can || {}
  const options = (TASK_TRANSITIONS[task.status] || []).filter((s) => (s === 'Completed' ? c.complete : s === 'Reopened' ? c.reopen : s === 'Cancelled' ? c.cancel : c.status))
  if (!options.length) return <TaskStatus status={task.status} />
  const pick = (s) => { if (s === 'Completed') run('complete', task); else if (s === 'Reopened') run('reopen', task); else if (s === 'Cancelled') run('cancel', task); else run('status', task, s) }
  return (
    <Dropdown align="left" width="w-48" trigger={<button type="button" aria-label={`Change status of ${task.id}`} onClick={(e) => e.stopPropagation()} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><TaskStatus status={task.status} className="cursor-pointer hover:brightness-95" /></button>}>
      <div onClick={(e) => e.stopPropagation()}>{options.map((s) => <DropdownItem key={s} onClick={() => pick(s)}>{s === 'Reopened' ? 'Reopen…' : s === 'Cancelled' ? 'Cancel…' : s}</DropdownItem>)}</div>
    </Dropdown>
  )
}

function CheckBox({ task, run }) {
  const can = task._can?.complete
  const done = task.status === 'Completed'
  return (
    <button type="button" aria-label={done ? `${task.id} is completed` : `Complete ${task.id}`} disabled={!can} onClick={(e) => { e.stopPropagation(); run('complete', task) }} title={can ? 'Mark complete' : done ? 'Completed' : 'You can’t complete this task'}
      className={clsx('shrink-0 rounded-full transition-colors', done ? 'text-emerald-500' : can ? 'text-ink-300 hover:text-emerald-500' : 'text-ink-200 dark:text-ink-700')}>
      {done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
    </button>
  )
}

export function ListView({ tasks, loading, run, canLog, page, setPage, pageSize = 20 }) {
  const navigate = useNavigate()
  const columns = [
    { key: 'done', header: '', className: 'w-10 !pr-0', render: (t) => <CheckBox task={t} run={run} /> },
    {
      key: 'title', header: 'Task', render: (t) => (
        <div className="relative max-w-sm pl-3">
          <span className={clsx('absolute inset-y-0.5 left-0 w-1 rounded-full', priorityBar(t.priority))} />
          <div className="flex items-center gap-2"><span className="font-mono text-[11px] text-ink-400">{t.id}</span><TaskFlags task={t} /></div>
          <p className={clsx('truncate text-sm font-medium', t.status === 'Completed' || t.status === 'Cancelled' ? 'text-ink-400 line-through' : 'text-ink-800 dark:text-ink-100')}>{t.title}</p>
          {t.subtaskCount > 0 && <ProgressBar done={t.subtasksDone} total={t.subtaskCount} className="mt-1 max-w-[10rem]" />}
        </div>
      ),
    },
    { key: 'related', header: 'Related to', render: (t) => <div className="max-w-[14rem] truncate"><RelatedLink type={t.relatedType} id={t.relatedId} name={t.relatedName} /></div> },
    { key: 'assignees', header: 'Assigned to', render: (t) => <AssigneeStack ids={t.assignees} /> },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityMark priority={t.priority} /> },
    { key: 'due', header: 'Due', render: (t) => <DueLabel task={t} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusSelect task={t} run={run} /> },
    { key: 'actions', header: '', className: 'w-10', render: (t) => <TaskMenu task={t} run={run} canLog={canLog} /> },
  ]
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize))
  const slice = tasks.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize)
  return (
    <DataTable columns={columns} data={slice} loading={loading} onRowClick={(t) => navigate(`/tasks/${t.id}`)} page={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} total={tasks.length} pageSize={pageSize}
      emptyTitle="No tasks match" emptyDescription="Change the view or clear the filters — or create a task." />
  )
}

const KANBAN_COLUMNS = [
  { status: 'To Do', hint: 'Not started', dot: 'bg-ink-400' },
  { status: 'In Progress', hint: 'Being worked on', dot: 'bg-brand-500' },
  { status: 'Waiting / On Hold', hint: 'Blocked or waiting', dot: 'bg-amber-500' },
  { status: 'Completed', hint: 'Done', dot: 'bg-emerald-500' },
]
const columnOf = (t) => (t.status === 'Reopened' ? 'To Do' : t.status)

export function KanbanView({ tasks, run, toast }) {
  const navigate = useNavigate()
  const [over, setOver] = useState(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const cancelled = tasks.filter((t) => t.status === 'Cancelled')
  const drop = (status, e) => {
    e.preventDefault(); setOver(null)
    const id = e.dataTransfer.getData('text/task')
    const t = tasks.find((x) => x.id === id)
    if (!t || columnOf(t) === status) return
    const c = t._can || {}
    if (t.status === 'Completed' || t.status === 'Cancelled') { if (c.reopen) run('reopen', t); else toast('You can’t reopen this task.', { type: 'error' }); return }
    if (status === 'Completed') { if (c.complete) run('complete', t); else toast('You can’t complete this task.', { type: 'error' }); return }
    if (!c.status) { toast('You can’t change this task’s status.', { type: 'error' }); return }
    run('status', t, status)
  }
  return (
    <div>
      <div className="scrollbar-thin grid auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-3">
        {KANBAN_COLUMNS.map((col) => {
          const items = tasks.filter((t) => columnOf(t) === col.status)
          return (
            <section key={col.status} aria-label={col.status} onDragOver={(e) => { e.preventDefault(); setOver(col.status) }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(col.status, e)}
              className={clsx('flex min-h-[18rem] flex-col rounded-2xl border bg-ink-50/60 p-3 transition-colors dark:bg-ink-900/40', over === col.status ? 'border-brand-400 bg-brand-50/50 dark:border-brand-600' : 'border-ink-100 dark:border-ink-800')}>
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={clsx('h-2 w-2 rounded-full', col.dot)} />
                <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{col.status}</h3>
                <span className="rounded-full bg-white px-1.5 text-xs font-medium text-ink-500 dark:bg-ink-800">{items.length}</span>
              </header>
              <div className="scrollbar-thin flex flex-1 flex-col gap-2.5 overflow-y-auto">
                {items.map((t) => <KanbanCard key={t.id} t={t} navigate={navigate} />)}
                {!items.length && <p className="px-2 py-6 text-center text-xs text-ink-400">{col.hint} — drop a task here</p>}
              </div>
            </section>
          )
        })}
      </div>
      {cancelled.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowCancelled((s) => !s)} className="text-xs font-medium text-ink-500 hover:text-ink-700">{showCancelled ? 'Hide' : 'Show'} {cancelled.length} cancelled</button>
          {showCancelled && <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">{cancelled.map((t) => <KanbanCard key={t.id} t={t} navigate={navigate} />)}</div>}
        </div>
      )}
    </div>
  )
}

function KanbanCard({ t, navigate }) {
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} onClick={() => navigate(`/tasks/${t.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/tasks/${t.id}`)}
      className="group cursor-pointer rounded-xl border border-ink-100 bg-white p-3 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-800 dark:bg-ink-900">
      <div className={clsx('mb-2 h-1 w-10 rounded-full', priorityBar(t.priority))} />
      <div className="flex items-center justify-between gap-2"><span className="font-mono text-[11px] text-ink-400">{t.id}</span><TaskFlags task={t} /></div>
      <p className={clsx('mt-1 line-clamp-2 text-sm font-medium', t.status === 'Cancelled' ? 'text-ink-400 line-through' : 'text-ink-800 dark:text-ink-100')}>{t.title}</p>
      {t.relatedName && <div className="mt-1 truncate"><RelatedLink type={t.relatedType} id={t.relatedId} name={t.relatedName} /></div>}
      {t.subtaskCount > 0 && <ProgressBar done={t.subtasksDone} total={t.subtaskCount} className="mt-2" />}
      <div className="mt-3 flex items-center justify-between gap-2"><DueLabel task={t} /><AssigneeStack ids={t.assignees} max={2} /></div>
      {t.status === 'Reopened' && <p className="mt-2 text-[11px] font-medium text-brand-600">Reopened</p>}
    </article>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function CalendarView({ tasks }) {
  const navigate = useNavigate()
  const now = new Date()
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selected, setSelected] = useState(ymd(now))
  const byDay = useMemo(() => {
    const m = {}
    tasks.filter((t) => t.dueDate).forEach((t) => { (m[t.dueDate] = m[t.dueDate] || []).push(t) })
    Object.values(m).forEach((l) => l.sort((a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99')))
    return m
  }, [tasks])
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), 1 - lead + i))
  const move = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))
  const todayKey = ymd(now)
  const dayTasks = byDay[selected] || []
  const noDate = tasks.filter((t) => !t.dueDate).length
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{cursor.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h3>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(todayKey) }} className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">Today</button>
            <button type="button" aria-label="Next month" onClick={() => move(1)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><ChevronRight size={16} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-ink-100 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-400 dark:border-ink-800">{WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = ymd(d)
            const items = byDay[key] || []
            const inMonth = d.getMonth() === cursor.getMonth()
            const overdue = items.some((t) => t.overdue)
            return (
              <button key={key} type="button" onClick={() => setSelected(key)} aria-label={`${key}, ${items.length} tasks`}
                className={clsx('min-h-[5.2rem] border-b border-r border-ink-50 p-1.5 text-left align-top transition-colors hover:bg-ink-50 dark:border-ink-800/60 dark:hover:bg-ink-800/40', !inMonth && 'bg-ink-50/40 dark:bg-ink-950/30', selected === key && 'bg-brand-50/60 ring-1 ring-inset ring-brand-400 dark:bg-brand-900/20')}>
                <span className={clsx('inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', key === todayKey ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-ink-700 dark:text-ink-200' : 'text-ink-300 dark:text-ink-600')}>{d.getDate()}</span>
                <div className="mt-0.5 space-y-0.5">
                  {items.slice(0, 2).map((t) => <div key={t.id} className={clsx('truncate rounded px-1 py-0.5 text-[10px] font-medium', t.overdue ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : t.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 line-through dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300')}>{t.dueTime ? `${t.dueTime} ` : ''}{t.title}</div>)}
                  {items.length > 2 && <div className={clsx('px-1 text-[10px] font-medium', overdue ? 'text-rose-500' : 'text-ink-400')}>+{items.length - 2} more</div>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <aside className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{formatDate(selected)}</h3>
        <p className="text-xs text-ink-400">{dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''}{noDate ? ` · ${noDate} without a due date aren’t shown` : ''}</p>
        <ul className="mt-3 space-y-2">
          {dayTasks.map((t) => (
            <li key={t.id}><button type="button" onClick={() => navigate(`/tasks/${t.id}`)} className="block w-full rounded-xl border border-ink-100 p-2.5 text-left hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-[11px] text-ink-400">{t.id}</span><TaskStatus status={t.status} /></div>
              <p className="mt-1 text-sm font-medium text-ink-800 dark:text-ink-100">{t.title}</p>
              <div className="mt-1.5 flex items-center justify-between"><DueLabel task={t} /><PriorityMark priority={t.priority} label={false} /></div>
            </button></li>
          ))}
          {!dayTasks.length && <li className="py-8 text-center text-xs text-ink-400">Nothing due this day.</li>}
        </ul>
      </aside>
    </div>
  )
}

export function TeamView({ summary, onPick, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />
  const team = summary?.team || []
  if (!team.length) return <EmptyState icon={Users} title="No team workload to show" description="Tasks assigned to people in your scope will be summarised here." />
  const scope = { organization: 'everyone in the organisation', team: 'your team and department', own: 'you' }[summary.scope]
  return (
    <div>
      <p className="mb-3 text-sm text-ink-500 dark:text-ink-400">Open work for {scope}. You only see tasks your role is allowed to view.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {team.map((m) => (
          <button key={m.userId} type="button" onClick={() => onPick(m.userId)} className="rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center gap-3"><Avatar name={m.name} size="md" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{m.name}</p><p className="truncate text-xs text-ink-400">{m.role} · {m.department}</p></div></div>
            <p className="mt-3 text-sm text-ink-700 dark:text-ink-200"><span className="font-semibold">{m.pending}</span> pending{m.inProgress ? <> · <span className="font-semibold text-brand-600">{m.inProgress}</span> in progress</> : null} · <span className={clsx('font-semibold', m.overdue ? 'text-rose-600' : 'text-ink-500')}>{m.overdue} overdue</span></p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800" aria-hidden="true">
              {m.open + m.completed > 0 && <><span className="bg-rose-500" style={{ width: `${(m.overdue / (m.open + m.completed)) * 100}%` }} /><span className="bg-brand-500" style={{ width: `${((m.open - m.overdue) / (m.open + m.completed)) * 100}%` }} /><span className="bg-emerald-500" style={{ width: `${(m.completed / (m.open + m.completed)) * 100}%` }} /></>}
            </div>
            <p className="mt-1.5 flex gap-3 text-[11px] text-ink-400"><span>{m.dueToday} due today</span><span>{m.completed} completed</span>{m.overdue > 0 && <span className="inline-flex items-center gap-0.5 text-rose-500"><AlertTriangle size={11} /> needs attention</span>}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
