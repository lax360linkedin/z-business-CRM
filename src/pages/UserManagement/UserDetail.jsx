import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Mail, Phone, Building2, UserCog, CalendarClock, Clock, KeyRound, Monitor,
  ShieldCheck, CheckCircle2, XCircle, Pencil, CheckCircle, History, User, Lock, Unlock,
  Copy, Eye, EyeOff, UserCircle2,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Tabs } from '../../components/common/Tabs'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { Modal } from '../../components/common/Modal'
import { FormField, Input } from '../../components/common/FormField'
import { PasswordStrengthMeter } from '../Auth/PasswordStrength'
import { EmptyState } from '../../components/common/EmptyState'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getEffectiveRoles, DEPARTMENTS } from '../../data/constants'
import { USERS, getUserById } from '../../data/users'
import { generateLoginActivity } from '../../data/userAccounts'
import { getPermissionsForRole, ACTIONS, canViewCredentials } from '../../data/permissions'
import { LEADS } from '../../data/leads'
import { DEALS } from '../../data/deals'
import { PROJECTS } from '../../data/projects'
import { formatDate, formatDateTime, timeAgo } from '../../utils/format'

const BASE_TABS = ['Overview', 'Permissions', 'Login Activity', 'Assigned Records', 'Tasks', 'Activities', 'Security']

function ChangePasswordModal({ open, onClose, onSubmit, loading }) {
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm()
  const next = watch('next')
  useEffect(() => { if (open) reset() }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change Password"
      description="Set a new password for this user. They'll use it on their next sign-in."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit(onSubmit)} loading={loading}>Save Password</Button>
      </>}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label="New Password" required error={errors.next?.message}>
          <Input type="text" {...register('next', { required: 'Required', minLength: { value: 8, message: 'At least 8 characters' } })} />
          <PasswordStrengthMeter password={next} />
        </FormField>
        <FormField label="Confirm Password" required error={errors.confirm?.message}>
          <Input type="text" {...register('confirm', { required: 'Required', validate: (v) => v === watch('next') || 'Passwords do not match' })} />
        </FormField>
      </form>
    </Modal>
  )
}

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

