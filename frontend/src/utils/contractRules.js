// Contract lifecycle rules: statuses and who may move between them, permissions, renewal and billing maths, template merge fields.
// Pure — the Contracts pages, the migration, the reminder hook and the PDF generator all use these same functions.
import { round2 } from './salesOrderCalc'

export const CONTRACT_STATUS_LIST = ['Draft', 'Internal Review', 'Pending Approval', 'Approved', 'Sent', 'Signed', 'Active', 'Expiring Soon', 'Expired', 'Renewed', 'Terminated', 'Cancelled']
export const CONTRACT_OPEN = ['Draft', 'Internal Review', 'Pending Approval', 'Approved', 'Sent', 'Signed', 'Active', 'Expiring Soon']
export const CONTRACT_LIVE = ['Active', 'Expiring Soon', 'Signed']
export const CONTRACT_CLOSED = ['Expired', 'Renewed', 'Terminated', 'Cancelled']
export const DEFAULT_CONTRACT_TYPES = ['Service Agreement', 'Software Development Agreement', 'AMC / Maintenance Contract', 'Annual Support Contract', 'Subscription Agreement', 'Consulting Agreement', 'NDA', 'Partnership Agreement', 'Vendor Agreement', 'Custom Contract']
export const BILLING_FREQUENCIES = ['One-time', 'Monthly', 'Quarterly', 'Half-yearly', 'Annual', 'Milestone-based']
export const CYCLE_MONTHS = { Monthly: 1, Quarterly: 3, 'Half-yearly': 6, Annual: 12 }
export const REMINDER_DAYS = [90, 60, 30, 15, 7]
export const DEFAULT_CONTRACT_CONFIG = { approvalRequired: true, reminderDays: [90, 60, 30, 15, 7], expiringSoonDays: 60, renewalTaskDays: 30 }
export const ORG_NAME = 'LAX360 Pvt Ltd'

