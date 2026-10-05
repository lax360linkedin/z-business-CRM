import { useEffect, useMemo, useState } from 'react'
import { useProducts } from '../../hooks/useProducts'
import { Routes, Route, Navigate, NavLink, Link } from 'react-router-dom'
import {
  Building2, Users, ShieldCheck, Target, ListChecks, GitBranch, Package, Network,
  Percent, Receipt, Bell, Mail, MessageCircle, Zap, Lock, History, Plus, X, Save, KeyRound, Palette, FileText,
} from 'lucide-react'
import { FormField, Input, Textarea, Select } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Avatar } from '../../components/common/Avatar'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { DataTable } from '../../components/common/DataTable'
import { Logo } from '../../components/common/Logo'
import { useToast } from '../../context/ToastContext'
import { LEAD_STATUSES, DEAL_STAGES, DEPARTMENTS, NOTIFICATION_TYPES, getEffectiveRoles } from '../../data/constants'
import { USERS } from '../../data/users'
import { generateLoginActivity } from '../../data/userAccounts'
import { formatDateTime, timeAgo } from '../../utils/format'
import { getAuditLog } from '../../utils/auditLog'
import { getSecuritySettings, saveSecuritySettings, SESSION_TIMEOUT_PRESETS } from '../../utils/securitySettings'
import { AppearancePanel } from './AppearancePanel'

// `to` here is the bare route segment (also used as the matching nested <Route path="…">
// below). It is rendered as an ABSOLUTE NavLink target (`/settings/${item.to}`, see the nav
// list further down) — never pass it to NavLink/Navigate as a bare relative string. Relative
// resolution here is based on the CURRENT location, not this component's own base path, so
// once the user is already on any nested settings sub-route (e.g. /settings/company-profile),
// a relative "appearance" resolves to /settings/company-profile/appearance instead of
// /settings/appearance. That mismatches every <Route> below, falls through to the wildcard
// route, whose *own* relative redirect target then compounds the same way — an infinite
// self-extending redirect loop that manifests as the whole Settings page continuously
// flickering/remounting. Keep every NavLink `to` and every <Navigate> `to` in this file
// absolute (leading `/settings/…`) to prevent that regressing.
const NAV = [
  { to: 'company-profile', label: 'Company Profile', icon: Building2 },
  { to: 'appearance', label: 'Appearance', icon: Palette },
  { to: 'users', label: 'Users', icon: Users },
  { external: '/roles-permissions', label: 'Roles & Permissions', icon: ShieldCheck },
  { external: '/lead-sources', label: 'Lead Sources', icon: Target },
  { to: 'lead-statuses', label: 'Lead Statuses', icon: ListChecks },
  { to: 'deal-stages', label: 'Deal Stages', icon: GitBranch },
  { to: 'services', label: 'Services', icon: Package },
  { to: 'departments', label: 'Departments', icon: Network },
  { to: 'tax-settings', label: 'Tax Settings', icon: Percent },
  { external: '/quotation-templates', label: 'Quotation Templates', icon: FileText },
  { to: 'invoice-settings', label: 'Invoice Settings', icon: Receipt },
  { to: 'notification-settings', label: 'Notification Settings', icon: Bell },
  { to: 'email-settings', label: 'Email Settings', icon: Mail },
  { to: 'whatsapp-settings', label: 'WhatsApp Settings', icon: MessageCircle },
  { to: 'automation', label: 'Automation', icon: Zap },
  { to: 'security', label: 'Security', icon: Lock },
  { to: 'login-history', label: 'Login History', icon: KeyRound },
  { to: 'audit-logs', label: 'Audit Logs', icon: History },
]

function Panel({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      <div className="mt-5">{children}</div>
    </div>
  )
}

function SaveBar({ onSave }) {
  return (
    <div className="mt-6 flex justify-end border-t border-ink-100 pt-5 dark:border-ink-800">
      <Button icon={Save} onClick={onSave}>Save Changes</Button>
    </div>
  )
}

function useLocalForm(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })
  const save = () => localStorage.setItem(key, JSON.stringify(value))
  return [value, setValue, save]
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

