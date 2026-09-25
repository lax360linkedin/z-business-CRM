import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { DEALS } from './deals'
import { PRODUCTS } from './products'
import { QUOTATION_STATUSES } from './constants'
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
    items.push({ productId: product.id, name: product.name, qty, unitPrice, discount })
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
  const relatedDeals = DEALS.filter((d) => d.companyId === customer.companyId)
  const deal = relatedDeals.length ? pick(relatedDeals) : null
  const items = buildItems()
  const totals = itemsTotal(items)
  const createdDate = daysFromNow(-randInt(1, 120))
  return {
    id: `QT-${String(4000 + i)}`,
    number: `QUO-2026-${String(4000 + i)}`,
    customerId: customer.id,
    customerName: customer.name,
    dealId: deal?.id ?? null,
    // Traceability carried down from the Deal — null when there's no related Deal to inherit
    // from (see createQuotationFromDeal() in src/pages/Deals/dealActions.js, which carries these
    // forward on every live create-from-Deal instead of regenerating them).
    leadId: deal?.leadId ?? null,
    source: deal?.source ?? null,
    sourceDetail: deal?.sourceDetail ?? null,
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    amount: totals.total,
    createdDate,
    validUntil: daysFromNow(randInt(-10, 30)),
    status: i < 3 ? 'Draft' : pick(QUOTATION_STATUSES),
    assignedTo: pick(reps).id,
    terms: 'Payment due within 15 days of acceptance. Prices are exclusive of applicable taxes unless noted. Quotation valid until the date specified above.',
  }
})

export function getQuotationById(id) {
  return QUOTATIONS.find((q) => q.id === id)
}
