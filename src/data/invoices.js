import { resetSeed, pick, randInt, randFloat, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { PROJECTS, projectsByCustomer } from './projects'
import { SALES_ORDERS } from './salesOrders'
import { INVOICE_STATUSES } from './constants'

resetSeed(1313)

// The first handful of invoices trace all the way back through a Sales Order → Quotation →
// Deal → Lead, so the full chain (spec: "Lead → Opportunity → Quotation → Sales Order →
// Invoice") is demonstrable in seed data without every invoice needing one (most real invoices,
// like most real sales orders, are billed against ongoing project work rather than a fresh
// sale). Every invoice still keeps its `projectId` link either way.
const chainedOrders = SALES_ORDERS.slice(0, Math.min(5, SALES_ORDERS.length))

export const INVOICES = Array.from({ length: 32 }).map((_, i) => {
  const chained = chainedOrders[i]
  const customer = chained ? CUSTOMERS.find((c) => c.id === chained.customerId) || pick(CUSTOMERS) : pick(CUSTOMERS)
  const projects = projectsByCustomer(customer.id)
  const project = projects.length ? pick(projects) : pick(PROJECTS)
  const amount = chained ? chained.amount : randFloat(50000, 1800000, 0)
  const status = i < 3 ? 'Draft' : pick(INVOICE_STATUSES)
  const paidAmount = status === 'Paid' ? amount : status === 'Partially Paid' ? Math.round(amount * randFloat(0.2, 0.7, 2)) : 0
  return {
    id: `INV-${String(9000 + i)}`,
    number: `INV-2026-${String(9000 + i)}`,
    customerId: customer.id,
    customerName: customer.name,
    projectId: project?.id ?? null,
    // Full upstream traceability — null for invoices billed outside the Lead→…→Sales Order
    // chain (e.g. ad-hoc/project billing), matching the spec's "do not fake connections that
    // don't exist" principle.
    salesOrderId: chained?.id ?? null,
    quotationId: chained?.quotationId ?? null,
    dealId: chained?.dealId ?? null,
    leadId: chained?.leadId ?? null,
    source: chained?.source ?? null,
    sourceDetail: chained?.sourceDetail ?? null,
    amount,
    paidAmount,
    issueDate: daysFromNow(-randInt(1, 150)),
    dueDate: daysFromNow(randInt(-30, 30)),
    status,
  }
})

export function getInvoiceById(id) {
  return INVOICES.find((inv) => inv.id === id)
}
export function invoicesByCustomer(customerId) {
  return INVOICES.filter((inv) => inv.customerId === customerId)
}
