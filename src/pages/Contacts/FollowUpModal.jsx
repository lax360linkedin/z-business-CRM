import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { salesUsers } from '../../data/users'
import { FOLLOWUP_TYPES, REMINDER_OPTIONS } from '../../data/constants'
import { formatDate } from '../../utils/format'
import { followUpTaskFields } from '../Tasks/followUpTask'
import { logContactActivity } from './contactCommunication'

/** Mirrors src/pages/Leads/FollowUpModal.jsx — same field set (Type/Date/Time/Reminder/
 * Assigned User/Notes). A Contact has no owning salesperson field (unlike Lead/Enquiry), so
 * "Assigned User" here defaults to whoever is scheduling the follow-up rather than an existing
 * owner. */
export function FollowUpModal({ open, onClose, contact, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const reps = salesUsers()
  const [type, setType] = useState('Call')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [reminder, setReminder] = useState(REMINDER_OPTIONS[1])
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  if (!contact) return null
  const reset = () => { setType('Call'); setDate(''); setTime(''); setReminder(REMINDER_OPTIONS[1]); setAssignedTo(''); setNotes(''); }

  const save = () => {
    if (!date) return
    setSaving(true)
    const assignee = assignedTo || user.id
    api.put(`/contacts/${contact.id}`, { nextFollowUp: date }).then(() => logContactActivity({
      type: 'Follow-up', relatedId: contact.id, relatedName: contact.name,
      subject: `${type} follow-up scheduled for ${formatDate(date)}`, notes,
      followUpType: type, followUpDate: date, followUpTime: time || null, reminder, assignedTo: assignee,
      by: user.id,
    })).then(() => api.post('/tasks', {
      title: `${type} follow-up — ${contact.name} (${contact.companyName})`,
      relatedType: 'Contact', relatedId: contact.id, relatedName: contact.name,
      assignedTo: assignee, priority: 'Medium', dueDate: date, description: notes, ...followUpTaskFields({ type, time, reminder }),
    })).then(() => {
      setSaving(false)
      toast('Follow-up scheduled.', { type: 'success' })
      reset()
      onLogged?.()
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Add Follow-up"
      description={`Schedule the next follow-up for ${contact.name}.`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!date}>Schedule</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Follow-up Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {FOLLOWUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        <FormField label="Assigned User">
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Me ({user.name})</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Date" required><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
        <FormField label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormField>
        <FormField label="Reminder" className="col-span-2">
          <Select value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {REMINDER_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </FormField>
        <FormField label="Notes" className="col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}
