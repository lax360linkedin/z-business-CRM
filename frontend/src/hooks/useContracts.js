import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/mockServer'
import { useAuth } from '../context/AuthContext'
import { USERS } from '../data/users'
import { contractPermissions, canViewContract, DEFAULT_CONTRACT_TYPES, DEFAULT_CONTRACT_CONFIG } from '../utils/contractRules'

const EVT = 'crm:contracts-changed'
export const emitContractsChanged = () => { window.dispatchEvent(new Event(EVT)); window.dispatchEvent(new Event('crm:tasks-changed')) }

const COLLECTIONS = ['contracts', 'products', 'customers', 'companies', 'contacts', 'deals', 'proposals', 'quotations', 'salesOrders', 'projects', 'invoices', 'payments', 'documents', 'tasks']

/** Everything a contract screen needs, loaded once and refreshed when contracts, tasks, invoices or payments change. */
export function useContractsData() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all(COLLECTIONS.map((c) => api.get(`/${c}`, { params: { all: true } }).then((r) => [c, r.data])))
    .then((p) => { setData(Object.fromEntries(p)); setError('') }).catch((e) => setError(e?.response?.data?.message || 'Could not load contracts.')), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    window.addEventListener('crm:tasks-changed', load)
    return () => { window.removeEventListener(EVT, load); window.removeEventListener('crm:tasks-changed', load) }
  }, [load])
  return { data, error, reload: load }
}

/** Contract permissions for the signed-in user: role capabilities, module access, scope and ownership. */
export function useContractAccess(projects = []) {
  const { user, hasPermission } = useAuth()
  const usersById = useMemo(() => new Map(USERS.map((u) => [u.id, u])), [])
  const ctx = useMemo(() => ({ hasPermission, usersById, projects }), [hasPermission, usersById, projects])
  return { user, usersById, can: (c) => contractPermissions(user, c, ctx), canView: (c) => canViewContract(user, c, ctx) }
}

// ---- settings (contract types + workflow configuration) - kept on the server (GET / PUT /contracts/settings), shared by everyone ----------------
const SETTINGS_EVT = 'crm:contract-settings'
let settings = { types: DEFAULT_CONTRACT_TYPES, config: DEFAULT_CONTRACT_CONFIG }
let loadedAt = 0
const publish = (next) => { settings = { types: next.types || settings.types, config: { ...DEFAULT_CONTRACT_CONFIG, ...(next.config || settings.config) } }; window.dispatchEvent(new Event(SETTINGS_EVT)) }
export const getContractTypes = () => settings.types
export const getContractConfig = () => settings.config
export function loadContractSettings(force = false) {
  if (!force && Date.now() - loadedAt < 10000) return Promise.resolve(settings)
  loadedAt = Date.now()
  return api.get('/contracts/settings').then((r) => { publish(r.data); return settings }).catch(() => settings)
}
export const saveContractTypes = (types) => api.put('/contracts/settings', { types }).then((r) => { publish(r.data); return r.data })
export const saveContractConfig = (config) => api.put('/contracts/settings', { config }).then((r) => { publish(r.data); return r.data })
export function useContractSettings() {
  const [state, setState] = useState(() => ({ types: getContractTypes(), config: getContractConfig() }))
  useEffect(() => {
    const h = () => setState({ types: getContractTypes(), config: getContractConfig() })
    window.addEventListener(SETTINGS_EVT, h)
    loadContractSettings()
    return () => window.removeEventListener(SETTINGS_EVT, h)
  }, [])
  return state
}

/** Contract events on the Activity timeline are written by the server together with the change itself; nothing to post from the browser. */
export function logContractActivity() {
  return Promise.resolve(null)
}

export function useContractsLite() {
  const [contracts, setContracts] = useState([])
  const load = useCallback(() => api.get('/contracts', { params: { all: true } }).then((r) => setContracts(r.data)).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener(EVT, load); return () => window.removeEventListener(EVT, load) }, [load])
  return { contracts }
}
