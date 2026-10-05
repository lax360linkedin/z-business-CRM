import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Eye, Plus, ClipboardList, Truck, IndianRupee, CheckCircle2, Receipt, FileText } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { Modal } from '../../components/common/Modal'
import { Input } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { SALES_ORDER_STATUSES } from '../../data/constants'
import { salesUsers, getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadCsv } from '../../utils/csv'
import { paymentStatusOf, PAYMENT_STATUS_TONES, SO_OPEN_STATUSES, fulfilmentPercent } from '../../utils/salesOrderCalc'

const PAYMENT_FILTER = ['Unbilled', 'Invoiced', 'Partially Paid', 'Paid', 'Overdue']

/** Accepted quotations that don't have an active sales order yet — the only valid starting points. */
function QuotationPicker({ open, onClose, onPick }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    setRows(null)
    Promise.all([api.get('/quotations', { params: { all: true } }), api.get('/salesOrders', { params: { all: true } })]).then(([qs, sos]) => {
      const taken = new Set(sos.data.filter((o) => o.status !== 'Cancelled').map((o) => o.quotationId))
      setRows(qs.data.filter((x) => x.status === 'Accepted' && !taken.has(x.id)))
    })
  }, [open])
  const list = (rows || []).filter((x) => `${x.number} ${x.customerName}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal open={open} onClose={onClose} title="New sales order" description="Choose the accepted quotation this order is for — all details are carried over for you to review." size="lg">
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by quotation number or client…" />
        {rows === null ? <p className="py-8 text-center text-sm text-ink-400">Loading accepted quotations…</p> : list.length === 0 ? (
          <EmptyState icon={FileText} title="No accepted quotations waiting" description="A sales order is created from an Accepted quotation that doesn't have one yet. Accept a quotation first." />
        ) : (
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            {list.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onPick(x)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-50 dark:hover:bg-ink-800/50">
                  <span><span className="block text-sm font-semibold text-ink-800 dark:text-ink-100">{x.number}</span><span className="block text-xs text-ink-400">{x.customerName}{x.dealId ? ` · ${x.dealId}` : ''}</span></span>
                  <span className="text-sm font-medium text-ink-700 dark:text-ink-200">{formatCurrency(x.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export default function SalesOrders() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [range, setRange] = useState({ from: '', to: '' })
  const [payFilter, setPayFilter] = useState('all')

  useEffect(() => {
    api.get('/invoices', { params: { all: true } }).then((r) => setInvoices(r.data))
    api.get('/customers', { params: { all: true } }).then((r) => setCustomers(r.data))
  }, [])
  const invoiceById = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices])

  const filterFn = useCallback((o) => {
    if (range.from && o.orderDate < range.from) return false
    if (range.to && o.orderDate > range.to) return false
    if (payFilter !== 'all' && paymentStatusOf(o, invoiceById[o.invoiceId]) !== payFilter) return false
    return true
  }, [range, payFilter, invoiceById])
  const crud = useCrud('salesOrders', { searchFields: ['number', 'customerName', 'quotationNumber', 'companyName', 'dealId'], pageSize: 10, filterFn })

  const stats = useMemo(() => {
    const list = crud.allItems
    const open = list.filter((o) => SO_OPEN_STATUSES.includes(o.status))
    return {
      total: list.length,
      openValue: open.reduce((s, o) => s + (o.amount || 0), 0),
      inProgress: list.filter((o) => ['Confirmed', 'Processing', 'Partially Fulfilled'].includes(o.status)).length,
      fulfilled: list.filter((o) => o.status === 'Fulfilled').length,
      toInvoice: list.filter((o) => ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled'].includes(o.status) && !(invoiceById[o.invoiceId] && invoiceById[o.invoiceId].status !== 'Cancelled')).length,
    }
  }, [crud.allItems, invoiceById])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: SALES_ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'customerId', label: 'Customers', options: customers.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'salesperson', label: 'Owners', options: salesUsers().map((u) => ({ value: u.id, label: u.name })) },
  ]
  const activeFilters = Object.values(crud.filters).filter((v) => v && v !== 'all').length + (range.from ? 1 : 0) + (range.to ? 1 : 0) + (payFilter !== 'all' ? 1 : 0)
  const clearAll = () => { crud.setFilters({}); setRange({ from: '', to: '' }); setPayFilter('all') }

  const columns = [
    { key: 'number', header: 'Sales Order #', sortable: true, render: (row) => <span className="font-medium text-ink-800 dark:text-ink-100">{row.number}{row.revision > 1 && <span className="ml-1.5 text-[10px] font-semibold text-brand-600">R{row.revision}</span>}</span> },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'quotationNumber', header: 'Quotation', render: (row) => row.quotationNumber || '—' },
    { key: 'dealId', header: 'Deal', render: (row) => row.dealId || '—' },
    { key: 'orderDate', header: 'Order date', sortable: true, render: (row) => formatDate(row.orderDate) },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => <span className="font-medium">{formatCurrency(row.amount)}</span> },
    { key: 'expectedDeliveryDate', header: 'Delivery', sortable: true, render: (row) => formatDate(row.expectedDeliveryDate) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'fulfil', header: 'Fulfilled', render: (row) => <span className="text-xs text-ink-500">{fulfilmentPercent(row.items)}%</span> },
    { key: 'payment', header: 'Billing', render: (row) => { const s = paymentStatusOf(row, invoiceById[row.invoiceId]); return <Badge tone={PAYMENT_STATUS_TONES[s]}>{s}</Badge> } },
    { key: 'salesperson', header: 'Owner', render: (row) => getUserById(row.salesperson)?.name.split(' ')[0] || '—' },
    { key: 'actions', header: '', headerClassName: 'w-10', render: (row) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><IconButton icon={Eye} size="sm" aria-label="Open" onClick={() => navigate(`/sales-orders/${row.id}`)} /></div> },
  ]

  const handleExport = () => {
    downloadCsv('sales-orders.csv', crud.allFiltered, [
      { label: 'Sales Order #', value: 'number' }, { label: 'Customer', value: 'customerName' }, { label: 'Quotation', value: 'quotationNumber' }, { label: 'Deal', value: 'dealId' },
      { label: 'Order Date', value: 'orderDate' }, { label: 'Subtotal', value: 'subtotal' }, { label: 'Tax', value: 'tax' }, { label: 'Amount', value: 'amount' },
      { label: 'Status', value: 'status' }, { label: 'Expected Delivery', value: 'expectedDeliveryDate' },
    ])
    toast(`Exported ${crud.allFiltered.length} sales orders.`, { type: 'success' })
  }

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        description="Confirmed customer orders created from accepted quotations — track fulfilment, invoicing and payment in one place."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>
            {hasPermission('Sales Orders', 'create') && <Button icon={Plus} onClick={() => setPickerOpen(true)}>New Sales Order</Button>}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total orders" value={stats.total} icon={ClipboardList} tone="brand" />
        <StatCard label="Open order value" value={formatCurrency(stats.openValue, { compact: true })} icon={IndianRupee} tone="violet" />
        <StatCard label="In progress" value={stats.inProgress} icon={Truck} tone="amber" />
        <StatCard label="Fulfilled" value={stats.fulfilled} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Awaiting invoice" value={stats.toInvoice} icon={Receipt} tone="sky" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by order, customer, quotation or deal…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={clearAll} />
          <select value={payFilter} onChange={(e) => setPayFilter(e.target.value)} aria-label="Billing status" className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200">
            <option value="all">All billing statuses</option>
            {PAYMENT_FILTER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-500">From <input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-xs dark:border-ink-700 dark:bg-ink-900" /></label>
          <label className="flex items-center gap-1.5 text-xs text-ink-500">To <input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 rounded-lg border border-ink-200 bg-white px-2 text-xs dark:border-ink-700 dark:bg-ink-900" /></label>
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
        emptyDescription="Adjust your search or filters — or start a new order from an accepted quotation."
      />

      <QuotationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(x) => { setPickerOpen(false); navigate(`/sales-orders/new?quotationId=${x.id}`) }} />
    </div>
  )
}
