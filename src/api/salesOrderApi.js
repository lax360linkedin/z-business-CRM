// Mock-backend endpoints for the Sales Order lifecycle and the Invoice/Payment steps hanging off it.
// Registered from mockServer.js BEFORE the generic REST handlers, so these take precedence for the
// routes they cover.
//
// Why dedicated endpoints rather than plain PUTs: this is where the CRM's order-to-cash rules live.
//   • An order is created only from an Accepted quotation, once (no duplicates), and its customer /
//     contact / company / deal / quotation links are copied from the stored records — never taken
//     from the request. A missing Customer is found-or-created by company so none is duplicated.
//   • Every total is recomputed here (tax type, CGST/SGST/IGST, discounts) — client figures ignored.
//   • Status moves follow the lifecycle; confirmed orders are not silently edited — commercial
//     changes go through Revise, which snapshots the previous version.
//   • An invoice is built from the order (one active invoice per order); payments are separate
//     records against the invoice and are the ONLY thing that moves paid/balance — an order is
//     never "paid" by itself.
//   • Every step writes a persisted timeline event (user + time) on the order, and mirrors the key
//     ones onto the Deal's timeline.
import { getCollection, setCollection } from './db'
import { getActiveToken } from '../utils/sessionToken'
import { validateSession } from '../utils/sessionStore'
import { getPermissionsForRole } from '../data/permissions'
import { PAYMENT_METHODS } from '../data/constants'
import {
  SO_TRANSITIONS, SO_LIGHT_EDIT_FIELDS, SO_DRAFT_EDIT_FIELDS, DEFAULT_DELIVERY_TERMS, DEFAULT_TAX_RATE,
  normalizeItem, pricingFields, validateOrderInput, inferTaxType, round2, fulfilmentPercent,
} from '../utils/salesOrderCalc'
import { checkSignature, dataUrlToBytes, dataUrlByteLength, extensionOf, sanitizeFileName, MAX_ATTACHMENT_BYTES } from '../utils/quotationAttachmentRules'
import { createTask } from './taskApi'

const CONFIRM_ROLES = ['Super Admin', 'Admin', 'Sales Manager']
const rid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
const today = () => new Date().toISOString().slice(0, 10)
const bad = (status, message, fields) => [status, { message, ...(fields ? { fields } : {}) }]

function actor() {
  const session = validateSession(getActiveToken()).session
  const account = session ? getCollection('userAccounts').find((a) => a.id === session.accountId) : null
  return { id: account?.employeeId || session?.accountId || 'unknown', name: account?.name || 'Unknown user', role: session?.role || account?.role || null }
}
const can = (a, module, action) => !!getPermissionsForRole(a.role)?.[module]?.[action]
const find = (name, id) => getCollection(name).find((x) => x.id === id) || null

function put(name, id, patch) {
  const list = getCollection(name)
  const idx = list.findIndex((x) => x.id === id)
  if (idx === -1) return null
  const updated = { ...list[idx], ...(typeof patch === 'function' ? patch(list[idx]) : patch) }
  const next = [...list]
  next[idx] = updated
  setCollection(name, next)
  return updated
}

function addActivity(so, a, fields) {
  const entry = {
    id: rid('ACT'), relatedType: 'Sales Order', relatedId: so.id, relatedName: so.number,
    date: new Date().toISOString(), status: 'Completed', by: a.id, ...fields,
  }
  const mirrored = so.dealId && fields.mirrorToDeal
    ? [{ ...entry, id: rid('ACT'), mirrorOf: entry.id, relatedType: 'Deal', relatedId: so.dealId, relatedName: find('deals', so.dealId)?.name || so.dealId, subject: fields.subject.includes(so.number) ? fields.subject : `${fields.subject} (${so.number})` }]
    : []
  delete entry.mirrorToDeal
  mirrored.forEach((m) => delete m.mirrorToDeal)
  setCollection('activities', [entry, ...mirrored, ...getCollection('activities')])
  return entry
}

function notify(message, relatedType, relatedId, type = 'Sales Order Update') {
  setCollection('notifications', [{ id: rid('NTF'), type, message, relatedType, relatedId, date: new Date().toISOString(), read: false }, ...getCollection('notifications')])
}

