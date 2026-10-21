import { useOptions } from '../../hooks/useOptions'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Pencil, Trash2, Package, Copy, LayoutGrid, Rows3, X, Layers, CheckCircle2, PauseCircle, Tag, Link2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { Badge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useAuth } from '../../context/AuthContext'
import { useProducts, useCatalogData, useProductCategories } from '../../hooks/useProducts'
import { formatCurrency } from '../../utils/format'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { TAX_RATES, computeProductUsage } from '../../utils/productRules'
import { ProductFormDialog } from './ProductFormDialog'
import { ProductCategoriesDialog } from './ProductCategoriesDialog'
import { useProductActions } from './ProductActions'

const TYPE_TONES = { Service: 'info', Package: 'success', 'Add-on': 'warning', Product: 'neutral' }
const PAGE_SIZE = 12
const EMPTY = { category: 'all', type: 'all', status: 'all', billingCycle: 'all', unit: 'all', taxRate: 'all', min: '', max: '' }
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const SORTS = { name: 'Name (A–Z)', priceDesc: 'Price (high → low)', priceAsc: 'Price (low → high)', recent: 'Recently updated', used: 'Most used' }
const STAT_TONE = { brand: 'bg-brand-50 text-brand-600', emerald: 'bg-emerald-50 text-emerald-600', ink: 'bg-ink-100 text-ink-600', violet: 'bg-violet-50 text-violet-600', amber: 'bg-amber-50 text-amber-600' }

