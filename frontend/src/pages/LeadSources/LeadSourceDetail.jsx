import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, FileX2, Plug, Plus, Trash2, Power } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { Modal } from '../../components/common/Modal'
import { useToast } from '../../context/ToastContext'
import { useBranch } from '../../context/BranchContext'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { TrendChart, fmtMoney, fmtPct } from '../Marketing/MarketingCharts'
import { fetchSource, useMarketingConfig, addMapping, updateMapping, removeMapping, mkErr, mkFields } from '../Marketing/marketingClient'
import { SourceFormDialog } from './LeadSources'
import { IntegrationBadge } from './IntegrationBadge'

const PROVIDERS = ['Meta Lead Ads', 'Google Ads lead forms', 'Website contact / enquiry form', 'Instagram messaging', 'Facebook messaging', 'WhatsApp Business', 'LinkedIn Lead Gen Forms', 'Other platform']
const Card = ({ title, children, className, action }) => <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}><header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header><div className="p-5">{children}</div></section>
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>
const A = ({ to, children }) => <Link to={to} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{children}</Link>
const Fact = ({ label, children }) => <div className="min-w-0"><dt className="text-xs text-ink-500">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-ink-900 dark:text-ink-50">{children || '—'}</dd></div>

/** Records WHERE a source's enquiries are expected to come from (platform, account / form name, branch). It holds no credentials and never sets a connection status: that is reported by the Integrations module. */
function MappingDialog({ source, mapping, onClose, onSaved }) {
  const { toast } = useToast()
  const { activeNames } = useBranch()
  const [f, setF] = useState({ provider: mapping?.provider || '', accountName: mapping?.accountName || '', mappedBranch: mapping?.mappedBranch || source.branch || '', notes: mapping?.notes || '' })
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const go = () => {
    setBusy(true); setErrors({}); setError('')
    const call = mapping ? updateMapping(source.id, mapping.id, f) : addMapping(source.id, f)
    call.then(() => { toast('Integration mapping saved.', { type: 'success' }); onSaved(); onClose() }).catch((e) => { setErrors(mkFields(e)); setError(mkErr(e)) }).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="md" title={mapping ? 'Edit integration mapping' : 'Add integration mapping'} description="Describes where enquiries from this source come from. Saving it does not connect anything." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save mapping</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && !Object.keys(errors).length && <p role="alert" className="text-sm text-rose-500 sm:col-span-2">{error}</p>}
        <FormField label="Platform" required error={errors.provider}><Select aria-label="Platform" value={f.provider} onChange={set('provider')} error={!!errors.provider}><option value="">Choose…</option>{PROVIDERS.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
        <FormField label="Mapped branch" error={errors.mappedBranch} hint={source.branch ? `This source belongs to ${source.branch}.` : 'Enquiries from this account / form are created in this branch.'}>
          <Select aria-label="Mapped branch" value={f.mappedBranch} onChange={set('mappedBranch')} disabled={!!source.branch} error={!!errors.mappedBranch}><option value="">Not mapped yet</option>{activeNames.map((b) => <option key={b}>{b}</option>)}</Select>
        </FormField>
        <FormField label="Account, page or form name" className="sm:col-span-2" error={errors.accountName}><Input aria-label="Account, page or form name" value={f.accountName} onChange={set('accountName')} maxLength={160} placeholder="For example: LAX360 Salem – Facebook page" /></FormField>
        <FormField label="Notes" className="sm:col-span-2"><Textarea aria-label="Notes" value={f.notes} onChange={set('notes')} maxLength={500} className="min-h-[64px]" /></FormField>
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600 sm:col-span-2 dark:bg-ink-800/50 dark:text-ink-300">Never enter passwords, access tokens or webhook secrets here. Credentials belong in the secure backend configuration of the Integrations module.</p>
      </div>
    </Modal>
  )
}

