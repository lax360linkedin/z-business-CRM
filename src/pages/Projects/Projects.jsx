import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, FolderKanban, Activity, CheckCircle2, AlertTriangle, IndianRupee } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { PROJECT_STATUSES } from '../../data/constants'
import { CUSTOMERS, getCustomerById } from '../../data/customers'
import { projectManagers, getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

export default function Projects() {
  const crud = useCrud('projects', { searchFields: ['name', 'customerName'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()
  const navigate = useNavigate()
  const pms = projectManagers()

  const stats = useMemo(() => {
    const list = crud.allItems
    return [
      { label: 'Total Projects', value: list.length, icon: FolderKanban, tone: 'brand' },
      { label: 'Active Projects', value: list.filter((p) => p.status === 'In Progress').length, icon: Activity, tone: 'sky' },
      { label: 'Completed Projects', value: list.filter((p) => p.status === 'Completed').length, icon: CheckCircle2, tone: 'emerald' },
      { label: 'Delayed Projects', value: list.filter((p) => p.status === 'Delayed').length, icon: AlertTriangle, tone: 'rose' },
      { label: 'Total Project Value', value: formatCurrency(list.reduce((s, p) => s + (p.budget || 0), 0), { compact: true }), icon: IndianRupee, tone: 'violet' },
    ]
  }, [crud.allItems])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: PROJECT_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'manager', label: 'Managers', options: pms.map((m) => ({ value: m.id, label: m.name })) },
  ]

  const columns = [
    {
      key: 'name', header: 'Project', sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
          <p className="text-xs text-ink-400">{row.id}</p>
        </div>
      ),
    },
    { key: 'customerName', header: 'Client', sortable: true },
    { key: 'manager', header: 'Manager', render: (row) => getUserById(row.manager)?.name.split(' ')[0] || '—' },
    {
      key: 'team', header: 'Team',
      render: (row) => {
        const members = row.team || []
        return (
          <div className="flex items-center -space-x-2">
            {members.slice(0, 3).map((uid) => {
              const u = getUserById(uid)
              return u ? <Avatar key={uid} name={u.name} size="xs" ringed /> : null
            })}
            {members.length > 3 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-[10px] font-semibold text-ink-600 ring-2 ring-white dark:bg-ink-700 dark:text-ink-300 dark:ring-ink-900">
                +{members.length - 3}
              </span>
            )}
            {members.length === 0 && <span className="text-xs text-ink-400">—</span>}
          </div>
        )
      },
    },
    { key: 'startDate', header: 'Start Date', sortable: true, render: (row) => formatDate(row.startDate) },
    { key: 'deadline', header: 'Deadline', sortable: true, render: (row) => formatDate(row.deadline) },
    {
      key: 'progress', header: 'Progress', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-ink-100 dark:bg-ink-800">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${row.progress}%` }} />
          </div>
          <span className="text-xs text-ink-500 dark:text-ink-400">{row.progress}%</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createProject = (data) => {
    setSaving(true)
    const customer = getCustomerById(data.customerId)
    crud.create({
      id: genId('PRJ'),
      name: data.name,
      customerId: data.customerId,
      customerName: customer?.name || '',
      manager: data.manager,
      team: [data.manager],
      startDate: data.startDate,
      deadline: data.deadline,
      budget: Number(data.budget) || 0,
      progress: 0,
      status: data.status,
      milestones: [],
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Project created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Project "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Track delivery, milestones, and team progress across every active engagement."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Project</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search projects by name, client…" className="w-full max-w-xs" />
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
        onRowClick={(row) => navigate(`/projects/${row.id}`)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No projects found"
        emptyDescription="Try adjusting your search or filters, or create a new project."
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Project"
        description="Kick off a new project engagement for a client."
        submitLabel="Create Project"
        loading={saving}
        onSubmit={createProject}
        defaultValues={{ status: 'Not Started', customerId: CUSTOMERS[0]?.id, manager: pms[0]?.id }}
        fields={[
          { name: 'name', label: 'Project name', required: true, span: 2 },
          { name: 'customerId', label: 'Client', type: 'select', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'manager', label: 'Project Manager', type: 'select', options: pms.map((m) => ({ value: m.id, label: m.name })), required: true, span: 1 },
          { name: 'startDate', label: 'Start Date', type: 'date', required: true, span: 1 },
          { name: 'deadline', label: 'Deadline', type: 'date', required: true, span: 1 },
          { name: 'budget', label: 'Budget (₹)', type: 'number', required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this project?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Project"
      />
    </div>
  )
}