export default function UserDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user: viewer, hasPermission, adminSetPassword, adminResetPassword } = useAuth()
  const canSeeCredentials = canViewCredentials(viewer?.role)
  const canManage = hasPermission('User Management', 'edit')
  const TABS = canSeeCredentials ? [...BASE_TABS.slice(0, 1), 'Credentials', ...BASE_TABS.slice(1)] : BASE_TABS
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'login' ? 'Login Activity' : 'Overview')
  const [editOpen, setEditOpen] = useState(searchParams.get('edit') === '1')
  const [saving, setSaving] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [changingPw, setChangingPw] = useState(false)
  const [showPassword, setShowPassword] = useState(true)

  const load = () => {
    setLoading(true)
    api.get(`/userAccounts/${id}`).then((res) => setAccount(res.data)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [id])

  const employee = account ? getUserById(account.employeeId) : null
  const loginActivity = useMemo(() => (account ? generateLoginActivity(account.id, 10) : []), [account?.id])
  const permissions = useMemo(() => (account ? getPermissionsForRole(account.role) : {}), [account?.role])

  const assignedLeads = useMemo(() => (employee ? LEADS.filter((l) => l.assignedTo === employee.id) : []), [employee])
  const assignedDeals = useMemo(() => (employee ? DEALS.filter((d) => d.salesperson === employee.id) : []), [employee])
  const managedProjects = useMemo(() => (employee ? PROJECTS.filter((p) => p.manager === employee.id) : []), [employee])

  const [tasks, setTasks] = useState([])
  const [activities, setActivities] = useState([])
  useEffect(() => {
    if (!employee) return
    api.get('/tasks', { params: { all: true } }).then((res) => setTasks(res.data.filter((t) => t.assignedTo === employee.id)))
    api.get('/activities', { params: { all: true } }).then((res) => setActivities(res.data.filter((a) => a.by === employee.id)))
  }, [employee?.id])

  const updateStatus = (status, message, extraPatch = {}) => {
    api.put(`/userAccounts/${id}`, { status, ...extraPatch }).then((res) => {
      setAccount(res.data)
      toast(message, { type: 'success' })
    })
  }

  // Manual admin lock is indefinite (no `lockedUntil` timer) — distinct from the automatic
  // 15-minute brute-force lock in AuthContext, which does carry a timer and auto-expires.
  const lockUser = () => updateStatus('Locked', `${account.name} locked.`, { lockedUntil: null })
  const unlockUser = () => updateStatus('Active', `${account.name} unlocked.`, { failedAttempts: 0, lockedUntil: null })

  const submitChangePassword = (data) => {
    setChangingPw(true)
    try {
      adminSetPassword(account.id, data.next)
      load()
      setChangingPw(false)
      setChangePwOpen(false)
      toast(`Password updated for ${account.name}.`, { type: 'success' })
    } catch (err) {
      setChangingPw(false)
      toast(err.message, { type: 'error' })
    }
  }

  const handleResetPassword = () => {
    const tempPassword = adminResetPassword(account.id)
    load()
    toast(`New temporary password for ${account.name}: ${tempPassword}`, { type: 'success' })
  }

  const copyPassword = () => {
    navigator.clipboard?.writeText(account.password || '')
    toast('Password copied to clipboard.', { type: 'success' })
  }

  const saveEdit = (data) => {
    setSaving(true)
    api.put(`/userAccounts/${id}`, data).then((res) => {
      setAccount(res.data)
      setSaving(false)
      setEditOpen(false)
      toast('User account updated.', { type: 'success' })
    })
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  if (!account) {
    return <EmptyState title="User not found" description="This user account may have been removed." action={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/user-management')}>Back to User Management</Button>} />
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'User Management', href: '/user-management' }, { label: account.name }]} />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-4">
          <Avatar name={account.name} size="lg" />
          <div>
            <h1 className="text-lg font-bold text-ink-900 dark:text-ink-50">{account.name}</h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">{account.id} · {account.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={account.status} />
              <Badge tone="info">{account.role}</Badge>
              <Badge tone="neutral">{account.department}</Badge>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit User</Button>
            {account.status === 'Active' ? (
              <Button variant="danger" icon={XCircle} onClick={() => updateStatus('Inactive', `${account.name} deactivated.`)}>Deactivate</Button>
            ) : (
              <Button icon={CheckCircle2} onClick={() => updateStatus('Active', `${account.name} activated.`)}>Activate</Button>
            )}
          </div>
        )}
      </div>

      <div className="mb-5 rounded-2xl border border-ink-100 bg-white p-1.5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === 'Overview' && (
        <div className="grid gap-4 sm:grid-cols-2 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
          <InfoRow icon={Mail} label="Email" value={account.email} />
          <InfoRow icon={Phone} label="Phone" value={account.phone} />
          <InfoRow icon={UserCog} label="Role" value={account.role} />
          <InfoRow icon={Building2} label="Department" value={account.department} />
          <InfoRow icon={Building2} label="Linked Employee" value={employee?.name || 'Not linked'} />
          <InfoRow icon={ShieldCheck} label="Status" value={account.status} />
          <InfoRow icon={CalendarClock} label="Created Date" value={formatDate(account.createdDate)} />
          <InfoRow icon={Clock} label="Last Login" value={account.lastLogin ? formatDateTime(account.lastLogin) : 'Never logged in'} />
        </div>
      )}

      {activeTab === 'Credentials' && canSeeCredentials && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow icon={UserCircle2} label="Username" value={account.username} />
              <InfoRow icon={Mail} label="Email" value={account.email} />
              <InfoRow icon={UserCog} label="Role" value={account.role} />
              <InfoRow icon={ShieldCheck} label="Account Status" value={account.status} />
              <InfoRow icon={CalendarClock} label="Last Password Changed" value={account.passwordChangedAt ? formatDateTime(account.passwordChangedAt) : 'Never'} />
              <InfoRow icon={User} label="Password Changed By" value={account.passwordChangedBy || '—'} />
            </div>

            <div className="mt-5 border-t border-ink-100 pt-5 dark:border-ink-800">
              <p className="mb-2 text-xs text-ink-400">Current Password</p>
              <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
                <Lock size={15} className="shrink-0 text-ink-400" />
                <span className="flex-1 font-mono text-sm text-ink-800 dark:text-ink-100">
                  {showPassword ? account.password : '•'.repeat(Math.max(account.password?.length || 8, 8))}
                </span>
                <button onClick={() => setShowPassword((s) => !s)} className="shrink-0 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200" title={showPassword ? 'Hide' : 'Show'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button onClick={copyPassword} className="shrink-0 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200" title="Copy">
                  <Copy size={15} />
                </button>
              </div>
            </div>

            {canManage && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-ink-100 pt-5 dark:border-ink-800">
                <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit Username</Button>
                <Button variant="secondary" icon={Mail} onClick={() => setEditOpen(true)}>Edit Email</Button>
                <Button variant="secondary" icon={KeyRound} onClick={() => setChangePwOpen(true)}>Change Password</Button>
                <Button variant="secondary" icon={KeyRound} onClick={handleResetPassword}>Reset Password</Button>
                {account.status === 'Active' ? (
                  <Button variant="secondary" icon={XCircle} onClick={() => updateStatus('Inactive', `${account.name} deactivated.`)}>Deactivate User</Button>
                ) : (
                  <Button variant="secondary" icon={CheckCircle2} onClick={() => updateStatus('Active', `${account.name} activated.`)}>Activate User</Button>
                )}
                {account.status === 'Locked' ? (
                  <Button variant="secondary" icon={Unlock} onClick={unlockUser}>Unlock User</Button>
                ) : (
                  <Button variant="secondary" icon={Lock} onClick={lockUser}>Lock User</Button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>This is a frontend-only demo — the password shown here comes from the same single credential record used to log in, kept in sync on every change. A real deployment must enforce this view behind a backend permission check and store credentials with proper cryptographic protection, never plain text in application code as done here for demo purposes.</span>
          </div>
        </div>
      )}

      {activeTab === 'Permissions' && (
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
          <div className="border-b border-ink-100 px-5 py-4 dark:border-ink-800">
            <p className="text-sm text-ink-500 dark:text-ink-400">Permissions inherited from the <span className="font-semibold text-ink-800 dark:text-ink-100">{account.role}</span> role. Manage role defaults in Roles &amp; Permissions.</p>
          </div>
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Module</th>
                  {ACTIONS.map((a) => <th key={a.key} className="w-20 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{a.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(permissions).map(([label, perm]) => (
                  <tr key={label} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="px-4 py-2 font-medium text-ink-700 dark:text-ink-200">{label}</td>
                    {ACTIONS.map((a) => (
                      <td key={a.key} className="px-4 py-2 text-center">
                        {perm?.[a.key] ? <CheckCircle size={15} className="mx-auto text-emerald-500" /> : <span className="text-ink-300 dark:text-ink-700">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Login Activity' && (
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
                {['Login Date', 'Time', 'Device', 'Browser', 'IP Address', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loginActivity.map((l) => (
                <tr key={l.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                  <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200">{formatDate(l.date)}</td>
                  <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200">{l.time}</td>
                  <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200"><span className="inline-flex items-center gap-1.5"><Monitor size={13} className="text-ink-400" />{l.device}</span></td>
                  <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200">{l.browser}</td>
                  <td className="px-4 py-2.5 text-ink-500 dark:text-ink-400">{l.ip}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Assigned Records' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Assigned Leads ({assignedLeads.length})</p>
            {assignedLeads.length === 0 ? <p className="text-sm text-ink-400">No leads assigned.</p> : (
              <div className="space-y-1.5">
                {assignedLeads.slice(0, 6).map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                    <span className="text-sm text-ink-700 dark:text-ink-200">{l.name} — {l.company}</span>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Assigned Deals ({assignedDeals.length})</p>
            {assignedDeals.length === 0 ? <p className="text-sm text-ink-400">No deals assigned.</p> : (
              <div className="space-y-1.5">
                {assignedDeals.slice(0, 6).map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                    <span className="text-sm text-ink-700 dark:text-ink-200">{d.name}</span>
                    <StatusBadge status={d.stage} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Managed Projects ({managedProjects.length})</p>
            {managedProjects.length === 0 ? <p className="text-sm text-ink-400">No projects managed.</p> : (
              <div className="space-y-1.5">
                {managedProjects.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                    <span className="text-sm text-ink-700 dark:text-ink-200">{p.name}</span>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Tasks' && (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          {tasks.length === 0 ? <EmptyState title="No tasks assigned" description="This user has no tasks assigned to them." /> : (
            <div className="space-y-1.5">
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg px-2 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{t.title}</p>
                    <p className="text-xs text-ink-400">Due {formatDate(t.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Activities' && (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          {activities.length === 0 ? <EmptyState title="No activity logged" description="This user hasn't logged any activities yet." /> : (
            <div className="space-y-1.5">
              {activities.slice(0, 15).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg px-2 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{a.subject}</p>
                    <p className="text-xs text-ink-400">{timeAgo(a.date)}</p>
                  </div>
                  <Badge tone="neutral">{a.type}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Security' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Password</p>
                <p className="text-xs text-ink-400">Issue a new temporary password and require a change on next login.</p>
              </div>
              {canManage && <Button variant="secondary" icon={KeyRound} onClick={handleResetPassword}>Reset Password</Button>}
            </div>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Force password change on next login</p>
                <p className="text-xs text-ink-400">Currently {account.forcePasswordChange ? 'enabled' : 'disabled'} for this account.</p>
              </div>
              {canManage && (
                <Button
                  variant="secondary"
                  onClick={() => api.put(`/userAccounts/${id}`, { forcePasswordChange: !account.forcePasswordChange }).then((res) => { setAccount(res.data); toast('Security setting updated.', { type: 'success' }) })}
                >
                  {account.forcePasswordChange ? 'Disable' : 'Enable'}
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100"><History size={15} /> Recent Sign-in Attempts</p>
            <div className="space-y-1.5">
              {loginActivity.slice(0, 4).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
                  <span>{formatDate(l.date)} at {l.time} · {l.device}</span>
                  <span className={l.status === 'Success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{l.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit User"
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        size="lg"
        defaultValues={{ name: account.name, username: account.username, email: account.email, phone: account.phone, role: account.role, department: account.department, status: account.status }}
        fields={[
          { name: 'name', label: 'Full Name', required: true, span: 2 },
          { name: 'username', label: 'Username', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'role', label: 'Role', type: 'select', options: getEffectiveRoles().map((r) => ({ value: r, label: r })), required: true, span: 1 },
          { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS.map((d) => ({ value: d, label: d })), required: true, span: 1 },
        ]}
      />

      {canSeeCredentials && (
        <ChangePasswordModal open={changePwOpen} onClose={() => setChangePwOpen(false)} onSubmit={submitChangePassword} loading={changingPw} />
      )}
    </div>
  )
}
