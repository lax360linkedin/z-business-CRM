import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Trash2, Eye, FileText, Wallet, TrendingUp, AlertTriangle } from 'lucide-react'
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
import { INVOICE_STATUSES } from '../../data/constants'
import { api } from '../../api/mockServer'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'
import { downloadCsv, genId } from '../../utils/csv'

export default function Invoices() {
  const crud = useCrud('invoices', { searchFields: ['number', 'customerName'], pageSize: 10 })
  const navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customers, setCustomers] = useState([])
  useEffect(() => { api.get('/customers', { params: { all: true } }).then((r) => setCustomers(r.data)) }, [])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  const stats = useMemo(() => {
    const list = crud.allItems
    const totalInvoiced = list.reduce((s, i) => s + (i.amount || 0), 0)
    const totalCollected = list.reduce((s, i) => s + (i.paidAmount || 0), 0)
    const outstanding = list
      .filter((i) => !['Paid', 'Cancelled'].includes(i.status))
      .reduce((s, i) => s + ((i.amount || 0) - (i.paidAmount || 0)), 0)
    const overdueCount = list.filter((i) => i.status === 'Overdue').length
    return { totalInvoiced, totalCollected, outstanding, overdueCount }
  }, [crud.allItems])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: INVOICE_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'customerId', label: 'Customers', options: customers.map((c) => ({ value: c.id, label: c.name })) },
  ]

  const columns = [
    {
      key: 'number', header: 'Invoice Number', sortable: true,
      render: (row) => <span className="font-medium text-ink-800 dark:text-ink-100">{row.number}</span>,
    },
    { key: 'customerName', header: 'Customer', sortable: true },
    {
      key: 'salesOrderNumber', header: 'Sales Order',
      render: (row) => (row.salesOrderId ? (
        <button onClick={(e) => { e.stopPropagation(); navigate(`/sales-orders/${row.salesOrderId}`) }} className="font-medium text-brand-600 hover:underline dark:text-brand-400">{row.salesOrderNumber || row.salesOrderId}</button>
      ) : <span className="text-ink-400">—</span>),
    },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'paidAmount', header: 'Paid', sortable: true, render: (row) => formatCurrency(row.paidAmount) },
    {
      key: 'balance', header: 'Balance',
      render: (row) => <span className="font-medium">{formatCurrency((row.amount || 0) - (row.paidAmount || 0))}</span>,
    },
    { key: 'issueDate', header: 'Issue Date', sortable: true, render: (row) => formatDate(row.issueDate) },
    {
      key: 'dueDate', header: 'Due Date', sortable: true,
      render: (row) => {
        const overdue = !['Paid', 'Cancelled'].includes(row.status) && isOverdue(row.dueDate)
        return <span className={overdue ? 'font-medium text-rose-500' : ''}>{formatDate(row.dueDate)}</span>
      },
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/invoices/${row.id}`)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Invoice "${deleteTarget.number}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const handleExport = () => {
    downloadCsv('invoices.csv', crud.allFiltered, [
      { label: 'Invoice Number', value: 'number' }, { label: 'Customer', value: 'customerName' },
      { label: 'Amount', value: 'amount' }, { label: 'Paid', value: 'paidAmount' },
      { label: 'Issue Date', value: 'issueDate' }, { label: 'Due Date', value: 'dueDate' }, { label: 'Status', value: 'status' },
    ])
    toast(`Exported ${crud.allFiltered.length} invoices.`, { type: 'success' })
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Invoices are raised from confirmed sales orders — track billing, payments and balances across every customer."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>
            <Button icon={Plus} onClick={() => navigate('/sales-orders')}>Create from Sales Order</Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Invoiced" value={formatCurrency(stats.totalInvoiced)} icon={FileText} tone="brand" />
        <StatCard label="Total Collected" value={formatCurrency(stats.totalCollected)} icon={Wallet} tone="emerald" />
        <StatCard label="Outstanding" value={formatCurrency(stats.outstanding)} icon={TrendingUp} tone="amber" />
        <StatCard label="Overdue Invoices" value={stats.overdueCount} icon={AlertTriangle} tone="rose" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search invoices by number or customer…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/invoices/${row.id}`)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No invoices found"
        emptyDescription="Try adjusting your search or filters, or create a new invoice to get started."
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this invoice?"
        description={`"${deleteTarget?.number}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Invoice"
      />
    </div>
  )
}
