import { api } from '../api/mockServer'
import { productByName } from './productRules'

/** Async: the catalog item a free-text service name refers to (live lookup) — used where records are converted (Enquiry → Lead → Deal). */
export function resolveProductId(name) {
  if (!name) return Promise.resolve(null)
  return api.get('/products', { params: { all: true } }).then((r) => productByName(r.data, name)?.id || null).catch(() => null)
}
