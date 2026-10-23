import { useEffect, useMemo, useRef, useState } from 'react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { useRefreshHandler } from '../../api/refresh'
import { Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom'
import {
  Building2, Users, ShieldCheck, Network, Percent, Bell, Mail, MessageCircle, Zap, Lock, History, Save, KeyRound, Palette, UserRound, Fingerprint,
} from 'lucide-react'
import { FormField, Input, Textarea, Select } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Avatar } from '../../components/common/Avatar'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { DataTable } from '../../components/common/DataTable'
import { LogoSettings } from './LogoSettings'
import { useToast } from '../../context/ToastContext'
import { NOTIFICATION_TYPES } from '../../data/constants'
import { api, errorMessage } from '../../api/http'
import { useAuth } from '../../context/AuthContext'
import { USERS } from '../../data/users'
import { useRoleTemplates } from '../../hooks/useRoleTemplates'
import { formatDateTime, timeAgo } from '../../utils/format'
import ModuleSettings, { MODULES } from './ModuleSettings'
import { AutomationPanel } from './AutomationSettings'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { PersonalizationPanel } from './PersonalizationPanel'

function Panel({ title, description, actions, children }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}

function SaveBar({ onSave, busy = false }) {
  return (
    <div className="mt-6 flex justify-end border-t border-ink-100 pt-5 dark:border-ink-800">
      <Button icon={Save} onClick={onSave} loading={busy}>Save Changes</Button>
    </div>
  )
}

/** Workspace settings kept on the server (GET /settings, PUT /settings/:key). Everyone can read them; only an administrator can change them. */
function useServerSettings(key) {
  const [value, setValue] = useState(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  useEffect(() => {
    let alive = true
    api.get('/settings').then((res) => { if (alive) setValue(res.data[key]) }).catch((e) => toast(errorMessage(e), { type: 'error' }))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (message) => {
    setSaving(true)
    return api.put(`/settings/${key}`, value)
      .then((res) => { setValue(res.data); toast(message, { type: 'success' }) })
      .catch((e) => toast(errorMessage(e), { type: 'error' }))
      .finally(() => setSaving(false))
  }
  return [value, setValue, save, saving]
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-200 dark:bg-ink-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function useIsAdmin() {
  const { user } = useAuth()
  return ['Super Admin', 'Admin'].includes(user?.accessLevel)
}

function ReadOnlyNote() {
  return <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">You can see these settings, but only an administrator can change them.</p>
}

function CompanyProfilePanel() {
  const admin = useIsAdmin()
  const [form, setForm, save, saving] = useServerSettings('company')
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  if (!form) return <Panel title="Company Profile" description="Loading…"><p className="text-sm text-ink-400">Loading…</p></Panel>
  return (
    <Panel title="Company Profile" description="Basic information about your organization, shown on quotations and invoices.">
      {!admin && <ReadOnlyNote />}
      <LogoSettings />
      <fieldset disabled={!admin} className="grid gap-4 sm:grid-cols-2">
        <FormField label="Company Name"><Input value={form.name} onChange={update('name')} /></FormField>
        <FormField label="Industry"><Input value={form.industry} onChange={update('industry')} /></FormField>
        <FormField label="Phone"><Input value={form.phone} onChange={update('phone')} /></FormField>
        <FormField label="Email"><Input value={form.email} onChange={update('email')} /></FormField>
        <FormField label="Website"><Input value={form.website} onChange={update('website')} /></FormField>
        <FormField label="GST number"><Input value={form.gstNumber} onChange={update('gstNumber')} /></FormField>
        <FormField label="Address" className="sm:col-span-2"><Textarea value={form.address} onChange={update('address')} /></FormField>
      </fieldset>
      {admin && <SaveBar onSave={() => save('Company profile updated.')} busy={saving} />}
    </Panel>
  )
}

function UsersPanel() {
  const { hasPermission } = useAuth()
  return (
    <Panel title="Users" description="Manage employee accounts from the dedicated Employees module.">
      <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">Employees and their CRM logins are managed in the Employees module and in Administration → User Management, so the same people are not kept in two places.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/employees"><Button variant="secondary" icon={Users}>Go to Employees</Button></Link>
        {hasPermission('User Management', 'view') && <Link to="/administration/users"><Button variant="secondary" icon={Fingerprint}>Open User Management</Button></Link>}
      </div>
    </Panel>
  )
}

function DepartmentsPanel() {
  return (
    <Panel title="Departments" description="Departments, teams and team leaders are now managed in one place so they stay connected to employees.">
      <Link to="/employees?view=departments"><Button variant="secondary" icon={Network}>Open Employees → Departments</Button></Link>
    </Panel>
  )
}

function TaxSettingsPanel() {
  const admin = useIsAdmin()
  const [form, setForm, save, saving] = useServerSettings('tax')
  if (!form) return <Panel title="Tax Settings" description="Loading…"><p className="text-sm text-ink-400">Loading…</p></Panel>
  return (
    <Panel title="Tax Settings" description="Default tax configuration applied to new quotations and invoices.">
      {!admin && <ReadOnlyNote />}
      <fieldset disabled={!admin} className="grid gap-4 sm:grid-cols-2">
        <FormField label="GST Number"><Input value={form.gstNumber} onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value }))} /></FormField>
        <FormField label="Default Tax Rate (%)"><Input type="number" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></FormField>
      </fieldset>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
        <div>
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Prices are tax-inclusive</p>
          <p className="text-xs text-ink-400">When off, tax is added on top of the listed price.</p>
        </div>
        <Toggle checked={!!form.inclusive} onChange={(v) => admin && setForm((f) => ({ ...f, inclusive: v }))} />
      </div>
      {admin && <SaveBar onSave={() => save('Tax settings saved.')} busy={saving} />}
    </Panel>
  )
}

