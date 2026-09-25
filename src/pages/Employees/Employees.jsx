import { useState } from 'react'
import { Plus, Pencil, Trash2, Users2, UserCheck, Building2, CalendarClock, Mail, Phone, BadgeCheck, Handshake, FolderKanban, LifeBuoy } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { Drawer } from '../../components/common/Drawer'
import { StatCard } from '../../components/common/StatCard'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { DEPARTMENTS, getEffectiveRoles } from '../../data/constants'
import { DEALS } from '../../data/deals'
import { PROJECTS } from '../../data/projects'
import { TICKETS } from '../../data/tickets'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'
import { initials, avatarColor } from '../../utils/generators'

const STATUS_OPTIONS = ['Active', 'Inactive']

const DEPT_TONES = { Sales: 'success', Marketing: 'warning', Projects: 'info', Finance: 'neutral', Support: 'danger', Management: 'info', HR: 'warning' }

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
        <Icon size={15} />
      </span>
      <div>
        <p className="text-xs text-ink-400">{label}</p>
        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</p>
      </div>
    </div>
  )
}

function performanceFor(employee) {
  if (!employee) return null
  if (employee.department === 'Sales') {
    const won = DEALS.filter((d) => d.salesperson === employee.id && d.stage === 'Closed Won')
    return {
      icon: Handshake,
      label: 'Deals Won',
      value: won.length,
      sub: `${formatCurrency(won.reduce((s, d) => s + d.value, 0))} in closed revenue`,
    }
  }
  if (employee.role === 'Project Manager') {
    const active = PROJECTS.filter((p) => p.manager === employee.id && p.status === 'In Progress')
    return {
      icon: FolderKanban,
      label: 'Active Projects',
      value: active.length,
      sub: `Managing ${PROJECTS.filter((p) => p.manager === employee.id).length} project(s) in total`,
    }
  }
  if (employee.department === 'Support') {
    const resolved = TICKETS.filter((t) => t.assignedStaff === employee.id && t.status === 'Resolved')
    return {
      icon: LifeBuoy,
      label: 'Tickets Resolved',
      value: resolved.length,
      sub: `${TICKETS.filter((t) => t.assignedStaff === employee.id).length} ticket(s) handled overall`,
    }
  }
  return null
}

