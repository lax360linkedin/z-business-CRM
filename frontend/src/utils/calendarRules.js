// How the Calendar reads the CRM. The calendar owns no data of its own: every entry is derived, at read
// time, from the record that really holds it (a task, a scheduled activity or meeting, a record's next
// follow-up, an invoice due date …). Because nothing is copied, a change anywhere — rescheduling a meeting
// on a lead, completing a task, moving a follow-up — is reflected the next time the calendar loads.
// Shared by the mock server (src/api/calendarApi.js, taskApi.js) and the Calendar UI.

export const CALENDAR_KINDS = {
  task: { label: 'Tasks', singular: 'Task' },
  meeting: { label: 'Meetings & visits', singular: 'Meeting' },
  followup: { label: 'Follow-ups', singular: 'Follow-up' },
  reminder: { label: 'Reminders', singular: 'Reminder' },
  deadline: { label: 'Deadlines & due dates', singular: 'Deadline' },
}
export const KIND_ORDER = ['task', 'meeting', 'followup', 'reminder', 'deadline']

/** Activity types that are planned things with a time (they belong on a calendar even after they happen). */
export const MEETING_TYPES_CAL = ['Meeting', 'Demo / Presentation', 'Site Visit']
export const FOLLOWUP_TYPES_CAL = ['Follow-up', 'Payment Follow-up']
export const DEFAULT_MEETING_REMINDER = 15

export const reminderLabelToMinutes = (label) => ({ 'At time of event': 0, '5 minutes before': 5, '15 minutes before': 15, '30 minutes before': 30, '1 hour before': 60, '1 day before': 1440 }[label])

const pad = (n) => String(n).padStart(2, '0')
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
/** Parses 'YYYY-MM-DD' as a LOCAL day (new Date('2026-10-05') is UTC midnight and lands on the wrong day west of UTC). */
export function parseLocalDate(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }

/** The status a calendar entry should show for an activity. Meetings keep their own lifecycle in `meetingStatus`. */
export function activityStatus(a) {
  const ms = a.meetingStatus
  if (ms) return ms === 'Rescheduled' ? 'Scheduled' : ms === 'No Show' ? 'No Show' : ms
  // "follow-up scheduled for …" lines written by the Proposal / Sales Order / record dialogs were stored as Completed although nothing was done
  if (a.followUpDate && (a.status || 'Completed') === 'Completed' && !a.completedAt && !a.completedBy) return 'Scheduled'
  return a.status || 'Completed'
}

/**
 * When an activity happens. Meetings scheduled by the older Lead/Enquiry/Contact/Deal dialogs keep their real
 * time in meetingDate / meetingStartTime (their `date` is when they were *booked*); follow-ups keep it in
 * followUpDate / followUpTime; everything else uses `date`.
 */
export function activityWhen(a) {
  if (a.meetingDate) return { date: String(a.meetingDate).slice(0, 10), time: a.meetingStartTime || null, endTime: a.meetingEndTime || null }
  if (a.followUpDate) return { date: String(a.followUpDate).slice(0, 10), time: a.followUpTime || null, endTime: null }
  const d = new Date(a.date)
  if (Number.isNaN(d.getTime())) return null
  const hasTime = String(a.date).includes('T') && !(d.getHours() === 0 && d.getMinutes() === 0)
  return { date: localDate(d), time: hasTime ? localTime(d) : null, endTime: a.meetingEndTime || null }
}

/** Does this activity belong on the calendar, and as which kind? null = it is only history (notes, sent emails, system events…). */
export function activityKind(a) {
  if (a.source === 'task' || a.taskId) return null // the task itself is the calendar entry
  if (MEETING_TYPES_CAL.includes(a.type)) return 'meeting'
  if (a.type === 'Meeting' || a.meetingStatus) return 'meeting'
  if (FOLLOWUP_TYPES_CAL.includes(a.type)) {
    // older "Follow-up scheduled" log lines were written already-Completed next to a real task; only genuinely scheduled ones count
    return a.status === 'Scheduled' || a.followUpDate ? 'followup' : null
  }
  if (a.status === 'Scheduled' && !['Created', 'Updated', 'Note'].includes(a.type)) return 'followup'
  return null
}

/** Start instant of a dated entry (local time), or null. */
export function startOf(ev) {
  if (!ev?.date) return null
  const [h, m] = (ev.time || '00:00').split(':').map(Number)
  const d = parseLocalDate(ev.date)
  d.setHours(h, m, 0, 0)
  return d
}

/** Reminder minutes for a scheduled activity: its own setting, else the 15-minute default for meetings/visits. */
export function activityReminderMinutes(a) {
  if (a.reminderMinutes !== undefined && a.reminderMinutes !== null && a.reminderMinutes !== '') return Number(a.reminderMinutes)
  const fromLabel = reminderLabelToMinutes(a.reminder)
  if (fromLabel !== undefined) return fromLabel
  return MEETING_TYPES_CAL.includes(a.type) || a.meetingStatus ? DEFAULT_MEETING_REMINDER : null
}

export const CAL_REASONS = {
  reschedule: 'Only the person it is assigned to, whoever created it, or a manager can move this.',
}
