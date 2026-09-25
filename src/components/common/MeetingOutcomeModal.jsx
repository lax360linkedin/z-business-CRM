import { useState } from 'react'
import { Modal } from './Modal'
import { FormField, Select, Textarea, DateInput } from './FormField'
import { Button } from './Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { createNotification } from '../../utils/notify'
import { MEETING_STATUSES } from '../../data/constants'

const ENDPOINT = { Lead: '/leads', Enquiry: '/enquiries', Contact: '/contacts', Deal: '/deals' }

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

  if (!meeting) return null
  const reset = () => { setStatus('Completed'); setOutcome(''); setMeetingNotes(''); setNextFollowUp(''); }

  const save = () => {
    setSaving(true)
    api.put(`/activities/${meeting.id}`, {
      meetingStatus: status, outcome: outcome || null, meetingNotes: meetingNotes || null,
      nextFollowUp: nextFollowUp || null, completedAt: new Date().toISOString(), completedBy: user.id,
    }).then(() => {
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
      toast(`Meeting marked ${status}.`, { type: 'success' })
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
        <FormField label="Outcome"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What was agreed/discussed." /></FormField>
        <FormField label="Meeting Notes"><Textarea value={meetingNotes} onChange={(e) => setMeetingNotes(e.target.value)} /></FormField>
        <FormField label="Next Follow-up"><DateInput value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}
