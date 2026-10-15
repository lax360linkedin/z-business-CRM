import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../api/http'
import { ALL_BRANCHES, BRANCH_NAMES, setBranchNames } from '../data/branches'
import { readSelectedScope, writeSelectedScope } from '../utils/branchScope'

const BranchContext = createContext(null)
const EVT = 'crm:branches-changed'
export const emitBranchesChanged = () => window.dispatchEvent(new Event(EVT))

/**
 * The branch the signed-in person is working in.
 *  - Super Admin: free choice - "All branches" or one branch (kept in this browser, shared with the mock API through utils/branchScope.js).
 *  - Admin / Employee: always their assigned branch; no selector, no cross-branch browsing controls.
 * `scopeKey` changes whenever the effective scope changes; the layout remounts the routed page on it so no screen keeps results of the old scope.
 * The scope is sent with every request (X-Branch-Scope) and only honoured by the server for an account with explicit all-branch access; for everyone else the server fixes the branch itself.
 */
export function BranchProvider({ children }) {
  const { user } = useAuth()
  const isGlobal = !!user?.allBranches
  const [selected, setSelected] = useState(readSelectedScope)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener(EVT, bump)
    return () => window.removeEventListener(EVT, bump)
  }, [])

  const [branches, setBranches] = useState([])
  useEffect(() => {
    if (!user?.accountId) { setBranches([]); return undefined }
    let alive = true
    // the Super Admin reads the full branch records (status, code, headcount); everyone else only needs the names of the active branches
    const request = user.accessLevel === 'Super Admin' ? api.get('/branches') : api.get('/auth/branches').then((r) => ({ data: r.data.map((b) => ({ ...b, status: 'Active' })) }))
    Promise.resolve(request).then((r) => { if (alive) { setBranches(r.data); setBranchNames(r.data.filter((b) => b.status === 'Active').map((b) => b.name)) } }).catch(() => null)
    return () => { alive = false }
  }, [tick, user?.accountId, user?.accessLevel])
  const activeNames = useMemo(() => {
    const names = branches.filter((b) => b.status === 'Active').map((b) => b.name)
    return names.length ? names : BRANCH_NAMES
  }, [branches])

  const assigned = user?.branch || null
  const scope = isGlobal ? (selected === ALL_BRANCHES || activeNames.includes(selected) ? selected : ALL_BRANCHES) : (assigned || ALL_BRANCHES)

  const setBranch = useCallback((value) => {
    if (!isGlobal) return // only the Super Admin can browse across branches
    const next = value === ALL_BRANCHES || BRANCH_NAMES.includes(value) ? value : ALL_BRANCHES
    writeSelectedScope(next)
    setSelected(next)
  }, [isGlobal])

  const value = useMemo(() => ({
    branches, activeNames, isGlobal, assigned, scope,
    isAll: scope === ALL_BRANCHES,
    label: scope === ALL_BRANCHES ? 'All branches' : scope,
    unassigned: !isGlobal && !assigned,
    setBranch,
    scopeKey: `${user?.accountId || 'anon'}:${scope}`,
  }), [branches, activeNames, isGlobal, assigned, scope, setBranch, user?.accountId])

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch() {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch must be used within BranchProvider')
  return ctx
}