function Switch({ on, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', on ? 'bg-emerald-500' : 'bg-ink-200 dark:bg-ink-700')}>
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

export default function Products() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('Products & Services', 'create')
  const canEdit = hasPermission('Products & Services', 'edit')
  const canDelete = hasPermission('Products & Services', 'delete')
  const { products, loading, error, reload } = useProducts()
  const { categories } = useProductCategories()
  const types = useOptions('product_types')
  const cycles = useOptions('billing_cycles')
  const units = useOptions('product_units')
  const { data: catalogData, reload: reloadUsage } = useCatalogData()
  const actions = useProductActions({ data: catalogData, onChanged: reloadUsage })
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [sort, setSort] = useState('name')
  const [view, setView] = useState('cards')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [form, setForm] = useState(null) // { product?, template? }
  const [catsOpen, setCatsOpen] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  useEffect(() => { if (params.get('create') === '1' && canCreate) { setForm({}); setParams((p) => { const n = new URLSearchParams(p); n.delete('create'); return n }, { replace: true }) } }, [params, canCreate, setParams])
  useEffect(() => { setPage(1) }, [search, f, sort])
  // a category that was renamed or deleted no longer filters the list
  useEffect(() => { if (f.category !== 'all' && categories.length && !categories.includes(f.category)) setF((x) => ({ ...x, category: 'all' })) }, [categories, f.category])
  const perCategory = useMemo(() => Object.fromEntries(categories.map((c) => [c, products.filter((p) => p.category === c).length])), [categories, products])

  const usage = useMemo(() => (catalogData ? Object.fromEntries(products.map((p) => [p.id, computeProductUsage(p, catalogData)])) : {}), [products, catalogData])
  const docCount = (id) => { const u = usage[id]; return u ? u.proposals.length + u.quotations.length + u.salesOrders.length + u.invoices.length : 0 }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = f.min === '' ? null : Number(f.min)
    const max = f.max === '' ? null : Number(f.max)
    const list = products.filter((p) => {
      if (q && !`${p.name} ${p.code || ''} ${p.description || ''} ${p.category} ${p.type}`.toLowerCase().includes(q)) return false
      if (f.category !== 'all' && p.category !== f.category) return false
      if (f.type !== 'all' && p.type !== f.type) return false
      if (f.status !== 'all' && (p.status || 'Active') !== f.status) return false
      if (f.billingCycle !== 'all' && p.billingCycle !== f.billingCycle) return false
      if (f.unit !== 'all' && p.unit !== f.unit) return false
      if (f.taxRate !== 'all' && Number(p.taxRate) !== Number(f.taxRate)) return false
      if (min !== null && p.price < min) return false
      if (max !== null && p.price > max) return false
      return true
    })
    const by = { name: (a, b) => a.name.localeCompare(b.name), priceDesc: (a, b) => b.price - a.price, priceAsc: (a, b) => a.price - b.price, recent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')), used: (a, b) => docCount(b.id) - docCount(a.id) }
    return [...list].sort(by[sort])
  }, [products, search, f, sort, usage]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE)
  const activeFilters = Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).length
  const stats = useMemo(() => {
    const act = products.filter((p) => p.status !== 'Inactive')
    return { total: products.length, active: act.length, inactive: products.length - act.length, categories: new Set(products.map((p) => p.category)).size, avg: act.length ? act.reduce((s, p) => s + p.price, 0) / act.length : 0 }
  }, [products])

  // Export: every product / service that matches the search and filters on screen, in the chosen sort order
  const exportColumns = [
    { label: 'Code', value: 'code' }, { label: 'Name', value: 'name' }, { label: 'Category', value: 'category' }, { label: 'Type', value: 'type' }, { label: 'Unit', value: 'unit' },
    { label: 'Price', value: (p) => Number(p.price) || 0, align: 'right' }, { label: 'Billing cycle', value: 'billingCycle' }, { label: 'Tax %', value: (p) => Number(p.taxRate) || 0, align: 'right' },
    { label: 'Default discount %', value: (p) => Number(p.defaultDiscount) || 0, align: 'right' }, { label: 'Status', value: (p) => p.status || 'Active' },
    { label: 'Used in documents', value: (p) => docCount(p.id), align: 'right' },
  ]
  const exportFilters = describeFilters([
    ['Search', search.trim() && `"${search.trim()}"`], ['Category', f.category], ['Type', f.type], ['Status', f.status], ['Billing cycle', f.billingCycle], ['Unit', f.unit],
    ['Tax rate', f.taxRate !== 'all' && `${f.taxRate}%`], ['Price from', f.min], ['Price to', f.max],
  ])
  const dupTemplate = (p) => ({ ...p, name: `${p.name} (copy)`, status: 'Active' })

  const statCards = [['Total items', stats.total, Layers, 'brand', null], ['Active', stats.active, CheckCircle2, 'emerald', 'Active'], ['Inactive', stats.inactive, PauseCircle, 'ink', 'Inactive'], ['Categories', stats.categories, Tag, 'violet', null], ['Avg. active price', formatCurrency(stats.avg, { compact: true }), Package, 'amber', null]]

  return (
    <div>
      <PageHeader
        title="Products & Services"
        description="The master catalog behind every deal, proposal, quotation, order and invoice."
        actions={<><Button variant="secondary" icon={Tag} onClick={() => setCatsOpen(true)}>Categories</Button><ExportMenu title="Products & Services" name="products-services" noun="item" columns={exportColumns} rows={() => filtered} filters={exportFilters} />{canCreate && <Button icon={Plus} onClick={() => setForm({})}>Add Product</Button>}</>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Catalog summary">
        {statCards.map(([label, value, Icon, tone, status]) => (
          <button key={label} type="button" onClick={() => status && set({ status: f.status === status ? 'all' : status })} className={clsx('rounded-xl border bg-white p-3 text-left shadow-card dark:bg-ink-900', status && f.status === status ? 'border-brand-300 dark:border-brand-700' : 'border-ink-100 dark:border-ink-800', !status && 'cursor-default')}>
            <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', STAT_TONE[tone])}><Icon size={13} /></span></div>
            <p className="mt-1.5 text-xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Categories">
          {[['all', 'All', products.length], ...categories.map((c) => [c, c, perCategory[c] || 0])].map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={f.category === value} onClick={() => set({ category: f.category === value ? 'all' : value })}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', f.category === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300')}>
              {label}<span className={clsx('rounded-full px-1.5 text-[10px]', f.category === value ? 'bg-white/20' : 'bg-ink-100 text-ink-500 dark:bg-ink-800')}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, code, category…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200">{Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {activeFilters > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
        <div className="ml-auto flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'cards'} aria-label="Card view" onClick={() => setView('cards')} className={clsx('rounded-md p-1.5', view === 'cards' ? 'bg-brand-600 text-white' : 'text-ink-500')}><LayoutGrid size={15} /></button>
          <button type="button" aria-pressed={view === 'table'} aria-label="Table view" onClick={() => setView('table')} className={clsx('rounded-md p-1.5', view === 'table' ? 'bg-brand-600 text-white' : 'text-ink-500')}><Rows3 size={15} /></button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4 dark:border-ink-800 dark:bg-ink-900">
          {[['Category', 'category', categories], ['Type', 'type', types.all], ['Status', 'status', ['Active', 'Inactive']], ['Billing cycle', 'billingCycle', cycles.all], ['Unit', 'unit', units.all]].map(([label, key, opts]) => (
            <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>
          ))}
          <label className="text-xs font-medium text-ink-500">Tax rate<select aria-label="Tax rate" className={clsx(sel, 'mt-1')} value={f.taxRate} onChange={(e) => set({ taxRate: e.target.value })}><option value="all">All</option>{TAX_RATES.map((t) => <option key={t} value={t}>{t}%</option>)}</select></label>
          <label className="text-xs font-medium text-ink-500">Min price<input aria-label="Min price" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.min} onChange={(e) => set({ min: e.target.value })} /></label>
          <label className="text-xs font-medium text-ink-500">Max price<input aria-label="Max price" type="number" min="0" className={clsx(sel, 'mt-1')} value={f.max} onChange={(e) => set({ max: e.target.value })} /></label>
        </div>
      )}

      {error && !products.length ? (
        <EmptyState icon={Package} title="Couldn’t load products & services" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} className="h-52" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Package} title={products.length ? 'No products match' : 'Your catalog is empty'} description={products.length ? 'Try adjusting your search or filters.' : 'Add your first product or service — it becomes selectable everywhere quotes and orders are made.'} action={canCreate && !products.length && <Button icon={Plus} onClick={() => setForm({})}>Add Product</Button>} />
      ) : (
        <>
          {view === 'cards' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageItems.map((p) => {
                const u = usage[p.id]
                return (
                  <div key={p.id} role="link" tabIndex={0} onClick={() => navigate(`/products/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/products/${p.id}`)}
                    className={clsx('flex cursor-pointer flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-800 dark:bg-ink-900', p.status === 'Inactive' && 'opacity-75')}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5"><Badge tone="neutral">{p.category}</Badge><Badge tone={TYPE_TONES[p.type] || 'neutral'}>{p.type}</Badge></div>
                      <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
                        {canCreate && <IconButton icon={Copy} size="sm" aria-label={`Duplicate ${p.name}`} onClick={() => setForm({ template: dupTemplate(p) })} />}
                        {canEdit && <IconButton icon={Pencil} size="sm" aria-label={`Edit ${p.name}`} onClick={() => setForm({ product: p })} />}
                        {canDelete && <IconButton icon={Trash2} size="sm" aria-label={`Delete ${p.name}`} className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => actions.remove(p)} />}
                      </div>
                    </div>
                    <p className="font-mono text-[11px] text-ink-400">{p.code}</p>
                    <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{p.name}</h3>
                    <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-500 dark:text-ink-400">{p.description}</p>
                    <p className="mt-2 flex items-center gap-1 text-xs text-ink-400"><Link2 size={11} />{u ? (docCount(p.id) ? `Used in ${docCount(p.id)} document${docCount(p.id) === 1 ? '' : 's'} · ${u.deals.length} deal${u.deals.length === 1 ? '' : 's'}` : u.deals.length ? `${u.deals.length} deal${u.deals.length === 1 ? '' : 's'}` : 'Not used yet') : 'Checking usage…'}</p>
                    <div className="mt-3 flex items-end justify-between border-t border-ink-100 pt-3.5 dark:border-ink-800">
                      <div><p className="text-lg font-bold text-ink-900 dark:text-ink-50">{formatCurrency(p.price)}</p><p className="text-xs text-ink-400">per {p.unit} · {p.billingCycle} · GST {p.taxRate}%</p></div>
                      {canEdit && <Switch on={p.status !== 'Inactive'} label={p.status === 'Inactive' ? 'Inactive — click to activate' : 'Active — click to deactivate'} onClick={() => actions.toggle(p)} />}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div role="row" className="hidden grid-cols-[7rem_minmax(0,1fr)_9rem_8rem_7rem_6rem_auto] gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 md:grid dark:border-ink-800 dark:bg-ink-800/40"><span>Code</span><span>Name</span><span>Category</span><span className="text-right">Price</span><span>Tax</span><span>Usage</span><span className="w-24 text-right">Status</span></div>
              {pageItems.map((p) => (
                <div key={p.id} role="row" tabIndex={0} onClick={() => navigate(`/products/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/products/${p.id}`)}
                  className={clsx('grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/30 md:grid-cols-[7rem_minmax(0,1fr)_9rem_8rem_7rem_6rem_auto]', p.status === 'Inactive' && 'opacity-70')}>
                  <span className="hidden font-mono text-xs text-ink-500 md:block">{p.code}</span>
                  <div className="min-w-0"><p className="truncate font-medium text-ink-900 dark:text-ink-50">{p.name}</p><p className="truncate text-xs text-ink-400 md:hidden">{p.code} · {p.category}</p></div>
                  <span className="hidden text-ink-600 md:block dark:text-ink-300">{p.category}</span>
                  <span className="hidden text-right font-medium text-ink-900 md:block dark:text-ink-50">{formatCurrency(p.price)}<span className="block text-[11px] font-normal text-ink-400">per {p.unit} · {p.billingCycle}</span></span>
                  <span className="hidden text-xs text-ink-500 md:block">GST {p.taxRate}%</span>
                  <span className="hidden text-xs text-ink-500 md:block">{usage[p.id] ? `${docCount(p.id)} docs` : '…'}</span>
                  <div className="flex items-center justify-end gap-1.5">
                    <Badge tone={p.status === 'Inactive' ? 'neutral' : 'success'}>{p.status || 'Active'}</Badge>
                    {canEdit && <IconButton icon={Pencil} size="sm" aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); setForm({ product: p }) }} />}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      )}

      <ProductCategoriesDialog open={catsOpen} onClose={() => setCatsOpen(false)} categories={categories} products={products} can={{ create: canCreate, edit: canEdit, delete: canDelete }} />
      <ProductFormDialog open={!!form} onClose={() => setForm(null)} product={form?.product} template={form?.template} products={products} onSaved={reloadUsage} />
      {actions.dialogs}
    </div>
  )
}
