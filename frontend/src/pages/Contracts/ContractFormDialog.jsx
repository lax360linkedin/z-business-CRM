import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { useContractSettings, useContractAccess } from '../../hooks/useContracts'
import { BILLING_FREQUENCIES, validateContractInput, addDaysKey, addMonthsKey, todayKey } from '../../utils/contractRules'
import { orderValue } from '../../utils/projectRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { createContract, saveContract, errText } from './contractActions'
import { emitContractsChanged } from '../../hooks/useContracts'

const SO_READY = ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled']
const SOURCES = [['deal', 'Closed-won deal'], ['quotation', 'Accepted quotation'], ['order', 'Sales order'], ['project', 'Project']]
const TYPE_BY_CATEGORY = { Development: 'Software Development Agreement', 'Support & Maintenance': 'AMC / Maintenance Contract', Consulting: 'Consulting Agreement' }
const TYPE_BY_PROJECT = { Development: 'Software Development Agreement', 'Support & Maintenance': 'AMC / Maintenance Contract', Consulting: 'Consulting Agreement' }

const blank = (owner = '') => ({
  title: '', contractType: '', customerId: '', customerName: '', companyId: '', contactId: '', dealId: null, proposalId: null, quotationId: null, salesOrderId: null, projectId: null, owner, team: [], value: '',
  billingFrequency: 'Quarterly', paymentTerms: '30 days from the invoice date', startDate: todayKey(), endDate: addMonthsKey(todayKey(), 12), renewalDate: '', noticePeriodDays: 30, autoRenew: false,
  renewalTerms: 'Renews for a further term of equal length unless either party gives written notice within the notice period.', scope: '', terms: 'Standard terms and conditions apply: confidentiality, payment within the agreed terms, liability limited to the fees paid, governed by the laws of India.', notes: '',
})

/** Fills the rest of the chain (deal, quotation, order, proposal, project, customer, company, contact) from whichever record the contract starts at — IDs only, no copies. */
function resolveChain(seed, data) {
  const c = { ...seed }
  const take = (k, v) => { if (v && !c[k]) c[k] = v }
  for (let pass = 0; pass < 3; pass += 1) {
    const so = c.salesOrderId && data.salesOrders.find((s) => s.id === c.salesOrderId)
    if (so) ['quotationId', 'dealId', 'proposalId', 'customerId', 'companyId', 'contactId'].forEach((k) => take(k, so[k]))
    const q = c.quotationId && data.quotations.find((x) => x.id === c.quotationId)
    if (q) ['dealId', 'proposalId', 'customerId', 'companyId', 'contactId'].forEach((k) => take(k, q[k]))
    const p = c.projectId && data.projects.find((x) => x.id === c.projectId)
    if (p) ['salesOrderId', 'quotationId', 'dealId', 'proposalId', 'customerId', 'companyId', 'contactId'].forEach((k) => take(k, p[k]))
    const d = c.dealId && data.deals.find((x) => x.id === c.dealId)
    if (d) { take('companyId', d.companyId); take('contactId', d.contactId); take('proposalId', data.proposals.find((x) => x.dealId === d.id)?.id) }
    take('salesOrderId', c.quotationId && data.salesOrders.find((s) => s.quotationId === c.quotationId && s.status !== 'Cancelled')?.id)
    take('salesOrderId', c.dealId && data.salesOrders.find((s) => s.dealId === c.dealId && s.status !== 'Cancelled')?.id)
    take('projectId', c.salesOrderId && data.projects.find((x) => x.salesOrderId === c.salesOrderId && x.status !== 'Cancelled')?.id)
    take('projectId', c.dealId && data.projects.find((x) => x.dealId === c.dealId && x.status !== 'Cancelled')?.id)
    take('quotationId', c.dealId && (data.quotations.find((x) => x.dealId === c.dealId && x.status === 'Accepted') || data.quotations.find((x) => x.dealId === c.dealId))?.id)
    take('customerId', c.companyId && data.customers.find((x) => x.companyId === c.companyId)?.id)
  }
  return c
}