/** The service list used to be a separate chip list that nothing read. Leads, deals, proposals, quotations and orders now all use the Products & Services catalog, so this points there. */
function ServicesPanel() {
  const { products } = useProducts()
  const active = products.filter((p) => p.status !== 'Inactive').length
  return (
    <Panel title="Services" description="Services and offerings are managed in one place: Products & Services.">
      <p className="text-sm text-ink-600 dark:text-ink-300">{active} active and {products.length - active} inactive items feed every product / service picker across leads, enquiries, deals, proposals, quotations, sales orders and invoices. Add, price, tax, activate or retire them in the catalog.</p>
      <Link to="/products" className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700">Open Products &amp; Services</Link>
    </Panel>
  )
}

function EditableChipList({ storageKey, seed, label, description }) {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : seed
    } catch {
      return seed
    }
  })
  const [draft, setDraft] = useState('')
  const { toast } = useToast()

  const persist = (next) => {
    setItems(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }
  const add = () => {
    if (!draft.trim() || items.includes(draft.trim())) return
    persist([...items, draft.trim()])
    setDraft('')
    toast(`"${draft.trim()}" added.`, { type: 'success' })
  }
  const remove = (item) => persist(items.filter((i) => i !== item))

  return (
    <Panel title={label} description={description}>
      <div className="mb-4 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">
            {item}
            <button onClick={() => remove(item)} className="text-ink-400 hover:text-rose-500"><X size={12} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add new item…" className="max-w-xs" />
        <Button variant="secondary" icon={Plus} onClick={add}>Add</Button>
      </div>
    </Panel>
  )
}

function CompanyProfilePanel() {
  const { toast } = useToast()
  const [form, setForm] = useState({
    name: 'LAX360 Pvt Ltd', industry: 'Information Technology — Design, Development & Service', address: '4th Floor, Tech Park Avenue, Bengaluru',
    phone: '+91 80 4567 8900', email: 'hello@lax360.com', website: 'www.lax360.com',
  })
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Panel title="Company Profile" description="Basic information about your organization, shown on quotations and invoices.">
      <div className="mb-6 flex items-center gap-4 rounded-xl border border-ink-100 px-4 py-3.5 dark:border-ink-800">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm dark:bg-ink-800">
          <Logo imgClassName="h-11" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Company Logo</p>
          <p className="text-xs text-ink-400">Used across the sidebar, login screen, and document previews.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Company Name"><Input value={form.name} onChange={update('name')} /></FormField>
        <FormField label="Industry"><Input value={form.industry} onChange={update('industry')} /></FormField>
        <FormField label="Phone"><Input value={form.phone} onChange={update('phone')} /></FormField>
        <FormField label="Email"><Input value={form.email} onChange={update('email')} /></FormField>
        <FormField label="Website"><Input value={form.website} onChange={update('website')} /></FormField>
        <FormField label="Address" className="sm:col-span-2"><Textarea value={form.address} onChange={update('address')} /></FormField>
      </div>
      <SaveBar onSave={() => toast('Company profile updated.', { type: 'success' })} />
    </Panel>
  )
}

function UsersPanel() {
  return (
    <Panel title="Users" description="Manage employee accounts from the dedicated Employees module.">
      <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">User management (add/edit/deactivate accounts) lives in the Employees module to avoid duplicating the same records in two places.</p>
      <Link to="/employees"><Button variant="secondary" icon={Users}>Go to Employees</Button></Link>
    </Panel>
  )
}

function TaxSettingsPanel() {
  const { toast } = useToast()
  const [form, setForm] = useState({ gstNumber: '29AACCN1234A1Z5', rate: 18, inclusive: false })
  return (
    <Panel title="Tax Settings" description="Default tax configuration applied to new quotations and invoices.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="GST Number"><Input value={form.gstNumber} onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value }))} /></FormField>
        <FormField label="Default Tax Rate (%)"><Input type="number" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></FormField>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
        <div>
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Prices are tax-inclusive</p>
          <p className="text-xs text-ink-400">When off, tax is added on top of the listed price.</p>
        </div>
        <Toggle checked={form.inclusive} onChange={(v) => setForm((f) => ({ ...f, inclusive: v }))} />
      </div>
      <SaveBar onSave={() => toast('Tax settings saved.', { type: 'success' })} />
    </Panel>
  )
}

