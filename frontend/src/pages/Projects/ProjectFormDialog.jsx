import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Link2, Check } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { Badge } from '../../components/common/Badge'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { emitProjectsChanged, useProjectAccess } from '../../hooks/useProjects'
import { PROJECT_TYPES, PROJECT_PRIORITIES, validateProjectInput, orderValue, PROJECT_OPEN } from '../../utils/projectRules'
import { formatCurrency, formatDate } from '../../utils/format'

const SO_READY = ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled']
const TYPE_BY_CATEGORY = { Development: 'Development', Design: 'Design', Marketing: 'Marketing Campaign', Consulting: 'Consulting', 'Support & Maintenance': 'Support & Maintenance', Infrastructure: 'Infrastructure' }
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const errText = (e) => e?.response?.data?.message || e?.message || 'Could not save the project.'

/** Least-loaded active Project Manager — the suggested owner for a new project. */
function suggestManager(projects) {
  const pms = USERS.filter((u) => u.status !== 'Inactive' && u.role === 'Project Manager')
  const load = (id) => projects.filter((p) => p.manager === id && PROJECT_OPEN.includes(p.status)).length
  return [...pms].sort((a, b) => load(a.id) - load(b.id))[0]?.id || ''
}

const blank = (data, over = {}) => ({
  name: '', customerId: '', companyId: '', contactId: '', dealId: null, proposalId: null, quotationId: null, salesOrderId: null, productIds: [], projectType: 'Implementation', priority: 'Medium',
  manager: suggestManager(data.projects), team: [], startDate: addDays(0), deadline: addDays(90), value: '', description: '', objectives: '', progressMode: 'auto', billing: { paymentTerms: '', billingAddress: '', gstin: '' }, ...over,
})

/** Everything a project inherits from a Sales Order — nothing is retyped. */
function fromOrder(so, data) {
  const customer = data.customers.find((c) => c.id === so.customerId)
  const products = (so.items || []).map((i) => data.products.find((p) => p.id === i.productId)).filter(Boolean)
  const main = products[0]
  return blank(data, {
    name: `${main?.name || so.items?.[0]?.name || 'Project'} — ${so.customerName}`, customerId: so.customerId, companyId: so.companyId || customer?.companyId || '', contactId: so.contactId || '',
    dealId: so.dealId || null, contactId: so.contactId || data.deals.find((d) => d.id === so.dealId)?.contactId || '', proposalId: so.proposalId || null, quotationId: so.quotationId || null, salesOrderId: so.id, productIds: [...new Set((so.items || []).map((i) => i.productId).filter(Boolean))],
    projectType: TYPE_BY_CATEGORY[main?.category] || 'Implementation', value: orderValue(so) || '', deadline: so.expectedDeliveryDate || addDays(90),
    startDate: so.orderDate && so.orderDate > addDays(0) ? so.orderDate : addDays(0),
    description: so.notes || `Delivery of ${products.map((p) => p.name).join(', ') || 'the ordered services'} for ${so.customerName} (order ${so.number}).`,
    billing: { paymentTerms: so.paymentTerms || '', billingAddress: so.billingAddress || customer?.billingAddress || '', gstin: so.gstin || customer?.gstin || '' },
  })
}
function fromDeal(deal, data) {
  const customer = data.customers.find((c) => c.companyId === deal.companyId)
  const product = data.products.find((p) => p.id === deal.productId)
  const quotation = data.quotations.find((q) => q.dealId === deal.id && q.status === 'Accepted') || data.quotations.find((q) => q.dealId === deal.id)
  return blank(data, {
    name: `${product?.name || deal.service} — ${customer?.name || deal.companyName}`, customerId: customer?.id || '', companyId: deal.companyId, contactId: deal.contactId || '', dealId: deal.id,
    proposalId: quotation?.proposalId || data.proposals.find((p) => p.dealId === deal.id)?.id || null, quotationId: quotation?.id || null, productIds: deal.productId ? [deal.productId] : [],
    projectType: TYPE_BY_CATEGORY[product?.category] || 'Implementation', value: deal.value || '', deadline: addDays(90), description: deal.requirement || `Delivery of ${deal.service} for ${deal.companyName}.`,
    billing: { paymentTerms: quotation?.paymentTerms || '', billingAddress: customer?.billingAddress || '', gstin: customer?.gstin || '' },
  })
}

