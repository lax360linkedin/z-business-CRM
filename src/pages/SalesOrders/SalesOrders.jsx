import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Eye, ClipboardCheck, Truck, IndianRupee } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { SALES_ORDER_STATUSES, LEAD_SOURCES } from '../../data/constants'
import { CUSTOMERS } from '../../data/customers'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadCsv } from '../../utils/csv'

/**
 * Sales Orders — the stage the spec inserts between an Accepted Quotation and the Invoice
 * (Quotation → Sales Order → Invoice). Deliberately no "Add Sales Order" creation form here:
 * a Sales Order is only ever created FROM an Accepted Quotation (see the "Convert to Sales
 * Order" action on QuotationDetail.jsx) so it always carries real, non-duplicated line items,
 * pricing and customer data rather than being re-entered by hand.
 */
export default function SalesOrders() {
  const crud = useCrud('salesOrders', { searchFields: ['number', 'customerName', 'quotationNumber'], pageSize: 10 })
  const navigate = useNavigate()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { toast } = useToast()

  const stats = useMemo(() => {
    const list = crud.allItems
    const totalValue = list.reduce((s, o) => s + (o.amount || 0), 0)
    const pending = list.filter((o) => !['Invoiced', 'Cancelled'].includes(o.status)).length
    const invoiced = list.filter((o) => o.status === 'Invoiced').length
    return { totalValue, pending, invoiced }
  }, [crud.allItems])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: SALES_ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'customerId', label: 'Customers', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'source', label: 'Lead Source', options: LEAD_SOURCES.map((s) => ({ value: s, label: s })) },
  ]

  const columns = [
    { key: 'number', header: 'Sales Order #', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'quotationNumber', header: 'From Quotation', render: (row) => row.quotationNumber || '—' },
    { key: 'source', header: 'Lead Source', render: (row) => row.source || '—' },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'expectedDeliveryDate', header: 'Expected Delivery', sortable: true, render: (row) => formatDate(row.expectedDeliveryDate) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/sales-orders/${row.id}`)} />
        </div>
      ),
    },
  ]

  const handleExport = () => {
    downloadCsv('sales-orders.csv', crud.allFiltered, [
      { label: 'Sales Order #', value: 'number' }, { label: 'Customer', value: 'customerName' },
      { label: 'From Quotation', value: 'quotationNumber' }, { label: 'Lead Source', value: 'source' },
      { label: 'Amount', value: 'amount' }, { label: 'Status', value: 'status' },
      { label: 'Expected Delivery', value: 'expectedDeliveryDate' },
    ])
    toast(`Exported ${crud.allFiltered.length} sales orders.`, { type: 'success' })
  }

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        description="Confirmed orders generated from Accepted quotations, ready for fulfillment and invoicing."
        actions={<Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Order Value" value={formatCurrency(stats.totalValue, { compact: true })} icon={IndianRupee} tone="brand" />
        <StatCard label="Pending Fulfillment" value={stats.pending} icon={Truck} tone="amber" />
        <StatCard label="Invoiced" value={stats.invoiced} icon={ClipboardCheck} tone="emerald" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search sales orders by number or customer…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/sales-orders/${row.id}`)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No sales orders found"
        emptyDescription="Sales orders are created from an Accepted quotation — open a quotation and use Convert to Sales Order."
      />
    </div>
  )
}
