import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { invErr, invFields } from '../Invoices/invoiceClient'

export { invErr as expErr, invFields as expFields }
const EVT = 'crm:expenses-changed'
const CFG_EVT = 'crm:expense-config'
export const emitExpensesChanged = () => window.dispatchEvent(new Event(EVT))
const after = (p) => p.then((r) => { emitExpensesChanged(); return r.data })
export const fetchExpense = (id) => api.get(`/expenses/${id}`).then((r) => r.data)
export const createExpense = (payload) => after(api.post('/expenses', payload))
export const updateExpense = (id, patch) => after(api.put(`/expenses/${id}`, patch))
export const expenseAction = (id, action, payload = {}) => after(api.post(`/expenses/${id}/${action}`, payload))
export const deleteExpense = (id) => after(api.delete(`/expenses/${id}`))
export const exportExpensesCsv = () => api.get('/expenses/export').then((r) => r.data)
export const saveExpenseSettings = (cfg) => api.put('/expenses/config', cfg).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const saveCategory = (id, payload) => (id ? api.put(`/expenses/categories/${id}`, payload) : api.post('/expenses/categories', payload)).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); emitExpensesChanged(); return r.data })
export const deleteCategory = (id) => api.delete(`/expenses/categories/${id}`).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const saveVendor = (id, payload) => (id ? api.put(`/vendors/${id}`, payload) : api.post('/vendors', payload)).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); emitExpensesChanged(); return r.data })
export const deleteVendor = (id) => api.delete(`/vendors/${id}`).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); emitExpensesChanged(); return r.data })

/** Every expense the caller may see, refreshed whenever expenses change anywhere in the app. */
export function useExpenses() {
  const [expenses, setExpenses] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/expenses', { params: { all: true } }).then((r) => { setExpenses(r.data); setError('') }).catch((e) => setError(invErr(e, 'Could not load expenses.'))), [])
  useEffect(() => { load(); window.addEventListener(EVT, load); return () => window.removeEventListener(EVT, load) }, [load])
  return { expenses, error, reload: load }
}
let cache = null
/** Categories, payment methods, policy and the caller's capabilities. */
export function useExpenseConfig() {
  const [state, setState] = useState(cache)
  const load = useCallback(() => api.get('/expenses/config').then((r) => { cache = r.data; setState(r.data) }).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener(CFG_EVT, load); window.addEventListener('crm:invoice-config', load); return () => { window.removeEventListener(CFG_EVT, load); window.removeEventListener('crm:invoice-config', load) } }, [load])
  return useMemo(() => ({ ready: !!state, config: state?.config || {}, methods: state?.methods || [], categories: state?.categories || [], perms: state?.perms || {}, user: state?.user || null, scope: state?.scope, matrix: state?.matrix, reload: load }), [state, load])
}
export function useVendors() {
  const [vendors, setVendors] = useState(null)
  const load = useCallback(() => api.get('/vendors', { params: { all: true } }).then((r) => setVendors(r.data)).catch(() => setVendors([])), [])
  useEffect(() => { load(); window.addEventListener(CFG_EVT, load); window.addEventListener(EVT, load); return () => { window.removeEventListener(CFG_EVT, load); window.removeEventListener(EVT, load) } }, [load])
  return { vendors, reload: load }
}
