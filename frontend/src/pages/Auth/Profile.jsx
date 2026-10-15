import { useForm } from 'react-hook-form'
import { useCallback, useEffect, useState } from 'react'
import { Mail, Phone, Building2, BadgeCheck, Monitor, LogOut, ShieldOff, Info } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { FormField, Input } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Avatar } from '../../components/common/Avatar'
import { Badge } from '../../components/common/Badge'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate, timeAgo } from '../../utils/format'
import { api, errorMessage } from '../../api/http'

// Active Sessions: the real sign-ins of this account (GET /auth/sessions). Ending one revokes it on the server at once - that device's next request is refused.
function ActiveSessionsPanel() {
  const { logout, forceLogoutAccount, user } = useAuth()
  const { toast } = useToast()
  const [sessions, setSessions] = useState([])
  const load = useCallback(() => api.get('/auth/sessions').then((res) => setSessions(res.data)).catch(() => setSessions([])), [])
  useEffect(() => { load() }, [load])
  const live = sessions.filter((s) => s.active)
  const others = live.filter((s) => !s.current)
  const current = live.find((s) => s.current)
  const browser = (ua) => (String(ua || '').match(/Edg|Chrome|Firefox|Safari/)?.[0] || 'Browser').replace('Edg', 'Edge')

  const logoutOther = (id) => api.delete(`/auth/sessions/${id}`).then(() => { toast('Session signed out.', { type: 'success' }); load() }).catch((e) => toast(errorMessage(e), { type: 'error' }))
  const logoutAll = () => forceLogoutAccount(user.accountId).then(() => { toast('Signed out of all devices.', { type: 'success' }); logout('revoked') }).catch((e) => toast(e.message, { type: 'error' }))

  return (
    <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Active Sessions</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Devices currently signed in to your account.</p>
        </div>
        {others.length > 0 && <Button variant="secondary" icon={ShieldOff} onClick={logoutAll}>Logout All Devices</Button>}
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-center gap-3">
            <Monitor size={18} className="text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">This device <Badge tone="success">Current</Badge></p>
              <p className="text-xs text-ink-400">{browser(navigator.userAgent)}{current?.ip ? ` · ${current.ip}` : ''} · Active now</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => logout()}>Logout</Button>
        </div>

        {others.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-3">
              <Monitor size={18} className="text-ink-400" />
              <div>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{browser(s.userAgent)}</p>
                <p className="text-xs text-ink-400">{s.ip || 'Unknown address'} · Last active {timeAgo(s.lastUsedAt)}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" icon={LogOut} onClick={() => logoutOther(s.id)}>Logout</Button>
          </div>
        ))}
        {!others.length && <p className="px-1 text-sm text-ink-400">You are not signed in anywhere else.</p>}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-2.5 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>Ending a session takes effect immediately: the device is signed out the next time it contacts the server.</span>
      </div>
    </div>
  )
}

export default function Profile() {
  const { user, refreshUser } = useAuth()
  const { toast } = useToast()
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ defaultValues: { name: user?.name, email: user?.email, phone: user?.phone } })
  const [loading, setLoading] = useState(false)
  // the job-profile role the Super Admin configured on the account (shown only when it says more than the access level)
  const jobRole = user?.role && user.role !== user?.accessLevel ? user.role : ''

  const onSubmit = (data) => {
    setLoading(true)
    api.put('/auth/me', { name: data.name, phone: data.phone })
      .then((res) => { refreshUser(res.data); toast('Profile updated successfully.', { type: 'success' }) })
      .catch((e) => {
        const fields = e?.response?.data?.fields || {}
        Object.entries(fields).forEach(([k, m]) => setError(k, { type: 'server', message: m }))
        toast(errorMessage(e), { type: 'error' })
      })
      .finally(() => setLoading(false))
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My Profile" description="Manage your personal information and account details." />
      <div className="mb-6 flex flex-col items-center gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card sm:flex-row dark:border-ink-800 dark:bg-ink-900">
        <Avatar name={user?.name} size="lg" />
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{user?.name}</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">{user?.designation || jobRole || user?.accessLevel}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Badge tone="info">{user?.accessLevel}</Badge>
            {jobRole && <Badge tone="info">{jobRole}</Badge>}
            {user?.department && <Badge tone="neutral">{user.department}</Badge>}
            <Badge tone="neutral">{user?.allBranches ? 'All branches' : user?.branch ? `${user.branch} branch` : 'No branch assigned'}</Badge>
          </div>
        </div>
        <div className="text-center text-xs text-ink-400 sm:text-right">
          <p className="flex items-center gap-1.5"><BadgeCheck size={13} /> Member since {formatDate(user?.joinDate)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" required error={errors.name?.message}>
            <Input {...register('name')} />
          </FormField>
          <FormField label="Email address" hint="Your sign-in address is set by the Super Admin.">
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input className="pl-9" disabled readOnly {...register('email')} />
            </div>
          </FormField>
          <FormField label="Phone number" error={errors.phone?.message}>
            <div className="relative">
              <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input className="pl-9" {...register('phone')} />
            </div>
          </FormField>
          <FormField label="Department">
            <div className="relative">
              <Building2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input className="pl-9" defaultValue={user?.department} disabled />
            </div>
          </FormField>
          <FormField label="Designation">
            <Input value={user?.designation || '—'} disabled readOnly />
          </FormField>
          <FormField label="Role" hint="Set by the Super Admin in User Management.">
            <Input value={[user?.accessLevel, jobRole].filter(Boolean).join(' · ')} disabled readOnly />
          </FormField>
          <FormField label="Branch">
            <Input value={user?.allBranches ? 'All branches' : user?.branch || 'Not assigned'} disabled readOnly />
          </FormField>
        </div>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={loading}>Save Changes</Button>
        </div>
      </form>

      <ActiveSessionsPanel />
    </div>
  )
}
