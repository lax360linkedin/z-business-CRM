// Branch model of the CRM. The branches themselves are records on the server (Branch Management, Super Admin); BRANCH_NAMES mirrors the active ones for the pickers and
// is refreshed after sign-in (setBranchNames). Isolation between branches is enforced by the server on every request - what the screens show is only a reflection of it.

export const BRANCH_NAMES = ['Salem', 'Mumbai', 'Bangalore']
export const ALL_BRANCHES = 'all'
export const SCOPE_KEY = 'business_crm_branch_scope_v1'

/** Replaces the branch names in place (so every module that imported the array sees the live list). */
export function setBranchNames(names) {
  if (Array.isArray(names) && names.length) BRANCH_NAMES.splice(0, BRANCH_NAMES.length, ...names)
}

/** The route segment -> API collection of record detail pages (used to show the record's branch above the page). */
export const DETAIL_COLLECTION = {
  leads: 'leads', enquiries: 'enquiries', contacts: 'contacts', companies: 'companies', customers: 'customers', deals: 'deals', quotations: 'quotations', 'sales-orders': 'salesOrders',
  proposals: 'proposals', projects: 'projects', contracts: 'contracts', invoices: 'invoices', payments: 'payments', expenses: 'expenses', campaigns: 'campaigns', tickets: 'tickets',
  tasks: 'tasks', documents: 'documents', employees: 'employees',
}