export const todayKey = () => new Date().toISOString().slice(0, 10)
export const daysUntil = (date, today = todayKey()) => (date ? Math.round((new Date(`${date.slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null)
export function addDaysKey(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export function addMonthsKey(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

// ---- lifecycle ------------------------------------------------------------------------------------------------
// 'auto' statuses are never set by hand: Expiring Soon / Expired follow the end date, Renewed is set by the renewal action.
export const AUTO_STATUSES = ['Expiring Soon', 'Expired', 'Renewed']
// from → { to: permission needed }. Draft → Approved is only offered when the workspace doesn't require approval.
export const CONTRACT_TRANSITIONS = {
  Draft: { 'Internal Review': 'edit', Approved: 'approve', Cancelled: 'changeStatus' },
  'Internal Review': { 'Pending Approval': 'edit', Draft: 'edit', Cancelled: 'changeStatus' },
  'Pending Approval': { Approved: 'approve', 'Internal Review': 'approve', Draft: 'approve', Cancelled: 'changeStatus' },
  Approved: { Sent: 'send', Draft: 'edit', Cancelled: 'changeStatus' },
  Sent: { Signed: 'changeStatus', Draft: 'edit', Cancelled: 'changeStatus' },
  Signed: { Active: 'changeStatus', Terminated: 'terminate' },
  Active: { Terminated: 'terminate' },
  'Expiring Soon': { Terminated: 'terminate' },
  Expired: {}, Renewed: {}, Terminated: {}, Cancelled: {},
}
/** Transitions that need a typed reason (kept on the contract and the audit trail). */
export const REASON_REQUIRED = { Cancelled: true, Terminated: true }
export const REJECTIONS = [['Pending Approval', 'Internal Review'], ['Pending Approval', 'Draft']]
export const isRejection = (from, to) => REJECTIONS.some(([a, b]) => a === from && b === to)

/** What the contract IS today: Active / Expiring Soon / Expired follow the dates, whatever was last stored. */
export function effectiveStatus(c, config = DEFAULT_CONTRACT_CONFIG, today = todayKey()) {
  if (['Active', 'Expiring Soon', 'Expired'].includes(c.status)) {
    const left = daysUntil(c.endDate, today)
    if (left === null) return c.status === 'Expired' ? 'Active' : c.status
    if (left < 0) return 'Expired'
    return left <= (config.expiringSoonDays ?? 60) ? 'Expiring Soon' : 'Active'
  }
  return c.status
}

export function allowedTransitions(c, perms, config = DEFAULT_CONTRACT_CONFIG) {
  const status = effectiveStatus(c, config)
  return Object.entries(CONTRACT_TRANSITIONS[status] || {}).filter(([to, need]) => {
    if (to === 'Approved' && status === 'Draft' && config.approvalRequired) return false
    return !!perms[need]
  }).map(([to]) => to)
}

// ---- permissions ---------------------------------------------------------------------------------------------
const ALL = ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'send', 'uploadDocuments', 'replaceDocuments', 'generate', 'changeStatus', 'renew', 'terminate', 'viewFinancial']
export const CONTRACT_ROLE_CAPS = {
  'Super Admin': ALL, Admin: ALL,
  MD: ['view', 'approve', 'viewFinancial'], CEO: ['view', 'viewFinancial'],
  'Sales Manager': ['view', 'create', 'edit', 'assign', 'approve', 'send', 'uploadDocuments', 'replaceDocuments', 'generate', 'changeStatus', 'renew', 'viewFinancial'],
  'Sales Executive': ['view', 'create', 'edit', 'uploadDocuments', 'generate', 'viewFinancial'],
  'Project Manager': ['view', 'uploadDocuments'], Accounts: ['view', 'viewFinancial'],
}
export const CONTRACT_PERMISSION_LABELS = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', assign: 'Assign', approve: 'Approve', send: 'Send', uploadDocuments: 'Upload documents', replaceDocuments: 'Replace documents', generate: 'Generate', changeStatus: 'Change status', renew: 'Renew', terminate: 'Terminate', viewFinancial: 'View financials' }
const scopeOf = (role) => (['Sales Executive'].includes(role) ? 'Own' : ['Sales Manager', 'Project Manager'].includes(role) ? 'Team' : 'Organization')

export function isContractMember(user, c) { return !!user && (c.owner === user.id || (c.team || []).includes(user.id) || c.createdBy === user.id) }

/** May this user open the contract at all? Own = owner/team/creator; Team = also anyone in the owner's department; otherwise organisation-wide. */
export function canViewContract(user, c, { hasPermission, usersById, projects = [] }) {
  if (!user || !hasPermission('Contracts', 'view') || !(CONTRACT_ROLE_CAPS[user.role] || []).includes('view')) return false
  const scope = scopeOf(user.role)
  if (scope === 'Organization' || isContractMember(user, c)) return true
  if (user.role === 'Project Manager') { const p = projects.find((x) => x.id === c.projectId); if (p && (p.manager === user.id || (p.team || []).includes(user.id))) return true }
  if (scope === 'Team') return usersById?.get(c.owner)?.department === user.department
  return false
}

export function contractPermissions(user, c, ctx) {
  const caps = CONTRACT_ROLE_CAPS[user?.role] || []
  const hp = ctx.hasPermission
  const view = c ? canViewContract(user, c, ctx) : hp('Contracts', 'view') && caps.includes('view')
  const admin = ['Super Admin', 'Admin'].includes(user?.role)
  const mine = !!c && isContractMember(user, c)
  const has = (k) => caps.includes(k)
  const closed = !!c && CONTRACT_CLOSED.includes(c.status)
  const editable = !!c && ['Draft', 'Internal Review', 'Approved'].includes(c.status)
  return {
    view,
    create: hp('Contracts', 'create') && has('create'),
    edit: view && hp('Contracts', 'edit') && has('edit') && !closed && (admin || mine || scopeOf(user.role) !== 'Own') && (editable || admin || has('changeStatus')),
    delete: view && hp('Contracts', 'delete') && has('delete') && !!c && ['Draft', 'Cancelled'].includes(c.status),
    assign: view && has('assign'), approve: view && has('approve'), send: view && has('send'),
    uploadDocuments: view && has('uploadDocuments') && (!closed || admin), replaceDocuments: view && has('replaceDocuments'), generate: view && has('generate'),
    changeStatus: view && has('changeStatus'), renew: view && has('renew') && !!c && !['Draft', 'Cancelled', 'Terminated', 'Renewed'].includes(c.status), terminate: view && has('terminate'),
    viewFinancial: view && has('viewFinancial'), createTasks: view && (has('edit') || has('changeStatus') || has('uploadDocuments')),
    manual: hp('Contracts', 'create') && ['Super Admin', 'Admin', 'Sales Manager'].includes(user?.role),
  }
}

// ---- renewal -------------------------------------------------------------------------------------------------------
export const noticeDeadline = (c) => (c.endDate && c.noticePeriodDays ? addDaysKey(c.endDate.slice(0, 10), -Number(c.noticePeriodDays)) : null)

/** Where a contract stands on renewal. `tasks` and `contracts` are the live collections. */
export function renewalState(c, { tasks = [], contracts = [], config = DEFAULT_CONTRACT_CONFIG } = {}) {
  const status = effectiveStatus(c, config)
  const left = daysUntil(c.endDate)
  const renewedTo = c.renewedToId ? contracts.find((x) => x.id === c.renewedToId) : null
  const draftRenewal = contracts.find((x) => x.renewedFromId === c.id && !['Cancelled'].includes(x.status))
  const task = tasks.find((t) => t.id === c.renewalTaskId && t.status !== 'Cancelled')
  let label = 'Not due'
  if (status === 'Renewed') label = 'Renewed'
  else if (['Terminated', 'Cancelled'].includes(status)) label = 'Not applicable'
  else if (['Draft', 'Internal Review', 'Pending Approval', 'Approved', 'Sent'].includes(status)) label = 'Not started'
  else if (draftRenewal) label = 'Renewal in progress'
  else if (c.renewalDecision === 'not-renewing') label = 'Not renewing'
  else if (left !== null && left < 0) label = 'Overdue — expired'
  else if (task && task.status !== 'Completed') label = 'Renewal in progress'
  else if (left !== null && left <= Math.max(...(config.reminderDays || REMINDER_DAYS))) label = c.autoRenew ? 'Auto-renews' : 'Due for renewal'
  return { status, daysLeft: left, label, task, renewal: draftRenewal || renewedTo || null, noticeDeadline: noticeDeadline(c) }
}

/** Duration-preserving terms for the renewal contract. */
export function renewalDates(c) {
  const start = addDaysKey(c.endDate.slice(0, 10), 1)
  const days = Math.max(30, daysUntil(c.endDate, c.startDate.slice(0, 10)))
  return { startDate: start, endDate: addDaysKey(start, days), renewalDate: addDaysKey(addDaysKey(start, days), -(Number(c.noticePeriodDays) || 30)) }
}

// ---- billing -------------------------------------------------------------------------------------------------------
/**
 * An invoice belongs to the contract it names (contractId), else to the contract of its sales order, else — only when neither is recorded —
 * to the project's original contract. Passing the full contract list stops one invoice being counted on several contracts of one project.
 */
const isProjectPrimary = (c, all) => all.filter((x) => x.projectId === c.projectId && x.status !== 'Cancelled' && !x.renewedFromId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id))[0]?.id === c.id
export const invoicesOfContract = (c, invoices, all = null) => invoices.filter((i) => {
  if (i.contractId) return i.contractId === c.id
  if (c.salesOrderId && i.salesOrderId === c.salesOrderId) return true
  if (!c.projectId || i.projectId !== c.projectId) return false
  if (!all) return true
  return !(i.salesOrderId && all.some((x) => x.salesOrderId === i.salesOrderId)) && isProjectPrimary(c, all)
})

/** Invoiced = issued invoices; Paid = payments actually recorded against them (an invoice alone never makes a contract "paid"). */
export function contractBilling(c, invoices, payments, contracts = null) {
  const all = invoicesOfContract(c, invoices, contracts)
  const issued = all.filter((i) => !['Draft', 'Cancelled', 'Void'].includes(i.status))
  const ids = new Set(all.map((i) => i.id))
  const pays = payments.filter((p) => ids.has(p.invoiceId) && (p.status === undefined || p.status === 'Completed' || p.status === 'Partially Refunded'))
  const invoiced = round2(issued.reduce((s, i) => s + (i.amount || 0), 0))
  const paid = round2(pays.reduce((s, p) => s + (p.amount || 0) - (p.refundedAmount || 0), 0))
  const value = Number(c.value) || 0
  let paymentStatus = 'Not invoiced'
  if (invoiced > 0) paymentStatus = paid <= 0 ? 'Unpaid' : paid >= invoiced - 0.005 ? 'Paid' : 'Partially paid'
  return { invoices: all, issued, payments: pays, value, invoiced, paid, outstanding: round2(Math.max(0, invoiced - paid)), unbilled: round2(Math.max(0, value - invoiced)), paymentStatus, nextBillingDate: nextBillingDate(c, all) }
}

/** The next billing cycle on or after today, counted from the start date (null for one-time / milestone billing or past the end date). */
export function nextBillingDate(c, invoices = []) {
  const months = CYCLE_MONTHS[c.billingFrequency]
  if (!months || !c.startDate || ['Draft', 'Cancelled', 'Terminated', 'Expired', 'Renewed'].includes(c.status)) return null
  const today = todayKey()
  let d = c.startDate.slice(0, 10)
  for (let i = 0; i < 400 && d < today; i += 1) d = addMonthsKey(c.startDate.slice(0, 10), months * (i + 1))
  return c.endDate && d > c.endDate.slice(0, 10) ? null : d
}

// ---- numbering & validation ----------------------------------------------------------------------------------------
export function nextContractNumbers(contracts) {
  const year = new Date().getFullYear()
  const top = contracts.reduce((m, c) => { const h = /^CN-(\d+)$/.exec(c.id); return h ? Math.max(m, Number(h[1])) : m }, 6999)
  const n = top + 1
  return { id: `CN-${n}`, number: `CNT-${year}-${n}` }
}

export function validateContractInput(f) {
  const e = {}
  if (!String(f.title || '').trim()) e.title = 'Give the contract a title.'
  else if (f.title.length > 160) e.title = 'Title is too long (max 160 characters).'
  if (!f.contractType) e.contractType = 'Choose a contract type.'
  if (!f.customerId) e.customerId = 'Choose the customer.'
  if (!f.owner) e.owner = 'Choose the contract owner.'
  if (!f.startDate) e.startDate = 'Set the start date.'
  if (!f.endDate) e.endDate = 'Set the end date.'
  else if (f.startDate && f.endDate < f.startDate) e.endDate = 'End date cannot be before the start date.'
  if (f.renewalDate && f.endDate && f.renewalDate > f.endDate) e.renewalDate = 'Renewal date should be on or before the end date.'
  if (f.value === '' || f.value === undefined || Number(f.value) < 0 || Number.isNaN(Number(f.value))) e.value = 'Enter the contract value (0 for an NDA).'
  if (f.noticePeriodDays !== '' && f.noticePeriodDays !== undefined && (Number(f.noticePeriodDays) < 0 || Number(f.noticePeriodDays) > 365)) e.noticePeriodDays = 'Notice period must be 0–365 days.'
  if (String(f.scope || '').length > 8000) e.scope = 'Scope is limited to 8000 characters.'
  return e
}

// ---- document rules ------------------------------------------------------------------------------------------------
export const CONTRACT_DOC_KINDS = ['Contract', 'Supporting']
export const CONTRACT_DOC_CATEGORIES = ['Signed Contract', 'Draft Contract', 'Amendment', 'Annexure / SOW', 'NDA', 'Client Documents', 'Other']
export const CONTRACT_FILE_RULES = { maxBytes: 1024 * 1024, extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'txt'] }
export const CONTRACT_ACCEPT = CONTRACT_FILE_RULES.extensions.map((e) => `.${e}`).join(',')
const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ps1|sh|jar|app|dll|lnk|hta|html?|svg|php)(\.|$)/i
export function checkContractFile(file) {
  const name = String(file?.name || '').trim()
  if (!name) return 'The file has no name.'
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase()
  if (BLOCKED.test(name) || !ext) return 'This file type is not allowed.'
  if (!CONTRACT_FILE_RULES.extensions.includes(ext)) return `".${ext}" files are not allowed. Allowed: ${CONTRACT_FILE_RULES.extensions.join(', ')}.`
  if (!file.size) return 'The file is empty.'
  if (file.size > CONTRACT_FILE_RULES.maxBytes) return `The file is too large (${(file.size / 1048576).toFixed(1)} MB). The maximum is 1 MB.`
  return null
}

// ---- template merge fields -----------------------------------------------------------------------------------------
export const MERGE_FIELDS = [
  ['CustomerName', 'Customer name'], ['CompanyName', 'Company name'], ['ContactName', 'Contact name'], ['ContactEmail', 'Contact email'], ['ContactPhone', 'Contact phone'],
  ['ContractNumber', 'Contract number'], ['ContractTitle', 'Contract title'], ['ContractType', 'Contract type'], ['ContractValue', 'Contract value'],
  ['StartDate', 'Start date'], ['EndDate', 'End date'], ['RenewalDate', 'Renewal date'], ['NoticePeriod', 'Notice period'], ['BillingFrequency', 'Billing frequency'], ['PaymentTerms', 'Payment terms'],
  ['AutoRenewal', 'Auto-renewal'], ['ContractOwner', 'Contract owner'], ['BillingAddress', 'Billing address'], ['GSTIN', 'Customer GSTIN'], ['ProjectName', 'Project name'], ['DealName', 'Deal name'],
  ['QuotationNumber', 'Quotation number'], ['SalesOrderNumber', 'Sales order number'], ['ServiceProvider', 'Our company'], ['Scope', 'Scope of work'], ['TodayDate', 'Today’s date'],
]
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '')
const fmtMoney = (n) => `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))}`

/** Values for every merge field, read from the contract and the CRM records it is linked to. */
export function mergeValues(c, { customer, company, contact, owner, project, deal, quotation, salesOrder }) {
  return {
    CustomerName: customer?.name || c.customerName || '', CompanyName: company?.name || customer?.name || '', ContactName: contact?.name || '', ContactEmail: contact?.email || '', ContactPhone: contact?.phone || '',
    ContractNumber: c.number, ContractTitle: c.title, ContractType: c.contractType, ContractValue: fmtMoney(c.value), StartDate: fmtDate(c.startDate), EndDate: fmtDate(c.endDate), RenewalDate: fmtDate(c.renewalDate),
    NoticePeriod: c.noticePeriodDays ? `${c.noticePeriodDays} days` : '', BillingFrequency: c.billingFrequency || '', PaymentTerms: c.paymentTerms || '', AutoRenewal: c.autoRenew ? 'Yes' : 'No', ContractOwner: owner?.name || '',
    BillingAddress: customer?.billingAddress || company?.address || '', GSTIN: customer?.gstin || company?.gstin || '', ProjectName: project?.name || '', DealName: deal?.name || '', QuotationNumber: quotation?.number || '',
    SalesOrderNumber: salesOrder?.number || '', ServiceProvider: ORG_NAME, Scope: c.scope || '', TodayDate: fmtDate(todayKey()),
  }
}
/** Replaces {{Field}} tokens; returns the text and the fields that could not be filled (so the preview can warn before generating). */
export function mergeTemplate(body, values) {
  const missing = new Set()
  const text = String(body || '').replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (m, key) => {
    if (!(key in values)) { missing.add(`${key} (unknown field)`); return m }
    if (!values[key]) { missing.add(key); return `[${key} not set]` }
    return values[key]
  })
  return { text, missing: [...missing] }
}
