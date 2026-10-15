import { useOptions } from '../../hooks/useOptions'
import { useEffect, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { todayKey } from '../../utils/marketingRules'
import { createCampaign, updateCampaign, useMarketingConfig, mkErr, mkFields } from '../Marketing/marketingClient'

const blank = (me) => ({ name: '', type: '', channel: '', startDate: todayKey(), endDate: '', budget: '', targetLeads: '', targetAudience: '', description: '', ownerId: me || '', team: [], leadSourceId: '', productIds: [] })

/** Create / edit a campaign. Results (leads, deals, customers, revenue, ROI) are never typed — they are computed from the CRM records attributed to the campaign. */
export function CampaignFormDialog({ open, onClose, campaign = null, onSaved }) {
  const { toast } = useToast()
  const channelOptions = useOptions('campaign_channels', campaign?.channel)
  const { types, sources, user } = useMarketingConfig()
  const [f, setF] = useState(blank(''))
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [products, setProducts] = useState([])
  const [requestId, setRequestId] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setRequestId(`REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`)
    setF(campaign ? { ...blank(''), ...Object.fromEntries(Object.keys(blank('')).map((k) => [k, campaign[k] ?? blank('')[k]])), budget: campaign.budget ?? '', targetLeads: campaign.targetLeads ?? '' } : blank(user?.id))
    api.get('/products', { params: { all: true } }).then((r) => setProducts((r.data || []).filter((p) => p.status !== 'Inactive'))).catch(() => {})
  }, [open, campaign?.id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  const editAll = !campaign || campaign.actions?.editAll
  const channels = channelOptions.values
  const toggle = (k, id) => set({ [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] })
  const save = () => {
    if (busy) return
    setBusy(true); setError(''); setErrors({})
    const payload = { ...f, budget: Number(f.budget || 0), targetLeads: Number(f.targetLeads || 0), requestId }
    ;(campaign ? updateCampaign(campaign.id, payload) : createCampaign(payload)).then((c) => { toast(campaign ? 'Campaign updated.' : `Campaign ${c.number} created as a draft.`, { type: 'success' }); onSaved?.(c); onClose() }).catch((e) => { setErrors(mkFields(e)); setError(mkErr(e)) }).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="xl" title={campaign ? `Edit ${campaign.number}` : 'New campaign'} description={editAll ? 'A new campaign starts as a draft. Leads attributed to it are counted automatically — nothing about results is typed here.' : 'This campaign is scheduled or running: type, channel, dates and source are fixed so attribution stays correct.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{campaign ? 'Save changes' : 'Create campaign'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <FormField label="Campaign name" required error={errors.name} className="sm:col-span-2"><Input aria-label="Campaign name" value={f.name} onChange={(e) => set({ name: e.target.value })} error={!!errors.name} /></FormField>
        <FormField label="Campaign type" required error={errors.type}><Select aria-label="Campaign type" disabled={!editAll} value={f.type} onChange={(e) => set({ type: e.target.value })}><option value="">Select a type</option>{types.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
        <FormField label="Marketing channel" required error={errors.channel}><Select aria-label="Marketing channel" disabled={!editAll} value={f.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">Select a channel</option>{channels.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
        <FormField label="Lead source" required error={errors.leadSourceId} hint="Leads this campaign generates are tagged with this source."><Select aria-label="Lead source" disabled={!editAll} value={f.leadSourceId} onChange={(e) => set({ leadSourceId: e.target.value })}><option value="">Select a source</option>{sources.filter((s) => s.active || s.id === campaign?.leadSourceId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
        <FormField label="Campaign owner" required error={errors.ownerId}><Select aria-label="Campaign owner" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>{USERS.filter((u) => u.status !== 'Inactive').map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</Select></FormField>
        <FormField label="Start date" required error={errors.startDate}><Input aria-label="Start date" type="date" disabled={!editAll} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></FormField>
        <FormField label="End date" required error={errors.endDate}><Input aria-label="End date" type="date" value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} error={!!errors.endDate} /></FormField>
        <FormField label="Budget (₹)" error={errors.budget} hint="The plan. Actual spend is recorded as it happens."><Input aria-label="Budget" type="number" min="0" value={f.budget} onChange={(e) => set({ budget: e.target.value })} /></FormField>
        <FormField label="Target leads" hint="A goal to compare against — not a result."><Input aria-label="Target leads" type="number" min="0" value={f.targetLeads} onChange={(e) => set({ targetLeads: e.target.value })} /></FormField>
        <FormField label="Target audience" className="sm:col-span-2"><Input aria-label="Target audience" value={f.targetAudience} onChange={(e) => set({ targetAudience: e.target.value })} placeholder="e.g. Mid-size manufacturers in South India" /></FormField>
        <FormField label="Description" className="sm:col-span-2"><Textarea aria-label="Description" value={f.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[70px]" /></FormField>
        <div className="sm:col-span-2"><p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">Assigned team</p><div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{USERS.filter((u) => u.status !== 'Inactive' && ['Marketing', 'Sales Manager', 'Sales Executive', 'Admin'].includes(u.role)).map((u) => <button key={u.id} type="button" aria-pressed={f.team.includes(u.id)} onClick={() => toggle('team', u.id)} className={`rounded-full border px-2.5 py-1 text-xs ${f.team.includes(u.id) ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'}`}>{u.name}</button>)}</div></div>
        <div className="sm:col-span-2"><p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">Products / services promoted</p><div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{products.map((p) => <button key={p.id} type="button" aria-pressed={f.productIds.includes(p.id)} onClick={() => toggle('productIds', p.id)} className={`rounded-full border px-2.5 py-1 text-xs ${f.productIds.includes(p.id) ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20' : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300'}`}>{p.name}</button>)}{!products.length && <span className="text-xs text-ink-400">No products in the catalogue.</span>}</div></div>
      </div>
    </Modal>
  )
}
