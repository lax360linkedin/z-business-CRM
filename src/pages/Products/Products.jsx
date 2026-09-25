import { useState } from 'react'
import { Plus, Pencil, Trash2, Package } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { Badge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { formatCurrency } from '../../utils/format'
import { genId } from '../../utils/csv'

const CATEGORIES = ['Development', 'Design', 'Marketing', 'Consulting', 'Support & Maintenance', 'Infrastructure']
const TYPES = ['Service', 'Package', 'Add-on']
const BILLING_CYCLES = ['One-time', 'Monthly', 'Quarterly', 'Annual']
const STATUSES = ['Active', 'Inactive']
const TYPE_TONES = { Service: 'info', Package: 'success', 'Add-on': 'warning' }
const PAGE_SIZE = 12

const FIELDS = [
  { name: 'name', label: 'Product / Service name', required: true, span: 2 },
  { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.map((c) => ({ value: c, label: c })), required: true, span: 1 },
  { name: 'type', label: 'Type', type: 'select', options: TYPES.map((t) => ({ value: t, label: t })), required: true, span: 1 },
  { name: 'description', label: 'Description', type: 'textarea', span: 2 },
  { name: 'price', label: 'Price (₹)', type: 'number', required: true, span: 1 },
  { name: 'billingCycle', label: 'Billing cycle', type: 'select', options: BILLING_CYCLES.map((b) => ({ value: b, label: b })), required: true, span: 1 },
  { name: 'status', label: 'Status', type: 'select', options: STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 2 },
]

export default function Products() {
  const crud = useCrud('products', { searchFields: ['name', 'description', 'category'], pageSize: PAGE_SIZE })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const filterDefs = [
    { key: 'category', label: 'Categories', options: CATEGORIES.map((c) => ({ value: c, label: c })) },
    { key: 'type', label: 'Types', options: TYPES.map((t) => ({ value: t, label: t })) },
    { key: 'status', label: 'Status', options: STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  const createProduct = (data) => {
    setSaving(true)
    crud.create({ id: genId('PRD'), ...data, price: Number(data.price) || 0 }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Product created successfully.', { type: 'success' })
    })
  }

  const saveEdit = (data) => {
    setSaving(true)
    crud.update(editTarget.id, { ...data, price: Number(data.price) || 0 }).then(() => {
      setSaving(false)
      setEditTarget(null)
      toast('Product updated.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`"${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const toggleStatus = (product) => {
    const nextStatus = product.status === 'Active' ? 'Inactive' : 'Active'
    crud.update(product.id, { status: nextStatus }).then(() => {
      toast(`${product.name} marked ${nextStatus}.`, { type: 'success' })
    })
  }

  return (
    <div>
      <PageHeader
        title="Products & Services"
        description="Manage your service catalog, packages, add-ons, and pricing."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Product</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search products by name, description…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      {crud.loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} className="h-52" />)}
        </div>
      ) : crud.items.length === 0 ? (
        <EmptyState icon={Package} title="No products found" description="Try adjusting your search or filters, or add a new product to your catalog." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {crud.items.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{p.category}</Badge>
                    <Badge tone={TYPE_TONES[p.type] || 'neutral'}>{p.type}</Badge>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton icon={Pencil} size="sm" onClick={() => setEditTarget(p)} />
                    <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(p)} />
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{p.name}</h3>
                <p className="mt-2.5 line-clamp-2 flex-1 text-sm text-ink-500 dark:text-ink-400">{p.description}</p>
                <div className="mt-4 flex items-end justify-between border-t border-ink-100 pt-3.5 dark:border-ink-800">
                  <div>
                    <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{formatCurrency(p.price)}</p>
                    <p className="text-xs text-ink-400">{p.billingCycle}</p>
                  </div>
                  <button
                    onClick={() => toggleStatus(p)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${p.status === 'Active' ? 'bg-emerald-500' : 'bg-ink-200 dark:bg-ink-700'}`}
                    title={p.status === 'Active' ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${p.status === 'Active' ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900">
            <Pagination page={crud.page} totalPages={crud.totalPages} onChange={crud.setPage} total={crud.total} pageSize={PAGE_SIZE} />
          </div>
        </>
      )}

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Product / Service"
        description="Add a new item to your catalog."
        submitLabel="Create Product"
        loading={saving}
        onSubmit={createProduct}
        defaultValues={{ category: CATEGORIES[0], type: TYPES[0], billingCycle: BILLING_CYCLES[0], status: 'Active' }}
        fields={FIELDS}
      />

      <FormModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Product / Service"
        description={editTarget ? `Update details for ${editTarget.name}.` : ''}
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        defaultValues={editTarget || {}}
        fields={FIELDS}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this product?"
        description={`"${deleteTarget?.name}" will be permanently removed from your catalog. This cannot be undone.`}
        confirmLabel="Delete Product"
      />
    </div>
  )
}
