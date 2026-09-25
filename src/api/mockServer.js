import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { getCollection, setCollection, resetDb } from './db'
import { USERS } from '../data/users'

export const api = axios.create({ baseURL: '/api' })
const mock = new MockAdapter(api, { delayResponse: 300 })

function isTrue(v) {
  return v === true || v === 'true'
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

function registerResource(name, path) {
  // LIST
  mock.onGet(path).reply((config) => {
    const list = getCollection(name)
    if (isTrue(config.params?.all)) return [200, list]
    return [200, paginate(list, config.params)]
  })
  // DETAIL
  mock.onGet(new RegExp(`^${path}/[^/]+$`)).reply((config) => {
    const id = config.url.split('/').pop()
    const list = getCollection(name)
    const item = list.find((it) => it.id === id)
    return item ? [200, item] : [404, { message: 'Not found' }]
  })
  // CREATE
  mock.onPost(path).reply((config) => {
    const body = JSON.parse(config.data)
    const list = getCollection(name)
    const item = { ...body }
    setCollection(name, [item, ...list])
    return [201, item]
  })
  // UPDATE
  mock.onPut(new RegExp(`^${path}/[^/]+$`)).reply((config) => {
    const id = config.url.split('/').pop()
    const body = JSON.parse(config.data)
    const list = getCollection(name)
    const idx = list.findIndex((it) => it.id === id)
    if (idx === -1) return [404, { message: 'Not found' }]
    const updated = { ...list[idx], ...body }
    const next = [...list]
    next[idx] = updated
    setCollection(name, next)
    return [200, updated]
  })
  // DELETE
  mock.onDelete(new RegExp(`^${path}/[^/]+$`)).reply((config) => {
    const id = config.url.split('/').pop()
    const list = getCollection(name)
    setCollection(name, list.filter((it) => it.id !== id))
    return [200, { success: true }]
  })
}

const RESOURCES = [
  'users', 'userAccounts', 'companies', 'contacts', 'leads', 'enquiries', 'customers', 'deals',
  'quotations', 'salesOrders', 'proposals', 'products', 'projects', 'contracts', 'documents',
  'invoices', 'payments', 'expenses', 'campaigns', 'tickets', 'activities',
  'tasks', 'notifications',
]
RESOURCES.forEach((r) => registerResource(r, `/${r}`))

// --- Custom endpoints ---

mock.onPost('/auth/login').reply((config) => {
  const { email } = JSON.parse(config.data)
  const user = USERS.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
  if (!user) return [401, { message: 'Invalid email or password' }]
  return [200, { user, token: `mock-token-${user.id}` }]
})

mock.onPost('/notifications/read-all').reply(() => {
  const list = getCollection('notifications').map((n) => ({ ...n, read: true }))
  setCollection('notifications', list)
  return [200, { success: true }]
})

mock.onPost('/db/reset').reply(() => {
  resetDb()
  return [200, { success: true }]
})

mock.onGet(/^\/search/).reply((config) => {
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
})

export default api
