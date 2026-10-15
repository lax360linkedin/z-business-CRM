import { api } from '../../api/mockServer'

export function soError(err, fallback = 'Something went wrong.') {
  return err?.response?.data?.message || err?.message || fallback
}
export function soFieldErrors(err) {
  const f = err?.response?.data?.fields
  return f && typeof f === 'object' ? f : {}
}

export const getSalesOrderDraft = (quotationId) => api.get(`/quotations/${quotationId}/sales-order-draft`).then((r) => r.data)
export const createSalesOrder = (quotationId, order, confirm) => api.post('/salesOrders/from-quotation', { quotationId, order, confirm }).then((r) => r.data)
export const updateSalesOrder = (id, patch) => api.put(`/salesOrders/${id}`, patch).then((r) => r.data)
export const changeSalesOrderStatus = (id, status, reason) => api.post(`/salesOrders/${id}/status`, { status, reason }).then((r) => r.data)
export const recordFulfilment = (id, lines, note) => api.post(`/salesOrders/${id}/fulfillment`, { lines, note }).then((r) => r.data)
export const reviseSalesOrder = (id, payload) => api.post(`/salesOrders/${id}/revise`, payload).then((r) => r.data)
export const addSalesOrderNote = (id, text) => api.post(`/salesOrders/${id}/notes`, { text }).then((r) => r.data)
export const addSalesOrderFollowUp = (id, payload) => api.post(`/salesOrders/${id}/followups`, payload).then((r) => r.data)
export const attachSalesOrderDocument = (id, payload) => api.post(`/salesOrders/${id}/documents`, payload).then((r) => r.data)
export const removeSalesOrderDocument = (id, docId) => api.delete(`/salesOrders/${id}/documents/${docId}`).then((r) => r.data)
export const deleteSalesOrder = (id) => api.delete(`/salesOrders/${id}`).then((r) => r.data)
export const createInvoiceFromOrder = (id, payload = {}) => api.post(`/salesOrders/${id}/invoice`, payload).then((r) => r.data)
export const recordInvoicePayment = (invoiceId, payload) => api.post(`/invoices/${invoiceId}/payments`, payload).then((r) => r.data)
export const cancelInvoice = (invoiceId, reason) => api.post(`/invoices/${invoiceId}/cancel`, { reason }).then((r) => r.data)

/** Loads every record a Sales Order links to, live from the API (never frozen seed arrays). */
export async function loadOrderLinks(order) {
  const get = (path) => api.get(path).then((r) => r.data).catch(() => null)
  const [customer, company, contact, deal, quotation, invoice, allPayments] = await Promise.all([
    order.customerId ? get(`/customers/${order.customerId}`) : null,
    order.companyId ? get(`/companies/${order.companyId}`) : null,
    order.contactId ? get(`/contacts/${order.contactId}`) : null,
    order.dealId ? get(`/deals/${order.dealId}`) : null,
    order.quotationId ? get(`/quotations/${order.quotationId}`) : null,
    order.invoiceId ? get(`/invoices/${order.invoiceId}`) : null,
    api.get('/payments', { params: { all: true } }).then((r) => r.data).catch(() => []),
  ])
  const ids = new Set([...(order.paymentIds || []), ...(invoice?.paymentIds || [])])
  const payments = allPayments.filter((p) => ids.has(p.id) || p.salesOrderId === order.id || (invoice && p.invoiceId === invoice.id))
  return { customer, company, contact, deal, quotation, invoice, payments }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsDataURL(file)
  })
}
