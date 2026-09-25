import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'

/**
 * Real device/browser actions for Call/WhatsApp/Email — never simulated, mirroring
 * src/pages/Contacts/contactCommunication.js exactly. The Deal itself has no phone/email of its
 * own — these act on the Deal's linked primary Contact — but the activity is always logged
 * against the DEAL (relatedType: 'Deal'), per spec §5 ("Record the call activity" in the Deal
 * timeline), not the Contact's own timeline.
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

export function logDealActivity(fields) {
  return api.post('/activities', {
    id: fields.id || genId('ACT'),
    relatedType: 'Deal',
    date: new Date().toISOString(),
    status: 'Completed',
    ...fields,
  }).then((res) => res.data)
}
