import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { INVOICES } from './invoices'
import { PAYMENT_METHODS } from './constants'

resetSeed(1414)

const paidInvoices = INVOICES.filter((inv) => inv.paidAmount > 0)

export const PAYMENTS = paidInvoices.map((inv, i) => ({
  id: `PAY-${String(11000 + i)}`,
  invoiceId: inv.id,
  invoiceNumber: inv.number,
  customerId: inv.customerId,
  customerName: inv.customerName,
  amount: inv.paidAmount,
  method: pick(PAYMENT_METHODS),
  date: daysFromNow(-randInt(0, 60)),
  status: 'Completed',
  reference: `TXN${randInt(100000, 999999)}`,
}))

export function getPaymentById(id) {
  return PAYMENTS.find((p) => p.id === id)
}