function nextNumber(collection, prefix, field = 'number') {
  const year = new Date().getFullYear()
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`)
  const max = getCollection(collection).reduce((m, x) => {
    const hit = re.exec(x[field] || '')
    return hit ? Math.max(m, Number(hit[1])) : m
  }, 0)
  return `${prefix}-${year}-${String(max + 1).padStart(5, '0')}`
}

const activeInvoice = (so) => (so.invoiceId ? find('invoices', so.invoiceId) : null)
const isLiveInvoice = (inv) => !!inv && inv.status !== 'Cancelled'

function quotationTaxRate(q) {
  return q.subtotal > 0 ? Math.round((q.tax / q.subtotal) * 100) : DEFAULT_TAX_RATE
}

/** Everything the "Create Sales Order" screen needs, resolved from the stored quotation and its linked records. */
function buildDraft(q) {
  const company = find('companies', q.companyId)
  const contact = q.contactId ? find('contacts', q.contactId) : null
  const customer = (q.customerId && find('customers', q.customerId)) || getCollection('customers').find((c) => c.companyId === q.companyId) || null
  const deal = q.dealId ? find('deals', q.dealId) : null
  const rate = quotationTaxRate(q)
  const gstin = q.gstin || customer?.gstin || company?.gstin || ''
  const items = (q.items || []).map((it) => normalizeItem({ ...it, taxRate: it.taxRate ?? rate, fulfilledQty: 0 }))
  const orderDate = today()
  return {
    quotationId: q.id, quotationNumber: q.number, quotationAmount: q.amount, proposalId: q.proposalId || null, proposalNumber: q.proposalNumber || null,
    dealId: q.dealId || null, dealName: deal?.name || null, leadId: q.leadId || deal?.leadId || null, sourceEnquiryId: q.sourceEnquiryId || deal?.sourceEnquiryId || null,
    source: q.source ?? deal?.source ?? null, sourceDetail: q.sourceDetail || '',
    customerId: customer?.id || null, customerName: customer?.name || company?.name || q.customerName, customerWillBeCreated: !customer,
    companyId: company?.id || q.companyId || null, companyName: company?.name || q.customerName,
    contactId: contact?.id || null, contactName: contact?.name || q.contactName || company?.contactPerson || '',
    contactEmail: contact?.email || q.contactEmail || company?.email || '', contactPhone: contact?.phone || q.contactPhone || company?.phone || '',
    orderDate, expectedDeliveryDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    salesperson: q.assignedTo || deal?.salesperson || null,
    billingAddress: q.billingAddress || customer?.billingAddress || company?.billingAddress || company?.address || '',
    shippingAddress: q.shippingAddress || customer?.shippingAddress || company?.shippingAddress || company?.address || '',
    gstin, taxType: inferTaxType(gstin),
    paymentTerms: q.paymentTerms || '', deliveryTerms: q.deliveryTerms || DEFAULT_DELIVERY_TERMS,
    notes: '', internalRemarks: '',
    items,
  }
}

/** One Customer per Company: reuse the existing record, creating one only if the company has never been a customer. */
function ensureCustomer(draft, a) {
  if (draft.customerId) return draft.customerId
  const existing = getCollection('customers').find((c) => c.companyId === draft.companyId)
  if (existing) return existing.id
  const company = find('companies', draft.companyId)
  if (!company) return null
  const customer = {
    id: rid('CUS'), companyId: company.id, name: company.name, industry: company.industry || '', contactPerson: draft.contactName || company.contactPerson || '',
    email: draft.contactEmail || company.email || '', phone: draft.contactPhone || company.phone || '', gstin: draft.gstin || company.gstin || '',
    billingAddress: draft.billingAddress, shippingAddress: draft.shippingAddress, accountManager: draft.salesperson || a.id,
    since: today(), status: 'Active', lifetimeValue: 0, tier: 'Standard',
  }
  setCollection('customers', [customer, ...getCollection('customers')])
  return customer.id
}

const slim = (items) => items.map(({ fulfilledQty, ...rest }) => rest)

function snapshotOf(so) {
  return {
    revision: so.revision, status: so.status, items: so.items, paymentTerms: so.paymentTerms, deliveryTerms: so.deliveryTerms,
    subtotal: so.subtotal, discountAmount: so.discountAmount, taxableAmount: so.taxableAmount, tax: so.tax, cgst: so.cgst, sgst: so.sgst, igst: so.igst, amount: so.amount, taxType: so.taxType,
    quotationSnapshot: so.quotationSnapshot || null,
  }
}

function pick(obj, keys) {
  const out = {}
  keys.forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k] })
  return out
}

export function documentError(body) {
  const fileName = sanitizeFileName(body.fileName)
  if (!fileName) return 'The file has no name.'
  const ext = extensionOf(fileName)
  const KINDS = { pdf: 'pdf', doc: 'doc', docx: 'docx', xlsx: 'xlsx', png: 'png', jpg: 'jpg', jpeg: 'jpg' }
  const kind = KINDS[ext]
  if (!kind) return 'Only PDF, Word, Excel (.xlsx), PNG and JPG files can be attached.'
  if (/\.(exe|bat|cmd|js|vbs|ps1|sh|html?|svg|php)(\.|$)/i.test(fileName)) return 'This file name looks like an executable or web file.'
  const size = dataUrlByteLength(body.dataUrl)
  if (!size) return 'The file is empty.'
  if (size > MAX_ATTACHMENT_BYTES) return `The file is too large (max ${MAX_ATTACHMENT_BYTES / 1048576} MB).`
  let bytes
  try { bytes = dataUrlToBytes(body.dataUrl, 16) } catch { return 'The uploaded file data is corrupt.' }
  const sig = (arr) => arr.every((b, i) => bytes[i] === b)
  if (['pdf', 'doc', 'docx'].includes(kind)) return checkSignature(dataUrlToBytes(body.dataUrl, 1024), kind)
  if (kind === 'xlsx' && !sig([0x50, 0x4b, 0x03, 0x04])) return 'This is not a valid .xlsx file.'
  if (kind === 'png' && !sig([0x89, 0x50, 0x4e, 0x47])) return 'This is not a valid PNG image.'
  if (kind === 'jpg' && !sig([0xff, 0xd8, 0xff])) return 'This is not a valid JPG image.'
  return null
}

export function registerSalesOrderEndpoints(mock, withSession) {
  const idOf = (config, i = 2) => config.url.split('/')[i]
  const body = (config) => (config.data ? JSON.parse(config.data) : {})

  // ---- Draft for "Create Sales Order" (review before saving) --------------------------------
  mock.onGet(/^\/quotations\/[^/]+\/sales-order-draft$/).reply(withSession((config) => {
    const q = find('quotations', idOf(config))
    if (!q) return bad(404, 'Quotation not found.')
    if (q.status !== 'Accepted') return bad(409, 'A sales order can only be created from an Accepted quotation.')
    const existing = getCollection('salesOrders').find((o) => o.quotationId === q.id && o.status !== 'Cancelled')
    if (existing) return bad(409, `Sales order ${existing.number} already exists for this quotation.`, { existingId: existing.id })
    return [200, buildDraft(q)]
  }))

  // Payments exist only as records against an invoice (Invoice → Record Payment).
  mock.onPost('/payments').reply(withSession(() => bad(400, 'Record payments from the invoice (Invoice → Record Payment) so the balance and the sales order stay in sync.')))

  // ---- Create from quotation -----------------------------------------------------------------
  mock.onPost('/salesOrders').reply(withSession(() => bad(400, 'Sales orders are created from an Accepted quotation — open the quotation and choose Create Sales Order.')))

  mock.onPost('/salesOrders/from-quotation').reply(withSession((config) => {
    const a = actor()
    if (!can(a, 'Sales Orders', 'create')) return bad(403, 'You do not have permission to create sales orders.')
    const req = body(config)
    const q = find('quotations', req.quotationId)
    if (!q) return bad(404, 'Quotation not found.')
    if (q.status !== 'Accepted') return bad(409, 'A sales order can only be created from an Accepted quotation.')
    const dup = getCollection('salesOrders').find((o) => o.quotationId === q.id && o.status !== 'Cancelled')
    if (dup) return bad(409, `Sales order ${dup.number} already exists for this quotation.`, { existingId: dup.id })
    if (req.confirm && !CONFIRM_ROLES.includes(a.role)) return bad(403, 'Only a Sales Manager or Admin can confirm an order. Save it as a draft for approval.')

    const draft = buildDraft(q)
    const input = pick(req.order || {}, SO_DRAFT_EDIT_FIELDS)
    const merged = { ...draft, ...input }
    if (input.contactId !== undefined && input.contactId) {
      const c = find('contacts', input.contactId)
      if (!c || c.companyId !== draft.companyId) return bad(422, "The chosen contact doesn't belong to this quotation's company.")
      merged.contactName = c.name; merged.contactEmail = c.email || ''; merged.contactPhone = c.phone || ''
    }
    merged.items = (input.items || draft.items).map(normalizeItem)
    merged.taxType = input.taxType === 'inter' ? 'inter' : 'intra'
    const errors = validateOrderInput(merged)
    if (Object.keys(errors).length) return bad(422, 'Please fix the highlighted fields.', errors)

    const customerId = ensureCustomer(draft, a)
    const now = new Date().toISOString()
    const status = req.confirm ? 'Confirmed' : 'Draft'
    const so = {
      id: rid('SO'), number: nextNumber('salesOrders', 'SO'),
      proposalId: draft.proposalId, proposalNumber: draft.proposalNumber,
      quotationId: q.id, quotationNumber: q.number, quotationSnapshot: { amount: q.amount, itemCount: (q.items || []).length },
      dealId: draft.dealId, leadId: draft.leadId, sourceEnquiryId: draft.sourceEnquiryId, source: draft.source, sourceDetail: draft.sourceDetail,
      customerId, customerName: draft.customerName, companyId: draft.companyId, companyName: draft.companyName,
      contactId: merged.contactId || draft.contactId || null, contactName: merged.contactName, contactEmail: merged.contactEmail, contactPhone: merged.contactPhone,
      orderDate: merged.orderDate, expectedDeliveryDate: merged.expectedDeliveryDate, salesperson: merged.salesperson,
      billingAddress: merged.billingAddress, shippingAddress: merged.shippingAddress, gstin: (merged.gstin || '').trim().toUpperCase(),
      paymentTerms: merged.paymentTerms, deliveryTerms: merged.deliveryTerms || '', notes: merged.notes || '', internalRemarks: merged.internalRemarks || '',
      items: merged.items, ...pricingFields(merged.items, merged.taxType),
      status, invoiceId: null, invoiceIds: [], paymentIds: [], revision: 1, revisions: [], documents: [], nextFollowUp: null,
      createdBy: a.id, createdAt: now, updatedAt: now, createdDate: merged.orderDate,
      dealName: draft.dealName,
    }
    if (so.amount <= 0 && req.confirm) return bad(422, 'An order with a zero total cannot be confirmed.')
    setCollection('salesOrders', [so, ...getCollection('salesOrders')])
    put('quotations', q.id, { salesOrderId: so.id })
    if (!q.customerId && customerId) put('quotations', q.id, { customerId })
    const deal = draft.dealId ? find('deals', draft.dealId) : null
    if (deal && !deal.customerId && customerId) put('deals', deal.id, { customerId })

    addActivity(so, a, { type: 'Created', subject: `Sales Order ${so.number} created from quotation ${q.number}`, mirrorToDeal: true })
    addActivity(so, a, { type: 'Quotation', subject: `Linked to quotation ${q.number}` })
    if (req.confirm) addActivity(so, a, { type: 'StatusChange', subject: 'Order confirmed', fromStatus: 'Draft', toStatus: 'Confirmed', mirrorToDeal: true })
    addActivity({ ...so, id: q.id, number: q.number }, a, { type: 'Conversion', subject: `Sales Order ${so.number} created from this quotation` , relatedType: 'Quotation' })
    notify(`Sales Order ${so.number} was ${req.confirm ? 'confirmed' : 'created'} for ${so.customerName}.`, 'Sales Order', so.id)
    return [201, so]
  }))

  // ---- Edit -----------------------------------------------------------------------------------
  mock.onPut(/^\/salesOrders\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to edit sales orders.')
    if (so.status === 'Cancelled') return bad(409, 'A cancelled order cannot be edited.')
    const req = body(config)
    const allowed = so.status === 'Draft' ? SO_DRAFT_EDIT_FIELDS : so.status === 'Fulfilled' ? ['notes', 'internalRemarks'] : SO_LIGHT_EDIT_FIELDS
    const rejected = Object.keys(req).filter((k) => !allowed.includes(k) && JSON.stringify(req[k]) !== JSON.stringify(so[k]))
    if (rejected.length) {
      return bad(409, so.status === 'Draft' ? `These fields can't be edited: ${rejected.join(', ')}.` : `${rejected.join(', ')} can't be changed on a ${so.status.toLowerCase()} order. Use Revise Order for commercial changes.`)
    }
    const patch = pick(req, allowed)
    if (patch.contactId) {
      const c = find('contacts', patch.contactId)
      if (!c || c.companyId !== so.companyId) return bad(422, "The chosen contact doesn't belong to this order's company.")
      Object.assign(patch, { contactName: c.name, contactEmail: c.email || '', contactPhone: c.phone || '' })
    }
    if (patch.items) patch.items = patch.items.map(normalizeItem)
    const merged = { ...so, ...patch }
    const errors = validateOrderInput(merged)
    if (Object.keys(errors).length) return bad(422, 'Please fix the highlighted fields.', errors)
    if (patch.gstin !== undefined) patch.gstin = String(patch.gstin || '').trim().toUpperCase()
    if (patch.items || patch.taxType) Object.assign(patch, pricingFields(merged.items, merged.taxType === 'inter' ? 'inter' : 'intra'))
    const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(so[k]) && !['subtotal', 'discountAmount', 'taxableAmount', 'tax', 'cgst', 'sgst', 'igst', 'amount', 'contactName', 'contactEmail', 'contactPhone'].includes(k))
    if (!changed.length) return [200, so]
    const updated = put('salesOrders', so.id, { ...patch, updatedAt: new Date().toISOString() })
    addActivity(so, a, { type: 'Updated', subject: `Sales order updated (${changed.join(', ')})`, updatedFields: changed })
    return [200, updated]
  }))

  // ---- Status ---------------------------------------------------------------------------------
  mock.onPost(/^\/salesOrders\/[^/]+\/status$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to change the order status.')
    const { status, reason } = body(config)
    if (!(SO_TRANSITIONS[so.status] || []).includes(status)) return bad(409, `An order can't move from ${so.status} to ${status}.`)
    if (status === 'Partially Fulfilled') return bad(409, 'Record the delivered quantities (Record Fulfilment) to mark an order partially fulfilled.')
    if (status === 'Confirmed') {
      if (!CONFIRM_ROLES.includes(a.role)) return bad(403, 'Only a Sales Manager or Admin can confirm an order.')
      const errors = validateOrderInput(so)
      if (Object.keys(errors).length) return bad(422, 'Complete the order before confirming it.', errors)
      if (!(so.amount > 0)) return bad(422, 'An order with a zero total cannot be confirmed.')
    }
    if (status === 'Cancelled') {
      if (!String(reason || '').trim()) return bad(422, 'Give a reason for cancelling this order.')
      const inv = activeInvoice(so)
      if (isLiveInvoice(inv)) return bad(409, `Invoice ${inv.number} exists for this order. Cancel the invoice first (only possible while no payment is recorded).`)
    }
    const now = new Date().toISOString()
    const patch = { status, updatedAt: now }
    if (status === 'Confirmed') Object.assign(patch, { confirmedAt: now, confirmedBy: a.id })
    if (status === 'Fulfilled') { patch.items = so.items.map((i) => ({ ...i, fulfilledQty: i.qty })); patch.fulfilledAt = now }
    if (status === 'Cancelled') Object.assign(patch, { cancelledAt: now, cancelledBy: a.id, cancelReason: String(reason).trim() })
    const updated = put('salesOrders', so.id, patch)
    if (status === 'Cancelled' && so.quotationId) put('quotations', so.quotationId, (q) => (q.salesOrderId === so.id ? { salesOrderId: null } : {}))
    const labels = { Confirmed: 'Order confirmed', Processing: 'Processing started', Fulfilled: 'Order fulfilled', Cancelled: `Order cancelled — ${String(reason || '').trim()}` }
    addActivity(so, a, { type: 'StatusChange', subject: labels[status] || `Status changed to ${status}`, fromStatus: so.status, toStatus: status, mirrorToDeal: true })
    notify(`Sales Order ${so.number} is now ${status}.`, 'Sales Order', so.id)
    return [200, updated]
  }))

  // ---- Fulfilment -----------------------------------------------------------------------------
  mock.onPost(/^\/salesOrders\/[^/]+\/fulfillment$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to record fulfilment.')
    if (!['Processing', 'Partially Fulfilled'].includes(so.status)) return bad(409, 'Fulfilment can be recorded once the order is Processing.')
    const lines = body(config).lines || []
    const items = so.items.map((it) => ({ ...it }))
    for (const l of lines) {
      const it = items[l.index]
      if (!it) return bad(422, 'Unknown line item.')
      const q = Number(l.fulfilledQty)
      if (!Number.isFinite(q) || q < (it.fulfilledQty || 0) || q > it.qty) return bad(422, `"${it.name}": delivered quantity must be between ${it.fulfilledQty || 0} and ${it.qty}.`)
      it.fulfilledQty = q
    }
    const total = items.reduce((s, i) => s + i.qty, 0)
    const done = items.reduce((s, i) => s + (i.fulfilledQty || 0), 0)
    const nextStatus = done >= total ? 'Fulfilled' : done > 0 ? 'Partially Fulfilled' : so.status
    const updated = put('salesOrders', so.id, { items, status: nextStatus, updatedAt: new Date().toISOString(), ...(nextStatus === 'Fulfilled' ? { fulfilledAt: new Date().toISOString() } : {}) })
    addActivity(so, a, {
      type: 'StatusChange', subject: `Fulfilment recorded — ${fulfilmentPercent(items)}% delivered${nextStatus !== so.status ? ` (${nextStatus})` : ''}`,
      fromStatus: so.status, toStatus: nextStatus, notes: String(body(config).note || '').slice(0, 500) || undefined, mirrorToDeal: nextStatus !== so.status,
    })
    return [200, updated]
  }))

  // ---- Revise (confirmed orders keep their history) ----------------------------------------------
  mock.onPost(/^\/salesOrders\/[^/]+\/revise$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit') || !CONFIRM_ROLES.includes(a.role)) return bad(403, 'Only a Sales Manager or Admin can revise a confirmed order.')
    if (!['Confirmed', 'Processing', 'Partially Fulfilled'].includes(so.status)) return bad(409, `A ${so.status.toLowerCase()} order can't be revised.`)
    if (isLiveInvoice(activeInvoice(so))) return bad(409, 'This order has been invoiced. Cancel the invoice before revising the order.')
    if (so.items.some((i) => (i.fulfilledQty || 0) > 0)) return bad(409, 'Fulfilment has already started — the order lines can no longer be revised.')
    const req = body(config)
    if (!String(req.reason || '').trim()) return bad(422, 'Give a reason for the revision.')
    let input = pick(req.order || {}, ['items', 'paymentTerms', 'deliveryTerms', 'taxType', 'gstin', 'billingAddress', 'expectedDeliveryDate'])
    let quotationSnapshot = so.quotationSnapshot
    if (req.fromQuotation) {
      const q = find('quotations', so.quotationId)
      if (!q) return bad(404, 'The linked quotation no longer exists.')
      const rate = quotationTaxRate(q)
      input = { ...input, items: (q.items || []).map((it) => normalizeItem({ ...it, taxRate: it.taxRate ?? rate })), paymentTerms: q.paymentTerms || so.paymentTerms }
      quotationSnapshot = { amount: q.amount, itemCount: (q.items || []).length }
    }
    if (input.items) input.items = input.items.map(normalizeItem)
    const merged = { ...so, ...input }
    const errors = validateOrderInput(merged)
    if (Object.keys(errors).length) return bad(422, 'Please fix the highlighted fields.', errors)
    const pricing = pricingFields(merged.items, merged.taxType === 'inter' ? 'inter' : 'intra')
    const now = new Date().toISOString()
    const revisions = [{ ...snapshotOf(so), at: now, by: a.id, byName: a.name, reason: String(req.reason).trim() }, ...(so.revisions || [])]
    const updated = put('salesOrders', so.id, { ...input, ...pricing, quotationSnapshot, revision: (so.revision || 1) + 1, revisions, updatedAt: now })
    addActivity(so, a, { type: 'Revision', subject: `Order revised to revision ${updated.revision} — ${String(req.reason).trim()}`, revision: updated.revision, mirrorToDeal: true })
    return [200, updated]
  }))

  // ---- Notes / follow-ups / documents ---------------------------------------------------------------
  mock.onPost(/^\/salesOrders\/[^/]+\/notes$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to add notes.')
    const text = String(body(config).text || '').trim()
    if (!text) return bad(422, 'Write a note first.')
    if (text.length > 2000) return bad(422, 'Notes are limited to 2000 characters.')
    addActivity(so, a, { type: 'Note', subject: 'Note added', notes: text })
    return [200, { success: true }]
  }))

  mock.onPost(/^\/salesOrders\/[^/]+\/followups$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to add follow-ups.')
    const f = body(config)
    if (!f.date || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return bad(422, 'Choose a follow-up date.')
    if (f.date < today()) return bad(422, 'The follow-up date cannot be in the past.')
    const type = f.type || 'Call'
    const assignee = f.assignedTo || so.salesperson
    put('salesOrders', so.id, { nextFollowUp: f.date })
    const entry = addActivity(so, a, { type: 'Follow-up', subject: `${type} follow-up scheduled for ${f.date}`, notes: String(f.notes || '').slice(0, 1000) || undefined, followUpType: type, followUpDate: f.date, followUpTime: f.time || null, assignedTo: assignee })
    const made = createTask({ ...a, system: true }, {
      title: `${type} follow-up — ${so.number}`, taskType: ['Call', 'Email', 'WhatsApp', 'Meeting', 'Demo'].includes(type) ? type : 'Follow-up', relatedType: 'Sales Order', relatedId: so.id, assignees: [assignee],
      priority: 'Medium', dueDate: f.date, dueTime: f.time || null, description: String(f.notes || ''), visibility: 'Team',
    }, { activityId: entry.id, source: 'activity', allowDuplicate: true, message: 'Created from the sales order follow-up' })
    if (made[0] === 201) put('activities', entry.id, { taskId: made[1].id })
    return [200, find('salesOrders', so.id)]
  }))

  mock.onPost(/^\/salesOrders\/[^/]+\/documents$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to attach documents.')
    if (so.status === 'Cancelled') return bad(409, 'Documents cannot be added to a cancelled order.')
    const req = body(config)
    const error = documentError(req)
    if (error) return bad(422, error)
    if ((so.documents || []).length >= 20) return bad(422, 'An order can hold at most 20 documents.')
    if ((so.documents || []).some((d) => d.hash && d.hash === req.hash)) return bad(409, 'This exact file is already attached to this order.')
    const doc = {
      id: rid('DOC'), fileName: sanitizeFileName(req.fileName), mimeType: req.mimeType || '', size: dataUrlByteLength(req.dataUrl), hash: req.hash || null,
      category: ['Purchase Order', 'Contract', 'Delivery Note', 'Other'].includes(req.category) ? req.category : 'Other',
      dataUrl: req.dataUrl, uploadedAt: new Date().toISOString(), uploadedBy: a.id, uploadedByName: a.name,
      // always stamped from the stored order, never from the request
      salesOrderId: so.id, customerId: so.customerId,
    }
    const updated = put('salesOrders', so.id, { documents: [doc, ...(so.documents || [])], updatedAt: doc.uploadedAt })
    addActivity(so, a, { type: 'Attachment', subject: `Document attached: "${doc.fileName}"`, attachmentName: doc.fileName, attachmentAction: 'Attached' })
    return [200, updated]
  }))

  mock.onDelete(/^\/salesOrders\/[^/]+\/documents\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const parts = config.url.split('/')
    const so = find('salesOrders', parts[2])
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'edit')) return bad(403, 'You do not have permission to remove documents.')
    const doc = (so.documents || []).find((d) => d.id === parts[4])
    if (!doc) return bad(404, 'Document not found on this order.')
    const updated = put('salesOrders', so.id, { documents: so.documents.filter((d) => d.id !== doc.id) })
    addActivity(so, a, { type: 'Attachment', subject: `Document removed: "${doc.fileName}"`, attachmentName: doc.fileName, attachmentAction: 'Removed' })
    return [200, updated]
  }))

  // ---- Delete (drafts only) -------------------------------------------------------------------------
  mock.onDelete(/^\/salesOrders\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Sales Orders', 'delete')) return bad(403, 'You do not have permission to delete sales orders.')
    if (so.status !== 'Draft' || so.invoiceId) return bad(409, 'Only a draft order that has never been invoiced can be deleted. Cancel it instead.')
    setCollection('salesOrders', getCollection('salesOrders').filter((o) => o.id !== so.id))
    setCollection('activities', getCollection('activities').filter((x) => !(x.relatedType === 'Sales Order' && x.relatedId === so.id)))
    put('quotations', so.quotationId, (q) => (q.salesOrderId === so.id ? { salesOrderId: null } : {}))
    return [200, { success: true }]
  }))

  // ---- Create invoice from the order -----------------------------------------------------------------
  mock.onPost(/^\/salesOrders\/[^/]+\/invoice$/).reply(withSession((config) => {
    const a = actor()
    const so = find('salesOrders', idOf(config))
    if (!so) return bad(404, 'Sales order not found.')
    if (!can(a, 'Invoices', 'create')) return bad(403, 'You do not have permission to create invoices.')
    if (!['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled'].includes(so.status)) return bad(409, `Invoices can only be raised for a confirmed order (this one is ${so.status}).`)
    const existing = activeInvoice(so)
    if (isLiveInvoice(existing)) return bad(409, `Invoice ${existing.number} already exists for this order.`, { existingId: existing.id })
    const req = body(config)
    const issueDate = req.issueDate || today()
    const dueDate = req.dueDate || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
    if (dueDate < issueDate) return bad(422, 'The due date cannot be before the issue date.')
    const now = new Date().toISOString()
    const inv = {
      id: rid('INV'), number: nextNumber('invoices', 'INV'),
      customerId: so.customerId, customerName: so.customerName, companyId: so.companyId, contactId: so.contactId, contactName: so.contactName,
      projectId: null, salesOrderId: so.id, salesOrderNumber: so.number, quotationId: so.quotationId, quotationNumber: so.quotationNumber, proposalId: so.proposalId || null, proposalNumber: so.proposalNumber || null,
      dealId: so.dealId, leadId: so.leadId, source: so.source, sourceDetail: so.sourceDetail,
      billingAddress: so.billingAddress, shippingAddress: so.shippingAddress, gstin: so.gstin, paymentTerms: so.paymentTerms,
      items: slim(so.items), taxType: so.taxType, subtotal: so.subtotal, discountAmount: so.discountAmount, taxableAmount: so.taxableAmount,
      tax: so.tax, cgst: so.cgst, sgst: so.sgst, igst: so.igst, amount: so.amount,
      paidAmount: 0, paymentIds: [], issueDate, dueDate, status: 'Draft', createdBy: a.id, createdAt: now,
    }
    setCollection('invoices', [inv, ...getCollection('invoices')])
    const updated = put('salesOrders', so.id, { invoiceId: inv.id, invoiceIds: [...(so.invoiceIds || []), inv.id], updatedAt: now })
    addActivity(so, a, { type: 'Invoice', subject: `Invoice ${inv.number} created`, invoiceId: inv.id, mirrorToDeal: true })
    notify(`Invoice ${inv.number} generated from Sales Order ${so.number}.`, 'Invoice', inv.id, 'Invoice Created')
    return [201, { salesOrder: updated, invoice: inv }]
  }))

  // ---- Invoice: protect generic writes, cancel, record payment --------------------------------------
  mock.onPut(/^\/invoices\/[^/]+$/).reply(withSession((config) => {
    const inv = find('invoices', idOf(config))
    if (!inv) return bad(404, 'Invoice not found.')
    const req = body(config)
    const status = req.status
    if (status && status !== inv.status) {
      if (['Cancelled', 'Paid', 'Partially Paid'].includes(status)) return bad(409, `Use the dedicated action for ${status}: payments are recorded against the invoice and cancellation has its own step.`)
      if (inv.status === 'Cancelled') return bad(409, 'A cancelled invoice cannot be reopened.')
    }
    const safe = pick(req, ['status', 'dueDate', 'issueDate'])
    if (safe.status === inv.status) delete safe.status
    return [200, put('invoices', inv.id, safe)]
  }))

  mock.onPost(/^\/invoices\/[^/]+\/cancel$/).reply(withSession((config) => {
    const a = actor()
    const inv = find('invoices', idOf(config))
    if (!inv) return bad(404, 'Invoice not found.')
    if (!can(a, 'Invoices', 'edit')) return bad(403, 'You do not have permission to cancel invoices.')
    if (inv.status === 'Cancelled') return bad(409, 'This invoice is already cancelled.')
    if ((inv.paidAmount || 0) > 0 || (inv.paymentIds || []).length) return bad(409, 'Payments are recorded against this invoice — it cannot be cancelled.')
    const reason = String(body(config).reason || '').trim()
    if (!reason) return bad(422, 'Give a reason for cancelling the invoice.')
    const updated = put('invoices', inv.id, { status: 'Cancelled', cancelReason: reason, cancelledAt: new Date().toISOString() })
    const so = inv.salesOrderId ? find('salesOrders', inv.salesOrderId) : null
    if (so) {
      put('salesOrders', so.id, (o) => (o.invoiceId === inv.id ? { invoiceId: null } : {}))
      addActivity(so, a, { type: 'Invoice', subject: `Invoice ${inv.number} cancelled — ${reason}`, invoiceId: inv.id })
    }
    return [200, updated]
  }))

  mock.onPost(/^\/invoices\/[^/]+\/payments$/).reply(withSession((config) => {
    const a = actor()
    const inv = find('invoices', idOf(config))
    if (!inv) return bad(404, 'Invoice not found.')
    if (!can(a, 'Payments', 'create')) return bad(403, 'You do not have permission to record payments.')
    if (inv.status === 'Cancelled') return bad(409, 'Payments cannot be recorded against a cancelled invoice.')
    const req = body(config)
    const amount = round2(req.amount)
    const balance = round2((inv.amount || 0) - (inv.paidAmount || 0))
    if (!(amount > 0)) return bad(422, 'Enter a payment amount greater than zero.', { amount: 'Enter an amount greater than zero.' })
    if (amount > balance + 0.005) return bad(422, `The amount exceeds the balance due (${balance}).`, { amount: 'Amount exceeds the balance due.' })
    if (!PAYMENT_METHODS.includes(req.method)) return bad(422, 'Choose a payment method.', { method: 'Choose a payment method.' })
    if (!req.date || req.date > today()) return bad(422, 'The payment date cannot be in the future.', { date: 'Date cannot be in the future.' })
    if (req.requestId && getCollection('payments').some((p) => p.requestId === req.requestId)) return bad(409, 'This payment was already recorded.')
    const so = inv.salesOrderId ? find('salesOrders', inv.salesOrderId) : null
    const paid = round2((inv.paidAmount || 0) + amount)
    const pay = {
      id: rid('PAY'), requestId: req.requestId || null, invoiceId: inv.id, invoiceNumber: inv.number,
      salesOrderId: so?.id || null, salesOrderNumber: so?.number || null, proposalId: inv.proposalId || null, quotationId: inv.quotationId || null, customerId: inv.customerId, customerName: inv.customerName,
      amount, method: req.method, date: req.date, status: 'Completed',
      reference: String(req.reference || '').trim() || `TXN${Math.floor(100000 + Math.random() * 900000)}`,
      notes: String(req.notes || '').slice(0, 500), recordedBy: a.id, recordedAt: new Date().toISOString(),
    }
    setCollection('payments', [pay, ...getCollection('payments')])
    const updated = put('invoices', inv.id, { paidAmount: paid, status: paid >= inv.amount - 0.005 ? 'Paid' : 'Partially Paid', paymentIds: [...(inv.paymentIds || []), pay.id] })
    if (so) {
      put('salesOrders', so.id, { paymentIds: [...(so.paymentIds || []), pay.id] })
      addActivity(so, a, { type: 'Payment', subject: `Payment recorded against ${inv.number}`, paymentId: pay.id, paymentAmount: amount, mirrorToDeal: true })
    }
    notify(`Payment of ${amount} received for ${inv.number}.`, 'Invoice', inv.id, 'Payment Received')
    return [201, { payment: pay, invoice: updated }]
  }))

  // Invoices raised from an order, or carrying payments, are cancelled (an audit trail) — never deleted.
  mock.onDelete(/^\/invoices\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const inv = find('invoices', idOf(config))
    if (!inv) return bad(404, 'Invoice not found.')
    if (!can(a, 'Invoices', 'delete')) return bad(403, 'You do not have permission to delete invoices.')
    if (inv.salesOrderId) return bad(409, 'This invoice belongs to a sales order. Cancel it instead of deleting it.')
    if ((inv.paidAmount || 0) > 0 || (inv.paymentIds || []).length || getCollection('payments').some((p) => p.invoiceId === inv.id)) return bad(409, 'Payments are recorded against this invoice — it cannot be deleted.')
    setCollection('invoices', getCollection('invoices').filter((i) => i.id !== inv.id))
    return [200, { success: true }]
  }))

  // ---- Payments: reversing a payment keeps the invoice balance honest ----------------------------------
  mock.onDelete(/^\/payments\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const pay = find('payments', idOf(config))
    if (!pay) return bad(404, 'Payment not found.')
    if (!can(a, 'Payments', 'delete')) return bad(403, 'You do not have permission to delete payments.')
    const inv = find('invoices', pay.invoiceId)
    setCollection('payments', getCollection('payments').filter((p) => p.id !== pay.id))
    if (inv) {
      const paid = Math.max(0, round2((inv.paidAmount || 0) - pay.amount))
      put('invoices', inv.id, { paidAmount: paid, paymentIds: (inv.paymentIds || []).filter((id) => id !== pay.id), status: inv.status === 'Cancelled' ? inv.status : paid <= 0 ? 'Sent' : paid >= inv.amount ? 'Paid' : 'Partially Paid' })
    }
    const so = pay.salesOrderId ? find('salesOrders', pay.salesOrderId) : null
    if (so) {
      put('salesOrders', so.id, { paymentIds: (so.paymentIds || []).filter((id) => id !== pay.id) })
      addActivity(so, a, { type: 'Payment', subject: `Payment ${pay.reference} reversed (deleted)`, paymentId: pay.id, paymentAmount: -pay.amount })
    }
    return [200, { success: true }]
  }))
}
