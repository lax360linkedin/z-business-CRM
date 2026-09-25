import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Trash2, Wallet, CalendarCheck, Star } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { PAYMENT_METHODS } from '../../data/constants'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadCsv } from '../../utils/csv'

export default function Payments() {
  const crud = useCrud('payments', { searchFields: ['invoiceNumber', 'customerName', 'reference'], pageSize: 10 })
  const navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  const stats = useMemo(() => {
    const list = crud.allItems
    const totalReceived = list.reduce((s, p) => s + (p.amount || 0), 0)
    const now = new Date()
    const thisMonth = list.filter((p) => {
      const d = new Date(p.date)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
    const counts = {}
    list.forEach((p) => { counts[p.method] = (counts[p.method] || 0) + 1 })
    const mostUsedMethod = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
    return { totalReceived, thisMonth, mostUsedMethod }
  }, [crud.allItems])

  const statusOptions = useMemo(() => {
    const unique = [...new Set(crud.allItems.map((p) => p.status).filter(Boolean))]
    return unique.map((s) => ({ value: s, label: s }))
  }, [crud.allItems])

  const filterDefs = [
    { key: 'method', label: 'Methods', options: PAYMENT_METHODS.map((m) => ({ value: m, label: m })) },
    { key: 'status', label: 'Statuses', options: statusOptions },
  ]

  const columns = [
    { key: 'id', header: 'Payment ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'invoiceNumber', header: 'Invoice Number', sortable: true,
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/invoices/${row.invoiceId}`) }}
          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {row.invoiceNumber}
        </button>
      ),
    },
    { key: 'customerName', header: 'Client', sortable: true },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'method', header: 'Payment Method' },
    { key: 'date', header: 'Date', sortable: true, render: (row) => formatDate(row.date) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'reference', header: 'Reference', className: 'text-xs text-ink-500' },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Payment "${deleteTarget.id}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const handleExport = () => {
    downloadCsv('payments.csv', crud.allFiltered, [
      { label: 'Payment ID', value: 'id' }, { label: 'Invoice Number', value: 'invoiceNumber' },
      { label: 'Client', value: 'customerName' }, { label: 'Amount', value: 'amount' },
      { label: 'Method', value: 'method' }, { label: 'Date', value: 'date' },
      { label: 'Status', value: 'status' }, { label: 'Reference', value: 'reference' },
    ])
    toast(`Exported ${crud.allFiltered.length} payments.`, { type: 'success' })
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Track every payment received against your invoices."
        actions={<Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Received" value={formatCurrency(stats.totalReceived)} icon={Wallet} tone="emerald" />
        <StatCard label="Payments This Month" value={stats.thisMonth} icon={CalendarCheck} tone="brand" />
        <StatCard label="Most Used Method" value={stats.mostUsedMethod} icon={Star} tone="amber" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by invoice, client, or reference…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
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
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No payments found"
        emptyDescription="Try adjusting your search or filters. Payments are recorded from an invoice's detail page."
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this payment record?"
        description={`Payment "${deleteTarget?.id}" for ${deleteTarget?.invoiceNumber} will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Payment"
      />
    </div>
  )
}
