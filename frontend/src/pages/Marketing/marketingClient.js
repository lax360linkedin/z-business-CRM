import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { invErr, invFields } from '../Invoices/invoiceClient'

export { invErr as mkErr, invFields as mkFields }
const EVT = 'crm:marketing-changed'
export const emitMarketingChanged = () => window.dispatchEvent(new Event(EVT))
const after = (p) => p.then((r) => { emitMarketingChanged(); return r.data })
export const fetchCampaign = (id) => api.get(`/campaigns/${id}`).then((r) => r.data)
export const createCampaign = (payload) => after(api.post('/campaigns', payload))
export const updateCampaign = (id, patch) => after(api.put(`/campaigns/${id}`, patch))
export const campaignAction = (id, action, payload = {}) => after(api.post(`/campaigns/${id}/${action}`, payload))
export const deleteCampaign = (id) => after(api.delete(`/campaigns/${id}`))
export const fetchSource = (id) => api.get(`/lead-sources/${id}`).then((r) => r.data)
export const saveSource = (id, payload) => after(id ? api.put(`/lead-sources/${id}`, payload) : api.post('/lead-sources', payload))
export const deleteSource = (id) => after(api.delete(`/lead-sources/${id}`))
export const addSourceCategory = (name) => after(api.post('/lead-sources/categories', { name })).then((d) => d.categories)
// integration mappings are metadata only (platform, account / form name, branch): the server never accepts a status or a credential from here
export const addMapping = (sourceId, payload) => after(api.post(`/lead-sources/${sourceId}/integrations`, payload))
export const updateMapping = (sourceId, id, payload) => after(api.put(`/lead-sources/${sourceId}/integrations/${id}`, payload))
export const removeMapping = (sourceId, id) => after(api.delete(`/lead-sources/${sourceId}/integrations/${id}`))
export const fetchAnalytics = (filters) => api.get('/marketing/analytics', { params: filters }).then((r) => r.data)
export const exportMarketing = (type, filters) => api.get('/marketing/export', { params: { ...filters, type } }).then((r) => r.data)

let cache = null
export function useMarketingConfig() {
  const [state, setState] = useState(cache)
  const load = useCallback(() => api.get('/marketing/config').then((r) => { cache = r.data; setState(r.data) }).catch(() => setState({ perms: {}, denied: true })), [])
  useEffect(() => { load(); window.addEventListener(EVT, load); return () => window.removeEventListener(EVT, load) }, [load])
  return useMemo(() => ({ ready: !!state, perms: state?.perms || {}, user: state?.user, statuses: state?.statuses || [], types: state?.types || [], categories: state?.categories || [], sources: state?.sources || [], channels: state?.channels || [], matrix: state?.matrix, reload: load }), [state, load])
}
export function useCampaigns() {
  const [campaigns, setCampaigns] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/campaigns', { params: { all: true } }).then((r) => { setCampaigns(r.data); setError('') }).catch((e) => setError(invErr(e, 'Could not load campaigns.'))), [])
  useEffect(() => { load(); const ev = [EVT, 'crm:expenses-changed', 'crm:invoices-changed']; ev.forEach((e) => window.addEventListener(e, load)); return () => ev.forEach((e) => window.removeEventListener(e, load)) }, [load])
  return { campaigns, error, reload: load }
}
/** The lead source register. `filters` ({ from, to, branch }) are applied by the server, which counts enquiries inside them. */
export function useSources(filters = {}) {
  const [sources, setSources] = useState(null)
  const [error, setError] = useState('')
  const key = JSON.stringify(filters)
  const load = useCallback(() => api.get('/lead-sources', { params: JSON.parse(key) }).then((r) => { setSources(r.data); setError('') }).catch((e) => setError(invErr(e, 'Could not load lead sources.'))), [key])
  useEffect(() => { load(); const ev = [EVT, 'crm:invoices-changed']; ev.forEach((e) => window.addEventListener(e, load)); return () => ev.forEach((e) => window.removeEventListener(e, load)) }, [load])
  return { sources, error, reload: load }
}
/** Live analytics for a filter set: refreshed when marketing, invoice or payment data changes. */
export function useAnalytics(filters) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const key = JSON.stringify(filters)
  const load = useCallback(() => fetchAnalytics(JSON.parse(key)).then((d) => { setData(d); setError('') }).catch((e) => setError(invErr(e, 'Could not load analytics.'))), [key])
  useEffect(() => { load(); const ev = [EVT, 'crm:invoices-changed', 'crm:payments-changed', 'crm:expenses-changed']; ev.forEach((e) => window.addEventListener(e, load)); return () => ev.forEach((e) => window.removeEventListener(e, load)) }, [load])
  return { data, error, reload: load }
}
