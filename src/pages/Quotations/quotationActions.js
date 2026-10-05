import { lineTotals } from '../../utils/salesOrderCalc'
import { lineFromProduct } from '../../utils/productRules'
import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { createNotification } from '../../utils/notify'
import { DEFAULT_QUOTATION_TERMS } from '../../data/constants'

/** Thin, shared wrapper so every quotation action logs to /activities in the exact same shape as Lead/Deal/Enquiry/Contact — see src/components/common/ActivityTimeline.jsx. */
export function logQuotationActivity(fields) {
  return api.post('/activities', {
    id: fields.id || genId('ACT'),
    relatedType: 'Quotation',
    date: new Date().toISOString(),
    status: 'Completed',
    ...fields,
  }).then((res) => res.data)
}

/** subtotal (after discount) + tax + total, with each line taxed at its own rate (the catalog item's GST), not a flat 18%. */
export function computeTotals(items) {
  const { subtotal, tax, total } = lineTotals(items)
  return { subtotal, tax, total }
}

/** Live lookup — never a frozen static import — so a Customer created moments ago in this session is always found instead of leaving customerId null when a real match exists. */
export function findCustomerForCompany(companyId) {
  return api.get('/customers', { params: { all: true } }).then((res) => res.data.find((c) => c.companyId === companyId) || null)
}

/** The letterhead/template every new quotation defaults to, if one has been uploaded and marked both Active and Default (see Settings → Quotation Templates). Null until the user supplies and activates their official letterhead — new quotations then fall back to the built-in default layout (src/pages/Quotations/quotationPdf.js). */
export function getDefaultTemplate() {
  return api.get('/quotationTemplates', { params: { all: true } }).then((res) => res.data.find((t) => t.isDefault && t.isActive) || null)
}

/**
 * The exact client-identity field set every quotation must carry, resolved from a Company +
 * optional Contact + optional Customer — single source of truth so the Quotation builder,
 * createQuotationFromDeal() and createQuotationFromLead() can never diverge on field mapping,
 * and a quotation can never end up showing one client's details against another client's
 * company/deal. customerId stays null when the company hasn't become a Customer yet (most
 * quotations go out BEFORE that happens) — never fabricated just to fill the field.
 */
export function buildClientSnapshot({ company, contact, customer }) {
  return {
    companyId: company.id,
    contactId: contact?.id ?? null,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? company.name,
    contactName: contact?.name ?? company.contactPerson ?? '',
    contactPhone: contact?.phone ?? company.phone ?? '',
    contactEmail: contact?.email ?? company.email ?? '',
    billingAddress: company.billingAddress || company.address || '',
    shippingAddress: company.shippingAddress || company.address || '',
    gstin: company.gstin || '',
  }
}

/** Resolves the full client + source-chain snapshot for "Create Quotation" starting from a Deal. */
export function resolveSourceFromDeal(deal) {
  return Promise.all([
    deal.companyId ? api.get(`/companies/${deal.companyId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
    deal.contactId ? api.get(`/contacts/${deal.contactId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
    deal.companyId ? findCustomerForCompany(deal.companyId) : Promise.resolve(null),
    deal.productId ? api.get(`/products/${deal.productId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
  ]).then(([company, contact, customer, product]) => {
    if (!company) throw new Error('This deal has no linked company on file — link a company before creating a quotation.')
    // Deals don't track their own line items, only a single negotiated value — seed one line
    // item from the Deal's service/value so subtotal/tax/amount stay internally consistent
    // (previously the amount was set to deal.value while items stayed empty, so the quotation's
    // own totals never matched its displayed amount). Fully editable afterwards.
    // the deal's catalog item supplies code, unit, tax and description; the agreed deal value is the price
    const items = deal.value ? [product ? { ...lineFromProduct(product, { qty: 1 }), description: deal.requirement || product.description || '', unitPrice: deal.value, discount: 0 } : { productId: null, name: deal.service || 'Service', description: deal.requirement || '', qty: 1, unitPrice: deal.value, discount: 0, taxRate: 18 }] : []
    return {
      ...buildClientSnapshot({ company, contact, customer }),
      dealId: deal.id,
      leadId: deal.leadId || null,
      sourceEnquiryId: deal.sourceEnquiryId || null,
      source: deal.source || null,
      sourceDetail: deal.sourceDetail || '',
      requirement: deal.requirement || '',
      assignedTo: deal.salesperson,
      items,
      ...computeTotals(items),
    }
  })
}

/** Resolves the full client + source-chain snapshot for "Create Quotation" starting from a Lead — requires the Lead to already carry a companyId (set once it's gone through Enquiry conversion or its own Deal conversion), since quoting an unlinked Lead would have nothing real to populate. */
export function resolveSourceFromLead(lead) {
  if (!lead.companyId) {
    return Promise.reject(new Error('This lead has no linked company yet — convert it to a Deal first, or create the quotation from Company Management instead.'))
  }
  return Promise.all([
    api.get(`/companies/${lead.companyId}`).then((r) => r.data).catch(() => null),
    lead.contactId ? api.get(`/contacts/${lead.contactId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
    findCustomerForCompany(lead.companyId),
  ]).then(([company, contact, customer]) => {
    if (!company) throw new Error('The company linked to this lead could not be found.')
    return {
      ...buildClientSnapshot({ company, contact, customer }),
      dealId: lead.dealId || null,
      leadId: lead.id,
      sourceEnquiryId: lead.sourceEnquiryId || null,
      source: lead.source || null,
      sourceDetail: lead.sourceDetail || '',
      requirement: lead.requirement || '',
      assignedTo: lead.assignedTo || null,
      items: [],
      subtotal: 0, tax: 0, amount: 0,
    }
  })
}

/** Resolves the full client snapshot for "Create Quotation" starting directly from a Company (optionally with a chosen Contact) — the path that also covers quoting an existing Customer directly. */
export function resolveSourceFromCompany(company, contact, customer) {
  return Promise.resolve({
    ...buildClientSnapshot({ company, contact, customer }),
    dealId: null,
    leadId: null,
    sourceEnquiryId: null,
    source: null,
    sourceDetail: '',
    requirement: '',
    assignedTo: null,
    items: [],
    subtotal: 0, tax: 0, amount: 0,
  })
}

/** Single creation choke point — every "Create Quotation" path (builder, Deal Detail, Lead Detail) funnels through this so defaults, id/number generation, activity logging and notification are never duplicated or diverged. */
export function createQuotation(payload, { by } = {}) {
  const id = genId('QT')
  return getDefaultTemplate().then((defaultTemplate) => api.post('/quotations', {
    id,
    number: `QUO-${new Date().getFullYear()}-${id.split('-').pop()}`,
    createdDate: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    status: 'Draft',
    terms: DEFAULT_QUOTATION_TERMS,
    paymentTerms: '50% advance, 50% on delivery',
    templateId: defaultTemplate?.id ?? null,
    salesOrderId: null,
    ...payload,
  })).then((res) => {
    const quotation = res.data
    logQuotationActivity({
      type: 'Created',
      relatedId: quotation.id,
      relatedName: quotation.number,
      subject: `Quotation ${quotation.number} created for ${quotation.customerName}`,
      by,
    })
    createNotification({ type: 'Quotation Created', message: `A quotation was created for ${quotation.customerName}.`, relatedType: 'Quotation', relatedId: quotation.id })
    return quotation
  })
}
