import { useMemo, useState } from 'react'
import { Plus, Download, Trash2, Check, X, Wallet, Clock3, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { EXPENSE_CATEGORIES } from '../../data/constants'
import { USERS, getUserById } from '../../data/users'
import { PROJECTS } from '../../data/projects'
import { formatCurrency, formatDate } from '../../utils/format'
import { downloadCsv, genId } from '../../utils/csv'

const EXPENSE_STATUS_TONE = { Pending: 'warning', Approved: 'success', Rejected: 'danger' }

function getProjectName(projectId) {
  if (!projectId) return '—'
  return PROJECTS.find((p) => p.id === projectId)?.name || '—'
}

export default function Expenses() {
  const crud = useCrud('expenses', { searchFields: ['title', 'category'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  const stats = useMemo(() => {
    const list = crud.allItems
    const total = list.reduce((s, e) => s + (e.amount || 0), 0)
    const pending = list.filter((e) => e.status === 'Pending').length
    const now = new Date()
    const approvedThisMonth = list.filter((e) => {
      if (e.status !== 'Approved') return false
      const d = new Date(e.date)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).length
    return { total, pending, approvedThisMonth }
  }, [crud.allItems])

  const filterDefs = [
    { key: 'category', label: 'Categories', options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })) },
    { key: 'status', label: 'Statuses', options: ['Pending', 'Approved', 'Rejected'].map((s) => ({ value: s, label: s })) },
    { key: 'employee', label: 'Employees', options: USERS.map((u) => ({ value: u.id, label: u.name })) },
  ]

  const quickUpdate = (row, status) => {
    crud.update(row.id, { status }).then(() => {
      toast(`Expense "${row.title}" marked as ${status}.`, { type: 'success' })
    })
  }

  const columns = [
    { key: 'title', header: 'Expense', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'category', header: 'Category', render: (row) => <Badge tone="info">{row.category}</Badge> },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'date', header: 'Date', sortable: true, render: (row) => formatDate(row.date) },
    {
      key: 'employee', header: 'Employee',
      render: (row) => {
        const user = getUserById(row.employee)
        return user ? (
          <div className="flex items-center gap-2">
            <Avatar name={user.name} size="sm" />
            <span className="text-ink-700 dark:text-ink-200">{user.name}</span>
          </div>
        ) : '—'
      },
    },
    { key: 'projectId', header: 'Project', render: (row) => getProjectName(row.projectId) },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={EXPENSE_STATUS_TONE[row.status] || 'neutral'}>{row.status}</Badge> },
    {
      key: 'actions', header: '', headerClassName: 'w-24',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.status === 'Pending' && (
            <>
              <IconButton icon={Check} size="sm" className="hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20" onClick={() => quickUpdate(row, 'Approved')} />
              <IconButton icon={X} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => quickUpdate(row, 'Rejected')} />
            </>
          )}
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createExpense = (data) => {
    setSaving(true)
    crud.create({
      id: genId('EXP'),
      title: data.title,
      category: data.category,
      amount: Number(data.amount) || 0,
      date: data.date,
      employee: data.employee,
      projectId: null,
      status: 'Pending',
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Expense submitted for approval.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Expense "${deleteTarget.title}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const handleExport = () => {
    downloadCsv('expenses.csv', crud.allFiltered, [
      { label: 'Expense', value: 'title' }, { label: 'Category', value: 'category' },
      { label: 'Amount', value: 'amount' }, { label: 'Date', value: 'date' },
      { label: 'Employee', value: (row) => getUserById(row.employee)?.name || '' },
      { label: 'Project', value: (row) => getProjectName(row.projectId) },
      { label: 'Status', value: 'status' },
    ])
    toast(`Exported ${crud.allFiltered.length} expenses.`, { type: 'success' })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Track and approve business expenses across your team."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Expense</Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total Expenses" value={formatCurrency(stats.total)} icon={Wallet} tone="brand" />
        <StatCard label="Pending Approval" value={stats.pending} icon={Clock3} tone="amber" />
        <StatCard label="Approved This Month" value={stats.approvedThisMonth} icon={CheckCircle2} tone="emerald" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search expenses by title or category…" className="w-full max-w-xs" />
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
        emptyTitle="No expenses found"
        emptyDescription="Try adjusting your search or filters, or add a new expense to get started."
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Expense"
        description="Submit a new business expense for approval."
        submitLabel="Submit Expense"
        loading={saving}
        onSubmit={createExpense}
        defaultValues={{ category: EXPENSE_CATEGORIES[0], employee: USERS[0]?.id, date: today }}
        fields={[
          { name: 'title', label: 'Expense title', required: true, span: 2 },
          { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })), required: true, span: 1 },
          { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, span: 1 },
          { name: 'employee', label: 'Employee', type: 'select', options: USERS.map((u) => ({ value: u.id, label: u.name })), required: true, span: 1 },
          { name: 'date', label: 'Date', type: 'date', required: true, span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this expense?"
        description={`"${deleteTarget?.title}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Expense"
      />
    </div>
  )
}
