import { useMemo, useState } from 'react'
import { Plus, Trash2, Eye, AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { Drawer } from '../../components/common/Drawer'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { CONTRACT_STATUSES } from '../../data/constants'
import { CUSTOMERS, getCustomerById } from '../../data/customers'
import { PROJECTS, getProjectById } from '../../data/projects'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

function daysUntil(dateStr) {
  if (!dateStr) return Infinity
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function isRenewingSoon(contract) {
  const d = daysUntil(contract.renewalDate)
  return d >= 0 && d <= 30 && !['Expired', 'Cancelled'].includes(contract.status)
}

export default function Contracts() {
  const crud = useCrud('contracts', { searchFields: ['number', 'customerName'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeContract, setActiveContract] = useState(null)
  const [renewOpen, setRenewOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  const renewalsSoon = useMemo(() =>
    crud.allItems.filter(isRenewingSoon).sort((a, b) => daysUntil(a.renewalDate) - daysUntil(b.renewalDate)),
  [crud.allItems])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: CONTRACT_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'customerId', label: 'Clients', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })) },
  ]

  const columns = [
    { key: 'number', header: 'Contract Number', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'customerName', header: 'Client', sortable: true },
    { key: 'projectId', header: 'Project', render: (row) => getProjectById(row.projectId)?.name || '—' },
    { key: 'value', header: 'Contract Value', sortable: true, render: (row) => formatCurrency(row.value) },
    { key: 'startDate', header: 'Start Date', sortable: true, render: (row) => formatDate(row.startDate) },
    { key: 'endDate', header: 'End Date', sortable: true, render: (row) => formatDate(row.endDate) },
    {
      key: 'renewalDate', header: 'Renewal Date', sortable: true,
      render: (row) => <span className={isRenewingSoon(row) ? 'font-medium text-amber-600 dark:text-amber-400' : ''}>{formatDate(row.renewalDate)}</span>,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => setActiveContract(row)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createContract = (data) => {
    setSaving(true)
    const customer = getCustomerById(data.customerId)
    crud.create({
      id: genId('CN'),
      number: data.number,
      customerId: data.customerId,
      customerName: customer?.name || '',
      projectId: data.projectId || null,
      value: Number(data.value) || 0,
      startDate: data.startDate,
      endDate: data.endDate,
      renewalDate: data.renewalDate,
      status: data.status,
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Contract created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Contract "${deleteTarget.number}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const changeStatus = (status) => {
    crud.update(activeContract.id, { status }).then(() => {
      toast(`Contract marked ${status}.`, { type: 'success' })
      setActiveContract((c) => (c ? { ...c, status } : c))
    })
  }

  const markRenewed = (data) => {
    setSaving(true)
    crud.update(activeContract.id, {
      startDate: data.startDate,
      endDate: data.endDate,
      renewalDate: data.renewalDate,
      status: 'Active',
    }).then(() => {
      setSaving(false)
      setRenewOpen(false)
      toast('Contract renewed successfully.', { type: 'success' })
      setActiveContract((c) => (c ? { ...c, ...data, status: 'Active' } : c))
    })
  }

  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Manage client contracts, terms, and renewal schedules."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Contract</Button>}
      />

      {renewalsSoon.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
              <AlertTriangle size={17} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {renewalsSoon.length} contract{renewalsSoon.length > 1 ? 's' : ''} need renewal attention in the next 30 days
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {renewalsSoon.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveContract(c)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300 transition-colors hover:bg-amber-100 dark:bg-ink-900 dark:text-amber-300 dark:ring-amber-700 dark:hover:bg-amber-900/40"
                  >
                    {c.number} · {formatDate(c.renewalDate)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search contracts by number, client…" className="w-full max-w-xs" />
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
        onRowClick={(row) => setActiveContract(row)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No contracts found"
        emptyDescription="Try adjusting your search or filters, or add a new contract."
      />

      <Drawer open={!!activeContract} onClose={() => setActiveContract(null)} title={activeContract?.number} subtitle={activeContract?.customerName} size="md">
        {activeContract && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <StatusBadge status={activeContract.status} />
              <p className="text-xs text-ink-400">Project: {getProjectById(activeContract.projectId)?.name || '—'}</p>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              <div>
                <p className="text-xs text-ink-400">Contract Value</p>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{formatCurrency(activeContract.value)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Client</p>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{activeContract.customerName}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Start Date</p>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{formatDate(activeContract.startDate)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">End Date</p>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{formatDate(activeContract.endDate)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Renewal Date</p>
                <p className={`text-sm font-medium ${isRenewingSoon(activeContract) ? 'text-amber-600 dark:text-amber-400' : 'text-ink-800 dark:text-ink-100'}`}>{formatDate(activeContract.renewalDate)}</p>
              </div>
            </div>

            <div className="mb-6">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Change Status</p>
              <div className="flex flex-wrap gap-2">
                {CONTRACT_STATUSES.map((s) => (
                  <Button key={s} variant={activeContract.status === s ? 'subtle' : 'secondary'} size="sm" onClick={() => changeStatus(s)} disabled={activeContract.status === s}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Quick Actions</p>
              <Button variant="primary" size="sm" icon={RefreshCw} onClick={() => setRenewOpen(true)}>Mark as Renewed</Button>
            </div>
          </>
        )}
      </Drawer>

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Contract"
        description="Create a new contract record for a client."
        submitLabel="Create Contract"
        loading={saving}
        onSubmit={createContract}
        defaultValues={{ status: 'Draft', customerId: CUSTOMERS[0]?.id }}
        fields={[
          { name: 'number', label: 'Contract Number', required: true, span: 1, placeholder: 'CNT-2026-XXXX' },
          { name: 'customerId', label: 'Client', type: 'select', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'projectId', label: 'Related Project', type: 'select', options: PROJECTS.map((p) => ({ value: p.id, label: p.name })), span: 2 },
          { name: 'value', label: 'Contract Value (₹)', type: 'number', required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: CONTRACT_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'startDate', label: 'Start Date', type: 'date', required: true, span: 1 },
          { name: 'endDate', label: 'End Date', type: 'date', required: true, span: 1 },
          { name: 'renewalDate', label: 'Renewal Date', type: 'date', required: true, span: 2 },
        ]}
      />

      {activeContract && (
        <FormModal
          open={renewOpen}
          onClose={() => setRenewOpen(false)}
          title="Mark Contract as Renewed"
          description={`Update the term dates for ${activeContract.number}.`}
          submitLabel="Confirm Renewal"
          loading={saving}
          onSubmit={markRenewed}
          defaultValues={{
            startDate: new Date().toISOString().slice(0, 10),
            endDate: activeContract.endDate,
            renewalDate: activeContract.renewalDate,
          }}
          fields={[
            { name: 'startDate', label: 'New Start Date', type: 'date', required: true, span: 1 },
            { name: 'endDate', label: 'New End Date', type: 'date', required: true, span: 1 },
            { name: 'renewalDate', label: 'New Renewal Date', type: 'date', required: true, span: 2 },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this contract?"
        description={`"${deleteTarget?.number}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Contract"
      />
    </div>
  )
}
