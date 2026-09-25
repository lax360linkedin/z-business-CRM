import { api } from '../api/mockServer'
import { genId } from './csv'

/**
 * The one place that creates a live notification. Before this existed, `NOTIFICATION_TYPES`
 * had a defined 'New Lead'/'Lead Assignment'/'Follow-up Reminder' vocabulary but nothing in
 * the app ever actually posted one — the Notifications page only ever showed static seed
 * text. `relatedType`/`relatedId` are additive fields (older seed notifications won't have
 * them) that let the bell/notifications list deep-link back to the record later.
 */
export function createNotification({ type, message, relatedType = null, relatedId = null }) {
  return api.post('/notifications', {
    id: genId('NTF'),
    type,
    message,
    relatedType,
    relatedId,
    date: new Date().toISOString(),
    read: false,
  })
}
