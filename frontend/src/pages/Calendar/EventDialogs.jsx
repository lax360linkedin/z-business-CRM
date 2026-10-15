import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { CheckCircle2, ExternalLink, Video, MapPin, CalendarClock, XCircle, Link2, Bell, Repeat, AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { Badge } from '../../components/common/Badge'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { MEETING_TYPES } from '../../data/constants'
import { formatDate } from '../../utils/format'
import { TASK_RELATED_BY_TYPE } from '../../utils/taskLinks'
import { RecordPicker } from '../Tasks/TaskFormDialog'
import { useDirectory, useTaskLookup, useTaskMeta, errMsg, emitTasksChanged, todayIso } from '../Tasks/taskClient'
import { KIND_STYLE } from './calendarStyle'

const msg = errMsg

/** Move an entry to another day (and optionally time) through the module that owns it — so the record, the task list and the calendar all agree. */
export function rescheduleEvent(ev, date, time) {
  const s = ev.source
  if (s.type === 'task') return api.post(`/tasks/${s.id}/reschedule`, { dueDate: date, dueTime: time ?? ev.time ?? null })
  if (s.type === 'activity') return api.post(`/activities/${s.id}/reschedule`, { date, time: time ?? ev.time ?? undefined })
  if (s.type === 'record') return api.post('/calendar/followup/reschedule', { recordType: s.recordType, id: s.id, date })
  return Promise.reject(new Error('This entry can’t be moved from the calendar.'))
}

const when = (ev) => `${formatDate(ev.date, { weekday: 'long', year: 'numeric' })}${ev.time ? `, ${ev.time}${ev.endTime ? `–${ev.endTime}` : ''}` : ' · all day'}`

export function EventDetailDialog({ event, onClose, onChanged }) {
  const { toast } = useToast()
  const [mode, setMode] = useState(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setMode(null); setError(''); setReason(''); if (event) { setDate(event.date); setTime(event.time || '') } }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!event) return null
  const ev = event
  const style = KIND_STYLE[ev.kind]
  const done = (m) => { toast(m, { type: 'success' }); emitTasksChanged(); onChanged?.(); onClose() }
  const run = (p, okMsg) => { setBusy(true); setError(''); p.then(() => done(okMsg)).catch((e) => setError(msg(e))).finally(() => setBusy(false)) }
  const s = ev.source
  const complete = () => run(s.type === 'task' ? api.post(`/tasks/${s.id}/complete`, {}) : api.post(`/activities/${s.id}/complete`, {}), s.type === 'task' ? 'Task completed.' : 'Marked complete.')
  const cancel = () => {
    if (!reason.trim()) { setError('Give a reason for cancelling.'); return }
    run(s.type === 'task' ? api.post(`/tasks/${s.id}/cancel`, { reason }) : api.post(`/activities/${s.id}/cancel`, { reason }), 'Cancelled.')
  }
  const move = () => {
    if (!date) { setError('Choose a date.'); return }
    run(rescheduleEvent(ev, date, time || undefined), 'Rescheduled.')
  }
  const c = ev.can || {}
  const people = (ev.assignees || []).map((id) => getUserById(id)?.name || id)
  return (
    <Modal open onClose={onClose} size="md" title={ev.title} description={`${style.singular}${ev.type && ev.type !== style.singular ? ` · ${ev.type}` : ''}`}
      footer={mode ? <>
        <Button variant="ghost" onClick={() => { setMode(null); setError('') }}>Back</Button>
        <Button variant={mode === 'cancel' ? 'danger' : 'primary'} loading={busy} onClick={mode === 'cancel' ? cancel : move}>{mode === 'cancel' ? 'Cancel it' : 'Save new time'}</Button>
      </> : <>
        {c.cancel && <Button variant="ghost" icon={XCircle} onClick={() => setMode('cancel')}>Cancel</Button>}
        {c.reschedule && <Button variant="secondary" icon={CalendarClock} onClick={() => setMode('reschedule')}>Reschedule</Button>}
        {c.complete && <Button icon={CheckCircle2} loading={busy} onClick={complete}>Complete</Button>}
        {ev.href && <Link to={ev.href}><Button variant={c.complete ? 'secondary' : 'primary'} icon={ExternalLink}>{ev.hrefLabel || 'Open'}</Button></Link>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', style.chip)}><style.icon size={12} />{style.singular}</span>
          <Badge tone={ev.state === 'overdue' ? 'danger' : ev.state === 'done' ? 'success' : ev.state === 'cancelled' ? 'neutral' : 'info'}>{ev.state === 'overdue' ? `${ev.status} · overdue` : ev.status}</Badge>
          {ev.priority && <Badge tone={ev.priority === 'Urgent' ? 'danger' : ev.priority === 'High' ? 'warning' : 'neutral'}>{ev.priority}</Badge>}
          {ev.recurring && <Badge><Repeat size={11} className="mr-1" />Repeats</Badge>}
          {ev.unlinked && <Badge tone="warning"><AlertTriangle size={11} className="mr-1" />Not linked to a record</Badge>}
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

        {mode === 'reschedule' && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
            <FormField label="New date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
            <FormField label="Time"><Input type="time" value={time} disabled={s.type === 'record'} onChange={(e) => setTime(e.target.value)} /></FormField>
          </div>
        )}
        {mode === 'cancel' && <FormField label="Reason" required><Textarea autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} placeholder="Why is this being cancelled?" className="min-h-[72px]" /></FormField>}

        {!mode && (
          <>
            <dl className="divide-y divide-ink-50 text-sm dark:divide-ink-800/60">
              <div className="flex justify-between gap-4 py-2"><dt className="text-ink-400">When</dt><dd className="text-right text-ink-800 dark:text-ink-100">{when(ev)}</dd></div>
              <div className="flex justify-between gap-4 py-2"><dt className="text-ink-400">Assigned to</dt><dd className="text-right text-ink-800 dark:text-ink-100">{people.join(', ') || '—'}</dd></div>
              {ev.relatedName && <div className="flex justify-between gap-4 py-2"><dt className="text-ink-400">Related to</dt><dd className="text-right">{ev.href ? <Link className="text-brand-700 hover:underline dark:text-brand-300" to={ev.href}>{ev.relatedType} · {ev.relatedName}</Link> : `${ev.relatedType} · ${ev.relatedName}`}</dd></div>}
              {ev.location && <div className="flex justify-between gap-4 py-2"><dt className="text-ink-400">Location</dt><dd className="flex items-center gap-1 text-right text-ink-800 dark:text-ink-100"><MapPin size={13} />{ev.location}</dd></div>}
            </dl>
            {ev.meetingLink && ev.state !== 'cancelled' && <Link to={ev.meetingLink}><Button variant="secondary" icon={Video}>Join meeting room</Button></Link>}
            {ev.description && <p className="whitespace-pre-wrap rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700 dark:bg-ink-800/50 dark:text-ink-200">{ev.description}</p>}
            {ev.related?.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-500"><Link2 size={12} /> Connected records</p>
                <div className="flex flex-wrap gap-1.5">{ev.related.map((r) => <Link key={`${r.type}${r.id}`} to={r.route} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{r.type}</span> {r.label}</Link>)}</div>
              </div>
            )}
            {ev.kind === 'reminder' && <p className="flex items-center gap-1.5 text-xs text-ink-400"><Bell size={12} /> You’ll get an in-app notification when this fires. Email / WhatsApp reminders aren’t configured.</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

const EVENT_TYPES = [
  { value: 'Meeting', needsRecord: true, time: true, end: true, kind: 'activity' },
  { value: 'Demo / Presentation', needsRecord: true, time: true, end: true, kind: 'activity' },
  { value: 'Site Visit', needsRecord: true, time: true, end: true, location: true, kind: 'activity' },
  { value: 'Follow-up', needsRecord: true, time: false, kind: 'activity' },
  { value: 'Task', needsRecord: false, time: false, kind: 'task' },
  { value: 'Reminder', needsRecord: false, time: true, kind: 'reminder' },
]
const REMINDER_CHOICES = [['', 'No reminder'], ['0', 'At the start'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]

/** Schedule something from the calendar. Meetings, demos, visits and follow-ups are real activities on a CRM record; tasks and reminders are real tasks. */
export function EventFormDialog({ open, onClose, onSaved, preset }) {
  const { toast } = useToast()
  const { me, perms } = useTaskMeta()
  const { dir } = useDirectory(open)
  const { data: lookup } = useTaskLookup(open)
  const blank = { type: 'Meeting', title: '', date: todayIso(), time: '10:00', endTime: '', location: '', meetingType: MEETING_TYPES[0], relatedType: 'Lead', relatedId: '', assignee: '', reminder: '15', notes: '' }
  const [f, setF] = useState(blank)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { if (open) { setF({ ...blank, ...(preset || {}), assignee: preset?.assignee || me?.id || '' }); setErrors({}); setError('') } }, [open, preset?.date, preset?.relatedId, preset?.type, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const def = EVENT_TYPES.find((t) => t.value === f.type)
  const past = f.date && new Date(`${f.date}T${f.time || '23:59'}:00`).getTime() < Date.now() - 60000

  const pickType = (type) => {
    const d = EVENT_TYPES.find((t) => t.value === type)
    set({ type, time: d.time ? f.time || '10:00' : f.time, reminder: d.time ? (f.reminder === '' ? '15' : f.reminder) : f.reminder })
  }
  const submit = () => {
    const e = {}
    if (!f.title.trim()) e.title = 'Give it a title.'
    if (!f.date) e.date = 'Pick a date.'
    if (def.time && !f.time) e.time = 'Set a start time.'
    if (def.needsRecord && !f.relatedId) e.relatedId = 'Choose the CRM record this belongs to.'
    if (def.location && !f.location.trim()) e.location = 'Where is the visit?'
    if (f.endTime && f.time && f.endTime <= f.time) e.endTime = 'End must be after the start.'
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({}); setError(''); setSaving(true)
    const assignee = f.assignee || me?.id
    let req
    if (def.kind === 'activity') {
      req = api.post('/activities/log', {
        type: f.type, subject: f.title, description: f.notes, date: f.date, time: f.time || undefined, endTime: f.endTime || undefined, location: f.location || undefined,
        meetingType: f.type === 'Meeting' ? f.meetingType : undefined, relatedType: f.relatedType, relatedId: f.relatedId, assignedTo: assignee, reminderMinutes: f.reminder === '' ? undefined : f.reminder,
        followUpType: f.type === 'Follow-up' ? 'Call' : undefined, status: past ? undefined : 'Scheduled',
      })
    } else {
      req = api.post('/tasks', {
        title: f.type === 'Reminder' && !/^remind/i.test(f.title) ? f.title : f.title, description: f.notes, taskType: f.type === 'Reminder' ? 'General' : 'General', dueDate: f.date, dueTime: f.time || null,
        reminderMinutes: f.type === 'Reminder' ? (f.reminder === '' ? '0' : f.reminder) : f.reminder, assignees: [assignee], relatedType: f.relatedId ? f.relatedType : null, relatedId: f.relatedId || null,
      })
    }
    req.then((r) => { toast(def.kind === 'activity' ? `${f.type} scheduled on the ${f.relatedType.toLowerCase()}.` : `${f.type} added — ${r.data.id}.`, { type: 'success' }); emitTasksChanged(); onSaved?.(r.data); onClose() })
      .catch((err) => { setError(msg(err)); if (err?.response?.data?.fields) setErrors(err.response.data.fields) })
      .finally(() => setSaving(false))
  }
  const locked = !!preset?.lockRecord
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Schedule an event" description="It is saved on the CRM record it belongs to — the calendar just shows it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>{f.type === 'Task' || f.type === 'Reminder' ? 'Add' : 'Schedule'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Event type">
          {EVENT_TYPES.map((t) => <button key={t.value} type="button" role="radio" aria-checked={f.type === t.value} onClick={() => pickType(t.value)} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors', f.type === t.value ? 'bg-brand-600 text-white ring-brand-600' : 'text-ink-600 ring-ink-200 hover:bg-ink-50 dark:text-ink-300 dark:ring-ink-700 dark:hover:bg-ink-800')}>{t.value}</button>)}
        </div>
        <FormField label="Title" required error={errors.title || errors.subject}><Input autoFocus value={f.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.type === 'Meeting' ? 'e.g. Requirements workshop' : f.type === 'Follow-up' ? 'e.g. Call back on pricing' : 'What is it?'} maxLength={160} /></FormField>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Date" required error={errors.date} className="col-span-2"><Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} error={errors.date} /></FormField>
          <FormField label={def.time ? 'Start' : 'Time'} required={def.time} error={errors.time}><Input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} error={errors.time} aria-label="Start time" /></FormField>
          {def.end ? <FormField label="End" error={errors.endTime}><Input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} aria-label="End time" /></FormField> : <div />}
        </div>
        {past && def.kind === 'activity' && <p className="flex items-center gap-1.5 text-xs text-amber-600"><AlertTriangle size={13} /> That time has passed — it will be recorded as already held, not scheduled.</p>}
        {f.type === 'Meeting' && <FormField label="Meeting type"><Select value={f.meetingType} onChange={(e) => set({ meetingType: e.target.value })}>{MEETING_TYPES.map((m) => <option key={m}>{m}</option>)}</Select></FormField>}
        {def.location && <FormField label="Location" required error={errors.location}><Input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Address or site name" error={errors.location} /></FormField>}
        <FormField label={`CRM record${def.needsRecord ? '' : ' (optional)'}`} required={def.needsRecord} error={errors.relatedId || errors.relatedType} hint={locked ? 'Scheduled from this record.' : def.needsRecord ? 'The event is stored on this record and appears on its timeline.' : 'Leave empty for a personal task or reminder.'}>
          <div className="grid grid-cols-[9rem_1fr] gap-2">
            <Select aria-label="Record type" value={f.relatedType} disabled={locked} onChange={(e) => set({ relatedType: e.target.value, relatedId: '' })}>
              {Object.values(TASK_RELATED_BY_TYPE).filter((r) => !['Project', 'Product', 'Campaign'].includes(r.type) || !def.needsRecord).map((r) => <option key={r.type}>{r.type}</option>)}
            </Select>
            <RecordPicker type={f.relatedType} value={f.relatedId} data={lookup} disabled={locked} error={errors.relatedId} onPick={(id) => set({ relatedId: id })} />
          </div>
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Assigned to" hint={perms.assign ? undefined : 'Your role schedules for yourself.'}>
            <Select value={f.assignee} disabled={!perms.assign} onChange={(e) => set({ assignee: e.target.value })}>{(dir?.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}{u.isMe ? ' (you)' : ''} — {u.role}</option>)}</Select>
          </FormField>
          <FormField label="Reminder" hint="In-app notification.">
            <Select value={f.reminder} onChange={(e) => set({ reminder: e.target.value })}>{REMINDER_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </FormField>
        </div>
        <FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[64px]" /></FormField>
      </form>
    </Modal>
  )
}
