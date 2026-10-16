import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { invErr, invFields } from '../Invoices/invoiceClient'
import { setDirectory } from '../../data/users'

export { invErr as orgErr, invFields as orgFields }
const EVT = 'crm:org-changed'
export const emitOrgChanged = () => window.dispatchEvent(new Event(EVT))
const after = (p) => p.then((r) => { emitOrgChanged(); return r.data })
// The detail pages read many nested fields. The server sends all of them; these defaults mean a missing one shows as "none" instead of breaking the whole page.
const NO_WORKLOAD = { pendingTasks: 0, overdueTasks: 0, activeProjects: 0, openTickets: 0, activeDeals: 0, openLeads: 0, level: 'None' }
const list = (v) => (Array.isArray(v) ? v : [])
const withEmployeeDefaults = (e) => ({ ...e, perms: e.perms || {}, workload: { ...NO_WORKLOAD, ...(e.workload || {}) }, directReports: list(e.directReports), chain: list(e.chain), ledTeams: list(e.ledTeams), timeline: list(e.timeline),
  related: { tasks: list(e.related?.tasks), projects: list(e.related?.projects), deals: list(e.related?.deals), leads: list(e.related?.leads), tickets: list(e.related?.tickets) } })
const withGroupDefaults = (g) => ({ ...g, perms: g.perms || {}, teams: list(g.teams), members: list(g.members).map((m) => ({ ...m, workload: { ...NO_WORKLOAD, ...(m.workload || {}) } })), subTeams: list(g.subTeams), history: list(g.history) })
export const fetchEmployee = (id) => api.get(`/employees/${id}`).then((r) => withEmployeeDefaults(r.data))
export const createEmployee = (payload) => after(api.post('/employees', payload))
export const updateEmployee = (id, patch) => after(api.put(`/employees/${id}`, patch))
export const changeStatus = (id, payload) => after(api.post(`/employees/${id}/status`, payload))
export const grantAccess = (id, payload) => after(api.post(`/employees/${id}/access`, payload))
export const bulkAction = (payload) => after(api.post('/employees/bulk', payload))
export const importEmployees = (rows, commit) => (commit ? after(api.post('/employees/import', { rows, commit: true })) : api.post('/employees/import', { rows }).then((r) => r.data))
export const fetchDepartment = (id) => api.get(`/departments/${id}`).then((r) => withGroupDefaults(r.data))
export const fetchTeam = (id) => api.get(`/teams/${id}`).then((r) => withGroupDefaults(r.data))
export const saveDepartment = (id, payload) => after(id ? api.put(`/departments/${id}`, payload) : api.post('/departments', payload))
export const saveTeam = (id, payload) => after(id ? api.put(`/teams/${id}`, payload) : api.post('/teams', payload))
// from User Management the same operation goes through the account's own endpoint (`accountId`), so the audit trail says where it was started
const deletePath = (id, accountId) => (accountId ? `/userAccounts/${accountId}` : `/employees/${id}`)
export const fetchDeleteImpact = (id, accountId) => api.get(`${deletePath(id, accountId)}/delete-impact`, { noCache: true }).then((r) => r.data)
export const fetchEmployeeChoices = () => api.get('/employees', { params: { all: true } }).then((r) => (Array.isArray(r.data) ? r.data : r.data.data || []))
/** Deletes the person (login + employee record together) and refreshes everything that lists people: the org screens, the user list and the name directory used by pickers. */
export const deletePerson = (id, reassignTo, accountId) => api.delete(deletePath(id, accountId), { params: reassignTo ? { reassignTo } : undefined, silent: true })
  .then((r) => { api.get('/directory/people', { noCache: true }).then((d) => setDirectory(d.data)).catch(() => null); emitOrgChanged(); return r.data })
export const removeDepartment = (id) => after(api.delete(`/departments/${id}`))
export const removeTeam = (id) => after(api.delete(`/teams/${id}`))

let cfgCache = null
/** The whole organisation (employees, departments, teams) plus the caller's capabilities, refreshed whenever anything in it changes. */
const ALL = { params: { all: true } }

export function useOrg() {
  const [state, setState] = useState({ cfg: cfgCache, employees: null, departments: null, teams: null, error: '' })
  const load = useCallback(() => Promise.all([api.get('/org/config'), api.get('/employees', ALL), api.get('/departments', ALL), api.get('/teams', ALL)])
    .then(([c, e, d, t]) => { cfgCache = c.data; setState({ cfg: c.data, employees: e.data, departments: d.data, teams: t.data, error: '' }) })
    .catch((e) => setState((s) => ({ ...s, error: invErr(e, 'Could not load the organisation.') }))), [])
  useEffect(() => { load(); const ev = [EVT, 'crm:tasks-changed']; ev.forEach((x) => window.addEventListener(x, load)); return () => ev.forEach((x) => window.removeEventListener(x, load)) }, [load])
  return useMemo(() => ({ ...state, perms: state.cfg?.perms || {}, reload: load }), [state, load])
}
