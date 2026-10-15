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
import { AddUserModal, CredentialsCard } from './AddUserModal'
import { BranchBadge } from '../../components/layout/BranchSelector'
import { useBranch } from '../../context/BranchContext'
import { accessToAccount } from './AccessSetup'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { departmentNames } from '../../utils/orgLookup'
import { LOGIN_ROLES, USER_ACCOUNT_STATUSES } from '../../data/constants'
import { canViewCredentials, accessLevelOf } from '../../data/permissions'
import { USERS } from '../../data/users'
import { formatDate, timeAgo, isOverdue } from '../../utils/format'

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
  const [preset, setPreset] = useState(null) // { level, branch } when 'Add admin' was chosen from a branch
  const [extraAdmin, setExtraAdmin] = useState(null) // the account waiting for the Super Admin to confirm a 4th admin
  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, hasPermission, forceLogoutAccount, adminResetPassword } = useAuth()
  const canManage = hasPermission('User Management', 'edit')
  const isProtected = (row) => accessLevelOf(row) === 'Super Admin'
  const canSeeCredentials = canViewCredentials(user?.accessLevel)
  const [createdAccount, setCreatedAccount] = useState(null)
  const { activeNames } = useBranch()

  useEffect(() => {
    const b = searchParams.get('branch')
    if (b) { crud.setFilters((f) => ({ ...f, branch: b })); setFiltersOpen(true); searchParams.delete('branch'); setSearchParams(searchParams, { replace: true }) }
    const addAdmin = searchParams.get('addAdmin')
    if (addAdmin) { setPreset({ level: 'Admin', branch: addAdmin }); setCreateOpen(true); searchParams.delete('addAdmin'); setSearchParams(searchParams, { replace: true }) }
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
    { key: 'accessLevel', label: 'Roles', options: LOGIN_ROLES.map((r) => ({ value: r, label: r })) },
    { key: 'branch', label: 'Branches', options: activeNames.map((n) => ({ value: n, label: n })) },
    { key: 'department', label: 'Departments', options: departmentNames().map((d) => ({ value: d, label: d })) },
    { key: 'status', label: 'Statuses', options: USER_ACCOUNT_STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  const runAction = (row, action) => {
    const actions = {
      activate: { patch: { status: 'Active' }, message: `${row.name} activated.`, label: 'Activate User' },
      deactivate: { patch: { status: 'Inactive' }, message: `${row.name} deactivated.`, label: 'Deactivate User' },
      suspend: { patch: { status: 'Suspended' }, message: `${row.name} suspended.`, label: 'Suspend User' },
      // Making an account Active again also clears its failed-attempt counter and lock - the server does that and writes the audit entry.
      unlock: { patch: { status: 'Active' }, message: `${row.name} unlocked.`, label: 'Unlock User' },
    }
    const cfg = actions[action]
    crud.update(row.id, cfg.patch).then(() => {
      toast(cfg.message, { type: 'success' })
      setConfirmAction(null)
    }).catch(() => setConfirmAction(null))
  }

  const resetPassword = (row) => {
    adminResetPassword(row.id).then((tempPassword) => {
      crud.refresh()
      toast(`New temporary password for ${row.name}: ${tempPassword}`, { type: 'success' })
    }).catch((err) => toast(err.message, { type: 'error' }))
  }

  // The server revokes every session of the account; the person is signed out the next time their browser calls the API.
  const terminateSession = (row) => {
    forceLogoutAccount(row.id)
      .then(() => toast(`${row.name}'s sessions have been ended.`, { type: 'success' }))
      .catch((err) => toast(err.message, { type: 'error' }))
  }

  const createUser = (data, confirmExtraAdmin = false) => {
    setSaving(true)
    const access = accessToAccount(data.access)
    crud.create({
      // What the Super Admin entered; the server stores the password as a hash, stamps who and when, and checks the password policy.
      employeeId: data.employeeId || null,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.trim(),
      phone: data.phone,
      username: data.username.trim(),
      password: data.password,
      ...access, // accessLevel (Admin / Employee), the job profile and the exact module permissions
      department: data.department,
      branch: access.branch,
      forcePasswordChange: data.forcePasswordChange,
      ...(confirmExtraAdmin ? { confirmExtraAdmin: true } : {}),
    }).then((created) => {
      setSaving(false)
      setCreateOpen(false)
      setExtraAdmin(null)
      setCreatedAccount(created)
    }).catch((err) => {
      setSaving(false)
      if (err?.response?.data?.code === 'ADMIN_LIMIT') { setExtraAdmin({ data, message: err.response.data.message }); return } // a deliberate choice, not an error
      toast(err?.response?.data?.message || 'Could not create the account.', { type: 'error' })
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
    { key: 'accessLevel', header: 'Role', render: (row) => <span><span className="font-medium">{accessLevelOf(row)}</span>{row.role !== accessLevelOf(row) && <span className="block text-[11px] text-ink-400">{row.role}</span>}</span> },
    { key: 'branch', header: 'Branch', render: (row) => (accessLevelOf(row) === 'Super Admin' ? <span className="text-xs text-ink-400">All branches</span> : <BranchBadge branch={row.branch} />) },
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
            {canManage && !isProtected(row) && <>
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
              <DropdownItem icon={UserCog} onClick={() => navigate(`/user-management/${row.id}?tab=permissions`)}>Role & permissions</DropdownItem>
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
        description="Create logins for Admins and Employees, set their role and module permissions, and manage their credentials and access. Super Admin only."
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

      <AddUserModal open={createOpen} onClose={() => { setCreateOpen(false); setPreset(null) }} onSubmit={createUser} loading={saving} preset={preset} />
      <ConfirmDialog open={!!extraAdmin} onClose={() => setExtraAdmin(null)} onConfirm={() => createUser(extraAdmin.data, true)} title="Add another admin to this branch?" description={extraAdmin?.message} confirmLabel="Add the admin" />
      {createdAccount && <CredentialsCard account={createdAccount} onClose={() => setCreatedAccount(null)} />}

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