function InvoiceSettingsPanel() {
  const { toast } = useToast()
  const [form, setForm] = useState({ prefix: 'INV-2026-', terms: 30, footer: 'Thank you for your business. Payment is due within the agreed terms.' })
  return (
    <Panel title="Invoice Settings" description="Defaults applied whenever a new invoice is created.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Invoice Number Prefix"><Input value={form.prefix} onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))} /></FormField>
        <FormField label="Default Payment Terms (days)"><Input type="number" value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} /></FormField>
        <FormField label="Default Footer Note" className="sm:col-span-2"><Textarea value={form.footer} onChange={(e) => setForm((f) => ({ ...f, footer: e.target.value }))} /></FormField>
      </div>
      <SaveBar onSave={() => toast('Invoice settings saved.', { type: 'success' })} />
    </Panel>
  )
}

function NotificationSettingsPanel() {
  const { toast } = useToast()
  const [channels, setChannels] = useState({ email: true, sms: false, push: true })
  const [events, setEvents] = useState(() => Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])))
  return (
    <Panel title="Notification Settings" description="Control how and when your team gets notified.">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Channels</p>
      <div className="mb-5 space-y-2.5">
        {Object.entries(channels).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
            <p className="text-sm font-medium capitalize text-ink-800 dark:text-ink-100">{k} notifications</p>
            <Toggle checked={v} onChange={(val) => setChannels((c) => ({ ...c, [k]: val }))} />
          </div>
        ))}
      </div>
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Event Types</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {NOTIFICATION_TYPES.map((t) => (
          <div key={t} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-2.5 dark:border-ink-800">
            <p className="text-sm text-ink-700 dark:text-ink-200">{t}</p>
            <Toggle checked={events[t]} onChange={(val) => setEvents((e) => ({ ...e, [t]: val }))} />
          </div>
        ))}
      </div>
      <SaveBar onSave={() => toast('Notification preferences saved.', { type: 'success' })} />
    </Panel>
  )
}

function EmailSettingsPanel() {
  const { toast } = useToast()
  const [form, setForm] = useState({ host: 'smtp.nexoracrm.com', port: 587, username: 'notifications@nexoracrm.com' })
  return (
    <Panel title="Email Settings" description="Connect an SMTP provider to send quotations, invoices, and alerts.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="SMTP Host"><Input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} /></FormField>
        <FormField label="Port"><Input type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} /></FormField>
        <FormField label="Username" className="sm:col-span-2"><Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></FormField>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" onClick={() => toast('This is a demo — no real service is connected.', { type: 'info' })}>Test Connection</Button>
        <Button onClick={() => toast('Email settings saved.', { type: 'success' })}>Save</Button>
      </div>
    </Panel>
  )
}

function WhatsAppSettingsPanel() {
  const { toast } = useToast()
  const [form, setForm] = useState({ apiKey: '••••••••••••3af1', phoneId: '918045678900' })
  return (
    <Panel title="WhatsApp Settings" description="Connect the WhatsApp Business API for customer messaging.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="API Key"><Input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} /></FormField>
        <FormField label="Phone Number ID"><Input value={form.phoneId} onChange={(e) => setForm((f) => ({ ...f, phoneId: e.target.value }))} /></FormField>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" onClick={() => toast('This is a demo — no real service is connected.', { type: 'info' })}>Test Connection</Button>
        <Button onClick={() => toast('WhatsApp settings saved.', { type: 'success' })}>Save</Button>
      </div>
    </Panel>
  )
}

