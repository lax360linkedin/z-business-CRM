import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { runRefresh } from '../api/refresh'
import { useToast } from './ToastContext'

const RefreshContext = createContext(null)

/**
 * Owns the Refresh button's state for the page that is open. `reopen()` re-mounts the page (the layout does that by changing the key of the outlet); `alwaysReopen` is true for a
 * record's detail page. `refreshable` is false on screens where a refresh could throw away work (forms and editors).
 */
export function RefreshProvider({ children, reopen, alwaysReopen = false, refreshable = true }) {
  const { toast } = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [headers, setHeaders] = useState(0)
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    const began = Date.now()
    try {
      const { failures } = await runRefresh(reopen, { alwaysReopen })
      if (failures.length) toast(`Couldn’t refresh everything: ${failures[0]}`, { type: 'error', title: 'Refresh failed' })
      else setUpdatedAt(new Date())
    } catch (e) {
      toast(e?.message || 'Could not refresh this page. Please try again.', { type: 'error', title: 'Refresh failed' })
    } finally {
      const rest = 450 - (Date.now() - began) // long enough to be seen
      if (rest > 0) await new Promise((r) => setTimeout(r, rest))
      busy.current = false
      setRefreshing(false)
    }
  }, [reopen, alwaysReopen, toast])

  const registerHeader = useCallback(() => { setHeaders((n) => n + 1); return () => setHeaders((n) => n - 1) }, [])
  const value = useMemo(() => ({ refresh, refreshing, updatedAt, refreshable, hasHeader: headers > 0, registerHeader }), [refresh, refreshing, updatedAt, refreshable, headers, registerHeader])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}

export const useRefresh = () => useContext(RefreshContext)

/** Lets a page header say "I am here", so the layout does not add a second Refresh button above the page. */
export function useHeaderPresence() {
  const ctx = useContext(RefreshContext)
  const register = ctx?.registerHeader
  useEffect(() => (register ? register() : undefined), [register])
}
