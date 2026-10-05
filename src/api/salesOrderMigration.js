// One-time, idempotent upgrade of Sales Order data to the corporate order model (lifecycle statuses,
// full customer/contact/company/deal links, tax breakdown, persisted timeline) — applied to freshly
// seeded data and to any browser that already holds an older database, so nothing is wiped.
//
// Operates on the plain `db` object (collection name → array) before it is saved. Safe to run twice:
// it stamps `db.__migrations.salesOrderV2` and skips when present.
import { computeOrder, inferTaxType, normalizeItem, DEFAULT_DELIVERY_TERMS, pricingFields } from '../utils/salesOrderCalc'

const STATUS_MAP = {
  Pending: 'Draft', Draft: 'Draft', Confirmed: 'Confirmed', 'In Fulfillment': 'Processing', Processing: 'Processing',
  Delivered: 'Fulfilled', Invoiced: 'Fulfilled', Fulfilled: 'Fulfilled', 'Partially Fulfilled': 'Partially Fulfilled', Cancelled: 'Cancelled',
}
const pad5 = (n) => String(n).padStart(5, '0')
const iso = (d) => (d ? `${String(d).slice(0, 10)}T09:00:00.000Z` : new Date().toISOString())

export function migrateSalesOrders(db) {
  db.__migrations = db.__migrations || {}
  if (db.__migrations.salesOrderV2) return db
  const quotations = db.quotations || []
  const customers = db.customers || []
  const companies = db.companies || []
  const contacts = db.contacts || []
  const invoices = db.invoices || []
  const payments = db.payments || []
  const activities = db.activities || []
  const newActivities = []

  const sorted = [...(db.salesOrders || [])].sort((a, b) => String(a.createdDate || a.orderDate).localeCompare(String(b.createdDate || b.orderDate)) || a.id.localeCompare(b.id))
  const seqByYear = {}

  const migrated = sorted.map((so) => {
    if (so.orderDate && so.revision) return so // already on the new model
    const q = quotations.find((x) => x.id === so.quotationId) || null
    const customer = customers.find((c) => c.id === (so.customerId || q?.customerId)) || null
    const companyId = so.companyId || q?.companyId || customer?.companyId || null
    const company = companies.find((c) => c.id === companyId) || null
    const contactId = so.contactId || q?.contactId || null
    const contact = contacts.find((c) => c.id === contactId) || null
    const invoice = invoices.find((i) => i.salesOrderId === so.id) || null

    let status = STATUS_MAP[so.status] || 'Draft'
    if (invoice && (status === 'Draft' || status === 'Cancelled')) status = 'Fulfilled'
    const orderDate = String(so.createdDate || new Date().toISOString()).slice(0, 10)
    const year = orderDate.slice(0, 4)
    seqByYear[year] = (seqByYear[year] || 0) + 1

    const taxType = inferTaxType(q?.gstin || customer?.gstin || company?.gstin)
    const items = (so.items || []).map((it) => ({
      ...normalizeItem(it),
      description: it.description || '',
      fulfilledQty: status === 'Fulfilled' ? Number(it.qty) || 0 : 0,
    }))
    const order = {
      id: so.id,
      number: `SO-${year}-${pad5(seqByYear[year])}`,
      quotationId: so.quotationId || null,
      quotationNumber: so.quotationNumber || q?.number || null,
      quotationSnapshot: q ? { amount: q.amount, itemCount: (q.items || []).length } : null,
      dealId: so.dealId || q?.dealId || null,
      leadId: so.leadId || q?.leadId || null,
      sourceEnquiryId: q?.sourceEnquiryId || null,
      customerId: customer?.id || null,
      customerName: so.customerName || customer?.name || company?.name || '',
      companyId,
      companyName: company?.name || so.customerName || '',
      contactId,
      contactName: contact?.name || q?.contactName || company?.contactPerson || '',
      contactEmail: contact?.email || q?.contactEmail || company?.email || '',
      contactPhone: contact?.phone || q?.contactPhone || company?.phone || '',
      source: so.source ?? null,
      sourceDetail: so.sourceDetail ?? '',
      orderDate,
      expectedDeliveryDate: so.expectedDeliveryDate,
      salesperson: so.salesperson || q?.assignedTo || null,
      billingAddress: q?.billingAddress || customer?.billingAddress || company?.billingAddress || company?.address || '',
      shippingAddress: q?.shippingAddress || customer?.shippingAddress || company?.shippingAddress || company?.address || '',
      gstin: q?.gstin || customer?.gstin || company?.gstin || '',
      paymentTerms: q?.paymentTerms || '50% advance, 50% on delivery',
      deliveryTerms: DEFAULT_DELIVERY_TERMS,
      notes: '',
      internalRemarks: '',
      items,
      ...pricingFields(items, taxType),
      status,
      invoiceId: invoice?.id || null,
      invoiceIds: invoice ? [invoice.id] : [],
      paymentIds: payments.filter((p) => p.invoiceId === invoice?.id).map((p) => p.id),
      revision: 1,
      revisions: [],
      documents: [],
      nextFollowUp: null,
      createdBy: so.salesperson || q?.assignedTo || null,
      createdAt: iso(orderDate),
      updatedAt: iso(orderDate),
      createdDate: orderDate,
    }
    // keep the legacy total if it differs only by rounding noise — the recomputed figure is authoritative
    if (Math.abs(order.amount - (so.amount || 0)) > 1) order.legacyAmount = so.amount

    // Persisted timeline — real events, dated from the order itself.
    const base = { relatedType: 'Sales Order', relatedId: so.id, relatedName: order.number, status: 'Completed', by: order.createdBy }
    let n = 0
    const add = (type, subject, date, extra = {}) => newActivities.push({ id: `ACT-SO-${so.id}-${++n}`, ...base, type, subject, date: iso(date), ...extra })
    add('Created', `Sales Order ${order.number} created`, orderDate)
    if (order.quotationNumber) add('Quotation', `Linked to quotation ${order.quotationNumber}`, orderDate)
    if (status !== 'Draft') add('StatusChange', 'Status changed from Draft to Confirmed', orderDate, { fromStatus: 'Draft', toStatus: 'Confirmed' })
    if (['Processing', 'Partially Fulfilled', 'Fulfilled'].includes(status)) add('StatusChange', 'Status changed from Confirmed to Processing', orderDate, { fromStatus: 'Confirmed', toStatus: 'Processing' })
    if (status === 'Fulfilled') add('StatusChange', 'Status changed from Processing to Fulfilled', orderDate, { fromStatus: 'Processing', toStatus: 'Fulfilled' })
    if (status === 'Cancelled') add('StatusChange', 'Order cancelled', orderDate, { fromStatus: 'Draft', toStatus: 'Cancelled' })
    if (invoice) add('Invoice', `Invoice ${invoice.number} created`, invoice.issueDate || orderDate, { invoiceId: invoice.id })
    payments.filter((p) => p.invoiceId === invoice?.id).forEach((p) => add('Payment', `Payment recorded against ${invoice.number}`, p.date || orderDate, { paymentId: p.id, paymentAmount: p.amount }))
    return order
  })

  // Re-derive the invoice/payment/quotation side of every link.
  const soById = Object.fromEntries(migrated.map((o) => [o.id, o]))
  db.invoices = invoices.map((inv) => {
    const so = inv.salesOrderId ? soById[inv.salesOrderId] : null
    if (!so || inv.items) return inv
    return {
      ...inv,
      contactId: so.contactId, companyId: so.companyId, contactName: so.contactName,
      billingAddress: so.billingAddress, gstin: so.gstin, salesOrderNumber: so.number, quotationNumber: so.quotationNumber,
      items: so.items.map(({ fulfilledQty, ...rest }) => rest),
      ...pricingFields(so.items, so.taxType),
      amount: inv.amount, // the issued invoice total never moves
      paymentIds: payments.filter((p) => p.invoiceId === inv.id).map((p) => p.id),
    }
  })
  db.payments = payments.map((p) => {
    const inv = invoices.find((i) => i.id === p.invoiceId)
    return inv?.salesOrderId ? { ...p, salesOrderId: inv.salesOrderId } : p
  })
  db.quotations = quotations.map((q) => {
    const so = migrated.find((o) => o.quotationId === q.id && o.status !== 'Cancelled')
    return { ...q, salesOrderId: so ? so.id : null }
  })
  db.salesOrders = migrated
  db.activities = [...newActivities, ...activities]
  db.__migrations.salesOrderV2 = true
  return db
}
