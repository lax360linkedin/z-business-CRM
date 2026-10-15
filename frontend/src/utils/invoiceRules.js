// Invoice rules shared by the browser (live totals, which buttons exist) and the mock API (src/api/invoiceApi.js), which recomputes every figure
// itself and never trusts what the browser sends. Pure functions only.
import { computeOrder, normalizeItem, inferTaxType, round2, DEFAULT_TAX_RATE, ORG_STATE_CODE } from './salesOrderCalc'

export { round2, inferTaxType, DEFAULT_TAX_RATE, ORG_STATE_CODE }

// ---- statuses -------------------------------------------------------------------------------------------------------
export const INVOICE_STATUS_LIST = ['Draft', 'Sent', 'Viewed', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled', 'Void']
/** Stored lifecycle states. The visible status is derived from them plus the real payments and the due date. */
export const LIFECYCLE = ['Draft', 'Sent', 'Viewed', 'Cancelled', 'Void']
export const ISSUED_STATUSES = ['Sent', 'Viewed', 'Partially Paid', 'Paid', 'Overdue']
export const DEAD_STATUSES = ['Cancelled', 'Void']
export const PAYMENT_STATUS_LIST = ['Not issued', 'Unpaid', 'Partially Paid', 'Paid', 'Not applicable']
export const isIssued = (inv) => ISSUED_STATUSES.includes(inv?.status)
export const isLiveInvoice = (inv) => !!inv && !DEAD_STATUSES.includes(inv.status)
/** Money that is owed to us: issued invoices only. Drafts, cancelled and void invoices never count. */
export const countsAsBilled = (inv) => isIssued(inv)
export const balanceOf = (inv) => round2(Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.paidAmount) || 0)))

