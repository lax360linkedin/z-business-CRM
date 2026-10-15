import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/http'
import { useAuth } from '../context/AuthContext'
import { useBranch } from '../context/BranchContext'

// The lead sources a person can choose on a lead or an enquiry: the ones marketing has configured (Lead Sources screen), active, and available in the branch they are working in
// (shared by every branch, or belonging to this one). The server decides; the forms and filters only show what it returns. The list refreshes when sources change, when the
// signed-in person changes, and when a Super Admin switches branch.
const EVT = 'crm:marketing-changed'

/** @returns {{ sources: {id: string, name: string, category: string, shared: boolean, branch: string|null}[], names: string[], ready: boolean, error: string, reload: () => void }} */
export function useLeadSources() {
  const { user } = useAuth()
  const { scopeKey } = useBranch()
  const [state, setState] = useState({ sources: [], ready: false, error: '' })
  const load = useCallback(() => {
    if (!user?.accountId) return Promise.resolve()
    return api.get('/lead-sources/options')
      .then((res) => setState({ sources: res.data, ready: true, error: '' }))
      .catch((e) => setState((s) => ({ ...s, ready: true, error: e?.response?.data?.message || 'Lead sources could not be loaded.' })))
  }, [user?.accountId])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load, scopeKey])
  return { ...state, names: state.sources.map((s) => s.name), reload: load }
}
