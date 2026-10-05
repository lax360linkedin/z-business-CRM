import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, Copy, Trash2, Power, Package, History, Layers, Users, FolderKanban } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useAuth } from '../../context/AuthContext'
import { useProducts, useCatalogData } from '../../hooks/useProducts'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { computeProductUsage } from '../../utils/productRules'
import { getUserById } from '../../data/users'
import { ProductFormDialog } from './ProductFormDialog'
import { useProductActions } from './ProductActions'

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className={clsx('mt-1 text-xl font-bold', tone === 'rose' ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-400">{sub}</p>}
    </div>
  )
}

function Block({ title, count, empty, children }) {
  return (
    <section className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3><Badge>{count}</Badge></header>
      {count === 0 ? <p className="px-5 py-6 text-center text-sm text-ink-400">{empty}</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{children}</ul>}
    </section>
  )
}
const RowLink = ({ to, title, sub, right, status }) => (
  <li><Link to={to} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50/60 dark:hover:bg-ink-800/30"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-brand-700 dark:text-brand-300">{title}</p>{sub && <p className="truncate text-xs text-ink-400">{sub}</p>}</div>{right && <span className="text-sm font-medium text-ink-800 dark:text-ink-100">{right}</span>}{status && <StatusBadge status={status} />}</Link></li>
)

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('Products & Services', 'create')
  const canEdit = hasPermission('Products & Services', 'edit')
  const canDelete = hasPermission('Products & Services', 'delete')
  const { products, byId, loading } = useProducts()
  const { data, reload } = useCatalogData()
  const [tab, setTab] = useState('overview')
  const [form, setForm] = useState(null)
  const product = byId.get(id)
  const actions = useProductActions({ data, onChanged: (deleted) => { reload(); if (deleted) navigate('/products') } })
  const u = useMemo(() => (product && data ? computeProductUsage(product, data) : null), [product, data])

  if (loading) return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-72" /></div>
  if (!product) return <EmptyState icon={Package} title="Product not found" description={`${id} isn’t in the catalog — it may have been deleted.`} action={<Button variant="secondary" onClick={() => navigate('/products')}>Back to Products & Services</Button>} />

  const price = product.price
  const afterDisc = price * (1 - (product.defaultDiscount || 0) / 100)
  const withTax = afterDisc * (1 + (product.taxRate || 0) / 100)
  const customers = u ? u.customerIds.map((cid) => data.customers.find((c) => c.id === cid)).filter(Boolean) : []

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Products & Services', href: '/products' }, { label: product.code || product.id }]} />
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/products" aria-label="Back to products" className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{product.code}</span>
            <Badge tone={product.status === 'Inactive' ? 'neutral' : 'success'}>{product.status || 'Active'}</Badge>
            <Badge tone="info">{product.type}</Badge><Badge>{product.category}</Badge>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{product.name}</h1>
          <p className="mt-1 text-sm text-ink-500">{formatCurrency(price)} per {product.unit} · {product.billingCycle} · GST {product.taxRate}%</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setForm({ product })}>Edit</Button>}
          {canCreate && <Button variant="secondary" icon={Copy} onClick={() => setForm({ template: { ...product, name: `${product.name} (copy)`, status: 'Active' } })}>Duplicate</Button>}
          {canEdit && <Button variant="secondary" icon={Power} loading={actions.busy} onClick={() => actions.toggle(product)}>{product.status === 'Inactive' ? 'Activate' : 'Deactivate'}</Button>}
          {canDelete && <Button variant="danger" icon={Trash2} onClick={() => actions.remove(product)}>Delete</Button>}
        </div>
      </div>
      {product.status === 'Inactive' && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200">Inactive — hidden from new proposals, quotations and orders. Existing documents keep it.</div>}

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'usage', label: 'Usage & documents', count: u ? u.deals.length + u.proposals.length + u.quotations.length + u.salesOrders.length + u.invoices.length : undefined }, { value: 'history', label: 'Price history', count: (product.priceHistory || []).length }]} />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Units sold" value={u ? u.unitsSold : '…'} sub="on non-cancelled orders" />
            <Stat label="Invoiced" value={u ? formatCurrency(u.invoiced, { compact: true }) : '…'} sub="incl. tax, issued invoices" />
            <Stat label="Collected" value={u ? formatCurrency(u.collected, { compact: true }) : '…'} sub="from payments received" />
            <Stat label="Outstanding" value={u ? formatCurrency(u.outstanding, { compact: true }) : '…'} tone={u?.outstanding > 0 ? 'rose' : undefined} />
            <Stat label="Open documents" value={u ? u.openDocs : '…'} sub="proposals, quotes, orders" />
            <Stat label="Customers" value={u ? customers.length : '…'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Pricing configuration</h2>
              <dl className="divide-y divide-ink-50 text-sm dark:divide-ink-800/60">
                {[['Standard price', formatCurrency(price)], ['Unit of sale', product.unit], ['Billing cycle', product.billingCycle], ['Default discount', `${product.defaultDiscount || 0}%`], ['Price after discount', formatCurrency(afterDisc)], ['Tax rate (GST)', `${product.taxRate}%`], ['Price incl. tax', formatCurrency(withTax)]].map(([k, v]) => <div key={k} className="flex justify-between py-2"><dt className="text-ink-500">{k}</dt><dd className="font-medium text-ink-900 dark:text-ink-50">{v}</dd></div>)}
              </dl>
              <p className="mt-3 text-xs text-ink-400">These defaults fill every new proposal, quotation and order line; each line can still be adjusted.</p>
            </section>
            <section className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Details</h2>
              <p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{product.description || 'No description.'}</p>
              <dl className="mt-4 divide-y divide-ink-50 text-sm dark:divide-ink-800/60">
                {[['Item code', product.code], ['Category', product.category], ['Type', product.type], ['Created', product.createdAt ? formatDate(product.createdAt) : '—'], ['Last updated', product.updatedAt ? formatDateTime(product.updatedAt) : '—']].map(([k, v]) => <div key={k} className="flex justify-between py-2"><dt className="text-ink-500">{k}</dt><dd className="font-medium text-ink-900 dark:text-ink-50">{v}</dd></div>)}
              </dl>
            </section>
          </div>
        </div>
      )}

      {tab === 'usage' && (!u ? <CardSkeleton className="h-64" /> : (
        <div className="space-y-5">
          <p className="text-sm text-ink-500">Every record below references this item by ID, from the first deal to the last payment. Documents keep the price and tax they were issued with.</p>
          <div className="grid gap-5 lg:grid-cols-2">
            <Block title="Deals" count={u.deals.length} empty="No deals for this item yet.">{u.deals.map((d) => <RowLink key={d.id} to={`/deals/${d.id}`} title={d.name} sub={d.companyName} right={formatCurrency(d.value, { compact: true })} status={d.stage} />)}</Block>
            <Block title="Proposals" count={u.proposals.length} empty="Not on any proposal.">{u.proposals.map((p) => <RowLink key={p.id} to={`/proposals/${p.id}`} title={`${p.number} · ${p.title}`} sub={p.clientSnapshot?.companyName} right={formatCurrency(p.value, { compact: true })} status={p.status} />)}</Block>
            <Block title="Quotations" count={u.quotations.length} empty="Not on any quotation.">{u.quotations.map((q) => <RowLink key={q.id} to={`/quotations/${q.id}`} title={q.number} sub={q.customerName} right={formatCurrency(q.amount, { compact: true })} status={q.status} />)}</Block>
            <Block title="Sales orders" count={u.salesOrders.length} empty="Not on any sales order.">{u.salesOrders.map((s) => <RowLink key={s.id} to={`/sales-orders/${s.id}`} title={s.number} sub={s.customerName} right={formatCurrency(s.amount, { compact: true })} status={s.status} />)}</Block>
            <Block title="Invoices" count={u.invoices.length} empty="Not on any invoice.">{u.invoices.map((i) => <RowLink key={i.id} to={`/invoices/${i.id}`} title={i.number} sub={i.customerName} right={formatCurrency(i.amount, { compact: true })} status={i.status} />)}</Block>
            <Block title="Payments received" count={u.payments.length} empty="No payments against invoices with this item.">{u.payments.map((p) => <RowLink key={p.id} to={`/invoices/${p.invoiceId}`} title={`${p.reference} · ${p.invoiceNumber}`} sub={`${p.customerName} · ${formatDate(p.date)}`} right={formatCurrency(p.amount, { compact: true })} />)}</Block>
            <Block title="Customers" count={customers.length} empty="No customer has bought this yet.">{customers.map((c) => <RowLink key={c.id} to={`/customers/${c.id}`} title={c.name} sub={c.industry} />)}</Block>
            <Block title="Projects" count={u.projects.length} empty="No projects delivering this item.">{u.projects.map((p) => <RowLink key={p.id} to={`/projects/${p.id}`} title={p.name} sub={getUserById(p.manager)?.name} status={p.status} />)}</Block>
          </div>
          <p className="flex flex-wrap items-center gap-4 text-xs text-ink-400"><span className="inline-flex items-center gap-1"><Layers size={12} />{u.leads.length} lead(s) and {u.enquiries.length} enquiry(ies) show interest in it</span><span className="inline-flex items-center gap-1"><Users size={12} />{customers.length} customer(s)</span><span className="inline-flex items-center gap-1"><FolderKanban size={12} />{u.projects.length} project(s)</span></p>
        </div>
      ))}

      {tab === 'history' && (
        <section className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50"><History size={15} />Price history</h2>
          <p className="mb-4 text-xs text-ink-400">Every change to the standard price. Existing documents are not affected by these changes.</p>
          <ol className="space-y-3">
            {[...(product.priceHistory || [])].reverse().map((h, i) => (
              <li key={i} className="flex items-center gap-4 rounded-xl bg-ink-50 px-4 py-2.5 text-sm dark:bg-ink-800/50">
                <span className="w-28 font-semibold text-ink-900 dark:text-ink-50">{formatCurrency(h.price)}</span>
                <span className="flex-1 text-ink-600 dark:text-ink-300">{h.note || 'Price updated'}</span>
                <span className="text-xs text-ink-400">{formatDateTime(h.at)}{h.by ? ` · ${getUserById(h.by)?.name || h.by}` : ''}</span>
              </li>
            ))}
            {!(product.priceHistory || []).length && <li className="text-sm text-ink-400">No history recorded.</li>}
          </ol>
        </section>
      )}

      <ProductFormDialog open={!!form} onClose={() => setForm(null)} product={form?.product} template={form?.template} products={products} onSaved={(p) => { reload(); if (form?.template && p?.id) navigate(`/products/${p.id}`) }} />
      {actions.dialogs}
    </div>
  )
}