function NotificationSettingsPanel() {
  const admin = useIsAdmin()
  const [form, setForm, save, saving] = useServerSettings('notifications')
  if (!form) return <Panel title="Notification Settings" description="Loading…"><p className="text-sm text-ink-400">Loading…</p></Panel>
  const on = (t) => form.events?.[t] !== false
  return (
    <Panel title="Notification Settings" description="Choose which events create an in-app notification for your team.">
      {!admin && <ReadOnlyNote />}
      <p className="mb-4 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">Notifications appear in the bell inside the CRM. E-mail, SMS and push delivery are not connected to this workspace.</p>
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Event Types</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {NOTIFICATION_TYPES.map((t) => (
          <div key={t} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-2.5 dark:border-ink-800">
            <p className="text-sm text-ink-700 dark:text-ink-200">{t}</p>
            <Toggle checked={on(t)} onChange={(val) => admin && setForm((f) => ({ ...f, events: { ...f.events, [t]: val } }))} />
          </div>
        ))}
      </div>
      {admin && <SaveBar onSave={() => save('Notification preferences saved.')} busy={saving} />}
    </Panel>
  )
}

function useSystemStatus() {
  const [status, setStatus] = useState(null)
  useEffect(() => { api.get('/system/status').then((r) => setStatus(r.data)).catch(() => setStatus(false)) }, [])
  return status
}

function ConnectionPanel({ title, description, field }) {
  const status = useSystemStatus()
  const info = status ? status[field] : null
  return (
    <Panel title={title} description={description}>
      <div className="flex items-start gap-3 rounded-xl border border-ink-100 px-4 py-3.5 dark:border-ink-800">
        <Badge tone={info?.connected ? 'success' : 'neutral'}>{status === null ? 'Checking…' : info?.connected ? 'Connected' : 'Not connected'}</Badge>
        <p className="text-sm text-ink-600 dark:text-ink-300">{status === false ? 'Only an administrator can see the connection status.' : info?.note || ' '}</p>
      </div>
      <p className="mt-4 text-xs text-ink-400">Nothing is sent from this workspace through this channel until it is connected by your administrator on the server.</p>
    </Panel>
  )
}

