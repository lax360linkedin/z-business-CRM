// Products & Services master data: vocabulary, validation, how a catalog item becomes a document line, and where
// an item is used. Shared by the Products pages and every form that picks a product (Deal, Proposal, Quotation,
// Sales Order …), so the same item always maps to the same name, code, category, unit, price, discount and tax.
import { TAX_RATES, DEFAULT_TAX_RATE, computeOrder, round2 } from './salesOrderCalc'

export const PRODUCT_CATEGORIES = ['Development', 'Design', 'Marketing', 'Consulting', 'Support & Maintenance', 'Infrastructure']
export const PRODUCT_TYPES = ['Service', 'Package', 'Add-on', 'Product']
export const PRODUCT_UNITS = ['Project', 'Nos', 'Hour', 'Day', 'Month', 'Year', 'Licence', 'User / Month', 'Page', 'Sq. ft.']
export const BILLING_CYCLES = ['One-time', 'Monthly', 'Quarterly', 'Annual']
export const PRODUCT_STATUSES = ['Active', 'Inactive']
export { TAX_RATES, DEFAULT_TAX_RATE }

const CATEGORY_PREFIX = { Development: 'DEV', Design: 'DSN', Marketing: 'MKT', Consulting: 'CON', 'Support & Maintenance': 'SUP', Infrastructure: 'INF' }
const pad = (n) => String(n).padStart(3, '0')

