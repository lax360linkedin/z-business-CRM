import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'

/**
 * Real device/browser actions for Call/WhatsApp/Email — never simulated, mirroring
 * src/pages/Leads/leadCommunication.js exactly. `tel:`/`wa.me`/`mailto:` are the honest
 * options available to a frontend-only CRM with no live telephony, WhatsApp Business API or
 * SMTP server connected. Each hands off to whatever the user's OS/browser has configured — the
 * CRM only ever records that the team member performed the action, not that the far end
 * received it. A Contact has no lifecycle status (unlike Lead/Enquiry), so there's no
 * auto-transition here — just an honest, structured activity record.
 */
export function telHref(phone) {
  return `tel:${String(phone || '').replace(/[^\d+]/g, '')}`
}

export function waHref(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '')
  const text = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${text}`
}

export function mailHref(email, subject, body) {
  return `mailto:${email || ''}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`
}

/**
 * Posts an activity record with arbitrary structured fields (callOutcome/duration,
 * emailSubject/emailStatus, meetingStatus/meetingLink, …) — same shape as
 * leadCommunication.js's logLeadActivity / enquiryCommunication.js's logEnquiryActivity.
 */
export function logContactActivity(fields) {
  return api.post('/activities', {
    id: fields.id || genId('ACT'),
    relatedType: 'Contact',
    date: new Date().toISOString(),
    status: 'Completed',
    ...fields,
  }).then((res) => res.data)
}
