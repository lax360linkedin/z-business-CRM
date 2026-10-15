import { api } from '../../api/mockServer'

export { soError as prError, soFieldErrors as prFieldErrors } from '../SalesOrders/salesOrderClient'

export const getProposalDraft = (dealId) => api.get(`/deals/${dealId}/proposal-draft`).then((r) => r.data)
export const createProposal = (dealId, proposal) => api.post('/proposals/from-deal', { dealId, proposal }).then((r) => r.data)
export const updateProposal = (id, patch) => api.put(`/proposals/${id}`, patch).then((r) => r.data)
export const changeProposalStatus = (id, status, reason) => api.post(`/proposals/${id}/status`, { status, reason }).then((r) => r.data)
export const sendProposal = (id, payload) => api.post(`/proposals/${id}/send`, payload).then((r) => r.data)
export const reviseProposal = (id, reason) => api.post(`/proposals/${id}/revise`, { reason }).then((r) => r.data)
export const getClientDiff = (id) => api.get(`/proposals/${id}/client-diff`).then((r) => r.data)
export const refreshClient = (id) => api.post(`/proposals/${id}/refresh-client`).then((r) => r.data)
export const logProposalActivity = (id, type, data) => api.post(`/proposals/${id}/activities`, { type, data }).then((r) => r.data)
export const attachProposalDocument = (id, payload) => api.post(`/proposals/${id}/documents`, payload).then((r) => r.data)
export const removeProposalDocument = (id, docId) => api.delete(`/proposals/${id}/documents/${docId}`).then((r) => r.data)
export const createQuotationFromProposal = (id, allowAnother = false) => api.post(`/proposals/${id}/create-quotation`, { allowAnother }).then((r) => r.data)
export const deleteProposal = (id) => api.delete(`/proposals/${id}`).then((r) => r.data)
export const sweepExpired = () => api.post('/proposals/expire-sweep').then((r) => r.data).catch(() => ({ expired: [] }))

/** Every record a proposal links to, loaded live. Only records that actually exist are returned. */
export async function loadProposalLinks(p) {
  const get = (path) => api.get(path).then((r) => r.data).catch(() => null)
  const list = (name) => api.get(`/${name}`, { params: { all: true } }).then((r) => r.data).catch(() => [])
  const [deal, company, contact, customer, enquiry, lead, quotations, orders, invoices, payments, template] = await Promise.all([
    p.dealId ? get(`/deals/${p.dealId}`) : null,
    p.companyId ? get(`/companies/${p.companyId}`) : null,
    p.contactId ? get(`/contacts/${p.contactId}`) : null,
    p.customerId ? get(`/customers/${p.customerId}`) : null,
    p.enquiryId ? get(`/enquiries/${p.enquiryId}`) : null,
    p.leadId ? get(`/leads/${p.leadId}`) : null,
    list('quotations'), list('salesOrders'), list('invoices'), list('payments'),
    p.templateId ? get(`/proposalTemplates/${p.templateId}`) : null,
  ])
  const myQuotations = quotations.filter((q) => q.proposalId === p.id)
  const qIds = new Set(myQuotations.map((q) => q.id))
  const myOrders = orders.filter((o) => (o.proposalId === p.id) || qIds.has(o.quotationId))
  const oIds = new Set(myOrders.map((o) => o.id))
  const myInvoices = invoices.filter((i) => i.proposalId === p.id || oIds.has(i.salesOrderId))
  const iIds = new Set(myInvoices.map((i) => i.id))
  const myPayments = payments.filter((x) => iIds.has(x.invoiceId))
  // the customer appears on the deal once it is Closed Won — pick it up live rather than from the proposal's stale copy
  const liveCustomer = customer || (deal?.customerId ? await get(`/customers/${deal.customerId}`) : null)
  return { deal, company, contact, customer: liveCustomer, enquiry, lead, quotations: myQuotations, orders: myOrders, invoices: myInvoices, payments: myPayments, template }
}

/** The default active proposal template (or the proposal's own selected one). */
export async function pickTemplate(proposal) {
  const all = await api.get('/proposalTemplates', { params: { all: true } }).then((r) => r.data).catch(() => [])
  return all.find((t) => t.id === proposal.templateId) || all.find((t) => t.isDefault && t.isActive) || null
}