function IntegrationPanel({ s, onChange }) {
  const { toast } = useToast()
  const [dlg, setDlg] = useState(null); const [del, setDel] = useState(null); const [busy, setBusy] = useState(false)
  const can = s.perms.manageIntegrations
  const flip = (m) => updateMapping(s.id, m.id, { active: !m.active }).then(() => { toast(m.active ? 'Mapping switched off.' : 'Mapping switched on.', { type: 'success' }); onChange() }).catch((e) => toast(mkErr(e), { type: 'error' }))
  const drop = () => { setBusy(true); removeMapping(s.id, del.id).then(() => { toast('Mapping removed.', { type: 'success' }); setDel(null); onChange() }).catch((e) => toast(mkErr(e), { type: 'error' })).finally(() => setBusy(false)) }
  return (
    <Card title="Integration" className="lg:col-span-2" action={<div className="flex items-center gap-2"><IntegrationBadge status={s.integrationStatus} />{can && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setDlg({})}>Add mapping</Button>}</div>}>
      {!s.integrations.length ? (
        <div className="flex items-start gap-3 text-sm text-ink-500"><Plug size={18} className="mt-0.5 shrink-0 text-ink-400" /><p>No integration is connected to this source. Enquiries from it are entered by people{can ? ', or record the account or form that will feed it using “Add mapping”' : ''}. A connection is shown here only after the Integrations module reports it.</p></div>
      ) : (
        <div className="overflow-x-auto"><table className="crm-table w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800"><th className="py-2 pr-3">Platform</th><th className="pr-3">Account / form</th><th className="pr-3">Mapped branch</th><th className="pr-3">Status</th><th className="pr-3">Last successful sync</th><th className="pr-3">Latest error</th>{can && <th className="w-20"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{s.integrations.map((m) => (
            <tr key={m.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
              <td className="py-2.5 pr-3 font-medium">{m.provider}</td><td className="pr-3 text-ink-600 dark:text-ink-300">{m.accountName || '—'}</td><td className="pr-3">{m.mappedBranch || 'Not mapped'}</td>
              <td className="pr-3"><IntegrationBadge status={m.status} /></td><td className="pr-3 text-xs text-ink-500">{m.lastSyncAt ? formatDateTime(m.lastSyncAt) : 'Never'}</td><td className="max-w-56 pr-3 text-xs text-rose-600 dark:text-rose-400">{m.lastError || '—'}</td>
              {can && <td><div className="flex justify-end gap-0.5"><button type="button" aria-label={`Edit mapping ${m.provider}`} onClick={() => setDlg(m)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><Pencil size={14} /></button><button type="button" aria-label={`${m.active ? 'Switch off' : 'Switch on'} mapping ${m.provider}`} onClick={() => flip(m)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><Power size={14} /></button><button type="button" aria-label={`Remove mapping ${m.provider}`} onClick={() => setDel(m)} className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"><Trash2 size={14} /></button></div></td>}
            </tr>))}</tbody></table></div>
      )}
      {dlg && <MappingDialog source={s} mapping={dlg.id ? dlg : null} onClose={() => setDlg(null)} onSaved={onChange} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={drop} loading={busy} title="Remove this mapping?" description="Only the saved description is removed. Enquiries already received are not affected." confirmLabel="Remove" />
    </Card>
  )
}

export default function LeadSourceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { perms } = useMarketingConfig()
  const [s, setS] = useState(null); const [state, setState] = useState('loading'); const [edit, setEdit] = useState(false)
  const load = useCallback(() => fetchSource(id).then((d) => { setS(d); setState('ok') }).catch(() => setState('missing')), [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const h = () => load(); window.addEventListener('crm:marketing-changed', h); return () => window.removeEventListener('crm:marketing-changed', h) }, [load])
  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-72" /></div>
  if (state === 'missing' || !s) return <EmptyState icon={FileX2} title="Lead source not found" description="It may have been removed, or you may not have access." action={<Button variant="secondary" onClick={() => navigate('/lead-sources')}>Back to lead sources</Button>} />
  const fin = !s.financialHidden
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Lead Sources', href: '/lead-sources' }, { label: s.name }]} />
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Link to="/lead-sources" aria-label="Back" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{s.name}</h1><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge><Badge>{s.category}</Badge><Badge tone={s.scope === 'Common' ? 'neutral' : 'info'}>{s.scope}</Badge></div>{s.description && <p className="mt-1 text-sm text-ink-500">{s.description}</p>}</div>
        {s.perms.edit && <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}
      </div>
      <Card title="Source details" className="mb-5"><dl className="grid grid-cols-2 gap-4 md:grid-cols-4"><Fact label="Available to">{s.branch ? `${s.branch} branch only` : 'All branches'}</Fact><Fact label="How enquiries arrive">{`${s.sourceType} · ${s.captureMethod}`}</Fact><Fact label="Created by">{s.createdByName}</Fact><Fact label="Created">{s.createdAt ? formatDate(s.createdAt) : ''}</Fact><Fact label="Last updated">{s.updatedAt ? formatDate(s.updatedAt) : ''}</Fact><Fact label="In use">{s.used ? 'Yes — it cannot be deleted' : 'Not used yet'}</Fact><Fact label="Integration"><IntegrationBadge status={s.integrationStatus} /></Fact></dl></Card>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Enquiries" value={s.enquiryCount} /><Stat label="Converted to leads" value={s.convertedLeadCount} /><Stat label="Enquiry → lead rate" value={`${s.enquiryConversionRate}%`} /><Stat label="Total leads" value={s.leads} /><Stat label="Deals" value={s.deals} /><Stat label="Customers" value={s.customers} tone="emerald" /></div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Qualified" value={s.qualifiedLeads} /><Stat label="New" value={s.newLeads} /><Stat label="Contacted" value={s.contactedLeads} /><Stat label="Unqualified" value={s.unqualifiedLeads} /><Stat label="Lost" value={s.lostLeads} />{fin ? <Stat label="Revenue collected" value={fmtMoney(s.collected)} tone="emerald" /> : <Stat label="Lead conversion" value={fmtPct(s.conversionRate)} />}</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <IntegrationPanel s={s} onChange={load} />
        <Card title="Monthly leads & customers"><TrendChart data={s.trend} lines={[{ key: 'leads', name: 'Leads' }, { key: 'customers', name: 'Customers' }]} /></Card>
        <Card title={`Campaigns using this source (${s.campaigns.length})`}>{!s.campaigns.length ? <p className="text-sm text-ink-400">No campaign uses this source.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{s.campaigns.map((c) => <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm"><A to={`/campaigns/${c.id}`}>{c.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{c.leads} leads<StatusBadge status={c.status} />{fin && c.roi !== null && <b className={c.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{c.roi}%</b>}</span></li>)}</ul>}</Card>
        <Card title={`Leads (${s.leadsList.length})`}>{!s.leadsList.length ? <p className="text-sm text-ink-400">No leads from this source.</p> : <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto dark:divide-ink-800/60">{s.leadsList.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm"><A to={`/leads/${l.id}`}>{l.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{l.campaign || 'No campaign'} · {formatDate(l.createdDate)}<StatusBadge status={l.status} /></span></li>)}</ul>}</Card>
        <Card title={`Deals (${s.dealsList.length}) · Customers (${s.customersList.length})`}><ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto dark:divide-ink-800/60">{s.dealsList.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm"><A to={`/deals/${d.id}`}>{d.name}</A><span className="flex items-center gap-2 text-xs text-ink-400">{d.value !== null && formatCurrency(d.value, { compact: true })}<StatusBadge status={d.stage} /></span></li>)}{s.customersList.map((c) => <li key={c.id} className="py-2 text-sm"><A to={`/customers/${c.id}`}>{c.name}</A></li>)}{!s.dealsList.length && !s.customersList.length && <p className="text-sm text-ink-400">No deals or customers yet.</p>}</ul></Card>
      </div>
      {edit && perms.manageSources && <SourceFormDialog source={s} onClose={() => setEdit(false)} onSaved={load} />}
    </div>
  )
}
