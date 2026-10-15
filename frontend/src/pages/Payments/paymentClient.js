import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { emitInvoicesChanged } from '../Invoices/invoiceClient'

export { invErr as payErr, invFields as payFields } from '../Invoices/invoiceClient'
const after = (p) => p.then((r) => { emitInvoicesChanged(); return r.data })
export const fetchPayment = (id) => api.get(`/payments/${id}`).then((r) => r.data)
export const createPayment = (invoiceId, payload) => after(api.post('/payments', { ...payload, invoiceId }))
export const updatePayment = (id, patch) => after(api.put(`/payments/${id}`, patch))
export const completePayment = (id) => after(api.post(`/payments/${id}/complete`))
export const failPayment = (id, reason) => after(api.post(`/payments/${id}/fail`, { reason }))
export const cancelPayment = (id, reason) => after(api.post(`/payments/${id}/cancel`, { reason }))
export const refundPayment = (id, payload) => after(api.post(`/payments/${id}/refund`, payload))
export const deletePendingPayment = (id) => after(api.delete(`/payments/${id}`))
export const logReceipt = (id, action) => after(api.post(`/payments/${id}/receipt`, { action }))
export const exportPaymentsCsv = () => api.get('/payments/export').then((r) => r.data)

let cache = null
/** Payment methods and bank accounts (configurable in Settings → Invoices) plus the caller's payment capabilities. */
export function usePaymentConfig() {
  const [state, setState] = useState(cache)
  const load = useCallback(() => api.get('/payments/config').then((r) => { cache = r.data; setState(r.data) }).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener('crm:invoice-config', load); return () => window.removeEventListener('crm:invoice-config', load) }, [load])
  return useMemo(() => ({ ready: !!state, methods: state?.methods || [], accounts: state?.accounts || [], caps: state?.caps || [], me: state?.user || null, matrix: state?.matrix || {} }), [state])
}