function build(kind, rec, data) {
  const seed = { dealId: null, quotationId: null, salesOrderId: null, projectId: null, [{ deal: 'dealId', quotation: 'quotationId', order: 'salesOrderId', project: 'projectId' }[kind]]: rec.id }
  const chain = resolveChain(seed, data)
  const customer = data.customers.find((x) => x.id === chain.customerId)
  const deal = data.deals.find((x) => x.id === chain.dealId)
  const so = data.salesOrders.find((x) => x.id === chain.salesOrderId)
  const q = data.quotations.find((x) => x.id === chain.quotationId)
  const project = data.projects.find((x) => x.id === chain.projectId)
  const product = data.products.find((p) => p.id === (project?.productIds?.[0] || deal?.productId || so?.items?.[0]?.productId))
  const type = TYPE_BY_PROJECT[project?.projectType] || TYPE_BY_CATEGORY[product?.category] || 'Service Agreement'
  const value = so ? orderValue(so) : project?.value || q?.subtotal || deal?.value || ''
  const start = project?.startDate && project.startDate >= todayKey() ? project.startDate : todayKey()
  const end = project?.deadline && project.deadline > start ? addMonthsKey(project.deadline, 0) : addMonthsKey(start, 12)
  const f = {
    ...blank(project?.manager || deal?.salesperson || so?.salesperson || q?.assignedTo || customer?.accountManager || ''),
    ...chain, customerName: customer?.name || so?.customerName || q?.customerName || deal?.companyName || '', contractType: type, title: `${type} — ${customer?.name || deal?.companyName || ''}`,
    value, startDate: start, endDate: end, paymentTerms: so?.paymentTerms || q?.paymentTerms || project?.billing?.paymentTerms || '30 days from the invoice date',
    scope: project?.description || deal?.requirement || so?.notes || q?.requirement || '', billingFrequency: project ? 'Milestone-based' : 'Quarterly',
  }
  f.renewalDate = addDaysKey(f.endDate, -Number(f.noticePeriodDays || 30))
  return f
}

