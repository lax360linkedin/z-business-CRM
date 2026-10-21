import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, RotateCcw, Pencil, Phone, Mail, MessageCircle, CalendarPlus, StickyNote, ListPlus, Paperclip, Trash2, Send, Lock, Repeat, Bell, Plus, ShieldAlert, FileQuestion, History, MessageSquare, Link2, GitBranch, Flag, CalendarClock, UserPlus, XCircle, Copy, Zap, AtSign, Clock, FileText } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { EmptyState } from '../../components/common/EmptyState'
import { Avatar } from '../../components/common/Avatar'
import { Badge } from '../../components/common/Badge'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { useTaskActions } from './TaskActions'
import { StatusSelect, TaskMenu } from './TaskViews'
import { PriorityMark, TaskStatus, DueLabel, UserChip, ProgressBar, RelatedLink } from './TaskBits'
import { useOnTasksChanged, useTaskMeta, errMsg, emitTasksChanged } from './taskClient'
import { checkTaskFile, TASK_ACCEPT_ATTR, TASK_FILE_RULES, isOpenTask, REMINDER_OPTIONS } from '../../utils/taskRules'
import { getUserById, USERS } from '../../data/users'
import { formatDate, formatDateTime, timeAgo } from '../../utils/format'

const EVENT_STYLE = {
  Created: ['bg-brand-50 text-brand-600', Plus], Assigned: ['bg-sky-50 text-sky-600', UserPlus], Reassigned: ['bg-sky-50 text-sky-600', UserPlus],
  'Status Changed': ['bg-violet-50 text-violet-600', Zap], 'Priority Changed': ['bg-amber-50 text-amber-600', Flag], 'Due Date Changed': ['bg-amber-50 text-amber-600', CalendarClock],
  'Description Updated': ['bg-ink-100 text-ink-600', FileText], Updated: ['bg-ink-100 text-ink-600', Pencil], Comment: ['bg-brand-50 text-brand-600', MessageSquare], 'Internal Note': ['bg-amber-50 text-amber-700', StickyNote],
  'Attachment Added': ['bg-ink-100 text-ink-600', Paperclip], 'Attachment Removed': ['bg-ink-100 text-ink-600', Paperclip], 'Reminder Triggered': ['bg-amber-50 text-amber-600', Bell], Overdue: ['bg-rose-50 text-rose-600', Clock],
  Completed: ['bg-emerald-50 text-emerald-600', CheckCircle2], Reopened: ['bg-brand-50 text-brand-600', RotateCcw], Cancelled: ['bg-rose-50 text-rose-600', XCircle], 'Recurring Created': ['bg-violet-50 text-violet-600', Repeat],
  'Subtask Added': ['bg-ink-100 text-ink-600', GitBranch], 'Subtask Removed': ['bg-ink-100 text-ink-600', GitBranch], Duplicated: ['bg-ink-100 text-ink-600', Copy], Deleted: ['bg-rose-50 text-rose-600', Trash2],
}
const CHANGES = ['Created', 'Assigned', 'Reassigned', 'Status Changed', 'Priority Changed', 'Due Date Changed', 'Description Updated', 'Updated', 'Completed', 'Reopened', 'Cancelled', 'Recurring Created', 'Overdue', 'Reminder Triggered', 'Duplicated', 'Subtask Added', 'Subtask Removed']