/** How long the CRM may sit completely unused before it signs the person out. Counted from their last real activity (typing, clicking, scrolling), never from background refreshes. */
function IdleTimeoutSetting({ status }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const canEdit = user?.accessLevel === 'Super Admin'
  const effective = status?.security?.idleTimeoutMinutes
  const [minutes, setMinutes] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (effective) setMinutes(String(effective)) }, [effective])
  const save = (value) => {
    setSaving(true)
    api.put('/settings/security', { idleTimeoutMinutes: value })
      .then((res) => { toast(res.data.idleTimeoutMinutes ? `People are now signed out after ${res.data.idleTimeoutMinutes} minutes of inactivity.` : 'Back to the server default.', { type: 'success' }); if (!res.data.idleTimeoutMinutes) setMinutes(String(status?.security?.idleTimeoutDefault || 30)) })
      .catch((e) => toast(errorMessage(e), { type: 'error' }))
      .finally(() => setSaving(false))
  }
  return (
    <div className="mt-4 rounded-xl border border-ink-100 px-4 py-4 dark:border-ink-800">
      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Automatic sign-out after inactivity</p>
      <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">Someone who is using the CRM is never signed out. A session that is left open with no typing, clicking or scrolling ends after this many minutes, with a one-minute warning first. Applies to everyone, in every module.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="number" min={5} max={480} value={minutes} disabled={!canEdit || saving} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes of inactivity before sign-out"
          className="h-9 w-28 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50" />
        <span className="text-sm text-ink-500">minutes (5 to 480)</span>
        {canEdit && <><button type="button" disabled={saving} onClick={() => save(Number(minutes))} className="h-9 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">Save</button>
          <button type="button" disabled={saving} onClick={() => save(null)} className="h-9 rounded-lg border border-ink-200 px-3.5 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200">Use default ({status?.security?.idleTimeoutDefault ?? 30})</button></>}
      </div>
      {!canEdit && <p className="mt-2 text-xs text-ink-400">Only the Super Admin can change this.</p>}
    </div>
  )
}

function SecurityPanel() {
  const status = useSystemStatus()
  const s = status?.security
  return (
    <Panel title="Security" description="How sign-in and sessions are protected. These are enforced by the server.">
      {status === false && <p className="mb-4 text-sm text-ink-500">Only an administrator can see the security configuration.</p>}
      {s && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[['Session length', `${s.sessionDays} days at most (renewed while in use)`], ['Inactivity sign-out', `${s.idleTimeoutMinutes} minutes without activity`], ['Access token lifetime', `${s.accessTokenMinutes} minutes`], ['Account lockout', `After ${s.maxFailedLogins} failed sign-ins, for ${s.lockoutMinutes} minutes`], ['Time zone', s.orgTimezone]].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800"><p className="text-xs text-ink-400">{k}</p><p className="mt-0.5 text-sm font-medium text-ink-800 dark:text-ink-100">{v}</p></div>
          ))}
          <div className="rounded-xl border border-ink-100 px-4 py-3 sm:col-span-2 dark:border-ink-800">
            <p className="text-xs text-ink-400">Password rules</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-700 dark:text-ink-200">{s.passwordRules.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </div>
      )}
      <IdleTimeoutSetting status={status} />
      <div className="mt-4 rounded-xl border border-ink-100 px-4 py-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        Sign-in uses the e-mail address or username and the password the Super Admin issued. Passwords are stored only as one-way hashes, refresh tokens rotate on every use, and ending a session takes effect on the very next request. Only the Super Admin can create accounts and change roles, permissions and credentials.
      </div>
    </Panel>
  )
}