/** Create a contract from a deal / quotation / sales order / project (everything inherited by ID), manually, or edit an existing one. */
export function ContractFormDialog({ open, onClose, contract, data, preset, onSaved }) {
  const { toast } = useToast()
  const { types } = useContractSettings()
  const { user, can } = useContractAccess(data.projects)
  const editing = !!contract
  const perms = can(contract)
  const [mode, setMode] = useState('deal')
  const [sourceId, setSourceId] = useState('')
  const [f, setF] = useState(() => blank())
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  const used = (key, id) => data.contracts.some((c) => c[key] === id && !['Cancelled', 'Renewed', 'Terminated'].includes(c.status))
  const lists = useMemo(() => ({
    deal: data.deals.filter((d) => d.stage === 'Closed Won' && !used('dealId', d.id)),
    quotation: data.quotations.filter((q) => q.status === 'Accepted' && !used('quotationId', q.id)),
    order: data.salesOrders.filter((s) => SO_READY.includes(s.status) && !used('salesOrderId', s.id)),
    project: data.projects.filter((p) => p.status !== 'Cancelled' && !data.contracts.some((c) => c.projectId === p.id && !['Cancelled', 'Renewed', 'Terminated'].includes(c.status))),
  }), [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setSourceId('')
    if (contract) { setF({ ...blank(), ...contract, value: contract.value ?? '' }); return }
    const pre = preset && (preset.salesOrderId ? ['order', data.salesOrders.find((s) => s.id === preset.salesOrderId)] : preset.quotationId ? ['quotation', data.quotations.find((q) => q.id === preset.quotationId)] : preset.projectId ? ['project', data.projects.find((p) => p.id === preset.projectId)] : preset.dealId ? ['deal', data.deals.find((d) => d.id === preset.dealId)] : null)
    if (pre?.[1]) { setMode(pre[0]); setSourceId(pre[1].id); setF(build(pre[0], pre[1], data)); return }
    setMode(Object.keys(lists).find((k) => lists[k].length) || (perms.manual ? 'manual' : 'deal'))
    setF(blank(user?.id))
  }, [open, contract?.id, data.customers.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id) => { setSourceId(id); setF(id ? build(mode, data[{ deal: 'deals', quotation: 'quotations', order: 'salesOrders', project: 'projects' }[mode]].find((r) => r.id === id), data) : blank(user?.id)) }
  const switchMode = (m) => { setMode(m); setSourceId(''); setF(blank(user?.id)); setErrors({}); setError('') }
  const customer = data.customers.find((c) => c.id === f.customerId)
  const contacts = data.contacts.filter((c) => c.companyId === (f.companyId || customer?.companyId))
  const locked = !editing && mode !== 'manual'
  const setNotice = (n) => set({ noticePeriodDays: n, ...(f.endDate ? { renewalDate: addDaysKey(f.endDate, -(Number(n) || 0)) } : {}) })
  const setEnd = (d) => set({ endDate: d, ...(d ? { renewalDate: addDaysKey(d, -(Number(f.noticePeriodDays) || 0)) } : {}) })
  const toggleTeam = (id) => set({ team: f.team.includes(id) ? f.team.filter((x) => x !== id) : [...f.team, id] })
  const chainChips = [['Deal', data.deals.find((d) => d.id === f.dealId)?.name], ['Proposal', data.proposals.find((p) => p.id === f.proposalId)?.number], ['Quotation', data.quotations.find((q) => q.id === f.quotationId)?.number], ['Order', data.salesOrders.find((s) => s.id === f.salesOrderId)?.number], ['Project', data.projects.find((p) => p.id === f.projectId)?.name]].filter(([, v]) => v)

  const submit = () => {
    const input = { ...f, customerName: customer?.name || f.customerName, companyId: f.companyId || customer?.companyId || '' }
    const e = validateContractInput(input)
    if (!editing && mode !== 'manual' && !sourceId) e.source = `Choose the ${SOURCES.find(([k]) => k === mode)[1].toLowerCase()} to start from.`
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({}); setError(''); setSaving(true)
    if (editing) {
      const patch = { ...input, value: perms.viewFinancial ? Number(input.value) || 0 : contract.value, noticePeriodDays: Number(input.noticePeriodDays) || 0, team: [...new Set([input.owner, ...(input.team || [])])] }
      saveContract(contract, patch)
        .then((r) => { toast('Contract updated.', { type: 'success' }); onSaved?.(r); onClose() }).catch((err) => setError(errText(err))).finally(() => setSaving(false))
      return
    }
    createContract(input, { source: mode === 'manual' ? 'manual' : `${SOURCES.find(([k]) => k === mode)[1].toLowerCase()} ${sourceId}` })
      .then((r) => { toast(`Contract ${r.number} created.`, { type: 'success' }); emitContractsChanged(); onSaved?.(r); onClose() }).catch((err) => setError(errText(err))).finally(() => setSaving(false))
  }

  return (
    <Modal open={open} onClose={onClose} size="xl" title={editing ? `Edit ${contract.number}` : 'New contract'}
      description={editing ? 'Every change is written to the contract’s audit history.' : 'Start from a sale — the customer, contact, deal, quotation, order and project are linked for you.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Create contract'}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</p>}
        {!editing && (
          <div>
            <div className="flex flex-wrap gap-1 rounded-lg bg-ink-50 p-1 text-xs font-medium dark:bg-ink-800/50" role="tablist" aria-label="Start from">
              {[...SOURCES.map(([k, l]) => [k, `${l} (${lists[k].length})`]), ...(perms.manual ? [['manual', 'Manual']] : [])].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => switchMode(k)} className={clsx('flex-1 whitespace-nowrap rounded-md px-3 py-1.5', mode === k ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50' : 'text-ink-500')}>{l}</button>)}
            </div>
            {mode !== 'manual' && (
              <FormField label={SOURCES.find(([k]) => k === mode)[1]} required error={errors.source} className="mt-3" hint="Only records that do not already have an open contract are listed.">
                <Select aria-label="Source record" value={sourceId} onChange={(e) => pick(e.target.value)}>
                  <option value="">Choose…</option>
                  {lists[mode].map((r) => <option key={r.id} value={r.id}>{mode === 'deal' ? `${r.name} · ${formatCurrency(r.value)}` : mode === 'quotation' ? `${r.number} · ${r.customerName} · ${formatCurrency(r.amount)}` : mode === 'order' ? `${r.number} · ${r.customerName} · ${formatCurrency(r.amount)}` : `${r.id} · ${r.name}`}</option>)}
                </Select>
              </FormField>
            )}
            {mode !== 'manual' && !lists[mode].length && <p className="mt-2 text-xs text-ink-400">Nothing is waiting for a contract here.</p>}
          </div>
        )}
        {chainChips.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-medium text-ink-400">Linked</span>{chainChips.map(([l, v]) => <span key={l} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{l}</span> {v}</span>)}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Contract title" required error={errors.title} className="sm:col-span-2"><Input autoFocus={editing} value={f.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} maxLength={160} /></FormField>
          <FormField label="Contract type" required error={errors.contractType}><Select value={f.contractType} onChange={(e) => set({ contractType: e.target.value })}><option value="">Choose…</option>{[...new Set([...types, f.contractType].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}</Select></FormField>
          <FormField label="Customer" required error={errors.customerId} hint={locked || (editing && (contract.salesOrderId || contract.dealId || contract.quotationId)) ? 'From the linked sale.' : undefined}>
            <Select value={f.customerId} disabled={locked || (editing && (contract.salesOrderId || contract.dealId || contract.quotationId))} onChange={(e) => { const c = data.customers.find((x) => x.id === e.target.value); set({ customerId: e.target.value, customerName: c?.name || '', companyId: c?.companyId || '', contactId: '' }) }}>
              <option value="">Choose…</option>{data.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Primary contact"><Select value={f.contactId || ''} onChange={(e) => set({ contactId: e.target.value })}><option value="">None</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          <FormField label="Contract owner" required error={errors.owner} hint={editing && !perms.assign ? 'Only an admin or sales manager can reassign.' : undefined}><Select value={f.owner} disabled={editing && !perms.assign} onChange={(e) => set({ owner: e.target.value })}><option value="">Choose…</option>{USERS.filter((u) => u.status !== 'Inactive').map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</Select></FormField>
          {(!editing || perms.viewFinancial) && <FormField label="Contract value (₹)" required error={errors.value}><Input type="number" min="0" value={f.value} error={errors.value} onChange={(e) => set({ value: e.target.value })} /></FormField>}
          <FormField label="Billing frequency"><Select value={f.billingFrequency} onChange={(e) => set({ billingFrequency: e.target.value })}>{BILLING_FREQUENCIES.map((b) => <option key={b}>{b}</option>)}</Select></FormField>
          <FormField label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} /></FormField>
          <FormField label="Start date" required error={errors.startDate}><Input type="date" value={f.startDate?.slice(0, 10)} error={errors.startDate} onChange={(e) => set({ startDate: e.target.value })} /></FormField>
          <FormField label="End date" required error={errors.endDate}><Input type="date" value={f.endDate?.slice(0, 10)} error={errors.endDate} onChange={(e) => setEnd(e.target.value)} /></FormField>
          <FormField label="Notice period (days)" error={errors.noticePeriodDays}><Input type="number" min="0" max="365" value={f.noticePeriodDays} onChange={(e) => setNotice(e.target.value)} /></FormField>
          <FormField label="Renewal date" error={errors.renewalDate} hint="Defaults to the end of the notice window."><Input type="date" value={f.renewalDate?.slice(0, 10) || ''} error={errors.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} /></FormField>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" checked={!!f.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-brand-600" /> Auto-renews at the end of the term</label>

        <FormField label="Assigned team" hint="Team members can see and work on the contract."><div className="scrollbar-thin grid max-h-36 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-ink-100 p-2 sm:grid-cols-2 dark:border-ink-800">
          {USERS.filter((u) => u.status !== 'Inactive' && u.id !== f.owner).map((u) => { const on = (f.team || []).includes(u.id); return (
            <button key={u.id} type="button" aria-pressed={on} onClick={() => toggleTeam(u.id)} className={clsx('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink-50 dark:hover:bg-ink-800', on && 'bg-brand-50/60 dark:bg-brand-900/20')}>
              <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-ink-600')}>{on && <Check size={11} />}</span><span className="min-w-0 flex-1 truncate text-ink-800 dark:text-ink-100">{u.name}</span><span className="shrink-0 text-ink-400">{u.role}</span>
            </button>) })}
        </div></FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Scope / description" error={errors.scope}><Textarea value={f.scope} onChange={(e) => set({ scope: e.target.value })} className="min-h-[96px]" /></FormField>
          <FormField label="Terms & conditions"><Textarea value={f.terms} onChange={(e) => set({ terms: e.target.value })} className="min-h-[96px]" /></FormField>
          <FormField label="Renewal terms"><Textarea value={f.renewalTerms} onChange={(e) => set({ renewalTerms: e.target.value })} className="min-h-[72px]" /></FormField>
          <FormField label="Internal notes" hint="Never shown to the client."><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[72px]" /></FormField>
        </div>
        {!editing && f.startDate && <p className="text-xs text-ink-400">Starts {formatDate(f.startDate)} · ends {formatDate(f.endDate)} · created as <b>Draft</b>; it then goes through review and approval.</p>}
      </form>
    </Modal>
  )
}
