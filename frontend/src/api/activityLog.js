// What a person does on a record - a call, an email, a WhatsApp message, a note, a follow-up, a meeting - is logged through POST /activities/log. The server checks the
// facts, stamps who and when, resolves the link chain, creates the follow-up task a follow-up needs, and returns the stored activity.
// Everything the CRM itself does (created, status changed, assigned, converted, ...) is recorded by the server inside the action, so those events are not posted from here.
import { api } from './http'

const idOf = (f) => f.relatedId || f.leadId || f.enquiryId || f.dealId || f.contactId || f.customerId || f.companyId || f.quotationId || f.proposalId || f.projectId || f.contractId
const REMINDER = { 'At time of event': 0, '5 minutes before': 5, '15 minutes before': 15, '30 minutes before': 30, '1 hour before': 60, '1 day before': 1440 }
const minutesOf = (f) => (f.reminderMinutes !== undefined && f.reminderMinutes !== null && f.reminderMinutes !== '' ? Number(f.reminderMinutes) : REMINDER[f.reminder])
const text = (v) => (v === undefined || v === null ? undefined : String(v))

/** Maps the fields the existing dialogs collect onto the server's activity contract. Returns the stored activity, or null for events the server records by itself. */
export function logManualActivity(relatedType, f) {
  const base = { relatedType, relatedId: idOf(f), type: f.type }
  let body = null
  switch (f.type) {
    case 'Call':
      body = { ...base, subject: text(f.subject), description: text(f.notes), outcome: f.callOutcome || f.outcome, callType: f.callType, duration: f.duration }
      break
    case 'Email':
      body = { ...base, subject: text(f.emailSubject || f.subject), description: text(f.emailMessage || f.notes) }
      break
    case 'WhatsApp':
      body = { ...base, subject: text(f.subject), description: text(f.waMessage || f.notes) }
      break
    case 'Note':
      body = { ...base, subject: text(f.noteTitle || f.subject), description: text(f.notes) }
      break
    case 'Follow-up':
      body = { ...base, subject: text(f.subject), description: text(f.notes), date: f.followUpDate || f.date, time: f.followUpTime || f.time || undefined, followUpType: f.followUpType, assignedTo: f.assignedTo || undefined,
        reminderMinutes: minutesOf(f) }
      break
    case 'Meeting':
      body = { ...base, subject: text(f.title || f.subject), description: text(f.notes), date: f.meetingDate || f.date, time: f.meetingStartTime || f.time, endTime: f.meetingEndTime || f.endTime || undefined,
        meetingType: f.meetingType, location: f.location, assignedTo: f.assignedTo || undefined, reminderMinutes: minutesOf(f) }
      break
    default:
      return Promise.resolve(null)
  }
  return api.post('/activities/log', body).then((res) => res.data)
}