function EmployeeDrawer({ employee, open, onClose, onEdit, onDelete }) {
  if (!employee) return null
  const perf = performanceFor(employee)
  return (
    <Drawer open={open} onClose={onClose} title={employee.name} subtitle={`${employee.id} · ${employee.designation}`} size="md">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={employee.name} size="lg" />
          <div>
            <p className="text-base font-bold text-ink-900 dark:text-ink-50">{employee.name}</p>
            <p className="text-sm text-ink-500 dark:text-ink-400">{employee.designation}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <StatusBadge status={employee.status} />
              <Badge tone={DEPT_TONES[employee.department] || 'neutral'}>{employee.department}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-ink-100 p-4 sm:grid-cols-2 dark:border-ink-800">
        <InfoRow icon={Mail} label="Email" value={employee.email} />
        <InfoRow icon={Phone} label="Phone" value={employee.phone} />
        <InfoRow icon={Building2} label="Department" value={employee.department} />
        <InfoRow icon={BadgeCheck} label="Role" value={employee.role} />
        <InfoRow icon={CalendarClock} label="Join Date" value={formatDate(employee.joinDate)} />
        <InfoRow icon={UserCheck} label="Status" value={employee.status} />
      </div>

      {perf && (
        <div className="mb-6 rounded-xl bg-brand-50 p-4 dark:bg-brand-900/20">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm dark:bg-ink-900 dark:text-brand-400">
              <perf.icon size={16} />
            </span>
            <div>
              <p className="text-xs text-ink-500 dark:text-ink-400">{perf.label}</p>
              <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{perf.value}</p>
            </div>
          </div>
          {perf.sub && <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{perf.sub}</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" icon={Pencil} onClick={() => onEdit(employee)}>Edit Employee</Button>
        <Button variant="danger" icon={Trash2} onClick={() => onDelete(employee)}>Delete</Button>
      </div>
    </Drawer>
  )
}

export default function Employees() {
  const ROLES = getEffectiveRoles()
  const crud = useCrud('users', { searchFields: ['name', 'email', 'designation'], pageSize: 12 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [activeEmployee, setActiveEmployee] = useState(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const filterDefs = [
    { key: 'department', label: 'Departments', options: DEPARTMENTS.map((d) => ({ value: d, label: d })) },
    { key: 'role', label: 'Roles', options: ROLES.map((r) => ({ value: r, label: r })) },
    { key: 'status', label: 'Statuses', options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })) },
  ]

  const totalEmployees = crud.allItems.length
  const activeCount = crud.allItems.filter((u) => u.status === 'Active').length
  const departmentCount = new Set(crud.allItems.map((u) => u.department)).size
  const avgTenureYears = totalEmployees
    ? (crud.allItems.reduce((sum, u) => sum + (Date.now() - new Date(u.joinDate).getTime()) / 86400000, 0) / totalEmployees / 365).toFixed(1)
    : '0.0'

  const columns = [
    {
      key: 'name', header: 'Employee', sortable: true,
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
    { key: 'phone', header: 'Phone' },
    { key: 'department', header: 'Department', render: (row) => <Badge tone={DEPT_TONES[row.department] || 'neutral'}>{row.department}</Badge> },
    { key: 'designation', header: 'Designation', sortable: true },
    { key: 'role', header: 'Role', render: (row) => <Badge tone="info">{row.role}</Badge> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'joinDate', header: 'Join Date', sortable: true, render: (row) => formatDate(row.joinDate) },
    {
      key: 'actions', header: '', headerClassName: 'w-20',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Pencil} size="sm" onClick={() => setEditTarget(row)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createEmployee = (data) => {
    setSaving(true)
    crud.create({
      id: genId('EMP'),
      ...data,
      joinDate: new Date().toISOString().slice(0, 10),
      initials: initials(data.name),
      avatarColor: avatarColor(data.name),
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Employee added successfully.', { type: 'success' })
    })
  }

  const updateEmployee = (data) => {
    setSaving(true)
    crud.update(editTarget.id, {
      ...data,
      initials: initials(data.name),
      avatarColor: avatarColor(data.name),
    }).then((updated) => {
      setSaving(false)
      setEditTarget(null)
      toast('Employee updated.', { type: 'success' })
      setActiveEmployee((a) => (a && a.id === updated.id ? updated : a))
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`"${deleteTarget.name}" removed from the team.`, { type: 'success' })
      if (activeEmployee?.id === deleteTarget.id) setActiveEmployee(null)
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Manage your team members, roles, and departmental assignments."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Employee</Button>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Employees" value={totalEmployees} icon={Users2} tone="brand" />
        <StatCard label="Active" value={activeCount} icon={UserCheck} tone="emerald" />
        <StatCard label="Departments" value={departmentCount} icon={Building2} tone="violet" />
        <StatCard label="Avg. Tenure" value={`${avgTenureYears} yrs`} icon={CalendarClock} tone="sky" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search employees by name, email, designation…" className="w-full max-w-xs" />
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
        onRowClick={(row) => setActiveEmployee(row)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={12}
        emptyTitle="No employees found"
        emptyDescription="Try adjusting your search or filters, or add a new employee to get started."
      />

      <EmployeeDrawer
        employee={activeEmployee}
        open={!!activeEmployee}
        onClose={() => setActiveEmployee(null)}
        onEdit={(emp) => setEditTarget(emp)}
        onDelete={(emp) => setDeleteTarget(emp)}
      />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Employee"
        description="Add a new team member and assign their department and role."
        submitLabel="Add Employee"
        loading={saving}
        onSubmit={createEmployee}
        defaultValues={{ department: DEPARTMENTS[0], role: ROLES[0], status: 'Active' }}
        fields={[
          { name: 'name', label: 'Full name', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'designation', label: 'Designation', required: true, span: 1 },
          { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS.map((d) => ({ value: d, label: d })), required: true, span: 1 },
          { name: 'role', label: 'Role', type: 'select', options: ROLES.map((r) => ({ value: r, label: r })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })), required: true, span: 1 },
        ]}
      />

      <FormModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Employee"
        description={editTarget ? `Update details for ${editTarget.name}.` : ''}
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={updateEmployee}
        defaultValues={editTarget || {}}
        fields={[
          { name: 'name', label: 'Full name', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'designation', label: 'Designation', required: true, span: 1 },
          { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS.map((d) => ({ value: d, label: d })), required: true, span: 1 },
          { name: 'role', label: 'Role', type: 'select', options: ROLES.map((r) => ({ value: r, label: r })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })), required: true, span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Remove this employee?"
        description={`"${deleteTarget?.name}" will be permanently removed from your team directory. This cannot be undone.`}
        confirmLabel="Remove Employee"
      />
    </div>
  )
}
