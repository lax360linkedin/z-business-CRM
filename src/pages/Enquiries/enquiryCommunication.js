import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { changeEnquiryStatus } from './enquiryActions'

/**
 * Real device/browser actions for Call/WhatsApp/Email — never simulated, mirroring
 * src/pages/Leads/leadCommunication.js exactly. `tel:`/`wa.me`/`mailto:` are the honest options
 * available to a frontend-only CRM with no live telephony, WhatsApp Business API or SMTP server
 * connected. Each hands off to whatever the user's OS/browser has configured — the CRM only
 * ever records that the team member performed the action, not that the far end received it.
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
 * emailSubject/emailStatus, meetingStatus/meetingLink, …) — a more flexible sibling of
 * enquiryActions.js's own logEnquiryActivity(), which only accepts the fixed
 * type/subject/notes/by shape. Callers pass `id` explicitly for types that need a stable,
 * independently-addressable id (Meeting — reuses the same MTG-prefixed id as the Lead module's
 * `/meetings/:id` join route, since a Meeting scheduled from an Enquiry uses the same join page).
 */
export function logEnquiryActivity(fields) {
  return api.post('/activities', {
    id: fields.id || genId('ACT'),
    relatedType: 'Enquiry',
    date: new Date().toISOString(),
    status: 'Completed',
    ...fields,
  }).then((res) => res.data)
}

/**
 * A successfully recorded Call/Email/WhatsApp/Meeting is what moves a New or Assigned enquiry
 * to Contacted — never opening the detail page, never a free status dropdown. Mirrors
 * advanceToContactedAfterContact() in the Lead module exactly, except an Enquiry can advance
 * from either New or Assigned (spec §8: both "New: primary action Contact" and "Assigned: can
 * be contacted" reach Contacted the same way).
 */
export function advanceEnquiryToContactedAfterContact(enquiry, { by, via }) {
  if (!enquiry || !['New', 'Assigned'].includes(enquiry.status)) return Promise.resolve(null)
  return changeEnquiryStatus(enquiry, 'Contacted', { by, note: `First contact completed via ${via}.` })
}
