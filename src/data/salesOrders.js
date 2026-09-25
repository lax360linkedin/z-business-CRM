import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { QUOTATIONS } from './quotations'
import { SALES_ORDER_STATUSES } from './constants'
import { salesUsers } from './users'

resetSeed(1717)
const reps = salesUsers()

// A Sales Order is created from an Accepted Quotation (see QuotationDetail.jsx's "Convert to
// Sales Order" action) — seeded here from a subset of the seed Quotations that are already
// Accepted, so the demo data shows the full chain without needing every Accepted quotation to
// have one (some Accepted quotations legitimately haven't been converted yet, same as real life).
const acceptedQuotations = QUOTATIONS.filter((q) => q.status === 'Accepted')
const sourceQuotations = acceptedQuotations.slice(0, Math.max(6, Math.floor(acceptedQuotations.length * 0.6)))

export const SALES_ORDERS = sourceQuotations.map((q, i) => {
  const createdDate = daysFromNow(-randInt(0, 40))
  const status = i < 2 ? 'Pending' : pick(SALES_ORDER_STATUSES)
  return {
    id: `SO-${String(6000 + i)}`,
    number: `SO-2026-${String(6000 + i)}`,
    quotationId: q.id,
    quotationNumber: q.number,
    dealId: q.dealId,
    leadId: q.leadId,
    customerId: q.customerId,
    customerName: q.customerName,
    // Source traceability carried all the way down from the originating Lead, per the spec's
    // "preserve the original Lead Source at every downstream stage" requirement.
    source: q.source,
    sourceDetail: q.sourceDetail,
    items: q.items,
    subtotal: q.subtotal,
    tax: q.tax,
    amount: q.amount,
    status,
    salesperson: q.assignedTo || pick(reps).id,
    createdDate,
    expectedDeliveryDate: daysFromNow(randInt(3, 30)),
    // Set once an Invoice has been generated from this Sales Order (see
    // src/pages/SalesOrders/SalesOrderDetail.jsx's "Create Invoice" action) — null until then.
    invoiceId: null,
  }
})

export function getSalesOrderById(id) {
  return SALES_ORDERS.find((so) => so.id === id)
}
export function salesOrdersByCustomer(customerId) {
  return SALES_ORDERS.filter((so) => so.customerId === customerId)
}
