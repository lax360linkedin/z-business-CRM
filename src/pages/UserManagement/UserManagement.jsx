import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect } from 'react'
import {
  Plus, MoreVertical, Eye, Pencil, CheckCircle2, Ban, ShieldAlert, Unlock, KeyRound,
  UserCog, Building2, History, Users, UserCheck, UserX, Clock3, Lock, LogOut,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '../../components/common/Dropdown'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { AddUserModal } from './AddUserModal'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getEffectiveRoles, DEPARTMENTS, USER_ACCOUNT_STATUSES } from '../../data/constants'
import { canViewCredentials } from '../../data/permissions'
import { USERS } from '../../data/users'
import { formatDate, timeAgo, isOverdue } from '../../utils/format'
import { genId } from '../../utils/csv'
import { logAuditEvent } from '../../utils/auditLog'

const LAST_LOGIN_OPTIONS = [
  { value: 'never', label: 'Never Logged In' },
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: 'older', label: 'Older than 30 Days' },
]

function lastLoginMatches(account, bucket) {
  if (!bucket) return true
  if (bucket === 'never') return !account.lastLogin
  if (!account.lastLogin) return false
  const days = (Date.now() - new Date(account.lastLogin).getTime()) / 86400000
  if (bucket === '7') return days <= 7
  if (bucket === '30') return days <= 30
  if (bucket === 'older') return days > 30
  return true
}

