import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { logManualActivity } from '../../api/activityLog'
import { MEETING_TYPES } from '../../data/constants'
import { emitContractsChanged } from '../../hooks/useContracts'
import { errText } from './contractActions'

const TYPES = ['Meeting', 'Call', 'Email', 'WhatsApp', 'Note']
const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * Log a client meeting (scheduled → appears on the Calendar and fires a reminder) or a client communication / note on a contract.
 * Saved as an Activity on the project, so it also shows on the Activities page and the project timeline.
 */
export function ContractActivityDialog({ open, onClose, contract, userId, presetType = 'Meeting', onSaved }) {
  const { toast } = useToast()
  const [f, setF] = useState({ type: 'Meeting', subject: '', notes: '', date: todayIso(), time: '10:00', endTime: '', meetingType: MEETING_TYPES[0], outcome: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { if (open) { setF((x) => ({ ...x, type: presetType, subject: '', notes: '', date: todayIso(), time: '10:00', endTime: '' })); setErrors({}); setError('') } }, [open, presetType])
  const meeting = f.type === 'Meeting'

  const submit = () => {
    const e = {}
    if (!f.subject.trim()) e.subject = meeting ? 'Give the meeting a title.' : 'Add a short summary.'
    if (meeting && (!f.date || !f.time)) e.date = 'Set the date and start time.'
    if (meeting && f.endTime && f.endTime <= f.time) e.endTime = 'End must be after the start.'
    if (Object.keys(e).length) { setErrors(e); return }
    setBusy(true); setError('')
    // the server checks the facts, stamps who and when, schedules a meeting on the calendar and links the record chain
    logManualActivity('Contract', { type: f.type, relatedId: contract.id, subject: f.subject.trim(), notes: f.notes.trim() || undefined, title: f.subject.trim(), meetingDate: f.date, meetingStartTime: f.time, endTime: f.endTime || undefined, meetingType: f.meetingType })
      .then((r) => { toast(meeting ? 'Meeting scheduled — it is on the Calendar.' : 'Logged on the contract.', { type: 'success' }); emitContractsChanged(); onSaved?.(r); onClose() })
      .catch((er) => setError(errText(er))).finally(() => setBusy(false))
  }
  return (
    <Modal open={open} onClose={onClose} size="md" title="Log client activity" description={contract ? `${contract.number} · ${contract.title}` : ''}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>{meeting ? 'Schedule meeting' : 'Log it'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Activity type">{TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={f.type === t} onClick={() => set({ type: t })} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset', f.type === t ? 'bg-brand-600 text-white ring-brand-600' : 'text-ink-600 ring-ink-200 dark:text-ink-300 dark:ring-ink-700')}>{t === 'Meeting' ? 'Client meeting' : t}</button>)}</div>
        <FormField label={meeting ? 'Title' : 'Summary'} required error={errors.subject}><Input autoFocus value={f.subject} error={errors.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={meeting ? 'e.g. Contract review / signature meeting' : 'What was discussed?'} /></FormField>
        {meeting && (
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Date" required error={errors.date}><Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></FormField>
            <FormField label="Start" required><Input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></FormField>
            <FormField label="End" error={errors.endTime}><Input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></FormField>
            <FormField label="Meeting type" className="col-span-3"><Select value={f.meetingType} onChange={(e) => set({ meetingType: e.target.value })}>{MEETING_TYPES.map((m) => <option key={m}>{m}</option>)}</Select></FormField>
          </div>
        )}
        <FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[72px]" /></FormField>
      </form>
    </Modal>
  )
}
