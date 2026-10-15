// Sales Order lifecycle rules, tax/total maths and shared constants — used by the UI (live totals
// while editing, button availability) AND by the mock backend (src/api/salesOrderApi.js), which
// recomputes every total itself and never trusts figures sent by the client.

// The selling organisation's GST state code (first two digits of its GSTIN). A customer GSTIN with
// a different state code means inter-state supply → IGST; same state (or no GSTIN) → CGST + SGST.
// A business setting, not derived data: change it here if the company is registered elsewhere.
export const ORG_STATE_CODE = '29'
export const DEFAULT_TAX_RATE = 18
export const TAX_RATES = [0, 5, 12, 18, 28]
export const DEFAULT_DELIVERY_TERMS = 'Delivery / go-live as per the expected delivery date, subject to receipt of the agreed advance payment.'

export const SO_STATUSES = ['Draft', 'Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled', 'Cancelled']

// Allowed forward moves. "Partially Fulfilled" is reached through the fulfilment action (it needs
// per-line quantities), everything else through a plain status change.
export const SO_TRANSITIONS = {
  Draft: ['Confirmed', 'Cancelled'],
  Confirmed: ['Processing', 'Cancelled'],
  Processing: ['Partially Fulfilled', 'Fulfilled', 'Cancelled'],
  'Partially Fulfilled': ['Fulfilled', 'Cancelled'],
  Fulfilled: [],
  Cancelled: [],
}

export const SO_OPEN_STATUSES = ['Draft', 'Confirmed', 'Processing', 'Partially Fulfilled']

// Fields a user may change on an order that has already been confirmed (everything commercial —
// items, prices, taxes, customer — goes through "Revise Order" instead, which keeps the history).
export const SO_LIGHT_EDIT_FIELDS = ['expectedDeliveryDate', 'deliveryTerms', 'shippingAddress', 'notes', 'internalRemarks', 'salesperson']
export const SO_DRAFT_EDIT_FIELDS = [
  ...SO_LIGHT_EDIT_FIELDS, 'orderDate', 'paymentTerms', 'billingAddress', 'gstin', 'taxType', 'items', 'contactId',
]

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export function gstStateCode(gstin) {
  const m = /^(\d{2})[A-Z0-9]{13}$/i.exec(String(gstin || '').trim())
  return m ? m[1] : null
}

/** 'inter' (IGST) when the customer's GSTIN is registered in a different state than ours, otherwise 'intra' (CGST + SGST). */
export function inferTaxType(gstin) {
  const code = gstStateCode(gstin)
  return code && code !== ORG_STATE_CODE ? 'inter' : 'intra'
}

export function normalizeItem(it = {}) {
  return {
    productId: it.productId || null,
    // catalog snapshot — written when the line is created from a product and never rewritten by later catalog edits
    productCode: it.productCode || null,
    category: it.category || null,
    unit: it.unit || null,
    billingCycle: it.billingCycle || null,
    listPrice: it.listPrice ?? null,
    name: String(it.name || '').trim(),
    description: String(it.description || '').trim(),
    qty: Number(it.qty) || 0,
    unitPrice: Number(it.unitPrice) || 0,
    discount: Number(it.discount) || 0,
    taxRate: it.taxRate === undefined || it.taxRate === null || it.taxRate === '' ? DEFAULT_TAX_RATE : Number(it.taxRate) || 0,
    fulfilledQty: Number(it.fulfilledQty) || 0,
  }
}

