import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { DEFAULT_INVOICE_CONFIG } from '../../utils/invoiceRules'

// Browser side of the Invoices module. Everything goes through the invoice API (src/api/invoiceApi.js), which re-checks the session, the caller's rights
// and every figure — nothing here is trusted for security, it only gives faster feedback.
const EVT = 'crm:invoices-changed'
const CFG_EVT = 'crm:invoice-config'
export const emitInvoicesChanged = () => { window.dispatchEvent(new Event(EVT)); window.dispatchEvent(new Event('crm:payments-changed')) }
export const invErr = (e, fallback = 'Something went wrong.') => e?.response?.data?.message || e?.message || fallback
export const invFields = (e) => (e?.response?.data?.fields && typeof e.response.data.fields === 'object' ? e.response.data.fields : {})
const after = (p) => p.then((r) => { emitInvoicesChanged(); return r.data })

export const fetchInvoice = (id) => api.get(`/invoices/${id}`).then((r) => r.data)
export const createManualInvoice = (payload) => after(api.post('/invoices', payload))
export const createInvoiceFromOrder = (soId, payload = {}) => after(api.post(`/salesOrders/${soId}/invoice`, payload))
export const updateInvoice = (id, patch) => after(api.put(`/invoices/${id}`, patch))
export const refreshInvoice = (id) => after(api.post(`/invoices/${id}/refresh`))
export const sendInvoice = (id, payload) => after(api.post(`/invoices/${id}/send`, payload))
export const markInvoiceViewed = (id) => after(api.post(`/invoices/${id}/viewed`))
export const cancelInvoice = (id, reason) => after(api.post(`/invoices/${id}/cancel`, { reason }))
export const voidInvoice = (id, reason) => after(api.post(`/invoices/${id}/void`, { reason }))
export const duplicateInvoice = (id) => after(api.post(`/invoices/${id}/duplicate`))
export const deleteDraftInvoice = (id) => after(api.delete(`/invoices/${id}`))
export const recordPayment = (id, payload) => after(api.post(`/invoices/${id}/payments`, payload))
export const reversePayment = (id, reason) => after(api.post(`/payments/${id}/reverse`, { reason }))
export const saveInvoiceSettings = (cfg) => api.put('/invoices/config', cfg).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const eligibleOrders = () => api.get('/invoices/eligible-orders').then((r) => r.data)
export const exportInvoicesCsv = () => api.get('/invoices/export').then((r) => r.data)

/** Every invoice the caller may see (summary shape), refreshed when invoices or payments change. */
export function useInvoices() {
  const [invoices, setInvoices] = useState(null)
  const [payments, setPayments] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all([api.get('/invoices', { params: { all: true } }), api.get('/payments', { params: { all: true } })])
    .then(([i, p]) => { setInvoices(i.data); setPayments(p.data); setError('') }).catch((e) => setError(invErr(e, 'Could not load invoices.'))), [])
  useEffect(() => { load(); window.addEventListener(EVT, load); return () => window.removeEventListener(EVT, load) }, [load])
  return { invoices, payments, error, reload: load }
}

let cfgCache = null
/** Settings (org details, numbering, terms, taxes) plus the caller's invoice capabilities. */
export function useInvoiceConfig() {
  const [state, setState] = useState(cfgCache)
  const load = useCallback(() => api.get('/invoices/config').then((r) => { cfgCache = r.data; setState(r.data) }).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener(CFG_EVT, load); return () => window.removeEventListener(CFG_EVT, load) }, [load])
  return useMemo(() => ({ ready: !!state, config: state?.config || DEFAULT_INVOICE_CONFIG, caps: state?.caps || [], perms: state?.perms || {}, me: state?.user || null, methods: state?.paymentMethods || [], reload: load }), [state, load])
}

export const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
