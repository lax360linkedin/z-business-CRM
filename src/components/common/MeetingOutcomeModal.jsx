import { useState } from 'react'
import { Modal } from './Modal'
import { FormField, Input, Select, Textarea, DateInput } from './FormField'
import { Button } from './Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { createNotification } from '../../utils/notify'
import { MEETING_STATUSES } from '../../data/constants'

const ENDPOINT = { Lead: '/leads', Enquiry: '/enquiries', Contact: '/contacts', Deal: '/deals', Proposal: '/proposals' }

/** After a meeting: Completed / Cancelled / Rescheduled / No Show, plus Meeting Notes / Outcome
 * / Next Follow-up. The meeting record IS the activity (see MeetingSchedulerModal), so this just
 * PUTs the same /activities/:id record in place. Shared between Lead, Enquiry, Contact and Deal
 * (identical behavior either way) via `relatedType` rather than duplicated per module. */
export function MeetingOutcomeModal({ open, onClose, meeting, relatedType = 'Lead', relatedId, onUpdated }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [status, setStatus] = useState('Completed')
  const [outcome, setOutcome] = useState('')
  const [meetingNotes, setMeetingNotes] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [saving, setSaving] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [error, setError] = useState('')

  if (!meeting) return null
  const reset = () => { setStatus('Completed'); setOutcome(''); setMeetingNotes(''); setNextFollowUp(''); setNewDate(''); setNewStart(''); setNewEnd(''); setError('') }

  const save = () => {
    const rescheduling = status === 'Rescheduled'
    if (rescheduling && (!newDate || !newStart)) { setError('Pick the new date and start time — the calendar needs it to move the meeting.'); return }
    if (rescheduling && new Date(`${newDate}T${newStart}:00`).getTime() < Date.now() - 60000) { setError('The new time must be in the future.'); return }
    setError('')
    setSaving(true)
    // a rescheduled meeting stays a live, Scheduled meeting at its new time (so the Calendar, reminders and the record timeline all follow it)
    const payload = rescheduling
      ? {
        meetingStatus: 'Scheduled', status: 'Scheduled', meetingDate: newDate, meetingStartTime: newStart, meetingEndTime: newEnd || null, date: new Date(`${newDate}T${newStart}:00`).toISOString(), reminderSentAt: null,
        rescheduledCount: (meeting.rescheduledCount || 0) + 1, rescheduledFrom: [...(meeting.rescheduledFrom || []), { date: meeting.meetingDate, time: meeting.meetingStartTime || null, at: new Date().toISOString(), by: user.id }],
        outcome: outcome || null, meetingNotes: meetingNotes || null,
      }
      : {
        meetingStatus: status, status: status === 'Completed' ? 'Completed' : 'Cancelled', outcome: outcome || null, meetingNotes: meetingNotes || null,
        nextFollowUp: nextFollowUp || null, completedAt: new Date().toISOString(), completedBy: user.id,
      }
    api.put(`/activities/${meeting.id}`, payload).then(() => {
      if (nextFollowUp && relatedId) return api.put(`${ENDPOINT[relatedType]}/${relatedId}`, { nextFollowUp })
    }).then(() => {
      if (['Rescheduled', 'Cancelled'].includes(status)) {
        createNotification({
          type: status === 'Rescheduled' ? 'Meeting Rescheduled' : 'Meeting Cancelled',
          message: `Meeting "${meeting.title}" was marked ${status}.`,
          relatedType, relatedId,
        })
      }
      setSaving(false)
      toast(rescheduling ? `Meeting moved to ${newDate} ${newStart}.` : `Meeting marked ${status}.`, { type: 'success' })
      reset()
      onUpdated?.()
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Update Meeting"
      description={meeting.title}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save</Button>
      </>}
    >
      <div className="space-y-4">
        <FormField label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {MEETING_STATUSES.filter((s) => s !== 'Scheduled').map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </FormField>
        {status === 'Rescheduled' && (
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-800/40 dark:bg-brand-900/10">
            <FormField label="New date" required><DateInput value={newDate} onChange={(e) => setNewDate(e.target.value)} /></FormField>
            <FormField label="Start" required><Input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></FormField>
            <FormField label="End"><Input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></FormField>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <FormField label="Outcome"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What was agreed/discussed." /></FormField>
        <FormField label="Meeting Notes"><Textarea value={meetingNotes} onChange={(e) => setMeetingNotes(e.target.value)} /></FormField>
        {status !== 'Rescheduled' && <FormField label="Next Follow-up"><DateInput value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} /></FormField>}
      </div>
    </Modal>
  )
}
