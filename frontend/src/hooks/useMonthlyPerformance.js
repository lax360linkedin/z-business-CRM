import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/http'
import { useRefreshHandler } from '../api/refresh'

/** Revenue, deals won, new leads and customers per month, computed by the server from the real records inside the signed-in person's branch scope. Empty until loaded. */
export function useMonthlyPerformance(months = 12) {
  const [rows, setRows] = useState([])
  const load = useCallback((alive = () => true) => api.get('/reports/monthly-performance', { params: { months } }).then((res) => { if (alive()) setRows(res.data) }).catch(() => { if (alive()) setRows([]) }), [months])
  useEffect(() => {
    let live = true
    load(() => live)
    return () => { live = false }
  }, [load])
  useRefreshHandler(() => load())
  return rows
}