/** Next free item code for a category, e.g. DEV-004. */
export function generateProductCode(category, existing = []) {
  const prefix = CATEGORY_PREFIX[category] || 'GEN'
  const top = existing.reduce((m, p) => { const h = new RegExp(`^${prefix}-(\\d+)$`).exec(p.code || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `${prefix}-${pad(top + 1)}`
}

export const blankProduct = (existing = []) => ({
  name: '', code: generateProductCode(PRODUCT_CATEGORIES[0], existing), category: PRODUCT_CATEGORIES[0], type: PRODUCT_TYPES[0], description: '', unit: 'Project',
  price: '', billingCycle: BILLING_CYCLES[0], taxRate: DEFAULT_TAX_RATE, defaultDiscount: 0, status: 'Active',
})

/** Field-level validation. `others` = every other product (so the item being edited doesn't clash with itself). */
export function validateProduct(f, others = []) {
  const e = {}
  const name = String(f.name || '').trim()
  if (!name) e.name = 'Give the product or service a name.'
  else if (name.length < 2 || name.length > 120) e.name = 'Name must be 2–120 characters.'
  else if (others.some((p) => String(p.name).trim().toLowerCase() === name.toLowerCase())) e.name = 'Another product already has this name.'
  const code = String(f.code || '').trim().toUpperCase()
  if (!code) e.code = 'An item code is required.'
  else if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) e.code = 'Use 2–20 letters, numbers or hyphens (e.g. DEV-001).'
  else if (others.some((p) => String(p.code || '').toUpperCase() === code)) e.code = 'This code is already used by another product.'
  if (!PRODUCT_CATEGORIES.includes(f.category)) e.category = 'Choose a category.'
  if (!PRODUCT_TYPES.includes(f.type)) e.type = 'Choose a type.'
  if (!PRODUCT_UNITS.includes(f.unit)) e.unit = 'Choose the unit of sale.'
  if (!BILLING_CYCLES.includes(f.billingCycle)) e.billingCycle = 'Choose a billing cycle.'
  const price = Number(f.price)
  if (f.price === '' || f.price === null || Number.isNaN(price)) e.price = 'Enter the standard price.'
  else if (price < 0) e.price = 'Price cannot be negative.'
  else if (price > 1e9) e.price = 'Price is too large.'
  if (!TAX_RATES.includes(Number(f.taxRate))) e.taxRate = `Tax rate must be one of ${TAX_RATES.join(', ')}%.`
  const disc = Number(f.defaultDiscount || 0)
  if (Number.isNaN(disc) || disc < 0 || disc > 100) e.defaultDiscount = 'Discount must be between 0 and 100%.'
  if (String(f.description || '').length > 1000) e.description = 'Description is limited to 1000 characters.'
  return e
}

export function normalizeProductInput(f) {
  return {
    name: String(f.name).trim(), code: String(f.code).trim().toUpperCase(), category: f.category, type: f.type, description: String(f.description || '').trim(), unit: f.unit,
    price: round2(Number(f.price) || 0), billingCycle: f.billingCycle, taxRate: Number(f.taxRate), defaultDiscount: round2(Number(f.defaultDiscount) || 0), status: f.status === 'Inactive' ? 'Inactive' : 'Active',
  }
}

/**
 * A document line built from a catalog item: every detail comes from the master record, nothing is re-typed.
 * The line keeps its own copy (a snapshot), so changing the catalog later never rewrites a quotation, order or invoice.
 */
export function lineFromProduct(p, base = {}) {
  return {
    ...base,
    productId: p.id, productCode: p.code || null, name: p.name, category: p.category || null, description: p.description || '', unit: p.unit || null, billingCycle: p.billingCycle || null,
    qty: base.qty ?? 1, listPrice: p.price ?? 0, unitPrice: p.price ?? 0, discount: p.defaultDiscount ?? 0, taxRate: p.taxRate ?? DEFAULT_TAX_RATE,
  }
}

export const isActiveProduct = (p) => p && p.status !== 'Inactive'

/** Options for a picker: active items, plus the one already chosen even if it has since been deactivated (flagged by the caller). */
export function pickableProducts(products, currentId) {
  return products.filter((p) => isActiveProduct(p) || p.id === currentId)
}

/** Has the catalog price/tax moved since this line was written? (drafts show a hint; issued documents never change.) */
export function catalogDrift(line, product) {
  if (!product || !line.productId) return null
  const d = []
  // compare with the catalog price the line was built from (a negotiated unit price is not "drift")
  if (Number(line.listPrice ?? line.unitPrice) !== Number(product.price)) d.push(['price', product.price])
  if (line.taxRate !== undefined && Number(line.taxRate) !== Number(product.taxRate ?? DEFAULT_TAX_RATE)) d.push(['tax', product.taxRate])
  return d.length ? d : null
}

const hasItem = (items, id) => (items || []).some((i) => i.productId === id)
const lineTotalFor = (doc, id) => {
  const { lines } = computeOrder(doc.items || [], doc.taxType || 'intra')
  return (doc.items || []).reduce((s, it, i) => (it.productId === id ? s + (lines[i]?.total || 0) : s), 0)
}

/** Everything that references a product, from live collections. Pure — pass `{deals, proposals, quotations, salesOrders, invoices, payments, projects, leads, enquiries}`. */
export function computeProductUsage(product, data) {
  const id = product.id
  const nameMatch = (r, field) => !r.productId && String(r[field] || '').toLowerCase() === String(product.name).toLowerCase()
  const deals = (data.deals || []).filter((d) => d.productId === id || nameMatch(d, 'service'))
  const proposals = (data.proposals || []).filter((p) => hasItem(p.content?.items, id))
  const quotations = (data.quotations || []).filter((q) => hasItem(q.items, id))
  const salesOrders = (data.salesOrders || []).filter((s) => hasItem(s.items, id))
  const invoices = (data.invoices || []).filter((i) => hasItem(i.items, id))
  const liveInvoices = invoices.filter((i) => !['Cancelled', 'Draft'].includes(i.status))
  const invoiced = round2(liveInvoices.reduce((s, i) => s + lineTotalFor(i, id), 0))
  const collected = round2(liveInvoices.reduce((s, i) => s + (i.amount > 0 ? lineTotalFor(i, id) * Math.min(1, (i.paidAmount || 0) / i.amount) : 0), 0))
  const invoiceIds = new Set(invoices.map((i) => i.id))
  const payments = (data.payments || []).filter((p) => invoiceIds.has(p.invoiceId))
  const projects = (data.projects || []).filter((p) => p.productId === id)
  const leads = (data.leads || []).filter((l) => l.productId === id || nameMatch(l, 'service'))
  const enquiries = (data.enquiries || []).filter((e) => e.productId === id || nameMatch(e, 'interestedService'))
  const customerIds = new Set([...salesOrders, ...invoices].map((d) => d.customerId).filter(Boolean))
  return {
    deals, proposals, quotations, salesOrders, invoices, payments, projects, leads, enquiries, customerIds: [...customerIds],
    invoiced, collected, outstanding: round2(invoiced - collected),
    unitsSold: (data.salesOrders || []).filter((s) => s.status !== 'Cancelled').reduce((s, o) => s + (o.items || []).filter((i) => i.productId === id).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0),
    // a product with financial/contractual history can only be deactivated, never removed
    locked: deals.length + proposals.length + quotations.length + salesOrders.length + invoices.length + projects.length > 0,
    openDocs: proposals.filter((p) => ['Draft', 'Internal Review', 'Sent', 'Viewed', 'Revision Requested'].includes(p.status)).length
      + quotations.filter((q) => ['Draft', 'Pending Approval', 'Sent', 'Viewed', 'Negotiation'].includes(q.status)).length
      + salesOrders.filter((s) => ['Draft', 'Confirmed', 'Processing', 'Partially Fulfilled'].includes(s.status)).length,
  }
}

/** Resolve the catalog item a free-text service name refers to (exact, case-insensitive, unique). */
export function productByName(products, name) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  const hits = products.filter((p) => String(p.name).trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0] : null
}

/** Next sequential catalog ID: PRD-041 … */
export function nextProductId(products) {
  const top = products.reduce((m, p) => { const h = /^PRD-(\d+)$/.exec(p.id); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `PRD-${String(top + 1).padStart(3, '0')}`
}
