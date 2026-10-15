import { api } from './http'

// Warming the read cache (see api/http.js) for the screen someone is about to open: while the pointer is still travelling to a menu entry - or while the sign-in answer is on its
// way back - the lists that screen will ask for are already being fetched, so when it mounts they are in flight or done. Only modules the person may view are ever requested
// (an unauthorised request would be refused AND recorded as a denied attempt), and a failure is silent: the screen asks again for itself and shows its own error.
const LISTS = (...names) => names.map((name) => ({ url: `/${name}`, params: { all: true } }))
const needs = (label, ...names) => ({ label, requests: LISTS(...names) })

const DASHBOARD = [
  needs('Leads', 'leads'), needs('Enquiries', 'enquiries'), needs('Deals', 'deals'), needs('Customers', 'customers'), needs('Projects', 'projects'), needs('Sales Orders', 'salesOrders'),
  needs('Invoices', 'invoices'), needs('Payments', 'payments'), needs('Tasks', 'tasks'), needs('Activities', 'activities'),
  { label: 'Dashboard', requests: [{ url: '/reports/monthly-performance', params: { months: 12 } }] },
]

const SCREENS = {
  '/dashboard': DASHBOARD,
  '/leads': [needs('Leads', 'leads')], '/enquiries': [needs('Enquiries', 'enquiries')], '/contacts': [needs('Contacts', 'contacts'), needs('Companies', 'companies')],
  '/companies': [needs('Companies', 'companies'), needs('Deals', 'deals'), needs('Customers', 'customers'), needs('Projects', 'projects')],
  '/customers': [needs('Customers', 'customers'), needs('Companies', 'companies')], '/deals': [needs('Deals', 'deals'), needs('Companies', 'companies')], '/pipeline': [needs('Deals', 'deals')],
  '/quotations': [needs('Quotations', 'quotations')], '/sales-orders': [needs('Sales Orders', 'salesOrders')], '/proposals': [needs('Proposals', 'proposals')],
  '/activities': [needs('Activities', 'activities')], '/tasks': [needs('Tasks', 'tasks')], '/products': [needs('Products & Services', 'products')], '/projects': [needs('Projects', 'projects')],
  '/contracts': [needs('Contracts', 'contracts')], '/invoices': [needs('Invoices', 'invoices')], '/payments': [needs('Payments', 'payments')], '/expenses': [needs('Expenses', 'expenses')],
  '/campaigns': [needs('Campaigns', 'campaigns')], '/tickets': [needs('Tickets', 'tickets')], '/notifications': [needs('Notifications', 'notifications')],
}

/** Starts the reads behind a screen. `can(label)` says whether the signed-in person may view a module; nothing else is requested. */
export function prefetchData(path, can) {
  const plan = SCREENS[String(path).split('?')[0].replace(/\/$/, '')]
  if (!plan) return
  plan.forEach(({ label, requests }) => {
    if (!can(label)) return
    requests.forEach((r) => api.get(r.url, { params: r.params }).catch(() => null))
  })
}
