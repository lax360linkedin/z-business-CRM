// Pure rules for the Expenses module (shared by the mock API, the data migration and the screens).
// An expense is money the BUSINESS spends. It is kept completely apart from customer invoices and payments (revenue); the two only meet in reports.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const dayOf = (v) => String(v || '').slice(0, 10)

export const EXPENSE_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid', 'Reimbursed', 'Cancelled']
export const EXPENSE_KINDS = [
  { value: 'Company', label: 'Company expense', short: 'Company', help: 'Paid directly by the company (rent, utilities, subscriptions). Draft → Approved → Paid.' },
  { value: 'Vendor', label: 'Vendor expense', short: 'Vendor', help: 'A bill from a vendor the company pays. Draft → Submitted → Approved → Paid.' },
  { value: 'Employee', label: 'Employee reimbursement', short: 'Employee', help: 'An employee paid personally and claims it back. Draft → Submitted → Approved → Reimbursed.' },
]
export const KIND_LABEL = Object.fromEntries(EXPENSE_KINDS.map((k) => [k.value, k.label]))
export const TAX_RATES = [0, 5, 12, 18, 28]
export const PAID_BY = ['Company', 'Employee']
/** Statuses whose amount is a real business cost. Draft / Submitted / Under Review are not yet costs; Rejected and Cancelled never are. */
export const COST_STATUSES = ['Approved', 'Paid', 'Reimbursed']
export const PENDING_STATUSES = ['Submitted', 'Under Review']
export const OPEN_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved']
export const FROZEN_STATUSES = ['Paid', 'Reimbursed', 'Cancelled', 'Rejected']

export const DEFAULT_EXPENSE_CATEGORIES = [
  ['Office & Administration', '#6366f1'], ['Rent', '#8b5cf6'], ['Utilities', '#f59e0b'], ['Internet & Communication', '#0ea5e9'], ['Travel', '#10b981'], ['Transportation', '#14b8a6'],
  ['Marketing', '#ec4899'], ['Advertising', '#f43f5e'], ['Software & Subscriptions', '#3b82f6'], ['Equipment', '#64748b'], ['Maintenance', '#a16207'], ['Employee Expenses', '#22c55e'],
  ['Vendor Expenses', '#d946ef'], ['Project Expenses', '#06b6d4'], ['Client Expenses', '#f97316'], ['Professional Services', '#84cc16'], ['Taxes & Government Charges', '#ef4444'], ['Miscellaneous', '#94a3b8'],
].map(([name, color], i) => ({ id: `EXC-${String(i + 1).padStart(2, '0')}`, name, color, active: true, system: name === 'Miscellaneous', description: '' }))

export const DEFAULT_EXPENSE_CONFIG = {
  prefix: 'EXP',
  allowSelfApproval: false,
  // the most one approver may approve alone (a role not listed has no limit)
  approvalLimits: { 'Sales Manager': 50000, 'Project Manager': 50000 },
  approvalDueDays: 2,
  reimbursementDays: 7,
  receiptRequiredAbove: 5000,
}

// ---- permissions ----------------------------------------------------------------------------------------------------
export const EXPENSE_PERMISSIONS = [
  ['view', 'View expenses'], ['create', 'Create expenses'], ['edit', 'Edit expenses'], ['submit', 'Submit expenses'], ['approve', 'Approve expenses'], ['reject', 'Reject expenses'],
  ['markPaid', 'Mark expenses paid'], ['reimburse', 'Reimburse employees'], ['deleteDraft', 'Delete draft expenses'], ['export', 'Export expenses'], ['viewFinancial', 'View financial information'],
  ['manageCategories', 'Manage categories'], ['manageVendors', 'Manage vendors'],
]
const ALL = EXPENSE_PERMISSIONS.map(([k]) => k)
const STAFF = ['view', 'create', 'edit', 'submit', 'deleteDraft', 'viewFinancial']
const MANAGER = ['view', 'create', 'edit', 'submit', 'approve', 'reject', 'deleteDraft', 'viewFinancial']
export const EXPENSE_ROLE_CAPS = {
  'Super Admin': ALL, Admin: ALL, Accounts: ALL,
  MD: ['view', 'approve', 'reject', 'export', 'viewFinancial'],
  CEO: ['view', 'export', 'viewFinancial'],
  'Sales Manager': MANAGER, 'Project Manager': MANAGER,
  'Sales Executive': STAFF, 'Project Staff': STAFF, Marketing: STAFF, Support: STAFF, HR: STAFF,
}
export const EXPENSE_SCOPE = { 'Super Admin': 'Organization', Admin: 'Organization', Accounts: 'Organization', MD: 'Organization', CEO: 'Organization', 'Sales Manager': 'Team', 'Project Manager': 'Team' }
export const expenseScopeOf = (role) => EXPENSE_SCOPE[role] || 'Own'