export const todayKey = () => new Date().toISOString().slice(0, 10)
export const daysBetween = (a, b) => Math.round((new Date(`${String(b).slice(0, 10)}T00:00:00Z`) - new Date(`${String(a).slice(0, 10)}T00:00:00Z`)) / 86400000)
export const addDays = (date, n) => { const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Only payments that are really in force count (a reversed payment stays on record but no longer reduces the balance). */
export const PAYMENT_STATUS_OPTIONS = ['Pending', 'Completed', 'Failed', 'Cancelled', 'Refunded', 'Partially Refunded']
export const COUNTED_PAYMENT = ['Completed', 'Partially Refunded']
/** What a payment is really worth to the invoice: Completed counts in full, Partially Refunded counts net of refunds; Pending, Failed, Cancelled and Refunded count nothing. */
export const paymentNet = (p) => (!p ? 0 : p.status === undefined || p.status === 'Completed' ? Number(p.amount) || 0 : p.status === 'Partially Refunded' ? Math.max(0, round2((Number(p.amount) || 0) - (Number(p.refundedAmount) || 0))) : 0)
export const countsAsPayment = (p) => !!p && (p.status === undefined || COUNTED_PAYMENT.includes(p.status))

/**
 * The visible state of an invoice, from its stored lifecycle and its real payments:
 *   Paid only when the payments received cover the whole amount; Overdue when the due date has passed with a balance;
 *   Partially Paid when something (but not everything) has been received; otherwise the lifecycle (Sent / Viewed).
 */
export function deriveInvoiceState(inv, payments = [], today = todayKey()) {
  const life = inv.lifecycle || (LIFECYCLE.includes(inv.status) ? inv.status : 'Sent')
  const paid = round2(payments.reduce((s, p) => s + paymentNet(p), 0))
  const amount = Number(inv.amount) || 0
  const balance = round2(Math.max(0, amount - paid))
  let status = life
  if (!['Draft', 'Cancelled', 'Void'].includes(life)) {
    if (amount > 0 && paid >= amount - 0.005) status = 'Paid'
    else if (inv.dueDate && String(inv.dueDate).slice(0, 10) < today && balance > 0.005) status = 'Overdue'
    else if (paid > 0) status = 'Partially Paid'
  }
  const paymentStatus = life === 'Draft' ? 'Not issued' : ['Cancelled', 'Void'].includes(life) ? 'Not applicable' : paid <= 0 ? 'Unpaid' : balance <= 0.005 ? 'Paid' : 'Partially Paid'
  const overdueDays = status === 'Overdue' ? Math.max(1, daysBetween(inv.dueDate, today)) : 0
  return { status, paid, balance, paymentStatus, overdueDays }
}

// ---- totals ---------------------------------------------------------------------------------------------------------
// What the app shows until the saved invoice settings arrive from the server (Settings -> Invoice Settings holds the real ones). Nothing here is company data.
export const DEFAULT_INVOICE_CONFIG = {
  prefix: 'INV', paymentPrefix: 'PAY', defaultTermsDays: 15, roundOff: true, extraTaxes: [],
  paymentMethods: [], bankAccounts: [], footer: '', terms: '', bankDetails: '',
  org: { name: '', address: '', gstin: '', email: '', phone: '', pan: '' },
}

/**
 * Every invoice figure from its lines. Discount is a % on the line gross; each line carries its own GST rate; GST splits into CGST+SGST (intra-state)
 * or IGST (inter-state); optional named "other taxes" are a % of the taxable amount; the total is rounded to the nearest rupee with the difference
 * shown as Round off. Pass `roundOff: false` (or a fixed `total`) to keep an existing amount unchanged.
 */
export function computeInvoice(rawItems, { taxType = 'intra', extraTaxes = [], roundOff = true, total = null } = {}) {
  const base = computeOrder(rawItems, taxType)
  const other = (extraTaxes || []).map((t) => ({ name: String(t.name || '').trim(), rate: Number(t.rate) || 0, amount: round2(base.taxableAmount * ((Number(t.rate) || 0) / 100)) })).filter((t) => t.name && t.rate > 0)
  const otherTotal = round2(other.reduce((s, t) => s + t.amount, 0))
  const preRound = round2(base.taxableAmount + base.tax + otherTotal)
  let amount = preRound
  if (total !== null && total !== undefined) amount = round2(total)
  else if (roundOff) amount = Math.round(preRound)
  return {
    lines: base.lines, subtotal: base.subtotal, discountAmount: base.discountAmount, taxableAmount: base.taxableAmount,
    tax: base.tax, cgst: base.cgst, sgst: base.sgst, igst: base.igst, extraTaxes: other, otherTaxAmount: otherTotal,
    roundOff: round2(amount - preRound), amount,
  }
}
/** The pricing block stored on an invoice (without the per-line breakdown). */
export function invoicePricing(items, opts) {
  const { lines, ...rest } = computeInvoice(items, opts)
  return { taxType: opts?.taxType || 'intra', ...rest }
}
export const normalizeInvoiceItem = (it = {}) => ({ ...normalizeItem(it), unit: String(it.unit || '').trim() || null })

// ---- terms & dates --------------------------------------------------------------------------------------------------
/** "Net 30", "30 days", "Due on receipt" … → days (null when the text names no period). */
export function termsToDays(terms) {
  const t = String(terms || '').toLowerCase()
  if (/due on receipt|immediate|on receipt/.test(t) || (/advance/.test(t) && !/%/.test(t))) return 0
  const m = /(\d{1,3})\s*(?:calendar\s*)?days?/.exec(t) || /net\s*(\d{1,3})/.exec(t)
  return m ? Number(m[1]) : null
}
export const dueDateFrom = (terms, issueDate, defaultDays = 15) => addDays(issueDate, termsToDays(terms) ?? defaultDays)

// ---- validation -----------------------------------------------------------------------------------------------------
export function validateInvoiceInput(f) {
  const e = {}
  const items = f.items || []
  if (!items.length) e.items = 'Add at least one line item.'
  items.forEach((raw, i) => {
    const it = normalizeInvoiceItem(raw)
    if (!it.name) e[`item-${i}-name`] = 'Name required'
    if (!(it.qty > 0)) e[`item-${i}-qty`] = 'Qty must be > 0'
    if (it.unitPrice < 0) e[`item-${i}-unitPrice`] = 'Price cannot be negative'
    if (it.discount < 0 || it.discount > 100) e[`item-${i}-discount`] = '0–100%'
    if (it.taxRate < 0 || it.taxRate > 100) e[`item-${i}-taxRate`] = '0–100%'
  })
  if (!f.issueDate) e.issueDate = 'Invoice date is required.'
  if (!f.dueDate) e.dueDate = 'Due date is required.'
  else if (f.issueDate && f.dueDate < f.issueDate) e.dueDate = 'The due date cannot be before the invoice date.'
  if (!String(f.billingAddress || '').trim()) e.billingAddress = 'Billing address is required.'
  if (f.gstin && !/^\d{2}[A-Z0-9]{13}$/i.test(String(f.gstin).trim())) e.gstin = 'GSTIN must be 15 characters (e.g. 29AABCT1332L1ZV).'
  ;(f.extraTaxes || []).forEach((t, i) => { if (!String(t.name || '').trim()) e[`tax-${i}-name`] = 'Name required'; if (!(Number(t.rate) > 0 && Number(t.rate) <= 100)) e[`tax-${i}-rate`] = '0–100%' })
  return e
}

// ---- numbering ------------------------------------------------------------------------------------------------------
/** INV-2026-00001: unique per year, always one more than the highest number ever issued (cancelled and void numbers stay reserved). */
export function nextInvoiceNumber(invoices, prefix = 'INV', date = new Date()) {
  const year = date.getFullYear()
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`)
  const max = invoices.reduce((m, x) => { const h = re.exec(x.number || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `${prefix}-${year}-${String(max + 1).padStart(5, '0')}`
}

// ---- permissions ----------------------------------------------------------------------------------------------------
export const INVOICE_PERMISSIONS = [
  ['view', 'View invoices'], ['create', 'Create invoices'], ['createManual', 'Create invoices without a sales order'], ['edit', 'Edit invoices'], ['send', 'Send invoices'], ['download', 'Download invoices'], ['print', 'Print invoices'],
  ['recordPayment', 'Record payments'], ['cancelVoid', 'Cancel / void invoices & reverse payments'], ['deleteDraft', 'Delete draft invoices'], ['viewFinancial', 'View financial data'], ['export', 'Export invoice data'],
]
const ALL = INVOICE_PERMISSIONS.map(([k]) => k)
export const INVOICE_ROLE_CAPS = {
  'Super Admin': ALL,
  Admin: ALL,
  MD: ['view', 'download', 'print', 'viewFinancial', 'export'],
  CEO: ['view', 'download', 'print', 'viewFinancial', 'export'],
  Accounts: ['view', 'create', 'createManual', 'edit', 'send', 'download', 'print', 'recordPayment', 'cancelVoid', 'deleteDraft', 'viewFinancial', 'export'],
  'Sales Manager': ['view', 'create', 'edit', 'send', 'download', 'print', 'viewFinancial', 'export'],
  'Sales Executive': ['view', 'download', 'print'],
  'Project Manager': ['view', 'download', 'print', 'viewFinancial'],
}
export const invoiceScopeOf = (role) => (['Super Admin', 'Admin', 'MD', 'CEO', 'Accounts'].includes(role) ? 'Organization' : role === 'Sales Manager' ? 'Team' : 'Own')

// ---- what can be done to an invoice in each state -------------------------------------------------------------------
export const DRAFT_EDIT_FIELDS = ['items', 'issueDate', 'dueDate', 'paymentTerms', 'billingAddress', 'shippingAddress', 'gstin', 'taxType', 'extraTaxes', 'contactId', 'projectId', 'contractId', 'notes', 'terms', 'ownerId', 'roundOff']
export const ISSUED_EDIT_FIELDS = ['dueDate', 'notes', 'shippingAddress', 'ownerId', 'projectId', 'contractId']
export const PAID_EDIT_FIELDS = ['notes']
export const editableFields = (inv) => (inv.status === 'Draft' ? DRAFT_EDIT_FIELDS : ['Cancelled', 'Void'].includes(inv.status) ? [] : inv.status === 'Paid' ? PAID_EDIT_FIELDS : ISSUED_EDIT_FIELDS)

/** Which actions exist for this invoice in its current state (the API still checks the caller's rights before doing any of them). */
export function stateActions(inv, { hasEverPaid = false, activePayments = 0 } = {}) {
  const s = inv.status
  const issued = ISSUED_STATUSES.includes(s)
  const balance = balanceOf(inv)
  return {
    edit: s !== 'Cancelled' && s !== 'Void',
    editFinancial: s === 'Draft',
    send: s === 'Draft' || (issued && s !== 'Paid'),
    markViewed: s === 'Sent',
    recordPayment: issued && s !== 'Paid' && balance > 0.005,
    cancel: s === 'Draft' || (['Sent', 'Viewed', 'Overdue'].includes(s) && !hasEverPaid && activePayments === 0),
    void: issued && activePayments === 0,
    deleteDraft: s === 'Draft',
    duplicate: true,
    refreshMaster: s === 'Draft',
  }
}

// ---- dashboard metrics ----------------------------------------------------------------------------------------------
const monthKey = (d) => String(d).slice(0, 7)
/** Finance dashboard figures, straight from the (already authorised) invoices and payments — nothing is hardcoded. */
export function invoiceMetrics(invoices, payments, today = todayKey()) {
  const issued = invoices.filter(isIssued)
  const sum = (list, f) => round2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0))
  const live = (payments || []).filter(countsAsPayment)
  const months = []
  const base = new Date(`${today}T00:00:00`)
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  const monthly = months.map((m) => ({ month: m, collected: sum(live.filter((p) => monthKey(p.date) === m), paymentNet), invoiced: sum(issued.filter((i) => monthKey(i.issueDate) === m), (i) => i.amount) }))
  const overdue = issued.filter((i) => i.status === 'Overdue')
  const aging = [['1–30 days', 1, 30], ['31–60 days', 31, 60], ['61–90 days', 61, 90], ['90+ days', 91, 99999]].map(([label, lo, hi]) => { const rows = overdue.filter((i) => i.overdueDays >= lo && i.overdueDays <= hi); return { label, count: rows.length, amount: sum(rows, (i) => i.balance) } })
  const fullyPaid = issued.filter((i) => i.status === 'Paid')
  const lastPay = (i) => live.filter((p) => p.invoiceId === i.id).map((p) => String(p.date).slice(0, 10)).sort().pop()
  const days = fullyPaid.map((i) => { const lp = lastPay(i); return lp ? daysBetween(i.issueDate, lp) : null }).filter((n) => n !== null && n >= 0)
  const totalInvoiced = sum(issued, (i) => i.amount)
  const totalPaid = sum(issued, (i) => i.paidAmount)
  return {
    count: invoices.length, issuedCount: issued.length, draftCount: invoices.filter((i) => i.status === 'Draft').length, deadCount: invoices.filter((i) => DEAD_STATUSES.includes(i.status)).length,
    totalInvoiced, totalPaid, outstanding: sum(issued, (i) => i.balance), overdueAmount: sum(overdue, (i) => i.balance), overdueCount: overdue.length,
    partiallyPaid: issued.filter((i) => i.paymentStatus === 'Partially Paid').length, paidCount: fullyPaid.length, unpaid: issued.filter((i) => i.paymentStatus === 'Unpaid').length,
    monthly, aging, collectionRate: totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0,
    collectedThisMonth: sum(live.filter((p) => monthKey(p.date) === monthKey(today)), paymentNet), avgDaysToPay: days.length ? Math.round(days.reduce((s, n) => s + n, 0) / days.length) : null,
    hasFinancial: invoices.some((i) => !i.financialHidden),
  }
}

// ---- payments -------------------------------------------------------------------------------------------------------
export const PAYMENT_PERMISSIONS = [
  ['view', 'View payments'], ['create', 'Create payments'], ['edit', 'Edit payments'], ['downloadReceipt', 'Download receipts'], ['printReceipt', 'Print receipts'], ['uploadProof', 'Upload payment proof'],
  ['refund', 'Refund payments'], ['cancel', 'Cancel payments'], ['deleteDraft', 'Delete pending payments'], ['export', 'Export payment data'], ['viewFinancial', 'View financial information'],
]
const PALL = PAYMENT_PERMISSIONS.map(([k]) => k)
export const PAYMENT_ROLE_CAPS = {
  'Super Admin': PALL, Admin: PALL, Accounts: PALL,
  MD: ['view', 'downloadReceipt', 'printReceipt', 'export', 'viewFinancial'], CEO: ['view', 'downloadReceipt', 'printReceipt', 'export', 'viewFinancial'],
  'Sales Manager': ['view', 'downloadReceipt', 'printReceipt', 'viewFinancial'], 'Sales Executive': ['view', 'downloadReceipt'], 'Project Manager': ['view', 'viewFinancial'],
}
export const nextPaymentNumber = (payments, prefix = 'PAY', date = new Date()) => {
  const year = date.getFullYear()
  const re = new RegExp(`^${prefix}-${year}-([0-9]+)$`)
  const max = payments.reduce((m, x) => { const h = re.exec(x.number || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `${prefix}-${year}-${String(max + 1).padStart(5, '0')}`
}
/** Collection figures from the (authorised) payments and invoices. Only Completed (net of refunds) counts as received. */
export function paymentMetrics(payments, invoices, today = todayKey()) {
  const rows = payments || []
  const sum = (l, f) => round2(l.reduce((s, x) => s + (Number(f(x)) || 0), 0))
  const net = rows.filter((p) => COUNTED_PAYMENT.includes(p.status))
  const byMethod = {}
  net.forEach((p) => { byMethod[p.method] = round2((byMethod[p.method] || 0) + paymentNet(p)) })
  return {
    received: sum(rows, paymentNet), today: sum(net.filter((p) => String(p.date).slice(0, 10) === today), paymentNet), month: sum(net.filter((p) => String(p.date).slice(0, 7) === today.slice(0, 7)), paymentNet),
    pendingCount: rows.filter((p) => p.status === 'Pending').length, pendingAmount: sum(rows.filter((p) => p.status === 'Pending'), (p) => p.amount),
    completedCount: rows.filter((p) => p.status === 'Completed').length, failedCount: rows.filter((p) => p.status === 'Failed').length, cancelledCount: rows.filter((p) => p.status === 'Cancelled').length,
    refunded: sum(rows, (p) => p.refundedAmount), transactions: rows.length,
    receivables: sum((invoices || []).filter(isIssued), (i) => i.balance), methods: Object.entries(byMethod).sort((a, b) => b[1] - a[1]),
  }
}
