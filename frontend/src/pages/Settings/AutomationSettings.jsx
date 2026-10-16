import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Trash2, Wifi, XCircle } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api, errorMessage } from '../../api/http'
import { timeAgo } from '../../utils/format'

const RUN_TONE = { Success: 'success', Failed: 'danger', Running: 'info', Queued: 'neutral' }
const TRIGGER = { event: 'CRM event', manual: 'Test', insight: 'AI Insight', retry: 'Retry' }
const card = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'
const BLANK = { name: '', event: '', webhookUrl: '', onlyWhen: '', awaitCallback: false, description: '', enabled: true }

function Section({ title, description, actions, children }) {
  return (
    <section className={card}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{title}</h2>{description && <p className="mt-1 max-w-2xl text-sm text-ink-500 dark:text-ink-400">{description}</p>}</div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-200 dark:bg-ink-700'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-ink-700 dark:text-ink-200">{label}</span>
    </label>
  )
}

function ConnectionCard({ config, canEdit, onSaved }) {
  const { toast } = useToast()
  const [f, setF] = useState(null)
  const [secret, setSecret] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { setF({ enabled: config.enabled, baseUrl: config.baseUrl || '', authHeader: config.authHeader, publicApiUrl: config.publicApiUrl || '', timeoutSeconds: config.timeoutSeconds }); setSecret('') }, [config])
  if (!f) return null
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const save = () => {
    setBusy(true); setErrors({})
    api.put('/automation/config', { ...f, timeoutSeconds: Number(f.timeoutSeconds), ...(secret ? { secret } : {}) }, { silent: true })
      .then((res) => { toast('Automation settings saved.', { type: 'success' }); setSecret(''); onSaved(res.data) })
      .catch((e) => { setErrors(e.response?.data?.fields || {}); toast(errorMessage(e), { type: 'error' }) })
      .finally(() => setBusy(false))
  }
  const test = () => {
    setTesting(true); setResult(null)
    api.post('/automation/test-connection', null, { silent: true }).then((r) => setResult(r.data)).catch((e) => setResult({ ok: false, message: errorMessage(e) })).finally(() => setTesting(false))
  }
  const state = !config.configured ? ['neutral', 'Not set up'] : config.enabled ? ['success', 'Connected'] : ['warning', 'Switched off']
  return (
    <Section
      title="n8n connection"
      description="Connect your n8n instance. The CRM sends business events to your workflows' webhooks and shows what happened to each one."
      actions={<Badge tone={state[0]}>{state[1]}</Badge>}
    >
      {!canEdit && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Only the Super Admin can change the connection. You can see whether it is on and use the workflows below.</p>}
      {config.hasSecret && !config.secretReadable && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">The stored secret can no longer be read (the server's security key changed). Enter the secret again and save.</p>}
      {canEdit && (
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Send events to n8n" /></div>
          <FormField label="n8n address" error={errors.baseUrl} hint="The address you open n8n at, e.g. https://n8n.yourcompany.com"><Input aria-label="n8n address" value={f.baseUrl} placeholder="https://n8n.yourcompany.com" onChange={(e) => set({ baseUrl: e.target.value })} error={!!errors.baseUrl} /></FormField>
          <FormField label="Shared secret" error={errors.secret} hint={config.hasSecret ? 'A secret is stored. Leave empty to keep it, or type a new one.' : 'At least 16 characters. Use the same value in your n8n Webhook node credential.'}>
            <Input aria-label="Shared secret" type="password" autoComplete="new-password" value={secret} placeholder={config.hasSecret ? '••••••••••••••••' : 'Long random string'} onChange={(e) => setSecret(e.target.value)} error={!!errors.secret} />
          </FormField>
          <FormField label="Header name" error={errors.authHeader} hint="The secret is sent in this header (n8n: Webhook → Authentication → Header Auth)."><Input aria-label="Header name" value={f.authHeader} onChange={(e) => set({ authHeader: e.target.value })} error={!!errors.authHeader} /></FormField>
          <FormField label="Wait for an answer (seconds)" error={errors.timeoutSeconds}><Input aria-label="Timeout seconds" type="number" min={3} max={60} value={f.timeoutSeconds} onChange={(e) => set({ timeoutSeconds: e.target.value })} error={!!errors.timeoutSeconds} /></FormField>
          <FormField className="sm:col-span-2" label="This CRM's public API address (optional)" error={errors.publicApiUrl} hint="Only needed if a workflow reports back when it finishes. It is added to every message as the callback address.">
            <Input aria-label="Public API address" value={f.publicApiUrl} placeholder="https://your-crm-api.example.com" onChange={(e) => set({ publicApiUrl: e.target.value })} error={!!errors.publicApiUrl} />
          </FormField>
        </fieldset>
      )}
      {canEdit && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button icon={Save} loading={busy} onClick={save}>Save connection</Button>
          <Button variant="secondary" icon={Wifi} loading={testing} disabled={!config.baseUrl} onClick={test}>Test connection</Button>
          {result && <span role="status" className={`inline-flex items-center gap-1.5 text-sm ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{result.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{result.message}{result.ms != null && result.ok ? ` (${result.ms} ms)` : ''}</span>}
        </div>
      )}
      <details className="mt-5 rounded-xl border border-ink-100 px-4 py-3 text-sm text-ink-600 dark:border-ink-800 dark:text-ink-300">
        <summary className="cursor-pointer font-medium text-ink-800 dark:text-ink-100">How to set up a workflow in n8n</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5">
          <li>In n8n add a <b>Webhook</b> node: method <b>POST</b>, authentication <b>Header Auth</b> with the header name and shared secret above.</li>
          <li>Copy the node's <b>Production URL</b> (not the Test URL) and activate the workflow.</li>
          <li>Add the workflow here, choose the CRM event it should react to, and paste that address (or just its path, such as <code>/webhook/abc</code>).</li>
          <li>The message contains <code>event</code>, <code>record</code> (type, id, label, full data), <code>changes</code>, <code>actor</code>, <code>branch</code> and <code>runId</code>. Messages are signed (<code>X-CRM-Signature</code>, HMAC-SHA256).</li>
          <li>Optional: tick “waits for callback” and, when the workflow ends, POST <code>{'{ runId, status: "success" | "failed", message }'}</code> to the <code>callbackUrl</code> with the same header and secret.</li>
        </ol>
      </details>
    </Section>
  )
}

function WorkflowDialog({ workflow, events, hasBase, onClose, onSaved }) {
  const { toast } = useToast()
  const [f, setF] = useState(workflow ? { ...BLANK, ...workflow } : BLANK)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setErrors({}) }
  const grouped = useMemo(() => events.filter((e) => e.kind !== 'manual').reduce((acc, e) => ({ ...acc, [e.module]: [...(acc[e.module] || []), e] }), {}), [events])
  const stateEvent = f.event.endsWith('.status_changed') || f.event.endsWith('.stage_changed')
  const save = () => {
    setBusy(true)
    const body = { name: f.name, event: f.event, webhookUrl: f.webhookUrl, onlyWhen: stateEvent ? f.onlyWhen : '', awaitCallback: f.awaitCallback, description: f.description, enabled: f.enabled }
    ;(workflow ? api.put(`/automation/workflows/${workflow.id}`, body, { silent: true }) : api.post('/automation/workflows', body, { silent: true }))
      .then(() => { toast(workflow ? 'Workflow updated.' : 'Workflow added.', { type: 'success' }); onSaved(); onClose() })
      .catch((e) => { setErrors(e.response?.data?.fields || {}); if (!e.response?.data?.fields) toast(errorMessage(e), { type: 'error' }) })
      .finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="lg" title={workflow ? `Edit ${workflow.name}` : 'Add workflow'} description="A workflow reacts to one CRM event by calling the webhook of an n8n workflow."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{workflow ? 'Save changes' : 'Add workflow'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={errors.name}><Input aria-label="Workflow name" value={f.name} placeholder="Welcome new leads" onChange={(e) => set({ name: e.target.value })} error={!!errors.name} /></FormField>
        <FormField label="When this happens" required error={errors.event}>
          <Select aria-label="CRM event" value={f.event} onChange={(e) => set({ event: e.target.value })} error={!!errors.event}>
            <option value="">Choose an event…</option>
            {Object.entries(grouped).map(([module, list]) => <optgroup key={module} label={module}>{list.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</optgroup>)}
          </Select>
        </FormField>
        <FormField className="sm:col-span-2" label="n8n webhook address" required error={errors.webhookUrl} hint={hasBase ? 'Paste the Production URL, or only its path (e.g. /webhook/abc-123) to use the n8n address from the connection.' : 'Paste the full Production URL of the Webhook node.'}>
          <Input aria-label="Webhook address" value={f.webhookUrl} placeholder="https://n8n.yourcompany.com/webhook/…" onChange={(e) => set({ webhookUrl: e.target.value })} error={!!errors.webhookUrl} />
        </FormField>
        {stateEvent && <FormField className="sm:col-span-2" label="Only when the new value is (optional)" error={errors.onlyWhen} hint="For example Proposal / Quotation or Qualified. Leave empty to react to every change."><Input aria-label="Only when" value={f.onlyWhen} onChange={(e) => set({ onlyWhen: e.target.value })} error={!!errors.onlyWhen} /></FormField>}
        <FormField className="sm:col-span-2" label="Description (optional)" error={errors.description}><Textarea aria-label="Description" value={f.description} className="min-h-[56px]" onChange={(e) => set({ description: e.target.value })} /></FormField>
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} label="Workflow is active" />
          <Toggle checked={f.awaitCallback} onChange={(v) => set({ awaitCallback: v })} label="n8n reports back when it finishes (the run stays “Running” until it does)" />
        </div>
      </div>
    </Modal>
  )
}

function WorkflowList({ workflows, canEdit, enabled, onChange, events, hasBase }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [testing, setTesting] = useState('')
  const test = (w) => {
    setTesting(w.id)
    api.post(`/automation/workflows/${w.id}/test`, null, { silent: true })
      .then((res) => { const r = res.data; toast(r.status === 'Failed' ? `Test failed: ${r.message}` : r.status === 'Running' ? 'Test message sent. Waiting for n8n.' : 'Test message delivered to n8n.', { type: r.status === 'Failed' ? 'error' : 'success' }); onChange() })
      .catch((e) => toast(errorMessage(e), { type: 'error' }))
      .finally(() => setTesting(''))
  }
  const remove = () => api.delete(`/automation/workflows/${removing.id}`).then(() => { toast('Workflow deleted. Its past runs are kept.', { type: 'success' }); setRemoving(null); onChange() })
  const toggle = (w) => api.put(`/automation/workflows/${w.id}`, { enabled: !w.enabled }).then(onChange)
  return (
    <Section title="Workflows" description="Each workflow listens to one CRM event. Events from the Leads, Enquiries, Deals, Quotations, Invoices, Tickets and Customers screens, and AI Insights, can be used."
      actions={canEdit && <Button icon={Plus} onClick={() => setEditing('new')}>Add workflow</Button>}>
      {workflows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-500 dark:border-ink-700 dark:text-ink-400">No workflows yet.{canEdit ? ' Add one to start sending CRM events to n8n.' : ' The Super Admin can add them.'}</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {workflows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">{w.name}<Badge tone={w.enabled ? 'success' : 'neutral'}>{w.enabled ? 'Active' : 'Off'}</Badge>{w.awaitCallback && <Badge tone="info">Waits for callback</Badge>}</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">When: {w.eventLabel}{w.onlyWhen ? ` → ${w.onlyWhen}` : ''}{w.webhookUrl ? ` · ${w.webhookUrl.length > 60 ? `${w.webhookUrl.slice(0, 58)}…` : w.webhookUrl}` : ''}</p>
                {w.description && <p className="mt-0.5 text-xs text-ink-400">{w.description}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" icon={Play} loading={testing === w.id} disabled={!enabled || !w.enabled} onClick={() => test(w)}>Send test</Button>
                {canEdit && <>
                  <Button size="sm" variant="ghost" onClick={() => toggle(w)}>{w.enabled ? 'Turn off' : 'Turn on'}</Button>
                  <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Edit ${w.name}`} onClick={() => setEditing(w)}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${w.name}`} onClick={() => setRemoving(w)}>Delete</Button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <WorkflowDialog workflow={editing === 'new' ? null : editing} events={events} hasBase={hasBase} onClose={() => setEditing(null)} onSaved={onChange} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} title={`Delete “${removing?.name}”?`} description="The CRM stops sending events to it. Its run history stays." confirmLabel="Delete workflow" tone="danger" />
    </Section>
  )
}

function RunHistory({ workflows, refreshKey }) {
  const { toast } = useToast()
  const [status, setStatus] = useState('')
  const [workflowId, setWorkflowId] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState('')
  const load = useCallback(() => api.get('/automation/runs', { params: { status: status || undefined, workflowId: workflowId || undefined, page, pageSize: 10 }, noCache: true })
    .then((r) => { setData(r.data); setError('') }).catch((e) => setError(errorMessage(e))), [status, workflowId, page])
  useEffect(() => { load() }, [load, refreshKey])
  const active = data?.data.some((r) => ['Queued', 'Running'].includes(r.status))
  useEffect(() => { if (!active) return undefined; const t = setInterval(load, 8000); return () => clearInterval(t) }, [active, load])
  const retry = (r) => {
    setRetrying(r.id)
    api.post(`/automation/runs/${r.id}/retry`, null, { silent: true })
      .then((res) => toast(res.data.status === 'Failed' ? `Still failing: ${res.data.message}` : 'Sent again.', { type: res.data.status === 'Failed' ? 'error' : 'success' }))
      .catch((e) => toast(errorMessage(e), { type: 'error' })).finally(() => { setRetrying(''); load() })
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const sel = 'h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
  return (
    <Section title="Run history" description="Every message the CRM handed to n8n and what became of it. Failed sends that can be retried are retried automatically (3 attempts); the rest wait for you."
      actions={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Filter by status" className={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['Success', 'Failed', 'Running', 'Queued'].map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter by workflow" className={sel} value={workflowId} onChange={(e) => { setWorkflowId(e.target.value); setPage(1) }}><option value="">All workflows</option>{workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-rose-500">{error}</p>}
      {!data ? <p className="text-sm text-ink-400">Loading…</p> : data.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-500 dark:border-ink-700 dark:text-ink-400">No runs{status || workflowId ? ' match these filters' : ' yet'}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800"><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Workflow</th><th className="py-2 pr-3 font-medium">Triggered by</th><th className="py-2 pr-3 font-medium">Result</th><th className="py-2 font-medium">When</th></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.data.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2.5 pr-3"><Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>{r.attempts > 1 && <span className="ml-1.5 text-[11px] text-ink-400">×{r.attempts}</span>}{r.status === 'Failed' && <Button size="sm" variant="ghost" icon={RotateCcw} className="mt-1" loading={retrying === r.id} onClick={() => retry(r)}>Retry</Button>}</td>
                  <td className="py-2.5 pr-3 font-medium text-ink-800 dark:text-ink-100">{r.workflowName}<span className="block text-xs font-normal text-ink-400">{r.event}</span></td>
                  <td className="py-2.5 pr-3 text-ink-600 dark:text-ink-300">{TRIGGER[r.trigger] || r.trigger}<span className="block max-w-[22ch] truncate text-xs text-ink-400" title={r.recordLabel}>{r.recordLabel}</span></td>
                  <td className={`max-w-[34ch] py-2.5 pr-3 text-xs ${r.status === 'Failed' ? 'text-rose-600 dark:text-rose-400' : 'text-ink-500 dark:text-ink-400'}`}>{r.message || '—'}{r.responseCode ? <span className="ml-1 text-ink-400">(HTTP {r.responseCode})</span> : null}{r.nextRetryAt && r.status === 'Failed' && <span className="block text-ink-400">Will be retried automatically.</span>}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-ink-500 dark:text-ink-400" title={r.createdAt}>{timeAgo(r.createdAt)}{r.durationMs != null ? ` · ${r.durationMs} ms` : ''}</td>
                  
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-500 dark:text-ink-400"><span>{data.total} runs</span><span className="flex items-center gap-2"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>Page {page} of {pages}<Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></span></div>
      )}
    </Section>
  )
}

/** Settings → Automation: the n8n connection, the workflows, what happened to each message - plus the built-in background rules. */
export function AutomationPanel() {
  const { user } = useAuth()
  const canEdit = user?.accessLevel === 'Super Admin'
  const isAdmin = canEdit || user?.accessLevel === 'Admin'
  const [ov, setOv] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const load = useCallback(() => api.get('/automation/overview', { noCache: true }).then((r) => { setOv(r.data); setError(''); setTick((t) => t + 1) }).catch((e) => setError(errorMessage(e))), [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  return (
    <div className="space-y-5">
      {!isAdmin ? (
        <Section title="n8n workflow automation" description="Connecting business workflows is managed by an administrator."><p className="text-sm text-ink-500 dark:text-ink-400">Ask your administrator if you need a workflow connected to the CRM.</p></Section>
      ) : error ? (
        <Section title="n8n workflow automation"><p role="alert" className="text-sm text-rose-500">{error}</p><Button className="mt-3" variant="secondary" icon={RefreshCw} onClick={load}>Try again</Button></Section>
      ) : !ov ? (
        <Section title="n8n workflow automation"><p className="text-sm text-ink-400">Loading…</p></Section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Succeeded (24 h)', ov.last24h.Success, 'text-emerald-600 dark:text-emerald-400'], ['Failed (24 h)', ov.last24h.Failed, ov.last24h.Failed ? 'text-rose-600 dark:text-rose-400' : 'text-ink-900 dark:text-ink-50'], ['Running', ov.last24h.Running + ov.last24h.Queued, 'text-brand-600 dark:text-brand-400'], ['Active workflows', ov.workflows.filter((w) => w.enabled).length, 'text-ink-900 dark:text-ink-50']].map(([label, value, tone]) => (
              <div key={label} className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500 dark:text-ink-400">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p></div>
            ))}
          </div>
          <ConnectionCard config={ov.config} canEdit={canEdit} onSaved={load} />
          <WorkflowList workflows={ov.workflows} canEdit={canEdit} enabled={ov.config.enabled && ov.config.configured} onChange={load} events={ov.events} hasBase={!!ov.config.baseUrl || !canEdit} />
          <RunHistory workflows={ov.workflows} refreshKey={tick} />
        </>
      )}
      <Section title="Built-in automation" description="Rules that run automatically in the background to save your team time.">
        <ul className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-ink-600 dark:text-ink-300">
          <li>Task reminders, overdue alerts and automatic follow-up tasks (configured in Tasks → Settings).</li>
          <li>Invoices past their due date become Overdue; contracts move to Expiring Soon / Expired by their end date.</li>
          <li>Contract expiry reminders and the renewal follow-up task; project deadline and milestone reminders; due follow-ups on leads and enquiries.</li>
          <li>Proposals past their validity expire; documents in the bin are removed after the retention period.</li>
          <li>Failed n8n sends are retried automatically and n8n workflows that never report back are closed after 15 minutes.</li>
        </ul>
        <Link to="/tasks/settings" className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700">Open task automation settings</Link>
      </Section>
    </div>
  )
}