function Ref({ icon: Icon = Link2, label, value }) {
  return value ? <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{label}</span> {value}</span> : null
}

/** Create (from a Sales Order, a Closed Won deal, or manually) or edit a project. */
export function ProjectFormDialog({ open, onClose, project, data, preset, onSaved }) {
  const { toast } = useToast()
  const { user, can } = useProjectAccess()
  const editing = !!project
  const perms = can(project)
  const { projects } = data
  const [mode, setMode] = useState('order')
  const [sourceId, setSourceId] = useState('')
  const [f, setF] = useState(() => blank(data))
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  const taken = (key, id) => projects.some((p) => p[key] === id && p.status !== 'Cancelled' && p.id !== project?.id)
  const orders = useMemo(() => data.salesOrders.filter((s) => SO_READY.includes(s.status) && !taken('salesOrderId', s.id)), [data.salesOrders, projects]) // eslint-disable-line react-hooks/exhaustive-deps
  const deals = useMemo(() => data.deals.filter((d) => d.stage === 'Closed Won' && !taken('dealId', d.id)), [data.deals, projects]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setSourceId('')
    if (project) { setF({ ...blank(data), ...project, value: project.value ?? '', objectives: (project.objectives || []).join('\n') }); return }
    const start = preset?.salesOrderId ? 'order' : preset?.dealId ? 'deal' : can(null).createManual || !orders.length ? (orders.length ? 'order' : deals.length ? 'deal' : 'manual') : 'order'
    setMode(start)
    if (preset?.salesOrderId) { const so = data.salesOrders.find((s) => s.id === preset.salesOrderId); if (so) { setSourceId(so.id); setF(fromOrder(so, data)) } }
    else if (preset?.dealId) { const d = data.deals.find((x) => x.id === preset.dealId); if (d) { setSourceId(d.id); setF(fromDeal(d, data)) } }
    else setF(blank(data))
  }, [open, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickSource = (id) => {
    setSourceId(id)
    if (!id) { setF(blank(data)); return }
    setF(mode === 'order' ? fromOrder(data.salesOrders.find((s) => s.id === id), data) : fromDeal(data.deals.find((d) => d.id === id), data))
  }
  const switchMode = (m) => { setMode(m); setSourceId(''); setF(blank(data)); setErrors({}); setError('') }
  const toggleTeam = (id) => set({ team: f.team.includes(id) ? f.team.filter((x) => x !== id) : [...f.team, id] })
  const customer = data.customers.find((c) => c.id === f.customerId)
  const contacts = data.contacts.filter((c) => c.companyId === (f.companyId || customer?.companyId))
  const locked = !editing && mode !== 'manual' // chain-derived fields come from the source record
  const canValue = !editing || perms.viewFinancial

  const submit = () => {
    const input = { ...f, companyId: f.companyId || customer?.companyId || '' }
    const e = validateProjectInput(input)
    if (!editing && mode !== 'manual' && !sourceId) e.source = `Choose the ${mode === 'order' ? 'sales order' : 'closed-won deal'} to start from.`
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({}); setError(''); setSaving(true)
    const team = [...new Set([f.manager, ...f.team])]
    const teamRoles = Object.fromEntries(team.map((id) => [id, f.teamRoles?.[id] || project?.teamRoles?.[id] || { role: id === f.manager ? 'Project Manager' : 'Team Member', responsibility: '' }]))
    const value = Number(f.value) || 0
    const objectives = String(f.objectives || '').split('\n').map((s) => s.trim()).filter(Boolean)
    if (editing) {
      const patch = {
        name: f.name.trim(), projectType: f.projectType, priority: f.priority, manager: f.manager, team, teamRoles, startDate: f.startDate, deadline: f.deadline, expectedEndDate: f.deadline,
        description: f.description.trim(), objectives, progressMode: f.progressMode, contactId: f.contactId || null,
        ...(perms.viewFinancial ? { value, budget: value, billing: f.billing } : {}),
        ...(!project.salesOrderId && !project.dealId ? { customerId: f.customerId, customerName: customer?.name, companyId: input.companyId } : {}),
      }
      api.put(`/projects/${project.id}`, patch).then((r) => {
        toast('Project updated.', { type: 'success' }); emitProjectsChanged(); onSaved?.(r.data); onClose()
      }).catch((err) => setError(errText(err))).finally(() => setSaving(false))
      return
    }
    // creating: the server numbers the project, refuses a second live project for the same order or deal, and writes the timeline entry
    const rec = {
      name: f.name.trim(), customerId: f.customerId, customerName: customer?.name, companyId: input.companyId, contactId: f.contactId || null,
      dealId: f.dealId, proposalId: f.proposalId, quotationId: f.quotationId, salesOrderId: f.salesOrderId, productIds: f.productIds,
      projectType: f.projectType, priority: f.priority, status: 'Planned', manager: f.manager, team, teamRoles, startDate: f.startDate, deadline: f.deadline, expectedEndDate: f.deadline,
      value, budget: value, progress: 0, progressMode: f.progressMode, description: f.description.trim(), objectives, notes: '', billing: f.billing,
    }
    api.post('/projects', rec).then((r) => {
      toast(`Project ${r.data.id} created.`, { type: 'success' }); emitProjectsChanged(); onSaved?.(r.data); onClose()
    }).catch((err) => setError(errText(err))).finally(() => setSaving(false))
  }

  const products = f.productIds.map((id) => data.products.find((p) => p.id === id)).filter(Boolean)
  return (
    <Modal open={open} onClose={onClose} size="xl" title={editing ? `Edit ${project.name}` : 'New project'}
      description={editing ? `${project.id} · changes are recorded on the project timeline.` : 'Projects start from a confirmed sale — the customer, deal, quotation, order and products are linked for you.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Create project'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</p>}

        {!editing && (
          <div>
            <div className="flex gap-1 rounded-lg bg-ink-50 p-1 text-xs font-medium dark:bg-ink-800/50" role="tablist" aria-label="Start from">
              {[['order', `Sales order (${orders.length})`], ['deal', `Closed-won deal (${deals.length})`], ...(perms.createManual ? [['manual', 'Manual']] : [])].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => switchMode(k)} className={clsx('flex-1 rounded-md px-3 py-1.5', mode === k ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50' : 'text-ink-500')}>{l}</button>
              ))}
            </div>
            {mode !== 'manual' && (
              <FormField label={mode === 'order' ? 'Sales order' : 'Closed-won deal'} required error={errors.source} className="mt-3" hint={mode === 'order' ? 'Confirmed orders that do not have a project yet.' : 'Won deals that do not have a project yet.'}>
                <Select value={sourceId} onChange={(e) => pickSource(e.target.value)} aria-label="Source record">
                  <option value="">Choose…</option>
                  {mode === 'order' ? orders.map((s) => <option key={s.id} value={s.id}>{s.number} · {s.customerName} · {formatCurrency(s.amount)}</option>) : deals.map((d) => <option key={d.id} value={d.id}>{d.name} · {formatCurrency(d.value)}</option>)}
                </Select>
              </FormField>
            )}
            {mode !== 'manual' && !(mode === 'order' ? orders : deals).length && <p className="mt-2 text-xs text-ink-400">Nothing is waiting for a project here{perms.createManual ? ' — use Manual to start one without a sale.' : '.'}</p>}
          </div>
        )}

        {(sourceId || editing) && (f.dealId || f.salesOrderId || f.quotationId || f.proposalId) && (
          <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-medium text-ink-400">Linked</span>
            <Ref label="Customer" value={customer?.name} /><Ref label="Deal" value={data.deals.find((d) => d.id === f.dealId)?.name} /><Ref label="Proposal" value={data.proposals.find((p) => p.id === f.proposalId)?.number} />
            <Ref label="Quotation" value={data.quotations.find((q) => q.id === f.quotationId)?.number} /><Ref label="Order" value={data.salesOrders.find((s) => s.id === f.salesOrderId)?.number} />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Project name" required error={errors.name} className="sm:col-span-2"><Input autoFocus={editing} value={f.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} /></FormField>
          <FormField label="Customer" required error={errors.customerId} hint={locked || (editing && (project.salesOrderId || project.dealId)) ? 'From the linked sale.' : undefined}>
            <Select value={f.customerId} disabled={locked || (editing && (project.salesOrderId || project.dealId))} onChange={(e) => { const c = data.customers.find((x) => x.id === e.target.value); set({ customerId: e.target.value, companyId: c?.companyId || '', contactId: '' }) }}>
              <option value="">Choose…</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Primary contact"><Select value={f.contactId || ''} disabled={locked && !!f.contactId} onChange={(e) => set({ contactId: e.target.value })}><option value="">None</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          <FormField label="Project type" required error={errors.projectType}><Select value={f.projectType} onChange={(e) => set({ projectType: e.target.value })}>{PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
          <FormField label="Priority" required error={errors.priority}><Select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>{PROJECT_PRIORITIES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
          <FormField label="Project manager" required error={errors.manager} hint={!editing ? 'Suggested: the project manager with the lightest workload.' : !perms.assign ? 'Only an admin or project manager can reassign.' : undefined}>
            <Select value={f.manager} disabled={editing && !perms.assign} onChange={(e) => set({ manager: e.target.value })}><option value="">Choose…</option>{USERS.filter((u) => u.status !== 'Inactive').map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</Select>
          </FormField>
          {canValue && <FormField label="Project value (₹, before tax)" error={errors.value} hint={f.salesOrderId ? 'Taken from the sales order.' : undefined}><Input type="number" min="0" value={f.value} error={errors.value} onChange={(e) => set({ value: e.target.value })} /></FormField>}
          <FormField label="Start date" required error={errors.startDate}><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} error={errors.startDate} /></FormField>
          <FormField label="Expected end date" required error={errors.deadline}><Input type="date" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} error={errors.deadline} /></FormField>
        </div>

        {(products.length > 0 || (!editing && mode === 'manual')) && (
          <FormField label="Products & services" hint="From the catalog — nothing is retyped.">
            {mode === 'manual' && !editing ? (
              <div className="flex flex-wrap gap-1.5">{data.products.filter((p) => p.status !== 'Inactive').map((p) => { const on = f.productIds.includes(p.id); return <button key={p.id} type="button" aria-pressed={on} onClick={() => set({ productIds: on ? f.productIds.filter((x) => x !== p.id) : [...f.productIds, p.id] })} className={clsx('rounded-full px-2.5 py-1 text-xs ring-1 ring-inset', on ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300' : 'text-ink-500 ring-ink-200 dark:ring-ink-700')}>{p.code} · {p.name}</button> })}</div>
            ) : <div className="flex flex-wrap gap-1.5">{products.map((p) => <Badge key={p.id}>{p.code} · {p.name}</Badge>)}</div>}
          </FormField>
        )}

        <FormField label="Team members" hint={`${new Set([f.manager, ...f.team].filter(Boolean)).size} on the project. Roles are set on the Team tab.`}>
          <div className="scrollbar-thin grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-ink-100 p-2 sm:grid-cols-2 dark:border-ink-800">
            {USERS.filter((u) => u.status !== 'Inactive' && u.id !== f.manager).map((u) => { const on = f.team.includes(u.id); return (
              <button key={u.id} type="button" aria-pressed={on} onClick={() => toggleTeam(u.id)} className={clsx('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink-50 dark:hover:bg-ink-800', on && 'bg-brand-50/60 dark:bg-brand-900/20')}>
                <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-ink-600')}>{on && <Check size={11} />}</span>
                <span className="min-w-0 flex-1 truncate text-ink-800 dark:text-ink-100">{u.name}</span><span className="shrink-0 text-ink-400">{u.role}</span>
              </button>) })}
          </div>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Description" error={errors.description}><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[88px]" /></FormField>
          <FormField label="Objectives" hint="One per line."><Textarea value={f.objectives} onChange={(e) => set({ objectives: e.target.value })} className="min-h-[88px]" /></FormField>
        </div>
        <FormField label="Progress" hint={f.progressMode === 'auto' ? 'Calculated from completed tasks and milestones (falls back to the saved figure until tasks exist).' : 'You set the percentage yourself on the Overview tab.'}>
          <Select value={f.progressMode} onChange={(e) => set({ progressMode: e.target.value })}><option value="auto">Automatic — from tasks & milestones</option><option value="manual">Manual</option></Select>
        </FormField>
        {!editing && f.startDate && <p className="text-xs text-ink-400">Starts {formatDate(f.startDate)} · due {formatDate(f.deadline)} · created as <b>Planned</b>; activate it when work begins.</p>}
      </form>
    </Modal>
  )
}
