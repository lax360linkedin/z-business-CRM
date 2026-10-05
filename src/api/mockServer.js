import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { getCollection, setCollection, resetDb } from './db'
import { USERS } from '../data/users'
import { getActiveToken, emitSessionExpired } from '../utils/sessionToken'
import { validateSession, touchSession } from '../utils/sessionStore'
import { registerQuotationAttachmentEndpoints } from './quotationAttachmentApi'
import { registerSalesOrderEndpoints } from './salesOrderApi'
import { registerProposalEndpoints } from './proposalApi'
import { registerActivityEndpoints } from './activityApi'
import { registerTaskEndpoints, currentActor } from './taskApi'
import { registerCalendarEndpoints } from './calendarApi'

export const api = axios.create({ baseURL: '/api' })
const mock = new MockAdapter(api, { delayResponse: 300 })

function isTrue(v) {
  return v === true || v === 'true'
}

// A session can expire or end (logout/revoke) mid-flight under a request a component never
// attached a .catch() to (a background poll, a chart refetch) — the *consequence* is already
// fully handled the instant it happens (emitSessionExpired → AuthContext clears state and
// redirects for 'expired'/'revoked'; for 'missing' there's simply nothing left to be logged
// into — see withSession below), so neither rejection needs to also surface as a scary
// "Uncaught (in promise)" console error for a request whose caller never cared about its result
// past that point. Nothing else is suppressed — any other rejection still logs normally.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const code = e.reason?.response?.data?.code
    if (code === 'SESSION_EXPIRED' || code === 'UNAUTHENTICATED') e.preventDefault()
  })
}

/**
 * Every protected resource handler runs through this first — the actual enforcement point for
 * "session expiration must be enforced by the backend, not only a frontend timer." A React-side
 * idle/expiry timer is only ever a courtesy that redirects a little before this would anyway;
 * this check is what a stale or forged token actually fails against, by looking up the live
 * `sessions` record server-side (see src/utils/sessionStore.js), the same way every other mock
 * endpoint here reads its data from the shared DB rather than trusting whatever the client sent.
 */
