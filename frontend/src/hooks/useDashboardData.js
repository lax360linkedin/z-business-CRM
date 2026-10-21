import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/mockServer'
import { useRefreshHandler } from '../api/refresh'

const RESOURCES = ['leads', 'enquiries', 'deals', 'customers', 'projects', 'salesOrders', 'invoices', 'payments', 'tasks', 'activities']

export function useDashboardData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => Promise.all(RESOURCES.map((r) => api.get(`/${r}`, { params: { all: true } })))
    .then((results) => {
      const merged = {}
      RESOURCES.forEach((r, i) => { merged[r] = results[i].data })
      setData(merged)
    })
    .finally(() => setLoading(false)), [])

  useEffect(() => { load() }, [load])
  useRefreshHandler(load)

  return { data, loading }
}
