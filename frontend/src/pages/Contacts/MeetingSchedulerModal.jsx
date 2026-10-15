import { useState } from 'react'
import { Copy, Mail, MessageCircle, CalendarClock } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { createNotification } from '../../utils/notify'
import { MEETING_TYPES } from '../../data/constants'
import { formatDate } from '../../utils/format'
import { waHref, mailHref, logContactActivity } from './contactCommunication'

/**
 * Meeting scheduling + link generation + sharing, mirroring src/pages/Leads/MeetingSchedulerModal.jsx
 * exactly. Uses the same shared `/meetings/:id` join page (MeetingJoin.jsx) — the meeting
 * record IS the activity record, tagged relatedType: 'Contact' so the join page and shared
 * MeetingOutcomeModal both route/PUT correctly.
 */
export function MeetingSchedulerModal({ open, onClose, contact, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [meetingType, setMeetingType] = useState(MEETING_TYPES[0])
  const [participants, setParticipants] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState(null)

  if (!contact) return null
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const reset = () => {
    setTitle(''); setDate(''); setStartTime(''); setEndTime(''); setMeetingType(MEETING_TYPES[0])
    setParticipants(''); setNotes(''); setCreated(null)
  }
  const closeAll = () => { reset(); onClose() }

  const defaultParticipants = () => participants || `${user.name} (You), ${contact.name} (${contact.companyName})`

  const schedule = () => {
    if (!title.trim() || !date || !startTime) return
    setSaving(true)
    const isOnline = meetingType === 'Online Meeting'
    logContactActivity({
      type: 'Meeting', relatedId: contact.id, relatedName: contact.name,
      subject: `Meeting scheduled: ${title}`, notes,
      title, meetingDate: date, meetingStartTime: startTime, meetingEndTime: endTime || null, timeZone,
      meetingType, participants: defaultParticipants(), meetingStatus: 'Scheduled',
      contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
      scheduledBy: user.id, scheduledAt: new Date().toISOString(), sharedVia: [],
      by: user.id,
    }).then((act) => {
      const meetingId = act.id
      const meetingLink = isOnline ? `/meetings/${meetingId}` : null
      createNotification({
        type: 'Meeting Scheduled',
        message: `Meeting "${title}" scheduled with ${contact.name} on ${formatDate(date)}.`,
        relatedType: 'Contact', relatedId: contact.id,
      })
      setSaving(false)
      setCreated({ id: meetingId, title, date, startTime, meetingLink, isOnline })
      onLogged?.()
    })
  }

  const shareMessage = (m) =>
    `Hi ${contact.name},\n\nYour meeting has been scheduled.\n\nMeeting:\n${m.title}\n\nDate:\n${formatDate(m.date)}\n\nTime:\n${m.startTime}\n\n${m.isOnline ? `Join Meeting:\n${window.location.origin}${m.meetingLink}\n\n` : ''}Thank you.`

  const shareVia = (channel) => {
    const message = shareMessage(created)
    if (channel === 'WhatsApp') window.open(waHref(contact.phone, message), '_blank')
    else window.open(mailHref(contact.email, `Meeting Scheduled: ${created.title}`, message), '_blank')
    logContactActivity({
      type: 'MeetingShared', relatedId: contact.id, relatedName: contact.name,
      subject: `Meeting shared via ${channel}`, channel, recipient: channel === 'WhatsApp' ? contact.phone : contact.email,
      meetingId: created.id, by: user.id,
    }).then(() => {
      toast(`Meeting shared via ${channel}.`, { type: 'success' })
      onLogged?.()
    })
  }

  const copyLink = () => {
    const link = `${window.location.origin}${created.meetingLink}`
    navigator.clipboard?.writeText(link)
      .then(() => toast('Meeting link copied.', { type: 'success' }))
      .catch(() => toast(link, { type: 'info' }))
  }

  return (
    <Modal
      open={open}
      onClose={closeAll}
      title={created ? 'Meeting Scheduled' : 'Schedule Meeting'}
      description={created ? undefined : `Set up a meeting with ${contact.name} (${contact.companyName}).`}
      footer={created
        ? <Button onClick={closeAll}>Done</Button>
        : <>
          <Button variant="ghost" onClick={closeAll}>Cancel</Button>
          <Button icon={CalendarClock} onClick={schedule} loading={saving} disabled={!title.trim() || !date || !startTime}>Schedule Meeting</Button>
        </>}
    >
      {created ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-900/20">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Meeting ID</p>
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">{created.id}</p>
            {created.isOnline ? (
              <>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Meeting Link (internal CRM room)</p>
                <p className="break-all text-sm text-emerald-800 dark:text-emerald-200">{window.location.origin}{created.meetingLink}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{meetingType} — no link needed.</p>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Share Meeting</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={MessageCircle} onClick={() => shareVia('WhatsApp')} disabled={!contact.phone}>Share via WhatsApp</Button>
              <Button variant="secondary" size="sm" icon={Mail} onClick={() => shareVia('Email')} disabled={!contact.email}>Share via Email</Button>
              {created.isOnline && <Button variant="secondary" size="sm" icon={Copy} onClick={copyLink}>Copy Meeting Link</Button>}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Meeting Title" required className="col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow-up Discussion" />
          </FormField>
          <FormField label="Date" required><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
          <FormField label="Time Zone"><Input value={timeZone} readOnly className="bg-ink-50 dark:bg-ink-800/60" /></FormField>
          <FormField label="Start Time" required><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></FormField>
          <FormField label="End Time"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></FormField>
          <FormField label="Meeting Type" className="col-span-2">
            <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
              {MEETING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FormField>
          <FormField label="Participants" className="col-span-2">
            <Input value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder={defaultParticipants()} />
          </FormField>
          <FormField label="Notes" className="col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
        </div>
      )}
    </Modal>
  )
}
