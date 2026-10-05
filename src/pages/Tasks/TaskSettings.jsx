import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Play, Save, ShieldCheck, Zap, Paperclip, Info, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { Input, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { errMsg, emitTasksChanged, useTaskMeta } from './taskClient'
import { TASK_PERMISSION_KEYS, DEFAULT_TASK_PERMISSIONS, TASK_PRIORITIES, TASK_FILE_RULES, taskPermissionsFor } from '../../utils/taskRules'

const RULE_ORDER = ['newLead', 'leadContacted', 'dealCreated', 'proposalSent', 'quotationSent', 'invoiceOverdue', 'taskOverdue']
const RULE_HELP = {
  newLead: 'Creates an initial call task for the lead owner when a new lead arrives.',
  leadContacted: 'Never creates a task by itself — surfaces a “create next follow-up” suggestion for contacted leads with nothing scheduled.',
  dealCreated: 'Creates a requirement follow-up for the deal owner.',
  proposalSent: 'Creates a follow-up once a proposal has really been sent.',
  quotationSent: 'Creates a follow-up once a quotation has really been sent.',
  invoiceOverdue: 'Creates a payment follow-up for invoices past due with a balance.',
  taskOverdue: 'Notifies the task owner at 0 / 1 / 3 / 7+ days overdue and the responsible manager once the escalation threshold is reached.',
}

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700')}>
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

export default function TaskSettings() {
  const { toast } = useToast()
  const { me } = useTaskMeta()
  const [s, setS] = useState(null)
  const [tab, setTab] = useState('automation')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  useEffect(() => { api.get('/tasks/settings').then((r) => setS(r.data)).catch((e) => setError(errMsg(e))) }, [])
  useEffect(() => { if (me && !['Super Admin', 'Admin'].includes(me.role)) setDenied(true) }, [me])

  const roles = Object.keys(DEFAULT_TASK_PERMISSIONS)
  const effective = useMemo(() => (s ? Object.fromEntries(roles.map((r) => [r, taskPermissionsFor(r, s)])) : {}), [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const setRule = (k, p) => setS((x) => ({ ...x, automation: { ...x.automation, [k]: { ...x.automation[k], ...p } } }))
  const setPerm = (role, key, v) => setS((x) => ({ ...x, permissions: { ...x.permissions, [role]: { ...(x.permissions[role] || {}), [key]: v } } }))

  const save = () => {
    // store only what differs from the built-in role defaults
    const permissions = {}
    roles.forEach((r) => {
      const diff = {}
      TASK_PERMISSION_KEYS.forEach(({ key }) => { if (!!effective[r][key] !== !!(DEFAULT_TASK_PERMISSIONS[r] || {})[key]) diff[key] = !!effective[r][key] })
      if (Object.keys(diff).length) permissions[r] = diff
    })
    setSaving(true); setError('')
    api.put('/tasks/settings', { ...s, permissions }).then((r) => { setS(r.data); toast('Task settings saved.', { type: 'success' }); emitTasksChanged() }).catch((e) => { setError(errMsg(e)); toast(errMsg(e), { type: 'error' }) }).finally(() => setSaving(false))
  }
  const runNow = () => {
    setRunning(true)
    api.post('/tasks/engine/run').then((r) => { const o = r.data; toast(`Automation ran: ${o.created} task(s) created, ${o.reminders} reminder(s), ${o.overdue} overdue alert(s).`, { type: 'success' }); emitTasksChanged() }).catch((e) => toast(errMsg(e), { type: 'error' })).finally(() => setRunning(false))
  }

  if (denied) return <EmptyState icon={ShieldAlert} title="Administrators only" description="Task settings change how tasks behave for everyone, so only an Admin can open them." action={<Link to="/tasks"><Button variant="secondary">Back to tasks</Button></Link>} />
  if (!s) return error ? <EmptyState title="Couldn’t load settings" description={error} /> : <div className="h-64 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />

  return (
    <div>
      <PageHeader breadcrumb={<Breadcrumbs items={[{ label: 'Tasks', href: '/tasks' }, { label: 'Settings' }]} />} title="Task settings" description="Automation, role permissions and upload rules. The server enforces every setting."
        actions={<><Button variant="secondary" icon={Play} loading={running} onClick={runNow}>Run automation now</Button><Button icon={Save} loading={saving} onClick={save}>Save changes</Button></>} />
      {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>}
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-800/40 dark:bg-sky-900/10 dark:text-sky-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>Reminders and overdue alerts are delivered <b>in the app</b> (bell and Notifications). Email and WhatsApp delivery are not configured, so nothing is sent through those channels. Automation runs while someone has the CRM open — there is no background scheduler in this workspace.</p>
      </div>
      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={[{ value: 'automation', label: 'Automation' }, { value: 'permissions', label: 'Permissions' }, { value: 'uploads', label: 'Reminders & uploads' }]} />

      {tab === 'automation' && (
        <div className="space-y-3">
          {RULE_ORDER.map((k) => {
            const r = s.automation[k]
            return (
              <div key={k} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-start gap-4">
                  <Switch checked={r.enabled} onChange={(v) => setRule(k, { enabled: v })} label={r.label} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50"><Zap size={14} className="text-amber-500" />{r.label}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{RULE_HELP[k]}</p>
                    {!['leadContacted', 'taskOverdue'].includes(k) && (
                      <div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-lg">
                        <label className="text-xs font-medium text-ink-500">Due in (days)<Input type="number" min={0} max={60} value={r.dueInDays} disabled={!r.enabled} onChange={(e) => setRule(k, { dueInDays: e.target.value })} aria-label={`${r.label} due in days`} className="mt-1" /></label>
                        <label className="text-xs font-medium text-ink-500">Priority<Select value={r.priority} disabled={!r.enabled} onChange={(e) => setRule(k, { priority: e.target.value })} aria-label={`${r.label} priority`} className="mt-1">{TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></label>
                        <label className="text-xs font-medium text-ink-500">Look back (days)<Input type="number" min={1} max={365} value={r.lookbackDays} disabled={!r.enabled} onChange={(e) => setRule(k, { lookbackDays: e.target.value })} aria-label={`${r.label} look back days`} className="mt-1" /></label>
                      </div>
                    )}
                    {k === 'taskOverdue' && (
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                        <label className="flex items-center gap-2 text-ink-700 dark:text-ink-200"><Switch checked={r.notifyManager} onChange={(v) => setRule(k, { notifyManager: v })} label="Notify manager" /> Notify the responsible manager</label>
                        <label className="flex items-center gap-2 text-xs font-medium text-ink-500">Escalate at<Select value={s.managerNotifyOverdueDays} disabled={!r.enabled || !r.notifyManager} onChange={(e) => setS((x) => ({ ...x, managerNotifyOverdueDays: Number(e.target.value) }))} aria-label="Manager escalation threshold" className="w-44">{[[0, 'Overdue today'], [1, 'Overdue 1+ day'], [3, 'Overdue 3+ days'], [7, 'Overdue 7+ days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <p className="text-xs text-ink-400">Each rule creates a task at most once per record (a dedupe key is stored on the task), so re-running automation never duplicates work.</p>
        </div>
      )}

      {tab === 'permissions' && (
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:bg-ink-800/40">
                <th className="px-4 py-3">Role</th>{TASK_PERMISSION_KEYS.map((p) => <th key={p.key} className="px-2 py-3 text-center">{p.label}</th>)}
              </tr></thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{r}{r === 'Super Admin' && <ShieldCheck size={13} className="ml-1.5 inline text-emerald-500" aria-label="Locked" />}</td>
                    {TASK_PERMISSION_KEYS.map((p) => (
                      <td key={p.key} className="px-2 py-2.5 text-center"><input type="checkbox" aria-label={`${r}: ${p.label}`} checked={!!effective[r][p.key]} disabled={r === 'Super Admin'} onChange={(e) => setPerm(r, p.key, e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50" /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ink-100 px-4 py-3 text-xs text-ink-500 dark:border-ink-800">“View team / department / all” widen which people’s tasks a role can see; Private tasks stay visible only to their creator, assignees and followers (and anyone with “View all”). Super Admin is locked.</p>
        </div>
      )}

      {tab === 'uploads' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50"><Paperclip size={14} /> Attachment rules</h3>
            <label className="mt-4 block text-xs font-medium text-ink-500">Maximum file size
              <Select value={s.uploadRules.maxBytes} onChange={(e) => setS((x) => ({ ...x, uploadRules: { ...x.uploadRules, maxBytes: Number(e.target.value) } }))} aria-label="Maximum file size" className="mt-1">
                {[[262144, '256 KB'], [524288, '512 KB'], [TASK_FILE_RULES.maxBytes, '1 MB']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </label>
            <p className="mt-1 text-[11px] text-ink-400">Files are stored in the browser-backed workspace database, so 1 MB is the ceiling.</p>
            <p className="mt-4 text-xs font-medium text-ink-500">Allowed file types</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TASK_FILE_RULES.extensions.map((e) => {
                const on = s.uploadRules.extensions.includes(e)
                return <button key={e} type="button" aria-pressed={on} onClick={() => setS((x) => ({ ...x, uploadRules: { ...x.uploadRules, extensions: on ? x.uploadRules.extensions.filter((y) => y !== e) : [...x.uploadRules.extensions, e] } }))} className={clsx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', on ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800' : 'text-ink-400 ring-ink-200 line-through dark:ring-ink-700')}>.{e}</button>
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Reminders</h3>
            <label className="mt-4 flex items-center gap-3 text-sm text-ink-700 dark:text-ink-200"><Switch checked={s.notifyManagerOnReminder} onChange={(v) => setS((x) => ({ ...x, notifyManagerOnReminder: v }))} label="Also remind the manager" /> Also send the reminder to the responsible manager</label>
            <p className="mt-2 text-xs text-ink-400">Users pick 5 min, 15 min, 30 min, 1 hour, 1 day or a custom time on each task. Reminders appear in the assignee’s bell when due.</p>
          </div>
        </div>
      )}
    </div>
  )
}
