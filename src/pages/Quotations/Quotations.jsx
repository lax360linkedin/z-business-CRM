import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Eye, Plus as PlusSmall } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea, Select, DateInput } from '../../components/common/FormField'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { QUOTATION_STATUSES } from '../../data/constants'
import { salesUsers, getUserById } from '../../data/users'
import { CUSTOMERS, getCustomerById } from '../../data/customers'
import { PRODUCTS, getProductById } from '../../data/products'
import { dealsByCompany } from '../../data/deals'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

const DEFAULT_TERMS = 'Payment due within 15 days of acceptance. Prices are exclusive of applicable taxes unless noted. Quotation valid until the date specified above.'

function emptyRow() {
  return { productId: '', name: '', qty: 1, unitPrice: 0, discount: 0 }
}

function computeTotals(rows) {
  const subtotal = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0) * (1 - (Number(r.discount) || 0) / 100), 0)
  const tax = subtotal * 0.18
  return { subtotal, tax, total: subtotal + tax }
}

function QuotationBuilderModal({ open, onClose, onCreate, saving }) {
  const [customerId, setCustomerId] = useState('')
  const [dealId, setDealId] = useState('')
  const [validUntil, setValidUntil] = useState(new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10))
  const [terms, setTerms] = useState(DEFAULT_TERMS)
  const [rows, setRows] = useState([emptyRow()])
  const reps = salesUsers()
  const [assignedTo, setAssignedTo] = useState(reps[0]?.id || '')

  const resetAndClose = () => {
    setCustomerId(''); setDealId(''); setValidUntil(new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10))
    setTerms(DEFAULT_TERMS); setRows([emptyRow()]); setAssignedTo(reps[0]?.id || '')
    onClose()
  }

  const customer = customerId ? getCustomerById(customerId) : null
  const availableDeals = customer ? dealsByCompany(customer.companyId) : []
  const totals = computeTotals(rows)

  const updateRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const onProductChange = (idx, productId) => {
    const product = getProductById(productId)
    updateRow(idx, { productId, name: product?.name || '', unitPrice: product?.price || 0 })
  }
  const addRow = () => setRows((rs) => [...rs, emptyRow()])
  const removeRow = (idx) => setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs))

  const handleSubmit = () => {
    if (!customerId) return
    const validRows = rows.filter((r) => r.productId)
    if (!validRows.length) return
    onCreate({ customerId, customer, dealId: dealId || null, validUntil, terms, assignedTo, items: validRows, totals })
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Create Quotation"
      description="Build a line-item quotation for a customer."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving} disabled={!customerId || !rows.some((r) => r.productId)}>Create Quotation</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Customer" required>
            <Select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setDealId('') }}>
              <option value="">Select customer…</option>
              {CUSTOMERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Related Deal" hint={!customer ? 'Select a customer first' : undefined}>
            <Select value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={!customer}>
              <option value="">None</option>
              {availableDeals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Valid Until" required>
            <DateInput value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Assigned To" required>
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="max-w-xs">
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </FormField>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Line Items</p>
            <Button variant="secondary" size="sm" icon={PlusSmall} onClick={addRow}>Add Item</Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                  <th className="px-3 py-2.5">Product / Service</th>
                  <th className="w-20 px-3 py-2.5">Qty</th>
                  <th className="w-28 px-3 py-2.5">Unit Price</th>
                  <th className="w-24 px-3 py-2.5">Disc %</th>
                  <th className="w-28 px-3 py-2.5 text-right">Line Total</th>
                  <th className="w-10 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const lineTotal = (Number(row.qty) || 0) * (Number(row.unitPrice) || 0) * (1 - (Number(row.discount) || 0) / 100)
                  return (
                    <tr key={idx} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-3 py-2">
                        <Select value={row.productId} onChange={(e) => onProductChange(idx, e.target.value)} className="h-9 text-xs">
                          <option value="">Select product…</option>
                          {PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="1" className="h-9 text-xs" value={row.qty} onChange={(e) => updateRow(idx, { qty: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" className="h-9 text-xs" value={row.unitPrice} onChange={(e) => updateRow(idx, { unitPrice: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" max="100" className="h-9 text-xs" value={row.discount} onChange={(e) => updateRow(idx, { discount: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(lineTotal)}</td>
                      <td className="px-2 py-2 text-center">
                        <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => removeRow(idx)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 rounded-xl bg-ink-50 p-4 text-sm dark:bg-ink-800/50">
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Tax (18%)</span><span>{formatCurrency(totals.tax)}</span></div>
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
          </div>
        </div>

        <FormField label="Terms & Conditions">
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  )
}

export default function Quotations() {
  const crud = useCrud('quotations', { searchFields: ['number', 'customerName'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  const reps = salesUsers()

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: QUOTATION_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'assignedTo', label: 'Staff', options: reps.map((r) => ({ value: r.id, label: r.name })) },
  ]

  const columns = [
    { key: 'number', header: 'Quotation Number', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'dealId', header: 'Deal', render: (row) => row.dealId || '—' },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'createdDate', header: 'Created Date', sortable: true, render: (row) => formatDate(row.createdDate) },
    { key: 'validUntil', header: 'Valid Until', sortable: true, render: (row) => formatDate(row.validUntil) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'assignedTo', header: 'Assigned To', render: (row) => getUserById(row.assignedTo)?.name.split(' ')[0] || '—' },
    {
      key: 'actions', header: '', headerClassName: 'w-16',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/quotations/${row.id}`)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const handleCreate = ({ customerId, customer, dealId, validUntil, terms, assignedTo, items, totals }) => {
    setSaving(true)
    const id = genId('QT')
    crud.create({
      id,
      number: `QUO-${new Date().getFullYear()}-${id.split('-').pop()}`,
      customerId,
      customerName: customer?.name || '',
      dealId,
      items: items.map((r) => ({ productId: r.productId, name: r.name, qty: Number(r.qty) || 0, unitPrice: Number(r.unitPrice) || 0, discount: Number(r.discount) || 0 })),
      subtotal: totals.subtotal,
      tax: totals.tax,
      amount: totals.total,
      createdDate: new Date().toISOString().slice(0, 10),
      validUntil,
      status: 'Draft',
      assignedTo,
      terms,
    }).then(() => {
      setSaving(false)
      setBuilderOpen(false)
      toast('Quotation created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Quotation "${deleteTarget.number}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Create, send and track quotations for your customers."
        actions={<Button icon={Plus} onClick={() => setBuilderOpen(true)}>Create Quotation</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by quotation number or customer…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        {selected.length > 0 && <span className="text-xs text-ink-500 dark:text-ink-400">{selected.length} selected</span>}
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={crud.items}
        loading={crud.loading}
        onRowClick={(row) => navigate(`/quotations/${row.id}`)}
        selectable
        selected={selected}
        onSelectChange={setSelected}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No quotations found"
        emptyDescription="Try adjusting your search or filters, or create a new quotation to get started."
      />

      <QuotationBuilderModal open={builderOpen} onClose={() => setBuilderOpen(false)} onCreate={handleCreate} saving={saving} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this quotation?"
        description={`"${deleteTarget?.number}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Quotation"
      />
    </div>
  )
}
