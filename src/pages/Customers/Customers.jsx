import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { INDUSTRIES } from '../../data/constants'
import { COMPANIES } from '../../data/companies'
import { USERS, getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

const TIERS = ['Standard', 'Premium', 'Enterprise']
const CUSTOMER_STATUSES = ['Active', 'Inactive']
const TIER_TONES = { Standard: 'neutral', Premium: 'info', Enterprise: 'success' }

export default function Customers() {
  const crud = useCrud('customers', { searchFields: ['name', 'industry', 'contactPerson', 'email'], pageSize: 10 })
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  useEffect(() => {
    if (searchParams.get('create') === '1') { setCreateOpen(true); searchParams.delete('create'); setSearchParams(searchParams, { replace: true }) }
  }, [searchParams, setSearchParams])

  const filterDefs = [
    { key: 'industry', label: 'Industries', options: INDUSTRIES.map((i) => ({ value: i, label: i })) },
    { key: 'tier', label: 'Tiers', options: TIERS.map((t) => ({ value: t, label: t })) },
    { key: 'status', label: 'Statuses', options: CUSTOMER_STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  const columns = [
    {
      key: 'name', header: 'Customer', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'industry', header: 'Industry', sortable: true },
    { key: 'contactPerson', header: 'Contact Person' },
    { key: 'accountManager', header: 'Account Manager', render: (row) => getUserById(row.accountManager)?.name.split(' ')[0] || '—' },
    { key: 'since', header: 'Customer Since', sortable: true, render: (row) => formatDate(row.since) },
    { key: 'tier', header: 'Tier', render: (row) => <Badge tone={TIER_TONES[row.tier] || 'neutral'}>{row.tier}</Badge> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'lifetimeValue', header: 'Lifetime Value', sortable: true, render: (row) => formatCurrency(row.lifetimeValue, { compact: true }) },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createCustomer = (data) => {
    setSaving(true)
    const company = COMPANIES.find((c) => c.id === data.companyId)
    crud.create({
      id: genId('CUS'),
      companyId: data.companyId,
      name: data.name,
      industry: data.industry,
      contactPerson: data.contactPerson,
      email: data.email,
      phone: data.phone,
      accountManager: data.accountManager,
      since: data.since,
      status: data.status,
      tier: data.tier,
      lifetimeValue: Number(data.lifetimeValue) || 0,
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast(`${company ? company.name : data.name} added as a customer.`, { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Customer "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Manage your active customer base and the full relationship history."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Customer</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search customers by name, industry, contact…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
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
        emptyTitle="No customers found"
        emptyDescription="Try adjusting your search or filters, or add a new customer to get started."
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Customer"
        description="Onboard a company as an active customer."
        submitLabel="Add Customer"
        loading={saving}
        onSubmit={createCustomer}
        defaultValues={{ companyId: COMPANIES[0]?.id, industry: INDUSTRIES[0], accountManager: USERS[0]?.id, tier: 'Standard', status: 'Active', since: new Date().toISOString().slice(0, 10) }}
        fields={[
          { name: 'companyId', label: 'Company', type: 'select', options: COMPANIES.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'name', label: 'Customer name', required: true, span: 1 },
          { name: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES.map((i) => ({ value: i, label: i })), required: true, span: 1 },
          { name: 'contactPerson', label: 'Contact person', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'accountManager', label: 'Account manager', type: 'select', options: USERS.map((u) => ({ value: u.id, label: u.name })), required: true, span: 1 },
          { name: 'since', label: 'Customer since', type: 'date', required: true, span: 1 },
          { name: 'tier', label: 'Tier', type: 'select', options: TIERS.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: CUSTOMER_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'lifetimeValue', label: 'Lifetime Value (₹)', type: 'number', span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this customer?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Customer"
      />
    </div>
  )
}
