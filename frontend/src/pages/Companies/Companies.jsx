import { useOptions, asChoices } from '../../hooks/useOptions'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, ExternalLink } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { filterText } from '../../utils/exporter'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { CLOSED_DEAL_STAGES } from '../../data/constants'
import { dealsByCompany } from '../../data/deals'
import { getCustomerByCompanyId } from '../../data/customers'
import { projectsByCustomer } from '../../utils/projectLookup'
import { formatCurrency } from '../../utils/format'
import { useCollections } from '../../api/store'

const COMPANY_STATUSES = ['Active', 'Inactive', 'Prospect']

export default function Companies() {
  const industries = useOptions('industries')
  const cities = useOptions('cities')
  useCollections('deals', 'customers', 'projects')
  const crud = useCrud('companies', { searchFields: ['name', 'industry', 'contactPerson', 'email'], pageSize: 10 })
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
    { key: 'industry', label: 'Industries', options: asChoices(industries.all) },
    { key: 'status', label: 'Statuses', options: COMPANY_STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  // Export: every company that matches the search and filters on screen
  const exportColumns = [
    { label: 'Company ID', value: 'id' }, { label: 'Company', value: 'name' }, { label: 'Industry', value: 'industry' }, { label: 'Contact person', value: 'contactPerson' }, { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' }, { label: 'Website', value: 'website' }, { label: 'City', value: 'city' }, { label: 'GSTIN', value: 'gstin' },
    { label: 'Revenue', value: (c) => Number(c.revenue) || 0, align: 'right' }, { label: 'Status', value: 'status' }, { label: 'Branch', value: 'branch' }, { label: 'Created', value: 'createdDate' },
  ]
  const exportFilters = filterText({ search: crud.search, values: crud.filters, defs: filterDefs })

  const columns = [
    {
      key: 'name', width: 240, header: 'Company', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.city}</p>
          </div>
        </div>
      ),
    },
    { key: 'industry', width: 160, header: 'Industry', sortable: true },
    { key: 'contactPerson', width: 180, header: 'Contact Person' },
    { key: 'email', width: 240, header: 'Email' },
    { key: 'phone', width: 150, header: 'Phone' },
    {
      key: 'website', width: 200, header: 'Website',
      render: (row) => (
        <a href={`https://${row.website}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400">
          {row.website} <ExternalLink size={11} />
        </a>
      ),
    },
    { key: 'activeDeals', width: 130, header: 'Active Deals', render: (row) => dealsByCompany(row.id).filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage)).length },
    { key: 'projectsCount', width: 120, header: 'Projects', render: (row) => { const cust = getCustomerByCompanyId(row.id); return cust ? projectsByCustomer(cust.id).length : 0 } },
    { key: 'revenue', width: 130, header: 'Revenue', sortable: true, render: (row) => formatCurrency(row.revenue, { compact: true }) },
    { key: 'status', width: 130, header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createCompany = (data) => {
    setSaving(true)
    crud.create({
      ...data,
      revenue: Number(data.revenue) || 0,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Company created successfully.', { type: 'success' })
    }).catch(() => setSaving(false))
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Company "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Manage company and account records across your business."
        actions={<><ExportMenu title="Companies" noun="company" columns={exportColumns} rows={() => crud.allFiltered} filters={exportFilters} /><Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Company</Button></>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search companies by name, industry, contact…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/companies/${row.id}`)}
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
        emptyTitle="No companies found"
        emptyDescription="Try adjusting your search or filters, or add a new company to get started."
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Company"
        description="Create a new company/account record."
        submitLabel="Create Company"
        loading={saving}
        onSubmit={createCompany}
        defaultValues={{ industry: '', city: '', status: 'Prospect' }}
        fields={[
          { name: 'name', label: 'Company name', required: true, span: 1 },
          { name: 'industry', label: 'Industry', type: 'select', options: asChoices(industries.values), blank: industries.placeholder, required: true, span: 1 },
          { name: 'contactPerson', label: 'Contact person', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'website', label: 'Website', span: 1 },
          { name: 'city', label: 'City', type: 'select', options: asChoices(cities.values), blank: cities.placeholder, required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: COMPANY_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'revenue', label: 'Annual Revenue (₹)', type: 'number', span: 1 },
          { name: 'address', label: 'Address', span: 2 },
          { name: 'tags', label: 'Tags (comma-separated)', placeholder: 'Key Account, Enterprise', span: 2 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this company?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Company"
      />
    </div>
  )
}
