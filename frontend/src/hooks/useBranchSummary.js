import { useEffect, useState } from 'react'
import { api } from '../api/http'
import { useRefreshHandler } from '../api/refresh'

/**
 * Per-branch figures for the Super Admin's comparison views (Branch Management and the Dashboard): one server-side aggregate across every branch
 * (GET /branches/summary, Super Admin only), whatever branch she is currently viewing.
 */
export function useBranchSummary(names, refreshKey = 0) {
  const [state, setState] = useState({ rows: [], total: {} })
  const load = (alive = () => true) => api.get('/branches/summary').then((res) => { if (alive()) setState(res.data) }).catch(() => { if (alive()) setState({ rows: [], total: {} }) })
  useEffect(() => {
    let live = true
    load(() => live)
    return () => { live = false }
  }, [names.join('|'), refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useRefreshHandler(() => load())
  return state
}

export const SUMMARY_COLUMNS = [
  ['employees', 'Employees'], ['admins', 'Admins'], ['enquiries', 'Enquiries'], ['leads', 'Leads'], ['openDeals', 'Open deals'], ['wonDeals', 'Won deals'],
  ['quotations', 'Quotations'], ['customers', 'Customers'], ['projects', 'Active projects'], ['openTasks', 'Open tasks'], ['openTickets', 'Open tickets'],
]