export default function UserManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [lastLoginFilter, setLastLoginFilter] = useState('')
  const crud = useCrud('userAccounts', {
    searchFields: ['name', 'email', 'phone', 'id'],
    pageSize: 10,
    filterFn: (row) => lastLoginMatches(row, lastLoginFilter),
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, hasPermission, forceLogoutAccount, adminResetPassword } = useAuth()
  const canManage = hasPermission('User Management', 'edit')
  const canSeeCredentials = canViewCredentials(user?.role)
  const ROLES = getEffectiveRoles()

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setCreateOpen(true)
      searchParams.delete('create')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams])

  const stats = useMemo(() => {
    const all = crud.allItems
    return {
      total: all.length,
      active: all.filter((u) => u.status === 'Active').length,
      inactive: all.filter((u) => u.status === 'Inactive').length,
      pending: all.filter((u) => u.status === 'Pending').length,
      locked: all.filter((u) => u.status === 'Locked').length,
    }
  }, [crud.allItems])

  const filterDefs = [
    { key: 'role', label: 'Roles', options: ROLES.map((r) => ({ value: r, label: r })) },
    { key: 'department', label: 'Departments', options: DEPARTMENTS.map((d) => ({ value: d, label: d })) },
    { key: 'status', label: 'Statuses', options: USER_ACCOUNT_STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  const runAction = (row, action) => {
    const actions = {
      activate: { patch: { status: 'Active' }, message: `${row.name} activated.`, label: 'Activate User' },
      deactivate: { patch: { status: 'Inactive' }, message: `${row.name} deactivated.`, label: 'Deactivate User' },
      suspend: { patch: { status: 'Suspended' }, message: `${row.name} suspended.`, label: 'Suspend User' },
      // Manual unlock also clears the failed-attempt counter and lock expiry — otherwise a
      // stale failedAttempts count sits at/above the lockout threshold even though status
      // is Active again, which is confusing state for the next admin who looks at the row.
      unlock: { patch: { status: 'Active', failedAttempts: 0, lockedUntil: null }, message: `${row.name} unlocked.`, label: 'Unlock User' },
    }
    const cfg = actions[action]
    crud.update(row.id, cfg.patch).then(() => {
      toast(cfg.message, { type: 'success' })
      logAuditEvent({ user, action: cfg.label, module: 'User Management', record: row.id, previousValue: row.status, newValue: cfg.patch.status })
      setConfirmAction(null)
    })
  }

  const resetPassword = (row) => {
    const tempPassword = adminResetPassword(row.id)
    crud.refresh()
    toast(`New temporary password for ${row.name}: ${tempPassword}`, { type: 'success' })
  }

  // Session termination by Admin — a genuine same-browser, cross-tab force-logout (see
  // AuthContext's `storage`-event listener). There's no backend here to reach a truly
  // different device, so this is scoped honestly to "another tab of this browser."
  const terminateSession = (row) => {
    forceLogoutAccount(row.id)
    toast(`${row.name}'s session has been terminated.`, { type: 'success' })
    logAuditEvent({ user, action: 'Session Terminated', module: 'User Management', record: row.id, detail: `Forced logout issued for ${row.name}.` })
  }

  const createUser = (data) => {
    setSaving(true)
    const employee = USERS.find((u) => u.id === data.employeeId)
    crud.create({
      id: genId('USR'),
      employeeId: data.employeeId || null,
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`,
      email: data.email,
      phone: data.phone,
      username: data.username,
      // Single authoritative credential — the temp password chosen in the Add User modal
      // IS the account's real password from creation, not a separate display-only value.
      password: data.tempPassword,
      passwordChangedAt: new Date().toISOString(),
      passwordChangedBy: user?.name || 'Administrator',
      role: data.role,
      roles: [data.role],
      department: data.department,
      status: data.status,
      forcePasswordChange: data.forcePasswordChange,
      failedAttempts: 0,
      lockedUntil: null,
      sendWelcomeEmail: data.sendWelcomeEmail,
      lastLogin: null,
      createdDate: new Date().toISOString().slice(0, 10),
      initials: `${data.firstName[0] || ''}${data.lastName[0] || ''}`.toUpperCase(),
      avatarColor: employee?.avatarColor || 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    }).then((created) => {
      setSaving(false)
      setCreateOpen(false)
      toast(data.sendWelcomeEmail ? 'User account created. A welcome email has been sent.' : 'User account created.', { type: 'success' })
      logAuditEvent({ user, action: 'Create User', module: 'User Management', record: created?.id, newValue: `${data.firstName} ${data.lastName} (${data.role})` })
    })
  }

  const columns = [
    {
      key: 'name', header: 'Profile', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'email', header: 'Email' },
    // Username + Password columns only render for the four roles the spec names as having
    // credential-view access (see canViewCredentials) — never masked, per the explicit
    // "do not replace with dots/status text" requirement, for the roles authorized to see it.
    ...(canSeeCredentials ? [
      { key: 'username', header: 'Username' },
      { key: 'password', header: 'Password', render: (row) => <span className="font-mono text-xs">{row.password}</span> },
    ] : []),
    { key: 'phone', header: 'Phone' },
    { key: 'role', header: 'Role' },
    { key: 'department', header: 'Department' },
    { key: 'employeeId', header: 'Employee', render: (row) => USERS.find((u) => u.id === row.employeeId)?.name.split(' ')[0] || '—' },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'lastLogin', header: 'Last Login', sortable: true, render: (row) => row.lastLogin ? timeAgo(row.lastLogin) : <span className="text-ink-400">Never</span> },
    { key: 'createdDate', header: 'Created', sortable: true, render: (row) => formatDate(row.createdDate) },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown
            align="right"
            width="w-56"
            trigger={<IconButton icon={MoreVertical} size="sm" />}
          >
            <DropdownItem icon={Eye} onClick={() => navigate(`/user-management/${row.id}`)}>View User</DropdownItem>
            {canManage && <>
              <DropdownItem icon={Pencil} onClick={() => navigate(`/user-management/${row.id}?edit=1`)}>Edit User</DropdownItem>
              <DropdownItem icon={History} onClick={() => navigate(`/user-management/${row.id}?tab=login`)}>View Login Activity</DropdownItem>
              <DropdownDivider />
              <DropdownLabel>Account Access</DropdownLabel>
              {row.status !== 'Active' && <DropdownItem icon={CheckCircle2} onClick={() => setConfirmAction({ row, type: 'activate' })}>Activate User</DropdownItem>}
              {row.status === 'Active' && <DropdownItem icon={Ban} onClick={() => setConfirmAction({ row, type: 'deactivate' })}>Deactivate User</DropdownItem>}
              {row.status !== 'Suspended' && <DropdownItem icon={ShieldAlert} danger onClick={() => setConfirmAction({ row, type: 'suspend' })}>Suspend User</DropdownItem>}
              {row.status === 'Locked' && <DropdownItem icon={Unlock} onClick={() => setConfirmAction({ row, type: 'unlock' })}>Unlock User</DropdownItem>}
              {row.status === 'Active' && <DropdownItem icon={LogOut} danger onClick={() => terminateSession(row)}>Terminate Session</DropdownItem>}
              <DropdownItem icon={KeyRound} onClick={() => resetPassword(row)}>Reset Password</DropdownItem>
              <DropdownDivider />
              <DropdownItem icon={UserCog} onClick={() => navigate(`/user-management/${row.id}?edit=role`)}>Change Role</DropdownItem>
              <DropdownItem icon={Building2} onClick={() => navigate(`/user-management/${row.id}?edit=department`)}>Change Department</DropdownItem>
            </>}
          </Dropdown>
        </div>
      ),
    },
  ]

  const CONFIRM_COPY = {
    activate: { title: 'Activate User?', description: `${confirmAction?.row.name} will regain access to LAX360 Business CRM.`, confirmLabel: 'Activate User', tone: 'primary' },
    deactivate: { title: 'Deactivate User?', description: `${confirmAction?.row.name} will no longer be able to access LAX360 Business CRM.`, confirmLabel: 'Deactivate User', tone: 'danger' },
    suspend: { title: 'Suspend User?', description: `${confirmAction?.row.name}'s access will be suspended pending review.`, confirmLabel: 'Suspend User', tone: 'danger' },
    unlock: { title: 'Unlock User?', description: `${confirmAction?.row.name} will be able to sign in again.`, confirmLabel: 'Unlock User', tone: 'primary' },
  }
  const confirmCopy = confirmAction ? CONFIRM_COPY[confirmAction.type] : null

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage system login accounts, access status, and security for LAX360 Business CRM."
        actions={hasPermission('User Management', 'create') && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add User</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total Users" value={stats.total} icon={Users} tone="brand" />
        <StatCard label="Active Users" value={stats.active} icon={UserCheck} tone="emerald" />
        <StatCard label="Inactive Users" value={stats.inactive} icon={UserX} tone="rose" />
        <StatCard label="Pending Users" value={stats.pending} icon={Clock3} tone="amber" />
        <StatCard label="Locked Users" value={stats.locked} icon={Lock} tone="violet" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by name, email, phone, or user ID…" className="w-full max-w-xs" />
        <FilterToggleButton
          active={filtersOpen}
          count={Object.values(crud.filters).filter((v) => v && v !== 'all').length + (lastLoginFilter ? 1 : 0)}
          onClick={() => setFiltersOpen((o) => !o)}
        />
      </div>
      {filtersOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => { crud.setFilters({}); setLastLoginFilter('') }} />
          <select
            value={lastLoginFilter}
            onChange={(e) => setLastLoginFilter(e.target.value)}
            className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
          >
            <option value="">All Last Login</option>
            {LAST_LOGIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      <DataTable
        columns={columns}
        data={crud.items}
        loading={crud.loading}
        onRowClick={(row) => navigate(`/user-management/${row.id}`)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No user accounts found"
        emptyDescription="Try adjusting your search or filters, or add a new user account."
      />

      <AddUserModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={createUser} loading={saving} />

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => runAction(confirmAction.row, confirmAction.type)}
        title={confirmCopy?.title}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        tone={confirmCopy?.tone === 'danger' ? 'danger' : 'primary'}
      />
    </div>
  )
}