function withSession(handler) {
  return (config) => {
    const token = getActiveToken()
    const result = validateSession(token)
    if (!result.valid) {
      // 'missing' = never logged in this tab (ProtectedRoute already keeps that state off
      // protected pages — this only catches a stray call during an unmount race) — no event to
      // emit, nothing "expired away" from. 'expired'/'revoked' is the real enforcement case:
      // a token that WAS good no longer is, so the backend rejects it regardless of whatever a
      // frontend timer thinks, and tells AuthContext to react immediately.
      if (result.reason === 'expired' || result.reason === 'revoked') {
        emitSessionExpired(result.reason)
        return [401, { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' }]
      }
      return [401, { code: 'UNAUTHENTICATED', message: 'Not signed in.' }]
    }
    touchSession(token)
    return handler(config)
  }
}

function paginate(list, params = {}) {
  const page = Number(params.page) || 1
  const pageSize = Number(params.pageSize) || 10
  const start = (page - 1) * pageSize
  return {
    data: list.slice(start, start + pageSize),
    total: list.length,
    page,
    pageSize,
  }
}

// Fields only a dedicated, validated endpoint may write (see quotationAttachmentApi.js) —
// stripped from generic create/update bodies so a plain PUT /quotations/:id can never overwrite
// or forge an attachment or the sent history.
const PROTECTED_FIELDS = {
  quotations: ['attachments', 'attachmentId', 'sends', 'sentAt', 'salesOrderId', 'proposalId', 'proposalNumber', 'proposalVersion'],
  invoices: ['salesOrderId', 'paymentIds', 'paidAmount'],
}
function stripProtected(name, body) {
  const out = { ...body }
  ;(PROTECTED_FIELDS[name] || []).forEach((k) => delete out[k])
  return out
}

function registerResource(name, path) {
  // LIST
  mock.onGet(path).reply(withSession((config) => {
    const list = getCollection(name)
    if (isTrue(config.params?.all)) return [200, list]
    return [200, paginate(list, config.params)]
  }))
  // DETAIL
  mock.onGet(new RegExp(`^${path}/[^/]+$`)).reply(withSession((config) => {
    const id = config.url.split('/').pop()
    const list = getCollection(name)
    const item = list.find((it) => it.id === id)
    return item ? [200, item] : [404, { message: 'Not found' }]
  }))
  // CREATE
  mock.onPost(path).reply(withSession((config) => {
    const body = stripProtected(name, JSON.parse(config.data))
    const list = getCollection(name)
    const item = { ...body }
    setCollection(name, [item, ...list])
    return [201, item]
  }))
  // UPDATE
  mock.onPut(new RegExp(`^${path}/[^/]+$`)).reply(withSession((config) => {
    const id = config.url.split('/').pop()
    const body = stripProtected(name, JSON.parse(config.data))
    const list = getCollection(name)
    const idx = list.findIndex((it) => it.id === id)
    if (idx === -1) return [404, { message: 'Not found' }]
    const updated = { ...list[idx], ...body }
    const next = [...list]
    next[idx] = updated
    setCollection(name, next)
    return [200, updated]
  }))
  // DELETE
  mock.onDelete(new RegExp(`^${path}/[^/]+$`)).reply(withSession((config) => {
    const id = config.url.split('/').pop()
    const list = getCollection(name)
    setCollection(name, list.filter((it) => it.id !== id))
    return [200, { success: true }]
  }))
}

const RESOURCES = [
  'users', 'userAccounts', 'companies', 'contacts', 'leads', 'enquiries', 'customers', 'deals',
  'quotations', 'quotationTemplates', 'salesOrders', 'proposals', 'proposalTemplates', 'products', 'projects', 'contracts', 'documents',
  'invoices', 'payments', 'expenses', 'campaigns', 'tickets', 'activities',
  'tasks', 'notifications',
]
RESOURCES.forEach((r) => registerResource(r, `/${r}`))
// Dedicated order-to-cash endpoints AFTER the generic ones: axios-mock-adapter replaces a handler that has
// an identical matcher, so registering later is what makes these override the generic PUT/DELETE/POST.
registerSalesOrderEndpoints(mock, withSession)
registerProposalEndpoints(mock, withSession)
registerActivityEndpoints(mock, withSession)
registerTaskEndpoints(mock, withSession)
registerCalendarEndpoints(mock, withSession)
registerQuotationAttachmentEndpoints(mock, withSession)

// --- Custom endpoints ---

mock.onPost('/auth/login').reply((config) => {
  const { email } = JSON.parse(config.data)
  const user = USERS.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
  if (!user) return [401, { message: 'Invalid email or password' }]
  return [200, { user, token: `mock-token-${user.id}` }]
})

mock.onPost('/notifications/read-all').reply(withSession(() => {
  const me = currentActor().id
  const list = getCollection('notifications').map((n) => (!n.userId || n.userId === me ? { ...n, read: true } : n))
  setCollection('notifications', list)
  return [200, { success: true }]
}))

mock.onPost('/db/reset').reply(() => {
  resetDb()
  return [200, { success: true }]
})

mock.onGet(/^\/search/).reply(withSession((config) => {
  const q = (config.params?.q || '').toLowerCase().trim()
  if (!q) return [200, []]
  const results = []
  const searchIn = (name, fields, type) => {
    getCollection(name).forEach((item) => {
      const hay = fields.map((f) => String(item[f] ?? '')).join(' ').toLowerCase()
      if (hay.includes(q)) results.push({ type, id: item.id, title: item.name || item.title || item.subject || item.number || item.id, subtitle: item.company || item.customerName || item.email || '' })
    })
  }
  searchIn('leads', ['name', 'company', 'email'], 'Lead')
  searchIn('contacts', ['name', 'companyName', 'email'], 'Contact')
  searchIn('companies', ['name', 'industry'], 'Company')
  searchIn('customers', ['name', 'industry'], 'Customer')
  searchIn('deals', ['name', 'companyName'], 'Deal')
  searchIn('projects', ['name', 'customerName'], 'Project')
  searchIn('invoices', ['number', 'customerName'], 'Invoice')
  searchIn('tickets', ['subject', 'customerName'], 'Ticket')
  return [200, results.slice(0, 20)]
}))

export default api
