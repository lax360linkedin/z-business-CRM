import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, CalendarClock, Ban, Pencil, Trash2, AlertCircle, ExternalLink } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { getUserById, salesUsers } from '../../data/users'
import { formatDateTime } from '../../utils/format'
import { RELATED_TYPES, canonicalType, effectiveStatus, relatedHref, ACTIVITY_PRIORITIES, todayStr } from '../../utils/activityRules'

const msg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.'
const STATUS_TONE = { Scheduled: 'info', Overdue: 'danger', Completed: 'success', Cancelled: 'neutral' }

/** One activity in full: every linked record (clickable), who/when/status, and the actions that are valid for it. */
export default function ActivityDetailDialog({ activityId, find, onClose, onChanged }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const reps = salesUsers()
  const [a, setA] = useState(null)
  const [mode, setMode] = useState(null) // complete | cancel | reschedule | edit
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setMode(null); setError('')
    if (!activityId) { setA(null); return }
    api.get(`/activities/${activityId}`).then((r) => setA(r.data)).catch(() => setA(null))
  }, [activityId])

  if (!activityId) return null
  const manual = a?.source === 'manual'
  const own = a && (a.by === user?.id || ['Super Admin', 'Admin', 'Sales Manager'].includes(user?.role))
  const status = a ? effectiveStatus(a) : ''
  const open = a && manual && a.status === 'Scheduled'

  const run = (req, okMsg) => {
    setBusy(true); setError('')
    req.then((r) => { toast(okMsg, { type: 'success' }); if (r?.data?.id) setA(r.data); setMode(null); onChanged?.() }).catch((e) => setError(msg(e))).finally(() => setBusy(false))
  }
  const start = (m) => { setMode(m); setError(''); setForm(m === 'edit' ? { subject: a.subject, description: a.description || a.notes || '', priority: a.priority || 'Medium', assignedTo: a.assignedTo || '' } : { date: todayStr(), time: '09:00', notes: '', reason: '' }) }
  const submit = () => {
    if (mode === 'complete') run(api.post(`/activities/${a.id}/complete`, { notes: form.notes }), 'Marked complete.')
    if (mode === 'cancel') run(api.post(`/activities/${a.id}/cancel`, { reason: form.reason }), 'Activity cancelled.')
    if (mode === 'reschedule') run(api.post(`/activities/${a.id}/reschedule`, { date: form.date, time: form.time }), 'Rescheduled.')
    if (mode === 'edit') run(api.post(`/activities/${a.id}/edit`, form), 'Activity updated.')
  }
  const remove = () => {
    setBusy(true)
    api.delete(`/activities/${a.id}`).then(() => { toast('Activity deleted.', { type: 'success' }); setConfirmDelete(false); onChanged?.(); onClose() }).catch((e) => { toast(msg(e), { type: 'error' }); setConfirmDelete(false) }).finally(() => setBusy(false))
  }
  const links = a ? RELATED_TYPES.filter((r) => a.links?.[r.linkKey]).map((r) => ({ ...r, id: a.links[r.linkKey], rec: find(r.collection, a.links[r.linkKey]) })) : []

  return (
    <Modal open onClose={onClose} title={a ? a.subject : 'Activity'} description={a ? `${canonicalType(a) === 'System event' ? a.type : canonicalType(a)} · ${formatDateTime(a.date)}` : ''} size="lg"
      footer={a && (
        <>
          {manual && own && <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-600" onClick={() => setConfirmDelete(true)}>Delete</Button>}
          {manual && own && <Button variant="secondary" icon={Pencil} onClick={() => start('edit')}>Edit</Button>}
          {open && own && <Button variant="secondary" icon={CalendarClock} onClick={() => start('reschedule')}>Reschedule</Button>}
          {open && own && <Button variant="secondary" icon={Ban} onClick={() => start('cancel')}>Cancel</Button>}
          {open && <Button icon={CheckCircle2} onClick={() => start('complete')}>Mark complete</Button>}
        </>
      )}>
      {!a ? <p className="py-8 text-center text-sm text-ink-400">Loading…</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[status] || 'neutral'}>{status}</Badge>
            <Badge tone="neutral">{manual ? 'Logged by user' : 'System event'}</Badge>
            {a.priority && manual && <Badge tone={a.priority === 'High' ? 'danger' : a.priority === 'Low' ? 'neutral' : 'warning'}>{a.priority} priority</Badge>}
          </div>
          {(a.description || a.notes) && <p className="whitespace-pre-line rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700 dark:bg-ink-800/50 dark:text-ink-200">{a.description || a.notes}</p>}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[['Logged by', getUserById(a.by)?.name || 'System'], ['Assigned to', getUserById(a.assignedTo)?.name || '—'], ['When', formatDateTime(a.date)],
              ['Outcome', a.callOutcome || a.outcome], ['Location', a.location], ['Channel', a.channel], ['Completed', a.completedAt && formatDateTime(a.completedAt)],
              ['Cancelled', a.cancelReason], ['Rescheduled', a.rescheduledCount ? `${a.rescheduledCount}×` : null]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{k}</dt><dd className="text-ink-800 dark:text-ink-100">{v}</dd></div>
            ))}
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Linked records</p>
            {links.length === 0 ? <p className="text-xs text-ink-400">No linked records.</p> : (
              <div className="flex flex-wrap gap-2">
                {links.map((l) => (
                  <button key={l.type} type="button" onClick={() => { const h = relatedHref(l.type, l.id); if (h) { onClose(); navigate(h) } }} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs hover:border-brand-400 dark:border-ink-700">
                    <span className="font-semibold text-brand-600">{l.type}</span><span className="truncate text-ink-700 dark:text-ink-200">{l.rec ? l.label(l.rec) : l.id}</span>{l.type === a.relatedType && <Badge tone="info">primary</Badge>}<ExternalLink size={11} className="text-ink-400" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {manual && !mode && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Attachments</p>
              <DocumentsPanel relatedType="Activity" relatedId={a.id} defaultCategory="Internal Documents" />
            </div>
          )}

          {mode && (
            <div className="space-y-3 rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              {mode === 'complete' && <FormField label="Outcome notes (optional)"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-[70px]" /></FormField>}
              {mode === 'cancel' && <FormField label="Reason for cancelling" required><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="min-h-[70px]" /></FormField>}
              {mode === 'reschedule' && <div className="grid grid-cols-2 gap-3"><FormField label="New date" required><DateInput value={form.date} min={todayStr()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></FormField><FormField label="Time"><Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></FormField></div>}
              {mode === 'edit' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><FormField label="Title"><Input value={form.subject} maxLength={160} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></FormField></div>
                  <FormField label="Priority"><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{ACTIVITY_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
                  <FormField label="Assigned to"><Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
                  <div className="col-span-2"><FormField label="Details"><Textarea value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[80px]" /></FormField></div>
                </div>
              )}
              {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-600"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}</p>}
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode(null)}>Back</Button><Button loading={busy} disabled={mode === 'cancel' && !form.reason?.trim()} onClick={submit}>Save</Button></div>
            </div>
          )}
          {!mode && !manual && <p className="text-xs text-ink-400">System-recorded events are part of the audit trail and can't be edited or deleted.</p>}
        </div>
      )}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove} loading={busy} title="Delete this activity?" description="It will be removed from every record's timeline." confirmLabel="Delete" />
    </Modal>
  )
}