function Card({ title, icon: Icon, action, children, className }) {
  return (
    <section className={clsx('rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">{Icon && <Icon size={15} className="text-ink-400" />}{title}</h2>{action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}
const Row = ({ label, children }) => <div className="flex items-start justify-between gap-3 py-2 text-sm"><dt className="shrink-0 text-ink-400">{label}</dt><dd className="min-w-0 text-right text-ink-800 dark:text-ink-100">{children}</dd></div>

function Mentioned({ text, mentions = [], people }) {
  const names = mentions.map((id) => people[id] || getUserById(id)?.name).filter(Boolean)
  if (!names.length) return <>{text}</>
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g')
  return <>{text.split(re).map((part, i) => (re.test(part) && part.startsWith('@') ? <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{part}</span> : <span key={i}>{part}</span>))}</>
}

function Composer({ taskId, canComment, onPosted }) {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const [picks, setPicks] = useState([])
  const [menu, setMenu] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const onChange = (e) => {
    const v = e.target.value
    setText(v); setError('')
    const m = /(?:^|\s)@([\w.]*)$/.exec(v.slice(0, e.target.selectionStart))
    setMenu(m ? m[1].toLowerCase() : null)
  }
  const options = menu === null ? [] : USERS.filter((u) => u.status !== 'Inactive' && u.name.toLowerCase().includes(menu.replace(/\./g, ' '))).slice(0, 5)
  const pick = (u) => {
    const pos = ref.current.selectionStart
    const before = text.slice(0, pos).replace(/@[\w.]*$/, `@${u.name} `)
    setText(before + text.slice(pos)); setPicks((p) => [...new Set([...p, u.id])]); setMenu(null)
    setTimeout(() => ref.current?.focus(), 0)
  }
  const post = () => {
    const mentions = picks.filter((id) => text.includes(`@${getUserById(id)?.name}`))
    setBusy(true); setError('')
    api.post(`/tasks/${taskId}/comments`, { text, mentions, internal }).then(() => { setText(''); setPicks([]); setInternal(false); toast(internal ? 'Internal note added.' : 'Comment posted.', { type: 'success' }); onPosted() }).catch((e) => setError(errMsg(e))).finally(() => setBusy(false))
  }
  if (!canComment) return null
  return (
    <div className="relative">
      <textarea ref={ref} value={text} onChange={onChange} aria-label="Write a comment" placeholder="Write a comment… use @ to mention a teammate" rows={2}
        className={clsx('w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 dark:bg-ink-900 dark:text-ink-100', internal ? 'border-amber-300 focus:ring-amber-400/30' : 'border-ink-200 focus:border-brand-500 focus:ring-brand-500/20 dark:border-ink-700')} />
      {options.length > 0 && (
        <ul className="absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-popover dark:border-ink-800 dark:bg-ink-900" role="listbox">
          {options.map((u) => <li key={u.id}><button type="button" role="option" onMouseDown={(e) => { e.preventDefault(); pick(u) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"><Avatar name={u.name} size="xs" />{u.name}<span className="ml-auto text-[11px] text-ink-400">{u.role}</span></button></li>)}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-rose-500">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-ink-500"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-3.5 w-3.5 rounded border-ink-300 text-amber-500" /> Internal note <span className="text-ink-400">(only people who can see this task)</span></label>
        <div className="flex items-center gap-2"><span className="hidden items-center gap-1 text-[11px] text-ink-400 sm:flex"><AtSign size={11} />Mentioned people become followers</span><Button size="sm" icon={Send} onClick={post} loading={busy} disabled={!text.trim()}>{internal ? 'Add note' : 'Comment'}</Button></div>
      </div>
    </div>
  )
}

function Timeline({ events, people, filter }) {
  const list = events.filter((e) => (filter === 'comments' ? ['Comment', 'Internal Note'].includes(e.type) : filter === 'changes' ? CHANGES.includes(e.type) : true))
  if (!list.length) return <p className="py-8 text-center text-sm text-ink-400">{filter === 'comments' ? 'No comments yet.' : 'Nothing recorded yet.'}</p>
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
      {list.map((e) => {
        const [tone, Icon] = EVENT_STYLE[e.type] || ['bg-ink-100 text-ink-600', History]
        const by = e.by === 'SYSTEM' ? 'Automation' : people[e.by] || getUserById(e.by)?.name || e.byName || e.by || '—'
        const note = e.type === 'Comment' || e.type === 'Internal Note'
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', tone, 'dark:bg-ink-800')}><Icon size={14} /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm text-ink-800 dark:text-ink-100"><span className="font-medium">{by}</span> <span className="text-ink-500">{note ? (e.type === 'Internal Note' ? 'added an internal note' : 'commented') : e.message}</span></p>
              {note && <div className={clsx('mt-1.5 whitespace-pre-wrap rounded-xl px-3 py-2 text-sm', e.type === 'Internal Note' ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100' : 'bg-ink-50 text-ink-700 dark:bg-ink-800/60 dark:text-ink-200')}><Mentioned text={e.text} mentions={e.mentions} people={people} /></div>}
              {!note && e.from !== undefined && e.to !== undefined && e.type !== 'Created' && (
                <p className="mt-0.5 text-xs text-ink-500"><span className="rounded bg-ink-100 px-1.5 py-0.5 line-through dark:bg-ink-800">{String(e.from)}</span> → <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{String(e.to)}</span>{e.reason ? <span className="ml-2 italic">“{e.reason}”</span> : null}</p>
              )}
              <p className="mt-0.5 text-[11px] text-ink-400" title={formatDateTime(e.at)}>{timeAgo(e.at)} · {formatDateTime(e.at)}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [d, setD] = useState(null)
  const [state, setState] = useState('loading')
  const [filter, setFilter] = useState('all')
  const [contact, setContact] = useState(null)
  const [quick, setQuick] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(() => api.get(`/tasks/${id}/detail`).then((r) => { setD(r.data); setState('ready') }).catch((e) => setState(e?.response?.status === 403 ? 'forbidden' : e?.response?.status === 404 ? 'missing' : 'error')), [id])
  useEffect(() => { setState('loading'); setD(null); load() }, [load])
  useOnTasksChanged(load)
  const actions = useTaskActions({ onChanged: load })
  const { me, meta } = useTaskMeta()

  const task = d?.task
  const people = d?.people || {}
  // the person to call / email: the record's contact, else the lead itself
  useEffect(() => {
    setContact(null)
    if (!task?.links) return
    const tryGet = (col, key) => (task.links[key] ? api.get(`/${col}/${task.links[key]}`).then((r) => r.data).catch(() => null) : Promise.resolve(null))
    Promise.all([tryGet('contacts', 'contactId'), tryGet('leads', 'leadId'), tryGet('enquiries', 'enquiryId')]).then(([c, l, e]) => { const x = c || l || e; if (x) setContact({ name: x.name, phone: x.phone || x.mobile, email: x.email }) })
  }, [task?.id, task?.links])

  const upload = (file) => {
    if (!file) return
    const err = checkTaskFile({ name: file.name, size: file.size })
    if (err) { toast(err, { type: 'error' }); return }
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => api.post(`/tasks/${id}/attachments`, { name: file.name, mimeType: file.type, dataUrl: reader.result }).then(() => { toast('File attached.', { type: 'success' }); emitTasksChanged() }).catch((e) => toast(errMsg(e), { type: 'error' })).finally(() => { setUploading(false); if (fileRef.current) fileRef.current.value = '' })
    reader.onerror = () => { setUploading(false); toast('Could not read the file.', { type: 'error' }) }
    reader.readAsDataURL(file)
  }
  const download = (a) => api.get(`/tasks/${id}/attachments/${a.id}`).then((r) => { const l = document.createElement('a'); l.href = r.data.dataUrl; l.download = a.name; document.body.appendChild(l); l.click(); l.remove() }).catch((e) => toast(errMsg(e), { type: 'error' }))
  const removeFile = (a) => api.delete(`/tasks/${id}/attachments/${a.id}`).then(() => { toast('Attachment removed.', { type: 'success' }); emitTasksChanged() }).catch((e) => toast(errMsg(e), { type: 'error' }))
  const addSubtask = () => {
    if (!quick.trim()) return
    api.post('/tasks', { title: quick.trim(), parentId: id, assignees: task.assignees, dueDate: task.dueDate, priority: task.priority, visibility: task.visibility }).then(() => { setQuick(''); emitTasksChanged() }).catch((e) => toast(errMsg(e), { type: 'error' }))
  }

  const waLink = useMemo(() => (contact?.phone ? `https://wa.me/${String(contact.phone).replace(/\D/g, '')}` : null), [contact])

  if (state === 'loading') return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" /><div className="h-96 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" /></div>
  if (state === 'forbidden') return <EmptyState icon={ShieldAlert} title="You don’t have access to this task" description="It’s private or outside your team and department. Ask its owner or a manager to share it with you." action={<Button variant="secondary" onClick={() => navigate('/tasks')}>Back to tasks</Button>} />
  if (state === 'missing') return <EmptyState icon={FileQuestion} title="Task not found" description={`${id} doesn’t exist — it may have been deleted.`} action={<Button variant="secondary" onClick={() => navigate('/tasks')}>Back to tasks</Button>} />
  if (state === 'error' || !task) return <EmptyState title="Couldn’t load this task" action={<Button variant="secondary" onClick={load}>Try again</Button>} />

  const c = task._can || {}
  const open = isOpenTask(task)
  const run = actions.run
  const rec = task.recurrence?.frequency !== 'none' ? task.recurrence : null
  const rem = meta?.settings?.reminders
  const ago = (m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} min`)
  const autoReminderText = !task.dueDate ? 'No due date' : !rem || rem.enabled === false || !rem.intervals?.length ? 'Off' : `${rem.intervals.map(ago).join(', ')} before due${task.dueReminders?.done?.length ? ` · ${task.dueReminders.done.length} handled` : ''}`
  const reminderText = task.reminderAt ? `${REMINDER_OPTIONS.find((o) => o.value === task.reminderMinutes)?.label || 'Custom'} · ${formatDateTime(task.reminderAt)}${task.remindedAt ? ' (sent)' : ''}` : 'None'
  const loggable = !!actions.canLog(task)

  return (
    <div>
      <div className="mb-5">
        <Breadcrumbs items={[{ label: 'Tasks', href: '/tasks' }, ...(d.parent ? [{ label: d.parent.id, href: `/tasks/${d.parent.id}` }] : []), { label: task.id }]} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/tasks" aria-label="Back to tasks" className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
              <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{task.id}</span>
              <StatusSelect task={task} run={run} />
              <PriorityMark priority={task.priority} />
              {task.overdue && <Badge tone="danger">{task.overdueLabel}</Badge>}
              {task.visibility === 'Private' && <Badge><Lock size={11} className="mr-1" />Private</Badge>}
            </div>
            <h1 className={clsx('mt-2 text-2xl font-bold tracking-tight', open ? 'text-ink-900 dark:text-ink-50' : 'text-ink-500 line-through')}>{task.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              <span className="flex items-center gap-1.5 text-ink-500"><CalendarClock size={14} /><DueLabel task={task} className="!text-sm" /></span>
              <span className="flex items-center gap-1.5 text-ink-500">Assigned to {(task.assignees || []).length ? task.assignees.map((a) => <UserChip key={a} id={a} name={people[a]} />) : <span className="italic">nobody</span>}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {c.complete && <Button icon={CheckCircle2} onClick={() => run('complete', task)}>Complete</Button>}
            {c.reopen && <Button icon={RotateCcw} onClick={() => run('reopen', task)}>Reopen</Button>}
            {c.claim && !c.reassign && !c.assign && <Button variant="secondary" icon={UserPlus} onClick={() => run('claim', task, me?.id)}>Assign to me</Button>}
            {c.edit && <Button variant="secondary" icon={Pencil} onClick={() => run('edit', task)}>Edit</Button>}
            <TaskMenu task={task} run={run} canLog={actions.canLog} />
          </div>
        </div>
      </div>

      {rec && <div className="mb-4 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-2.5 text-sm text-violet-800 dark:border-violet-800/40 dark:bg-violet-900/10 dark:text-violet-200"><Repeat size={15} /> Repeats {rec.interval > 1 || rec.frequency === 'custom' ? `every ${rec.interval} ${rec.frequency === 'custom' || rec.frequency === 'daily' ? 'day(s)' : rec.frequency === 'weekly' ? 'week(s)' : 'month(s)'}` : rec.frequency}. {d.nextTask ? <>Next: <Link className="font-medium underline" to={`/tasks/${d.nextTask.id}`}>{d.nextTask.id}</Link> due {formatDate(d.nextTask.dueDate)}.</> : 'The next task is created when this one is completed.'}</div>}
      {task.recurringRootId && <div className="mb-4 flex items-center gap-2 rounded-xl bg-ink-50 px-4 py-2 text-xs text-ink-500 dark:bg-ink-800/40"><Repeat size={13} /> Part of a recurring series.</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Card title="Task information" icon={FileText}>
            {task.description ? <p className="mb-4 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{task.description}</p> : <p className="mb-4 text-sm italic text-ink-400">No description.</p>}
            {task.status === 'Completed' && task.completionNote && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">Completion note: {task.completionNote}</p>}
            {task.status === 'Cancelled' && task.cancelReason && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Cancelled: {task.cancelReason}</p>}
            <dl className="grid divide-y divide-ink-50 sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0 dark:divide-ink-800/60">
              <div className="divide-y divide-ink-50 dark:divide-ink-800/60">
                <Row label="Task type">{task.taskType}</Row>
                <Row label="Related record"><RelatedLink type={task.relatedType} id={task.relatedId} name={task.relatedName} /></Row>
                <Row label="Assigned user">{(task.assignees || []).length ? <span className="flex flex-col items-end gap-1">{task.assignees.map((a) => <UserChip key={a} id={a} name={people[a]} />)}</span> : <span className="italic text-ink-400">Unassigned</span>}</Row>
                <Row label="Team">{task.assignedTeam ? `${task.assignedTeam.value} (${task.assignedTeam.kind})` : '—'}</Row>
                <Row label="Department">{task.department || '—'}</Row>
              </div>
              <div className="divide-y divide-ink-50 dark:divide-ink-800/60">
                <Row label="Created by"><UserChip id={task.createdBy} name={people[task.createdBy]} /></Row>
                <Row label="Start date">{task.startDate ? formatDate(task.startDate) : '—'}</Row>
                <Row label="Due date">{task.dueDate ? `${formatDate(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ''}` : '—'}</Row>
                <Row label="Reminder">{reminderText}</Row>
                <Row label="Auto reminders">{autoReminderText}</Row>
                <Row label="Visibility">{task.visibility}</Row>
              </div>
            </dl>
            {(task.watchers || []).length > 0 && <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">Followers: {task.watchers.map((w) => <UserChip key={w} id={w} name={people[w]} />)}</p>}
          </Card>

          {!task.parentId && (
            <Card title={`Subtasks${task.subtaskCount ? ` (${task.subtasksDone}/${task.subtaskCount})` : ''}`} icon={GitBranch} action={c.edit && <Button size="sm" variant="ghost" icon={Plus} onClick={() => run('subtask', task)}>Add with details</Button>}>
              {task.subtaskCount > 0 && <ProgressBar done={task.subtasksDone} total={task.subtaskCount} className="mb-3" />}
              <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
                {d.subtasks.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <button type="button" aria-label={`Complete ${s.title}`} disabled={!s._can?.complete} onClick={() => run('complete', s)} className={clsx('shrink-0', s.status === 'Completed' ? 'text-emerald-500' : s._can?.complete ? 'text-ink-300 hover:text-emerald-500' : 'text-ink-200')}><CheckCircle2 size={19} /></button>
                    <div className="min-w-0 flex-1"><Link to={`/tasks/${s.id}`} className={clsx('block truncate text-sm font-medium hover:underline', s.status === 'Completed' || s.status === 'Cancelled' ? 'text-ink-400 line-through' : 'text-ink-800 dark:text-ink-100')}>{s.title}</Link><span className="font-mono text-[11px] text-ink-400">{s.id}</span></div>
                    <DueLabel task={s} /><TaskStatus status={s.status} className="hidden sm:inline-flex" />
                  </li>
                ))}
                {!d.subtasks.length && <li className="py-4 text-center text-sm text-ink-400">No subtasks. Break big work into steps.</li>}
              </ul>
              {c.edit && (
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addSubtask() }}>
                  <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a subtask and press Enter…" aria-label="New subtask title" className="h-9 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100" />
                  <Button type="submit" size="md" variant="secondary" disabled={!quick.trim()}>Add</Button>
                </form>
              )}
            </Card>
          )}

          <Card title="Activity & timeline" icon={History}>
            <div className="mb-4 flex gap-1 rounded-lg bg-ink-50 p-1 text-xs font-medium dark:bg-ink-800/50" role="tablist" aria-label="Timeline filter">
              {[['all', 'Everything'], ['comments', 'Comments'], ['changes', 'Changes']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={clsx('flex-1 rounded-md px-3 py-1.5', filter === k ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50' : 'text-ink-500')}>{l}</button>)}
            </div>
            <div className="mb-5"><Composer taskId={task.id} canComment={c.comment} onPosted={emitTasksChanged} /></div>
            <Timeline events={d.events} people={people} filter={filter} />
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {(contact || loggable) && (
            <Card title="Quick actions" icon={Zap}>
              {contact && (
                <div className="mb-3 rounded-xl bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
                  <p className="font-medium text-ink-800 dark:text-ink-100">{contact.name}</p>
                  <div className="mt-1 space-y-0.5 text-xs">
                    {contact.phone ? <a className="block text-brand-700 hover:underline dark:text-brand-300" href={`tel:${contact.phone}`}>{contact.phone}</a> : <span className="block text-ink-400">No phone on record</span>}
                    {contact.email ? <a className="block truncate text-brand-700 hover:underline dark:text-brand-300" href={`mailto:${contact.email}`}>{contact.email}</a> : <span className="block text-ink-400">No email on record</span>}
                    {waLink && <a className="block text-emerald-700 hover:underline dark:text-emerald-300" href={waLink} target="_blank" rel="noreferrer">Open WhatsApp chat</a>}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {loggable && [['Call', Phone], ['Email', Mail], ['WhatsApp', MessageCircle], ['Meeting', CalendarPlus], ['Note', StickyNote]].map(([t, Icon]) => (
                  <button key={t} type="button" onClick={() => run('log', task, t)} className="flex flex-col items-center gap-1 rounded-xl border border-ink-100 px-2 py-2.5 text-[11px] font-medium text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700 dark:border-ink-800 dark:text-ink-300 dark:hover:bg-brand-900/20"><Icon size={16} />{t === 'Meeting' ? 'Meeting' : `Log ${t === 'Note' ? 'note' : t.toLowerCase()}`}</button>
                ))}
                {c.duplicate && task.relatedId && <button type="button" onClick={() => run('followup', task)} className="flex flex-col items-center gap-1 rounded-xl border border-ink-100 px-2 py-2.5 text-[11px] font-medium text-ink-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700 dark:border-ink-800 dark:text-ink-300"><ListPlus size={16} />Follow-up</button>}
              </div>
              <p className="mt-3 text-[11px] text-ink-400">Logged calls, emails and notes are recorded on the activity timeline of the linked records.</p>
            </Card>
          )}

          <Card title="Related records" icon={Link2}>
            {d.related.length ? (
              <ul className="space-y-1.5">
                {d.related.map((r) => <li key={r.key}><Link to={r.route} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-ink-50 dark:hover:bg-ink-800/60"><span className="min-w-0 truncate"><span className="text-xs text-ink-400">{r.type}</span><br /><span className="font-medium text-brand-700 dark:text-brand-300">{r.label}</span></span><ArrowLeft size={13} className="shrink-0 rotate-180 text-ink-300" /></Link></li>)}
              </ul>
            ) : <p className="text-sm text-ink-400">Not linked to a CRM record.</p>}
            {d.activities.length > 0 && <div className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500 dark:border-ink-800"><p className="mb-1 font-medium">Recorded on the activity timeline</p>{d.activities.map((a) => <p key={a.id} className="truncate">{a.subject} · <span className="text-ink-400">{a.status}</span></p>)}</div>}
          </Card>

          <Card title="Documents" icon={Paperclip}><DocumentsPanel relatedType="Task" relatedId={task.id} defaultCategory="Internal Documents" canUploadHere={!!c.attach} /></Card>
        </div>
      </div>
      {actions.dialogs}
    </div>
  )
}
