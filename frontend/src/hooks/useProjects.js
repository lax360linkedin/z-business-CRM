import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/mockServer'
import { useAuth } from '../context/AuthContext'
import { USERS } from '../data/users'
import { getDataScope } from '../data/dataScope'
import { projectPermissions, canViewProject } from '../utils/projectRules'

const EVT = 'crm:projects-changed'
export const emitProjectsChanged = () => { window.dispatchEvent(new Event(EVT)); window.dispatchEvent(new Event('crm:tasks-changed')) }

const COLLECTIONS = ['projects', 'tasks', 'invoices', 'payments', 'salesOrders', 'contracts', 'customers', 'deals', 'companies', 'contacts', 'products', 'quotations', 'proposals', 'documents']

/** Everything a project screen needs, loaded once and refreshed whenever a project, task, invoice or payment changes. */
export function useProjectsData() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all(COLLECTIONS.map((c) => api.get(`/${c}`, { params: { all: true } }).then((r) => [c, r.data])))
    .then((p) => { setData(Object.fromEntries(p)); setError('') }).catch((e) => setError(e?.response?.data?.message || 'Could not load projects.')), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    window.addEventListener('crm:tasks-changed', load)
    window.addEventListener('crm:products-changed', load) // the product pickers on project and contract forms follow the catalogue
    return () => { window.removeEventListener(EVT, load); window.removeEventListener('crm:tasks-changed', load); window.removeEventListener('crm:products-changed', load) }
  }, [load])
  return { data, error, reload: load }
}

/** Project permissions for the signed-in user: role matrix + data scope + project membership. */
export function useProjectAccess() {
  const { user, hasPermission } = useAuth()
  const usersById = useMemo(() => new Map(USERS.map((u) => [u.id, u])), [])
  const scope = user ? getDataScope(user.role, 'Projects') : 'Own'
  const ctx = useMemo(() => ({ hasPermission, scope, usersById }), [hasPermission, scope, usersById])
  return {
    user, scope, usersById,
    can: (project) => projectPermissions(user, project, ctx),
    canView: (project) => canViewProject(user, project, ctx),
  }
}

/** Project events on the Activity timeline are written by the server together with the change itself; nothing to post from the browser. */
export function logProjectActivity() {
  return Promise.resolve(null)
}

/** Just the project list (live) — for pages that only need to show or count a customer's / employee's projects. */
export function useProjectsLite() {
  const [projects, setProjects] = useState([])
  const load = useCallback(() => api.get('/projects', { params: { all: true } }).then((r) => setProjects(r.data)).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener(EVT, load); return () => window.removeEventListener(EVT, load) }, [load])
  return { projects, byCustomer: (cid) => projects.filter((p) => p.customerId === cid), byId: (pid) => projects.find((p) => p.id === pid) || null }
}