/** Can this person see this expense? (data scope — the module permission is checked separately). */
export function expenseVisible(a, e, { usersById, projects }) {
  const scope = expenseScopeOf(a.role)
  if (scope === 'Organization') return true
  if (e.createdBy === a.id || e.employeeId === a.id || e.approverId === a.id) return true
  if (a.role === 'Project Manager' && e.projectId) { const p = (projects || []).find((x) => x.id === e.projectId); if (p && (p.manager === a.id || (p.team || []).includes(a.id))) return true }
  if (scope === 'Team') return [e.createdBy, e.employeeId].some((id) => id && usersById.get(id)?.department === a.department)
  return false
}

// ---- numbers & maths ------------------------------------------------------------------------------------------------
export function nextExpenseNumber(expenses, prefix = 'EXP', date = new Date()) {
  const year = date.getFullYear()
  const re = new RegExp(`^${prefix}-${year}-([0-9]+)$`)
  const max = (expenses || []).reduce((m, x) => { const h = re.exec(x.number || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `${prefix}-${year}-${String(max + 1).padStart(5, '0')}`
}
export function computeExpense(amount, taxRate) {
  const base = round2(amount)
  const rate = TAX_RATES.includes(Number(taxRate)) ? Number(taxRate) : 0
  const tax = round2(base * rate / 100)
  return { amount: base, taxRate: rate, tax, total: round2(base + tax) }
}

// ---- money state ----------------------------------------------------------------------------------------------------
/** What the business owes for this expense once approved: the approved amount (≤ the claim for employees), else the total. */
export const payableOf = (e) => (e.approvedAmount !== null && e.approvedAmount !== undefined && COST_STATUSES.includes(e.status) ? round2(e.approvedAmount) : round2(e.total))
export const paidOf = (e) => round2((e.payments || []).filter((p) => p.status !== 'Void').reduce((s, p) => s + (Number(p.amount) || 0), 0))
export const remainingOf = (e) => (COST_STATUSES.includes(e.status) ? Math.max(0, round2(payableOf(e) - paidOf(e))) : 0)
/** Payment status shown next to the workflow status. For employees the words are about reimbursement. */
export function paymentStatusOf(e) {
  const emp = e.kind === 'Employee'
  if (e.status === 'Cancelled' || e.status === 'Rejected') return 'Not payable'
  if (!COST_STATUSES.includes(e.status)) return 'Not approved yet'
  const paid = paidOf(e); const left = remainingOf(e)
  if (left <= 0.005 && paid > 0) return emp ? 'Reimbursed' : 'Paid'
  if (paid > 0) return emp ? 'Partly reimbursed' : 'Partially Paid'
  return emp ? 'Reimbursement pending' : 'Unpaid'
}
/** The cost counted in reports: what was approved (never more than the claim), net of nothing else. */
export const costOf = (e) => (COST_STATUSES.includes(e.status) ? payableOf(e) : 0)

// ---- workflow -------------------------------------------------------------------------------------------------------
/** What the workflow itself allows at this status (before permissions). */
export function stateActions(e) {
  const s = e.status
  const direct = e.kind !== 'Employee'
  const paid = paidOf(e)
  return {
    editAll: s === 'Draft',
    editLimited: s === 'Approved' || s === 'Submitted' || s === 'Under Review',
    editNotes: s !== 'Cancelled',
    submit: s === 'Draft',
    withdraw: s === 'Submitted' || s === 'Under Review',
    review: s === 'Submitted',
    approve: s === 'Submitted' || s === 'Under Review' || (s === 'Draft' && direct),
    reject: s === 'Submitted' || s === 'Under Review',
    pay: s === 'Approved' && remainingOf(e) > 0.005,
    revise: s === 'Rejected',
    cancel: ['Draft', 'Submitted', 'Under Review', 'Approved'].includes(s) && paid <= 0.005,
    deleteDraft: s === 'Draft',
  }
}

// ---- dashboard figures ----------------------------------------------------------------------------------------------
const monthKey = (d) => String(d).slice(0, 7)
export function expenseMetrics(rows, today = todayKey(), { projectName = () => null } = {}) {
  const list = (rows || []).filter((e) => !e.financialHidden)
  const cost = list.filter((e) => COST_STATUSES.includes(e.status))
  const sum = (l, f = costOf) => round2(l.reduce((s, x) => s + (Number(f(x)) || 0), 0))
  const byCat = new Map(); const byMonth = new Map(); const byProject = new Map()
  cost.forEach((e) => {
    byCat.set(e.categoryName || 'Uncategorised', round2((byCat.get(e.categoryName || 'Uncategorised') || 0) + costOf(e)))
    byMonth.set(monthKey(e.date), round2((byMonth.get(monthKey(e.date)) || 0) + costOf(e)))
    if (e.projectId) byProject.set(e.projectId, round2((byProject.get(e.projectId) || 0) + costOf(e)))
  })
  const months = []
  const base = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  for (let i = 11; i >= 0; i -= 1) { const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1)); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; months.push({ key, label: d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }), value: byMonth.get(key) || 0 }) }
  const pending = list.filter((e) => PENDING_STATUSES.includes(e.status))
  return {
    total: sum(cost), month: sum(cost.filter((e) => monthKey(e.date) === today.slice(0, 7))), today: sum(cost.filter((e) => dayOf(e.date) === today)),
    pendingCount: pending.length, pendingAmount: sum(pending, (e) => e.total),
    approvedCount: list.filter((e) => e.status === 'Approved').length, approvedAmount: sum(list.filter((e) => e.status === 'Approved')),
    rejectedCount: list.filter((e) => e.status === 'Rejected').length, rejectedAmount: sum(list.filter((e) => e.status === 'Rejected'), (e) => e.total),
    paidCount: list.filter((e) => ['Paid', 'Reimbursed'].includes(e.status)).length, paidAmount: sum(list.filter((e) => COST_STATUSES.includes(e.status)), paidOf),
    reimbursementPendingCount: list.filter((e) => e.kind === 'Employee' && e.status === 'Approved').length, reimbursementPending: sum(list.filter((e) => e.kind === 'Employee' && e.status === 'Approved'), remainingOf),
    vendorPayable: sum(list.filter((e) => e.kind === 'Vendor' && e.status === 'Approved'), remainingOf),
    vendor: sum(cost.filter((e) => e.kind === 'Vendor')), employee: sum(cost.filter((e) => e.kind === 'Employee')), company: sum(cost.filter((e) => e.kind === 'Company')), project: sum(cost.filter((e) => e.projectId)),
    categories: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), months,
    projects: [...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([id, value]) => ({ id, name: projectName(id) || id, value })), count: list.length,
  }
}

/** Cost of a project / deal / customer / company from its linked expenses, with the budget picture where there is one. */
export function expenseSummary(rows, budget = null) {
  const list = (rows || []).filter((e) => !e.financialHidden)
  const approved = list.filter((e) => COST_STATUSES.includes(e.status))
  const pending = list.filter((e) => PENDING_STATUSES.includes(e.status))
  const a = round2(approved.reduce((s, e) => s + costOf(e), 0)); const p = round2(pending.reduce((s, e) => s + (Number(e.total) || 0), 0))
  const cats = new Map(); approved.forEach((e) => cats.set(e.categoryName || 'Uncategorised', round2((cats.get(e.categoryName || 'Uncategorised') || 0) + costOf(e))))
  return { count: list.length, approved: a, pending: p, total: round2(a + p), budget: budget ?? null, remaining: budget === null || budget === undefined ? null : round2(budget - a), remainingAfterPending: budget === null || budget === undefined ? null : round2(budget - a - p), overBudget: budget ? a > budget : false, breakdown: [...cats.entries()].sort((x, y) => y[1] - x[1]).map(([name, value]) => ({ name, value })) }
}
