import { logManualActivity } from '../../api/activityLog'
import { api } from '../../api/mockServer'
import { changeLeadStatus } from './leadActions'

/**
 * Real device/browser actions for Call/WhatsApp/Email — never simulated. `tel:`/`wa.me`/
 * `mailto:` are the honest options available to a frontend-only CRM with no live telephony,
 * WhatsApp Business API or SMTP server connected (see spec §37 "do not fake external
 * communication"). Each hands off to whatever the user's OS/browser has configured — the CRM
 * only ever records that the salesperson performed the action, not that the far end received it.
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
 * Posts an activity record. Callers pass `id` explicitly for types that need a stable,
 * independently-addressable id (Meeting — see MTG-prefixed ids doubling as `/meetings/:id`
 * route params) and omit it otherwise for the default ACT-prefixed id.
 */
export function logLeadActivity(fields) {
  return logManualActivity('Lead', fields)
}

/**
 * The single place that implements spec §21: a successfully recorded Call/Email/WhatsApp/
 * Meeting communication is what moves a brand-new lead to Contacted — never opening the
 * detail page, never a free status dropdown. Only fires from New (a lead already past New
 * doesn't get re-transitioned just because another call happened), and always logs its own
 * StatusChange activity via changeLeadStatus so the automatic move is traceable in Status
 * History exactly like a manual one.
 */
export function advanceToContactedAfterContact(lead, { by, via }) {
  if (!lead || lead.status !== 'New') return Promise.resolve(null)
  return changeLeadStatus(lead, 'Contacted', { by, note: `First contact completed via ${via}.` })
}