function useAuditFeed(params) {
  const [state, setState] = useState({ rows: [], total: 0, loading: true, error: '' })
  const reload = useRef(() => {})
  useRefreshHandler(() => reload.current())
  const key = JSON.stringify(params)
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    const load = () => api.get('/audit', { params: { ...params, pageSize: 100 }, noCache: true })
      .then((res) => { if (alive) setState({ rows: res.data.data, total: res.data.total, loading: false, error: '' }) })
      .catch((e) => { if (alive) setState({ rows: [], total: 0, loading: false, error: errorMessage(e) }) })
    reload.current = load
    load()
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

const userCell = (row) => (
  <div className="flex items-center gap-2">
    <Avatar name={row.user} size="xs" />
    <div>
      <p>{row.user || 'System'}</p>
      <p className="text-xs text-ink-400">{row.role || '—'}</p>
    </div>
  </div>
)

function LoginHistoryPanel() {
  const [filters, setFilters] = useState({ from: '', to: '', userId: '', status: '' })
  const { roles } = useRoleTemplates()
  void roles
  const params = { kind: 'login', ...(filters.from && { from: filters.from }), ...(filters.to && { to: filters.to }), ...(filters.userId && { userId: filters.userId }), ...(filters.status && { result: filters.status === 'Success' ? 'Success' : 'Denied' }) }
  const { rows, total, loading, error } = useAuditFeed(params)
  const columns = [
    { key: 'user', width: 240, header: 'User', render: userCell },
    { key: 'action', width: 280, header: 'Event', render: (row) => <span>{row.action}{row.detail ? <span className="block text-xs text-ink-400">{row.detail}</span> : null}</span> },
    { key: 'ip', width: 150, header: 'IP Address', render: (row) => row.ip || '—' },
    { key: 'success', width: 130, header: 'Status', render: (row) => <StatusBadge status={row.success ? 'Success' : 'Failed'} /> },
    { key: 'date', width: 170, header: 'Date & Time', render: (row) => <span title={formatDateTime(row.date)}>{timeAgo(row.date)}</span> },
  ]
  // Export: the sign-in attempts on screen (the latest 100 that match the dates, user and status chosen above)
  const exportColumns = [
    { label: 'User', value: (r) => r.user || 'System' }, { label: 'Role', value: 'role' }, { label: 'Event', value: 'action' }, { label: 'Detail', value: 'detail' }, { label: 'IP address', value: 'ip' },
    { label: 'Result', value: (r) => (r.success ? 'Success' : 'Failed') }, { label: 'Date & time', value: (r) => formatDateTime(r.date) },
  ]
  const exportFilters = describeFilters([['From', filters.from], ['To', filters.to], ['User', filters.userId && (USERS.find((u) => u.id === filters.userId)?.name || filters.userId)], ['Status', filters.status], ['Rows', total > rows.length ? `latest ${rows.length} of ${total}` : '']])
  return (
    <Panel title="Login History" description="Every sign-in attempt across your workspace — who, when, from where, and whether it succeeded."
      actions={<ExportMenu title="Login History" noun="sign-in" columns={exportColumns} rows={() => rows} filters={exportFilters} />}>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <FormField label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></FormField>
        <FormField label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></FormField>
        <FormField label="User">
          <Select value={filters.userId} onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}>
            <option value="">All Users</option>
            {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Status">
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value="Success">Success</option>
            <option value="Failed">Failed</option>
          </Select>
        </FormField>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} data={rows} rowKey="id" loading={loading} emptyTitle="No login history found" emptyDescription="Try adjusting your filters." />
      {total > rows.length && <p className="mt-3 text-xs text-ink-400">Showing the latest {rows.length} of {total} entries.</p>}
    </Panel>
  )
}