/** Per-line and order-level amounts. Discount is a % on the line gross; tax is applied on the discounted (taxable) amount. */
export function computeOrder(rawItems, taxType = 'intra') {
  const lines = (rawItems || []).map((raw) => {
    const it = normalizeItem(raw)
    const gross = it.qty * it.unitPrice
    const discount = gross * (it.discount / 100)
    const taxable = gross - discount
    const tax = taxable * (it.taxRate / 100)
    return { gross: round2(gross), discount: round2(discount), taxable: round2(taxable), tax: round2(tax), total: round2(taxable + tax) }
  })
  const sum = (k) => round2(lines.reduce((s, l) => s + l[k], 0))
  const taxTotal = sum('tax')
  const cgst = taxType === 'intra' ? round2(taxTotal / 2) : 0
  const sgst = taxType === 'intra' ? round2(taxTotal - cgst) : 0
  const igst = taxType === 'inter' ? taxTotal : 0
  const taxableAmount = sum('taxable')
  return {
    lines,
    subtotal: sum('gross'),
    discountAmount: sum('discount'),
    taxableAmount,
    tax: taxTotal,
    cgst, sgst, igst,
    amount: round2(taxableAmount + taxTotal),
  }
}

/** Quotation-style totals from lines that each carry their own tax rate: { subtotal (after discount), tax, total }. */
export function lineTotals(rawItems) {
  const t = computeOrder(rawItems, 'intra')
  return { subtotal: t.taxableAmount, tax: t.tax, total: t.amount, gross: t.subtotal, discount: t.discountAmount }
}

/** The pricing block stored on a Sales Order / Invoice record. */
export function pricingFields(items, taxType) {
  const t = computeOrder(items, taxType)
  const { lines, ...rest } = t
  return { taxType, ...rest }
}

export function fulfilmentPercent(items) {
  const total = (items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
  if (!total) return 0
  const done = (items || []).reduce((s, i) => s + Math.min(Number(i.fulfilledQty) || 0, Number(i.qty) || 0), 0)
  return Math.round((done / total) * 100)
}

/** Validation shared by the form and the server. Returns { field: message }. */
export function validateOrderInput(o) {
  const errors = {}
  const items = o.items || []
  if (!items.length) errors.items = 'Add at least one product or service.'
  items.forEach((raw, i) => {
    const it = normalizeItem(raw)
    if (!it.name) errors[`item-${i}-name`] = 'Name required'
    if (!(it.qty > 0)) errors[`item-${i}-qty`] = 'Qty must be > 0'
    if (it.unitPrice < 0) errors[`item-${i}-unitPrice`] = 'Price cannot be negative'
    if (it.discount < 0 || it.discount > 100) errors[`item-${i}-discount`] = '0–100%'
    if (it.taxRate < 0 || it.taxRate > 100) errors[`item-${i}-taxRate`] = '0–100%'
  })
  if (!o.orderDate) errors.orderDate = 'Order date is required.'
  if (!o.expectedDeliveryDate) errors.expectedDeliveryDate = 'Expected delivery date is required.'
  else if (o.orderDate && o.expectedDeliveryDate < o.orderDate) errors.expectedDeliveryDate = 'Delivery date cannot be before the order date.'
  if (!String(o.billingAddress || '').trim()) errors.billingAddress = 'Billing address is required.'
  if (o.gstin && !/^\d{2}[A-Z0-9]{13}$/i.test(String(o.gstin).trim())) errors.gstin = 'GSTIN must be 15 characters (e.g. 29AABCT1332L1ZV).'
  if (!o.salesperson) errors.salesperson = 'Choose an owner.'
  if (!o.paymentTerms || !String(o.paymentTerms).trim()) errors.paymentTerms = 'Payment terms are required.'
  return errors
}

export const PAYMENT_STATUS_TONES = { Unbilled: 'neutral', Invoiced: 'info', 'Partially Paid': 'warning', Paid: 'success', Overdue: 'danger' }

/** Derived (never stored on the order): where the order stands financially, from its real invoice/payments. */
export function paymentStatusOf(order, invoice) {
  if (!invoice || invoice.status === 'Cancelled' || invoice.status === 'Void') return 'Unbilled'
  const paid = Number(invoice.paidAmount) || 0
  if (paid >= (Number(invoice.amount) || 0) && paid > 0) return 'Paid'
  if (invoice.status === 'Overdue') return 'Overdue'
  if (paid > 0) return 'Partially Paid'
  return 'Invoiced'
}
