import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, onWrite } from '../api/http'

const EVT = 'crm:products-changed'
export const emitProductsChanged = () => window.dispatchEvent(new Event(EVT))
// ANY successful write to the catalogue - from the Products screen, an import, another tab's request through this client - tells every mounted picker to reload, so a product that is
// added, edited, deactivated or deleted is what the next dropdown offers (no screen has to remember to announce it).
onWrite((config) => { if (/\/products(\/|\?|$)/.test(String(config?.url || ''))) emitProductsChanged() })

const errorOf = (e) => e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server.' : e?.message) || 'Could not load products and services.'

/**
 * The LIVE Products & Services catalogue from the server. Every picker reads it through this hook - there is no built-in list - so what the Products screen holds is exactly what
 * every form offers. `loading` / `error` let a picker show an honest state instead of an empty list.
 */
export function useProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/products', { params: { all: true } })
    .then((r) => { setProducts(Array.isArray(r.data) ? r.data : []); setError('') })
    .catch((e) => setError(errorOf(e)))
    .finally(() => setLoading(false)), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    window.addEventListener('focus', load)
    return () => { window.removeEventListener(EVT, load); window.removeEventListener('focus', load) }
  }, [load])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const active = useMemo(() => products.filter((p) => p.status !== 'Inactive'), [products])
  return { products, active, byId, loading, error, reload: load }
}

/** The categories a product can have (configured on the server; people with the right add more without a code change). */
export function useProductCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => api.get('/products/categories').then((r) => setCategories(r.data?.categories || [])).catch(() => {}).finally(() => setLoading(false)), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load])
  return { categories, loading, reload: load }
}

export const addProductCategory = (name) => api.post('/products/categories', { name }).then((r) => { emitProductsChanged(); return r.data.categories })
// the server carries a rename to every product and, for a delete, moves the products still using the category; the write announces itself (see the onWrite listener above)
export const renameProductCategory = (name, next) => api.put(`/products/categories/${encodeURIComponent(name)}`, { name: next }).then((r) => r.data.categories)
export const deleteProductCategory = (name, moveTo) => api.delete(`/products/categories/${encodeURIComponent(name)}`, { params: moveTo ? { moveTo } : {} }).then((r) => r.data.categories)

/**
 * Names offered by "Product / Service" selects on Leads, Enquiries and Deals: the live Active catalogue, plus the record's current (possibly retired) value so editing never blanks it.
 * `placeholder` is the text of the empty first option: it says what is going on while there is nothing to choose yet.
 */
export function useServiceCatalog(current) {
  const { active, loading, error, reload } = useProducts()
  const names = useMemo(() => {
    const list = [...new Set(active.map((p) => p.name))]
    if (current && !list.includes(current)) list.push(current)
    return list.sort((a, b) => a.localeCompare(b))
  }, [active, current])
  const placeholder = loading ? 'Loading products & services…' : error && !names.length ? 'Could not load — check your connection' : !names.length ? 'No products or services yet' : 'Select a product / service…'
  return { names, loading, error, empty: !loading && !error && !names.length, placeholder, reload }
}

export function useServiceOptions(current) {
  return useServiceCatalog(current).names
}

/** Every catalogue name (active or not) - for list filters, where an old record may still carry a retired service. */
export function useAllServiceNames() {
  const { products } = useProducts()
  return useMemo(() => [...new Set(products.map((p) => p.name))].sort((a, b) => a.localeCompare(b)), [products])
}

const USAGE_COLLECTIONS = ['deals', 'proposals', 'quotations', 'salesOrders', 'invoices', 'payments', 'projects', 'leads', 'enquiries', 'customers']
/** Every collection a product can be referenced from, loaded once - feeds usage counts, delete guards and the detail page. */
export function useCatalogData() {
  const [data, setData] = useState(null)
  const load = useCallback(() => Promise.all(USAGE_COLLECTIONS.map((c) => api.get(`/${c}`, { params: { all: true } }).then((r) => [c, r.data]).catch(() => [c, []]))).then((p) => setData(Object.fromEntries(p))), [])
  useEffect(() => { load() }, [load])
  return { data, reload: load }
}
