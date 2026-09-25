import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Eye } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { SERVICES, PROPOSAL_STATUSES } from '../../data/constants'
import { salesUsers, getUserById } from '../../data/users'
import { CUSTOMERS, getCustomerById } from '../../data/customers'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

export default function Proposals() {
  const crud = useCrud('proposals', { searchFields: ['title', 'customerName', 'service'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  const reps = salesUsers()

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: PROPOSAL_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'assignedTo', label: 'Staff', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'service', label: 'Services', options: SERVICES.map((s) => ({ value: s, label: s })) },
  ]

  const columns = [
    { key: 'title', header: 'Title', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'service', header: 'Service' },
    { key: 'value', header: 'Value', sortable: true, render: (row) => formatCurrency(row.value) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'assignedTo', header: 'Assigned To', render: (row) => getUserById(row.assignedTo)?.name.split(' ')[0] || '—' },
    { key: 'createdDate', header: 'Created Date', sortable: true, render: (row) => formatDate(row.createdDate) },
    { key: 'validUntil', header: 'Valid Until', sortable: true, render: (row) => formatDate(row.validUntil) },
    {
      key: 'actions', header: '', headerClassName: 'w-16',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/proposals/${row.id}`)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createProposal = (data) => {
    setSaving(true)
    const customer = getCustomerById(data.customerId)
    crud.create({
      id: genId('PRP'),
      title: data.title,
      customerId: data.customerId,
      customerName: customer?.name || '',
      service: data.service,
      value: Number(data.value) || 0,
      sections: [
        { heading: 'Executive Summary', body: `This proposal outlines our recommended approach to deliver ${data.service.toLowerCase()} for ${customer?.name || 'the client'}, aligned with your growth objectives and timeline.` },
        { heading: 'Scope of Work', body: `Discovery, design, implementation, testing and go-live support for ${data.service.toLowerCase()}, delivered by a dedicated project team.` },
        { heading: 'Timeline', body: 'Estimated delivery within 6-8 weeks from kickoff, in milestone-based phases.' },
        { heading: 'Investment', body: 'Detailed pricing is available in the attached commercial quotation.' },
      ],
      assignedTo: data.assignedTo,
      createdDate: new Date().toISOString().slice(0, 10),
      validUntil: data.validUntil,
      status: 'Draft',
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Proposal created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Proposal "${deleteTarget.title}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Build and send polished proposals to prospective clients."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>New Proposal</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by title, customer, service…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/proposals/${row.id}`)}
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
        emptyTitle="No proposals found"
        emptyDescription="Try adjusting your search or filters, or create a new proposal to get started."
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Proposal"
        description="Create a client-ready proposal document."
        submitLabel="Create Proposal"
        loading={saving}
        onSubmit={createProposal}
        defaultValues={{ customerId: CUSTOMERS[0]?.id, service: SERVICES[0], assignedTo: reps[0]?.id, validUntil: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) }}
        fields={[
          { name: 'title', label: 'Proposal title', required: true, span: 2 },
          { name: 'customerId', label: 'Customer', type: 'select', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'service', label: 'Service', type: 'select', options: SERVICES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'value', label: 'Proposal value (₹)', type: 'number', required: true, span: 1 },
          { name: 'validUntil', label: 'Valid until', type: 'date', required: true, span: 1 },
          { name: 'assignedTo', label: 'Assigned to', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 2 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this proposal?"
        description={`"${deleteTarget?.title}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Proposal"
      />
    </div>
  )
}