function AutomationPanel() {
  const { toast } = useToast()
  const [rules, setRules] = useState([
    { id: 1, label: 'Auto-assign new leads round-robin to the sales team', on: true },
    { id: 2, label: 'Send a follow-up reminder 2 days before a lead’s due date', on: true },
    { id: 3, label: 'Notify account manager when an invoice becomes overdue', on: true },
    { id: 4, label: 'Auto-convert enquiries with status "Qualified" into leads', on: false },
    { id: 5, label: 'Send a satisfaction survey when a ticket is marked Resolved', on: false },
  ])
  return (
    <Panel title="Automation" description="Rules that run automatically in the background to save your team time.">
      <div className="space-y-2.5">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
            <p className="text-sm text-ink-700 dark:text-ink-200">{r.label}</p>
            <Toggle checked={r.on} onChange={(v) => setRules((rs) => rs.map((x) => x.id === r.id ? { ...x, on: v } : x))} />
          </div>
        ))}
      </div>
      <SaveBar onSave={() => toast('Automation rules saved.', { type: 'success' })} />
    </Panel>
  )
}

// Session Timeout and Trusted Device Duration are real, enforced settings — read by
// sessionStore.js on every session issuance / device-trust check (see src/utils/
// securitySettings.js), not just toasted-and-forgotten like the password-policy fields below
// (those aren't wired into the password-change validators anywhere in this app yet, so they
// stay cosmetic here rather than claim an enforcement that doesn't exist).
function SecurityPanel() {
  const { toast } = useToast()
  const [security, setSecurity] = useState(getSecuritySettings)
  const [form, setForm] = useState({ minLength: security.minPasswordLength, requireSpecial: security.requireSpecialChar })

  const save = () => {
    const next = saveSecuritySettings({
      sessionTimeoutMinutes: Number(security.sessionTimeoutMinutes) || 60,
      trustedDeviceDays: Number(security.trustedDeviceDays) || 30,
      minPasswordLength: Number(form.minLength) || 8,
      requireSpecialChar: form.requireSpecial,
    })
    setSecurity(next)
    toast('Security settings saved. New sign-ins and trusted-device checks apply this immediately.', { type: 'success' })
  }

  return (
    <Panel title="Security" description="Session duration, trusted-device policy, and password rules for your workspace.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Session Timeout" hint="How long a user stays signed in after login before being automatically logged out.">
          <Select value={security.sessionTimeoutMinutes} onChange={(e) => setSecurity((s) => ({ ...s, sessionTimeoutMinutes: Number(e.target.value) }))}>
            {SESSION_TIMEOUT_PRESETS.map((p) => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Trusted Device Duration (days)" hint="How long a verified device skips two-step verification before it's asked again.">
          <Input type="number" min="1" value={security.trustedDeviceDays} onChange={(e) => setSecurity((s) => ({ ...s, trustedDeviceDays: e.target.value }))} />
        </FormField>
        <FormField label="Minimum Password Length"><Input type="number" value={form.minLength} onChange={(e) => setForm((f) => ({ ...f, minLength: e.target.value }))} /></FormField>
      </div>
      <div className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
          <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Require a special character in passwords</p>
          <Toggle checked={form.requireSpecial} onChange={(v) => setForm((f) => ({ ...f, requireSpecial: v }))} />
        </div>
        <div className="rounded-xl border border-ink-100 px-4 py-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          Two-step verification is required automatically on a user's first sign-in from a new or untrusted device. A revoked device, or one whose trust period has expired, is asked again; session expiry alone never triggers it.
        </div>
      </div>
      <SaveBar onSave={save} />
    </Panel>
  )
}

// Historical filler so the panel isn't empty on a fresh seed — combined with every real
// "Login Attempt" / "Login" / "MFA Verification" event logged this session via AuthContext.
function seedLoginHistory() {
  const sample = USERS.slice(0, 10)
  return sample.flatMap((u) => generateLoginActivity(u.id, 4).map((row) => ({
    id: `${u.id}-${row.id}`,
    user: u.name,
    role: u.role,
    department: u.department,
    device: row.device,
    browser: row.browser,
    ip: row.ip,
    success: row.status === 'Success',
    date: `${row.date}T${row.time}:00`,
  })))
}

function LoginHistoryPanel() {
  const [liveEntries, setLiveEntries] = useState(() => getAuditLog())
  const [filters, setFilters] = useState({ from: '', to: '', user: '', role: '', status: '' })
  const seedRows = useMemo(() => seedLoginHistory(), [])

  useEffect(() => {
    const id = setInterval(() => setLiveEntries(getAuditLog()), 3000)
    return () => clearInterval(id)
  }, [])

  const liveLoginRows = liveEntries
    .filter((e) => e.module === 'Authentication' && ['Login', 'Login Attempt', 'MFA Verification', 'Session Expired', 'Logout', 'Session Terminated'].includes(e.action))
    .map((e) => ({ id: e.id, user: e.user, role: e.role, department: '—', device: '—', browser: '—', ip: '—', success: e.success !== false, date: e.date, action: e.action, detail: e.detail }))

  const rows = [...liveLoginRows, ...seedRows]
    .filter((r) => {
      if (filters.user && r.user !== filters.user) return false
      if (filters.role && r.role !== filters.role) return false
      if (filters.status && (filters.status === 'Success') !== r.success) return false
      if (filters.from && new Date(r.date) < new Date(filters.from)) return false
      if (filters.to && new Date(r.date) > new Date(`${filters.to}T23:59:59`)) return false
      return true
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const columns = [
    {
      key: 'user', header: 'User',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Avatar name={row.user} size="xs" />
          <div>
            <p>{row.user}</p>
            <p className="text-xs text-ink-400">{row.role}</p>
          </div>
        </div>
      ),
    },
    { key: 'action', header: 'Event', render: (row) => <span>{row.action || 'Login'}{row.detail ? <span className="block text-xs text-ink-400">{row.detail}</span> : null}</span> },
    { key: 'device', header: 'Device / Browser', render: (row) => row.device === '—' ? '—' : `${row.device} · ${row.browser}` },
    { key: 'ip', header: 'IP Address' },
    { key: 'success', header: 'Status', render: (row) => <StatusBadge status={row.success ? 'Success' : 'Failed'} /> },
    { key: 'date', header: 'Date & Time', render: (row) => <span title={formatDateTime(row.date)}>{timeAgo(row.date)}</span> },
  ]

  return (
    <Panel title="Login History" description="Every sign-in attempt across your workspace — who, when, from where, and whether it succeeded.">
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <FormField label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></FormField>
        <FormField label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></FormField>
        <FormField label="User">
          <Select value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}>
            <option value="">All Users</option>
            {USERS.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Role">
          <Select value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
            <option value="">All Roles</option>
            {getEffectiveRoles().map((r) => <option key={r} value={r}>{r}</option>)}
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
      <DataTable columns={columns} data={rows.slice(0, 150)} rowKey="id" emptyTitle="No login history found" emptyDescription="Try adjusting your filters." />
    </Panel>
  )
}

function AuditLogsPanel() {
  const [liveEntries, setLiveEntries] = useState(() => getAuditLog())

  useEffect(() => {
    const id = setInterval(() => setLiveEntries(getAuditLog()), 3000)
    return () => clearInterval(id)
  }, [])

  // Historical seed entries so the panel doesn't start empty, plus every real event logged
  // this session (login attempts, user status changes, quotation approvals, etc — see
  // src/utils/auditLog.js) merged in and sorted most-recent-first.
  const seedActions = [
    'Updated lead status to Qualified', 'Created invoice INV-2026-9010', 'Changed role permissions for Sales Executive',
    'Uploaded document "Master Service Agreement"', 'Marked deal as Won', 'Deleted expense EXP-12004',
    'Created quotation QUO-2026-4012', 'Reassigned lead to a new salesperson', 'Updated company profile',
    'Approved expense EXP-12009', 'Sent proposal PRP-5006 to client', 'Renewed contract CNT-2026-7003',
    'Marked ticket TK-14008 as Resolved', 'Added new lead source "Referral Partner"', 'Exported leads to CSV',
  ]
  const seedRows = seedActions.map((action, i) => ({
    id: `seed-${i}`,
    action,
    module: '—',
    user: USERS[i % USERS.length].name,
    role: USERS[i % USERS.length].role,
    success: true,
    date: new Date(Date.now() - (i + 1) * 3 * 3600 * 1000).toISOString(),
  }))
  const rows = [...liveEntries, ...seedRows].sort((a, b) => new Date(b.date) - new Date(a.date))

  const columns = [
    {
      key: 'action', header: 'Action',
      render: (row) => (
        <div>
          <p className="font-medium text-ink-700 dark:text-ink-200">{row.action}</p>
          {(row.record || row.detail) && <p className="text-xs text-ink-400">{[row.record, row.detail].filter(Boolean).join(' — ')}</p>}
          {(row.previousValue || row.newValue) && (
            <p className="text-xs text-ink-400">{row.previousValue ?? '—'} → {row.newValue ?? '—'}</p>
          )}
        </div>
      ),
    },
    { key: 'module', header: 'Module', render: (row) => <Badge tone="neutral">{row.module || '—'}</Badge> },
    {
      key: 'user', header: 'User',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Avatar name={row.user} size="xs" />
          <div>
            <p>{row.user}</p>
            <p className="text-xs text-ink-400">{row.role}</p>
          </div>
        </div>
      ),
    },
    { key: 'success', header: 'Result', render: (row) => <StatusBadge status={row.success === false ? 'Failed' : 'Success'} /> },
    { key: 'date', header: 'Timestamp', render: (row) => <span title={formatDateTime(row.date)}>{timeAgo(row.date)}</span> },
  ]
  return (
    <Panel title="Audit Logs" description="A read-only record of permission-sensitive activity across your workspace, updated live as actions happen.">
      <DataTable columns={columns} data={rows.slice(0, 100)} rowKey="id" emptyTitle="No audit entries" />
    </Panel>
  )
}

export default function Settings() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">Settings</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Configure your CRM workspace, defaults, and integrations.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="scrollbar-thin space-y-0.5 overflow-x-auto rounded-2xl border border-ink-100 bg-white p-2 dark:border-ink-800 dark:bg-ink-900 lg:sticky lg:top-20 lg:h-fit">
          {NAV.map((item) =>
            item.external ? (
              <Link
                key={item.label}
                to={item.external}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
              >
                <item.icon size={16} /> {item.label}
              </Link>
            ) : (
              <NavLink
                key={item.to}
                to={`/settings/${item.to}`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800'}`
                }
              >
                <item.icon size={16} /> {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div>
          <Routes>
            <Route index element={<Navigate to="/settings/company-profile" replace />} />
            <Route path="company-profile" element={<CompanyProfilePanel />} />
            <Route path="appearance" element={<AppearancePanel />} />
            <Route path="users" element={<UsersPanel />} />
            <Route path="lead-statuses" element={<EditableChipList storageKey="business_crm_lead_statuses_v1" seed={LEAD_STATUSES} label="Lead Statuses" description="Statuses available when qualifying a lead." />} />
            <Route path="deal-stages" element={<EditableChipList storageKey="business_crm_deal_stages_v1" seed={DEAL_STAGES} label="Deal Stages" description="Stages shown on the Sales Pipeline board." />} />
            <Route path="services" element={<ServicesPanel />} />
            <Route path="departments" element={<EditableChipList storageKey="business_crm_departments_v1" seed={DEPARTMENTS} label="Departments" description="Departments used to organize your team." />} />
            <Route path="tax-settings" element={<TaxSettingsPanel />} />
            <Route path="invoice-settings" element={<InvoiceSettingsPanel />} />
            <Route path="notification-settings" element={<NotificationSettingsPanel />} />
            <Route path="email-settings" element={<EmailSettingsPanel />} />
            <Route path="whatsapp-settings" element={<WhatsAppSettingsPanel />} />
            <Route path="automation" element={<AutomationPanel />} />
            <Route path="security" element={<SecurityPanel />} />
            <Route path="login-history" element={<LoginHistoryPanel />} />
            <Route path="audit-logs" element={<AuditLogsPanel />} />
            <Route path="*" element={<Navigate to="/settings/company-profile" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