function AuditLogsPanel() {
  const [q, setQ] = useState('')
  const [module, setModule] = useState('')
  const { rows, total, loading, error } = useAuditFeed({ ...(q && { q }), ...(module && { module }) })
  const columns = [
    {
      key: 'action', width: 280, header: 'Action',
      render: (row) => (
        <div>
          <p className="font-medium text-ink-700 dark:text-ink-200">{row.action}</p>
          {(row.record || row.detail) && <p className="text-xs text-ink-400">{[row.record, row.detail].filter(Boolean).join(' — ')}</p>}
        </div>
      ),
    },
    { key: 'module', width: 150, header: 'Module', render: (row) => <Badge tone="neutral">{row.module || '—'}</Badge> },
    { key: 'user', width: 240, header: 'User', render: userCell },
    { key: 'success', width: 130, header: 'Result', render: (row) => <StatusBadge status={row.success ? 'Success' : row.result === 'Denied' ? 'Denied' : 'Failed'} /> },
    { key: 'date', width: 170, header: 'Timestamp', render: (row) => <span title={formatDateTime(row.date)}>{timeAgo(row.date)}</span> },
  ]
  // Export: the audit entries on screen (the latest 100 that match the search and module above)
  const exportColumns = [
    { label: 'Action', value: 'action' }, { label: 'Record', value: 'record' }, { label: 'Detail', value: 'detail' }, { label: 'Module', value: 'module' }, { label: 'User', value: (r) => r.user || 'System' },
    { label: 'Role', value: 'role' }, { label: 'Result', value: (r) => (r.success ? 'Success' : r.result === 'Denied' ? 'Denied' : 'Failed') }, { label: 'Timestamp', value: (r) => formatDateTime(r.date) },
  ]
  const exportFilters = describeFilters([['Search', q && `"${q}"`], ['Module', module], ['Rows', total > rows.length ? `latest ${rows.length} of ${total}` : '']])
  return (
    <Panel title="Audit Logs" description="A read-only, append-only record of sign-ins, refusals and changes across your workspace. Entries cannot be edited or deleted."
      actions={<ExportMenu title="Audit Logs" noun="entry" columns={exportColumns} rows={() => rows} filters={exportFilters} />}>
      <div className="mb-4 grid gap-2.5 sm:grid-cols-2">
        <FormField label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, user, record…" /></FormField>
        <FormField label="Module"><Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="e.g. Invoices" /></FormField>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      <DataTable columns={columns} data={rows} rowKey="id" loading={loading} emptyTitle="No audit entries" />
      {total > rows.length && <p className="mt-3 text-xs text-ink-400">Showing the latest {rows.length} of {total} entries.</p>}
    </Panel>
  )
}

// Settings = how the workspace is set up and how I want the CRM to look: company profile, personalization, tax, each module's choices, access security and logs, notifications, e-mail,
// WhatsApp and automation. Everything here needs the "Settings" permission except the personal part (Personalization, my profile, change password), which every signed-in person has.
// Administration (/administration) is the separate area for running the organisation: Branches, User Management, Roles & Permissions - Super Admin only.
const MODULE_ORDER = ['leads', 'enquiries', 'companies', 'deals', 'quotations', 'products', 'invoices', 'contracts', 'documents', 'tickets', 'campaigns', 'expenses', 'tasks']
const mod = (key) => ({ to: `modules/${key}`, label: MODULES[key].label, icon: MODULES[key].icon })
const GROUPS = [
  { title: 'Workspace', items: [{ to: 'company-profile', label: 'Company Profile', icon: Building2 }, { to: 'personalization', label: 'Personalization', icon: Palette, personal: true }, { to: 'tax-settings', label: 'Tax Settings', icon: Percent }] },
  { title: 'Modules', items: MODULE_ORDER.map(mod) },
  {
    title: 'People & Access',
    items: [
      { to: 'users', label: 'Users', icon: Users }, { external: '/administration/roles-permissions', label: 'Roles & Permissions', icon: ShieldCheck, module: 'Roles & Permissions' },
      { to: 'departments', label: 'Departments', icon: Network }, { to: 'security', label: 'Security', icon: Lock }, { to: 'login-history', label: 'Login History', icon: KeyRound }, { to: 'audit-logs', label: 'Audit Logs', icon: History },
    ],
  },
  { title: 'Communication & Automation', items: [{ to: 'notification-settings', label: 'Notification Settings', icon: Bell }, { to: 'email-settings', label: 'Email Settings', icon: Mail }, { to: 'whatsapp-settings', label: 'WhatsApp Settings', icon: MessageCircle }, { to: 'automation', label: 'Automation', icon: Zap }] },
  { title: 'My account', items: [{ external: '/profile', label: 'My profile', icon: UserRound, personal: true }, { external: '/change-password', label: 'Change password', icon: KeyRound, personal: true }] },
]
const linkClass = (active) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800'}`

