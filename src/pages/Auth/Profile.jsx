import { useForm } from 'react-hook-form'
import { useEffect, useMemo, useState } from 'react'
import { Mail, Phone, Building2, BadgeCheck, Monitor, LogOut, ShieldOff, Info, Trash2, Smartphone } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { FormField, Input } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Avatar } from '../../components/common/Avatar'
import { Badge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { generateMockSessions } from '../../data/userAccounts'
import { getDeviceId } from '../../utils/deviceId'
import { getSecuritySettings } from '../../utils/securitySettings'

// Trusted Devices: the real, backend-held list behind "two-step verification on first login
// per device" — see src/utils/sessionStore.js. Each row is a server-side record, not a
// frontend flag; revoking one here forces that device back through 2FA on its next sign-in
// (and immediately ends its session too, if it's the one open right now).
function TrustedDevicesPanel() {
  const { listMyTrustedDevices, revokeMyDevice } = useAuth()
  const { toast } = useToast()
  const [devices, setDevices] = useState([])
  const [revokeTarget, setRevokeTarget] = useState(null)
  const currentDeviceId = useMemo(() => getDeviceId(), [])
  const { trustedDeviceDays } = getSecuritySettings()

  useEffect(() => { setDevices(listMyTrustedDevices()) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmRevoke = () => {
    const isCurrent = revokeTarget.deviceId === currentDeviceId
    revokeMyDevice(revokeTarget.id, isCurrent)
    setDevices((ds) => ds.filter((d) => d.id !== revokeTarget.id))
    toast(isCurrent ? 'Device revoked — you have been signed out.' : 'Device revoked. It will need two-step verification to sign in again.', { type: 'success' })
    setRevokeTarget(null)
  }

  return (
    <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Trusted Devices</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Devices that skip two-step verification for {trustedDeviceDays} days after it's confirmed once. Revoke a device to require verification again next time.</p>
      </div>

      {devices.length === 0 ? (
        <p className="mt-4 text-sm text-ink-400">No trusted devices yet — you'll see one here the first time you complete two-step verification on a device.</p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {devices.map((d) => {
            const isCurrent = d.deviceId === currentDeviceId
            const expired = Date.now() > d.trustExpiresAt
            return (
              <div key={d.id} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${isCurrent ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-900/20' : 'border-ink-100 dark:border-ink-800'}`}>
                <div className="flex items-center gap-3">
                  <Smartphone size={18} className={isCurrent ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-400'} />
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                      {d.deviceLabel || 'Unknown device'} {isCurrent && <Badge tone="success">This device</Badge>} {expired && <Badge tone="warning">Trust expired</Badge>}
                    </p>
                    <p className="text-xs text-ink-400">Verified {formatDateTime(d.createdAt)} · Last used {timeAgo(d.lastUsedAt)} · Trusted until {formatDate(d.trustExpiresAt)}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" icon={Trash2} className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setRevokeTarget(d)}>Revoke</Button>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        title="Revoke this trusted device?"
        description="This device will need to complete two-step verification again the next time it signs in."
        confirmLabel="Revoke Device"
      />
    </div>
  )
}

// Active Sessions: the current row is the one real session this frontend-only app can
// honestly track. The "other devices" rows are clearly-labeled mock data — there's no
// backend to actually observe other devices, so "Logout" on those just removes them from
// this local list rather than pretending to reach a real device.
function ActiveSessionsPanel() {
  const { user, logout, forceLogoutAccount } = useAuth()
  const { toast } = useToast()
  const [otherSessions, setOtherSessions] = useState(() => generateMockSessions(user?.accountId || 'demo', 2))

  const logoutOther = (id) => {
    setOtherSessions((s) => s.filter((x) => x.id !== id))
    toast('Session signed out.', { type: 'success' })
  }

  const logoutAll = () => {
    setOtherSessions([])
    forceLogoutAccount(user.accountId)
    toast('Signed out of all devices.', { type: 'success' })
    logout()
  }

  return (
    <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Active Sessions</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Devices currently signed in to your account.</p>
        </div>
        {otherSessions.length > 0 && <Button variant="secondary" icon={ShieldOff} onClick={logoutAll}>Logout All Devices</Button>}
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="flex items-center gap-3">
            <Monitor size={18} className="text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">This device <Badge tone="success">Current</Badge></p>
              <p className="text-xs text-ink-400">{navigator.userAgent.match(/Chrome|Firefox|Safari|Edg/)?.[0] || 'This browser'} · Active now</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => logout()}>Logout</Button>
        </div>

        {otherSessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
            <div className="flex items-center gap-3">
              <Monitor size={18} className="text-ink-400" />
              <div>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{s.device} · {s.browser}</p>
                <p className="text-xs text-ink-400">{s.ip} · Last active {timeAgo(s.lastActivity)}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" icon={LogOut} onClick={() => logoutOther(s.id)}>Logout</Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-2.5 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-800/50 dark:text-ink-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>This is a frontend-only demo — "other devices" are simulated. Terminating another user's session (e.g. by an admin) uses a real cross-tab signal within this browser; there's no backend here to reach a genuinely different device.</span>
      </div>
    </div>
  )
}

export default function Profile() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { register, handleSubmit } = useForm({ defaultValues: { name: user?.name, email: user?.email, phone: user?.phone } })
  const [loading, setLoading] = useState(false)

  const onSubmit = () => {
    setLoading(true)
    setTimeout(() => { setLoading(false); toast('Profile updated successfully.', { type: 'success' }) }, 600)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My Profile" description="Manage your personal information and account details." />
      <div className="mb-6 flex flex-col items-center gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card sm:flex-row dark:border-ink-800 dark:bg-ink-900">
        <Avatar name={user?.name} size="lg" />
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-lg font-bold text-ink-900 dark:text-ink-50">{user?.name}</h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">{user?.designation}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Badge tone="info">{user?.role}</Badge>
            <Badge tone="neutral">{user?.department}</Badge>
          </div>
        </div>
        <div className="text-center text-xs text-ink-400 sm:text-right">
          <p className="flex items-center gap-1.5"><BadgeCheck size={13} /> Member since {formatDate(user?.joinDate)}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" required>
            <Input {...register('name')} />
          </FormField>
          <FormField label="Email address" required>
            <div className="relative">
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input className="pl-9" {...register('email')} />
            </div>
          </FormField>
          <FormField label="Phone number">
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
        </div>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={loading}>Save Changes</Button>
        </div>
      </form>

      <TrustedDevicesPanel />
      <ActiveSessionsPanel />
    </div>
  )
}
