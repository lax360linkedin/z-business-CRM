import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/mockServer'
import { put as putList } from '../api/store'
import { useRefreshHandler } from '../api/refresh'

/**
 * Generic list+CRUD hook backed by the mock REST API for a given resource path.
 * Handles client-side search across `searchFields`, arbitrary `filters`, sorting, and pagination.
 */
export function useCrud(resource, { searchFields = [], pageSize = 10, filterFn = null } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState(null)
  const [page, setPage] = useState(1)

  const fetchAll = useCallback((quiet = false) => {
    if (quiet !== true) setLoading(true) // a refresh keeps the rows on screen while the new ones load
    setError(null)
    return api
      .get(`/${resource}`, { params: { all: true } })
      .then((res) => { setItems(res.data); putList(resource, res.data) })
      .catch((err) => setError(err.response?.data?.message || err.message || 'Failed to load data'))
      .finally(() => setLoading(false))
  }, [resource])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])
  useRefreshHandler(() => fetchAll(true))

  const filtered = useMemo(() => {
    let list = [...items]
    if (search.trim() && searchFields.length) {
      const q = search.toLowerCase().trim()
      list = list.filter((item) => searchFields.some((f) => String(item[f] ?? '').toLowerCase().includes(q)))
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || value === 'all') return
      list = list.filter((item) => item[key] === value)
    })
    if (filterFn) list = list.filter(filterFn)
    if (sort?.field) {
      list.sort((a, b) => {
        const av = a[sort.field]
        const bv = b[sort.field]
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'desc' ? bv - av : av - bv
        return sort.dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
      })
    }
    return list
  }, [items, search, filters, sort, searchFields, filterFn])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paged = useMemo(() => {
    const p = Math.min(page, totalPages)
    return filtered.slice((p - 1) * pageSize, p * pageSize)
  }, [filtered, page, pageSize, totalPages])

  const create = useCallback((payload) => api.post(`/${resource}`, payload).then((res) => { fetchAll(); return res.data }), [resource, fetchAll])
  const update = useCallback((id, payload) => api.put(`/${resource}/${id}`, payload).then((res) => { fetchAll(); return res.data }), [resource, fetchAll])
  const remove = useCallback((id) => api.delete(`/${resource}/${id}`).then((res) => { fetchAll(); return res.data }), [resource, fetchAll])

  return {
    items: paged,
    allFiltered: filtered,
    allItems: items,
    loading,
    error,
    search,
    setSearch,
    filters,
    setFilters,
    sort,
    setSort,
    page,
    setPage,
    totalPages,
    total: filtered.length,
    refresh: fetchAll,
    create,
    update,
    remove,
  }
}
