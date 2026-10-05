import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/mockServer'

const EVT = 'crm:products-changed'
export const emitProductsChanged = () => window.dispatchEvent(new Event(EVT))

/**
 * The LIVE Products & Services catalog. Forms must read it through this hook — never from the static seed array —
 * so a product created, repriced, deactivated or deleted on the Products page is what every picker offers next.
 */
export function useProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => api.get('/products', { params: { all: true } }).then((r) => setProducts(r.data)).catch(() => {}).finally(() => setLoading(false)), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    window.addEventListener('focus', load)
    return () => { window.removeEventListener(EVT, load); window.removeEventListener('focus', load) }
  }, [load])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const active = useMemo(() => products.filter((p) => p.status !== 'Inactive'), [products])
  return { products, active, byId, loading, reload: load }
}

/** Names offered by "Product / Service" selects on Leads, Enquiries and Deals — the live Active catalog, plus the record's current (possibly legacy) value so editing never blanks it. */
export function useServiceOptions(current) {
  const { active } = useProducts()
  return useMemo(() => {
    const names = [...new Set(active.map((p) => p.name))]
    if (current && !names.includes(current)) names.push(current)
    return names.sort((a, b) => a.localeCompare(b))
  }, [active, current])
}

/** Every catalog name (active or not) — for list filters, where an old record may still carry a retired service. */
export function useAllServiceNames() {
  const { products } = useProducts()
  return useMemo(() => [...new Set(products.map((p) => p.name))].sort((a, b) => a.localeCompare(b)), [products])
}

const USAGE_COLLECTIONS = ['deals', 'proposals', 'quotations', 'salesOrders', 'invoices', 'payments', 'projects', 'leads', 'enquiries', 'customers']
/** Every collection a product can be referenced from, loaded once — feeds usage counts, delete guards and the detail page. */
export function useCatalogData() {
  const [data, setData] = useState(null)
  const load = useCallback(() => Promise.all(USAGE_COLLECTIONS.map((c) => api.get(`/${c}`, { params: { all: true } }).then((r) => [c, r.data]).catch(() => [c, []]))).then((p) => setData(Object.fromEntries(p))), [])
  useEffect(() => { load() }, [load])
  return { data, reload: load }
}
