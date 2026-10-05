import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { DEALS } from './deals'
import { getCompanyById } from './companies'
import { contactsByCompany } from './contacts'
import { PRODUCTS } from './products'
import { QUOTATION_STATUSES, PAYMENT_TERMS_PRESETS, DEFAULT_QUOTATION_TERMS } from './constants'
import { salesUsers } from './users'

resetSeed(808)
const reps = salesUsers()

function buildItems() {
  const count = randInt(1, 4)
  const items = []
  for (let i = 0; i < count; i++) {
    const product = pick(PRODUCTS)
    const qty = randInt(1, 5)
    const unitPrice = product.price
    const discount = pick([0, 0, 5, 10])
    items.push({ productId: product.id, name: product.name, description: product.description, qty, unitPrice, discount })
  }
  return items
}
function itemsTotal(items) {
  const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice * (1 - it.discount / 100), 0)
  const tax = subtotal * 0.18
  return { subtotal, tax, total: subtotal + tax }
}

export const QUOTATIONS = Array.from({ length: 26 }).map((_, i) => {
  const customer = pick(CUSTOMERS)
  const company = getCompanyById(customer.companyId)
  const contacts = company ? contactsByCompany(company.id) : []
  const contact = contacts.length ? pick(contacts) : null
  const relatedDeals = DEALS.filter((d) => d.companyId === customer.companyId)
  const deal = relatedDeals.length ? pick(relatedDeals) : null
  const items = buildItems()
  const totals = itemsTotal(items)
  const createdDate = daysFromNow(-randInt(1, 120))
  return {
    id: `QT-${String(4000 + i)}`,
    number: `QUO-2026-${String(4000 + i)}`,
    // Primary client identity — companyId/contactId are the real relational anchors; customerId
    // is only ever set when this client already has a Closed-Won Customer record (nullable
    // otherwise), since most real-world quotations go out BEFORE a prospect becomes a Customer.
    companyId: customer.companyId,
    contactId: contact?.id ?? null,
    customerId: customer.id,
    customerName: customer.name,
    contactName: contact?.name ?? customer.contactPerson,
    contactPhone: contact?.phone ?? customer.phone,
    contactEmail: contact?.email ?? customer.email,
    billingAddress: company?.billingAddress || company?.address || '',
    shippingAddress: company?.shippingAddress || company?.address || '',
    gstin: company?.gstin || '',
    dealId: deal?.id ?? null,
    // Traceability carried down from the Deal — null when there's no related Deal to inherit
    // from (see createQuotationFromDeal() in src/pages/Deals/dealActions.js, which carries these
    // forward on every live create-from-Deal instead of regenerating them).
    leadId: deal?.leadId ?? null,
    sourceEnquiryId: deal?.sourceEnquiryId ?? null,
    source: deal?.source ?? null,
    sourceDetail: deal?.sourceDetail ?? null,
    requirement: deal?.requirement || '',
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    amount: totals.total,
    createdDate,
    validUntil: daysFromNow(randInt(-10, 30)),
    status: i < 3 ? 'Draft' : pick(QUOTATION_STATUSES),
    assignedTo: deal?.salesperson || pick(reps).id,
    paymentTerms: pick(PAYMENT_TERMS_PRESETS),
    terms: DEFAULT_QUOTATION_TERMS,
    // Which uploaded letterhead/template this quotation should render with — null means "use
    // the built-in default layout" (see src/pages/Quotations/quotationPdf.js). Seed quotations
    // predate any uploaded template, so this always starts null.
    templateId: null,
    salesOrderId: null,
  }
})

export function getQuotationById(id) {
  return QUOTATIONS.find((q) => q.id === id)
}
export function quotationsByCompany(companyId) {
  return QUOTATIONS.filter((q) => q.companyId === companyId)
}