export default function Settings() {
  const { hasPermission } = useAuth()
  const { pathname } = useLocation()
  const canConfigure = hasPermission('Settings', 'view') // the whole configuration side; without it only the personal pages are available
  const groups = useMemo(() => GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => (item.personal || canConfigure) && (!item.module || hasPermission(item.module, 'view'))),
  })).filter((g) => g.items.length), [canConfigure, hasPermission])
  const current = groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.title }))).find((item) => item.to && pathname === `/settings/${item.to}`)
  const crumbs = [{ label: 'Settings', href: '/settings' }, ...(current ? [{ label: current.group }, { label: current.label }] : [])]
  const only = (element) => (canConfigure ? element : <Navigate to="/settings/personalization" replace />)
  const first = canConfigure ? '/settings/company-profile' : '/settings/personalization'

  return (
    <div>
      <PageHeader title="Settings" breadcrumb={<Breadcrumbs items={crumbs} />}
        description="Configure your CRM workspace, defaults and integrations, and choose how the CRM looks for you. Running the organisation (branches, users, roles) is in Administration." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Settings" className="scrollbar-thin space-y-0.5 overflow-x-auto rounded-2xl border border-ink-100 bg-white p-2 dark:border-ink-800 dark:bg-ink-900 lg:sticky lg:top-20 lg:h-fit">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 first:mt-1 dark:text-ink-500">{g.title}</p>
              {g.items.map((item) => (item.external ? (
                <Link key={item.label} to={item.external} className={linkClass(false)}><item.icon size={16} /> <span className="truncate">{item.label}</span></Link>
              ) : (
                <NavLink key={item.to} to={`/settings/${item.to}`} className={({ isActive }) => linkClass(isActive)}><item.icon size={16} /> <span className="truncate">{item.label}</span></NavLink>
              )))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to={first} replace />} />
            <Route path="personalization" element={<PersonalizationPanel />} />
            <Route path="appearance" element={<Navigate to="/settings/personalization" replace />} />
            <Route path="company-profile" element={only(<CompanyProfilePanel />)} />
            <Route path="modules/:key" element={only(<ModuleSettings />)} />
            <Route path="users" element={only(<UsersPanel />)} />
            <Route path="lead-statuses" element={<Navigate to="/settings/modules/leads" replace />} />
            <Route path="deal-stages" element={<Navigate to="/settings/modules/deals" replace />} />
            <Route path="services" element={<Navigate to="/settings/modules/products" replace />} />
            <Route path="departments" element={only(<DepartmentsPanel />)} />
            <Route path="options" element={<Navigate to="/settings/modules/leads" replace />} />
            <Route path="overview" element={<Navigate to="/settings/company-profile" replace />} />
            <Route path="tax-settings" element={only(<TaxSettingsPanel />)} />
            <Route path="contracts" element={<Navigate to="/settings/modules/contracts" replace />} />
            <Route path="documents" element={<Navigate to="/settings/modules/documents" replace />} />
            <Route path="invoice-settings" element={<Navigate to="/settings/modules/invoices" replace />} />
            <Route path="notification-settings" element={only(<NotificationSettingsPanel />)} />
            <Route path="email-settings" element={only(<ConnectionPanel title="Email Settings" description="Sending quotations, invoices and alerts by e-mail." field="email" />)} />
            <Route path="whatsapp-settings" element={only(<ConnectionPanel title="WhatsApp Settings" description="Customer messaging through the WhatsApp Business API." field="whatsapp" />)} />
            <Route path="automation" element={only(<AutomationPanel />)} />
            <Route path="security" element={only(<SecurityPanel />)} />
            <Route path="login-history" element={only(<LoginHistoryPanel />)} />
            <Route path="audit-logs" element={only(<AuditLogsPanel />)} />
            <Route path="*" element={<Navigate to={first} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
