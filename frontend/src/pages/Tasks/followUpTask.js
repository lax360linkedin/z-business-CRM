// The follow-up dialogs on Lead / Enquiry / Contact / Deal create a real task through POST /tasks.
// This maps their form fields (follow-up type, time, "remind me") onto the task model.
const REMINDER_MINUTES = { 'At time of event': '0', '15 minutes before': '15', '30 minutes before': '30', '1 hour before': '60', '1 day before': '1440' }
const TYPE_MAP = { Call: 'Call', Email: 'Email', WhatsApp: 'WhatsApp', Meeting: 'Meeting', Demo: 'Demo', 'Site Visit': 'Site Visit' }

export function followUpTaskFields({ type, time, reminder }) {
  return { taskType: TYPE_MAP[type] || 'Follow-up', dueTime: time || null, reminderMinutes: REMINDER_MINUTES[reminder] || '' }
}
