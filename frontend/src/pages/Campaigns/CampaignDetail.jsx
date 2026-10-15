import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, PlayCircle, PauseCircle, CheckCircle2, Ban, Trash2, CalendarClock, IndianRupee, StickyNote, ListPlus, CalendarPlus, UploadCloud, FileX2, History, UserPlus, Link2 } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { FormField, Input, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { todayKey } from '../../utils/marketingRules'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { LogActivityDialog } from '../Activities/LogActivityDialog'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { ReasonDialog } from '../Invoices/InvoiceDialogs'
import { CampaignFormDialog } from './CampaignFormDialog'
import { Funnel, TrendChart, fmtMoney, fmtPct } from '../Marketing/MarketingCharts'
import { fetchCampaign, campaignAction, deleteCampaign, mkErr, mkFields, emitMarketingChanged } from '../Marketing/marketingClient'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const Stat = ({ label, value, tone, sub }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p>{sub && <p className="text-[11px] text-ink-400">{sub}</p>}</div>
const TONE = { Created: 'bg-brand-50 text-brand-600', Started: 'bg-emerald-50 text-emerald-600', Paused: 'bg-amber-50 text-amber-600', Resumed: 'bg-emerald-50 text-emerald-600', Completed: 'bg-sky-50 text-sky-600', Cancelled: 'bg-rose-50 text-rose-600', LeadGenerated: 'bg-violet-50 text-violet-600', DealCreated: 'bg-sky-50 text-sky-600', CustomerConverted: 'bg-emerald-50 text-emerald-600', SpendRecorded: 'bg-amber-50 text-amber-600' }

function SpendDialog({ campaign, onClose, onDone }) {
  const [f, setF] = useState({ amount: '', date: todayKey(), note: '' }); const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const go = () => { setBusy(true); setError(''); campaignAction(campaign.id, 'spend', { ...f, amount: Number(f.amount) }).then((d) => { onDone('Spend recorded.', d); onClose() }).catch((e) => { setErrors(mkFields(e)); setError(mkErr(e)) }).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title={`Record spend — ${campaign.number}`} description="Actual money spent on this campaign. It counts towards cost per lead and ROI." footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button loading={busy} onClick={go}>Record spend</Button></>}>
      <div className="space-y-3">{error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <FormField label="Amount (₹)" required error={errors.amount}><Input aria-label="Spend amount" type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
        <FormField label="Date" required error={errors.date}><Input aria-label="Spend date" type="date" min={campaign.startDate} max={todayKey()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="What was it for?" required error={errors.note}><Input aria-label="Spend note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Google Ads — week 1" /></FormField></div>
    </Modal>
  )
}

function AttachLeadDialog({ campaign, onClose, onDone }) {
  const [leads, setLeads] = useState([]); const [id, setId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/leads', { params: { all: true } }).then((r) => setLeads((r.data || []).filter((l) => !l.campaignId && !['Converted', 'Lost', 'Unqualified'].includes(l.status)))).catch(() => {}) }, [])
  const go = () => { setBusy(true); setError(''); api.post(`/campaigns/${campaign.id}/attach-lead`, { leadId: id }).then(() => { emitMarketingChanged(); onDone('Lead attributed to the campaign — it was reused, not duplicated.'); onClose() }).catch((e) => setError(mkErr(e))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title="Attribute an existing lead" description="Only leads with no campaign can be attached. A lead keeps its original campaign and source — attribution is never overwritten." footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button loading={busy} disabled={!id} onClick={go}>Attribute lead</Button></>}>
      <div className="space-y-3">{error && <p role="alert" className="text-sm text-rose-500">{error}</p>}<FormField label="Lead"><Select aria-label="Lead" value={id} onChange={(e) => setId(e.target.value)}><option value="">Select a lead</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.company} ({l.status})</option>)}</Select></FormField></div>
    </Modal>
  )
}

export default function CampaignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [c, setC] = useState(null)
  const [state, setState] = useState('loading')
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([]); const [tasks, setTasks] = useState([]); const [events, setEvents] = useState([])
  const [dlg, setDlg] = useState(null); const [uploadOpen, setUploadOpen] = useState(false)
  const { docs } = useDocuments({ relatedType: 'Campaign', relatedId: id })

  const load = useCallback(() => {
    fetchCampaign(id).then((d) => { setC(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data.filter((a) => (a.relatedType === 'Campaign' && a.relatedId === id) || a.links?.campaignId === id))).catch(() => {})
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks((r.data.items || r.data).filter((t) => t.links?.campaignId === id || (t.relatedType === 'Campaign' && t.relatedId === id)))).catch(() => {})
    api.get('/calendar/events').then((r) => setEvents((r.data.events || []).filter((e) => (e.relatedType === 'Campaign' && e.relatedId === id) || e.related?.some((x) => x.type === 'Campaign' && x.id === id)))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const ev = ['crm:marketing-changed', 'crm:tasks-changed', 'crm:documents-changed', 'crm:invoices-changed', 'crm:expenses-changed']; const h = () => load(); ev.forEach((e) => window.addEventListener(e, h)); return () => ev.forEach((e) => window.removeEventListener(e, h)) }, [load])

  const timeline = useMemo(() => {
    if (!c) return []
    const out = (c.timeline || []).map((e) => ({ key: e.id, at: e.at, type: e.type, text: e.text, note: e.details, by: e.by, byName: e.byName, href: e.href }))
    activities.filter((a) => !a.campaignEvent && a.source !== 'task').forEach((a) => out.push({ key: a.id, at: a.date, type: a.type === 'Note' ? 'Note' : 'Task', text: a.subject || a.type, note: a.notes, by: a.by }))
    tasks.forEach((t) => out.push({ key: `t-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy === 'SYSTEM' ? null : t.createdBy, byName: t.createdBy === 'SYSTEM' ? 'Campaign workflow' : null, href: `/tasks/${t.id}` }))
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [c, activities, tasks])

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !c) return <EmptyState icon={FileX2} title="Campaign not found" description="It may have been removed, or you may not have access to it." action={<Button variant="secondary" onClick={() => navigate('/campaigns')}>Back to campaigns</Button>} />

  const a = c.actions; const fin = !c.financialHidden
  const done = (m, d) => { if (m) toast(m, { type: 'success' }); if (d) setC(d); emitMarketingChanged(); load() }
  const fail = (e) => toast(mkErr(e), { type: 'error' })
  const close = () => setDlg(null)
  const run = (k, msg, payload) => campaignAction(c.id, k, payload).then((d) => done(msg, d)).catch(fail)
  const ref = { type: 'Campaign', id: c.id, label: `${c.number} · ${c.name}` }
  const preset = (title, extra = {}) => ({ title: `${title} — ${c.number}`, description: c.name, dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), assignees: [c.ownerId].filter(Boolean), ...extra })
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'performance', label: 'Performance' }, { value: 'related', label: 'Related records', count: c.leadsList.length + c.dealsList.length + c.customersList.length }, ...(fin ? [{ value: 'spend', label: 'Spend', count: (c.costs || []).length }] : []), { value: 'tasks', label: 'Tasks & activities', count: tasks.length }, { value: 'calendar', label: 'Calendar', count: events.length }, { value: 'documents', label: 'Documents', count: docs?.length || 0 }, { value: 'timeline', label: 'Timeline', count: timeline.length }]
  const overBudget = fin && c.budget > 0 && c.spend > c.budget
  const L = (p, t, k) => <Link key={k} to={p} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{t}</Link>

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Campaigns', href: '/campaigns' }, { label: c.number }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Link to="/campaigns" aria-label="Back to campaigns" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{c.name}</h1><StatusBadge status={c.status} /><Badge>{c.type}</Badge></div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-500">
              <span className="font-mono">{c.number}</span><span>Channel <b className="font-medium text-ink-800 dark:text-ink-100">{c.channel}</b></span>
              <span>Source <Link to={`/lead-sources/${c.leadSourceId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{c.leadSourceName}</Link></span>
              <span>Owner <b className="font-medium text-ink-800 dark:text-ink-100">{c.ownerName}</b></span><span>{formatDate(c.startDate)} – {formatDate(c.endDate)}</span>
            </div>
          </div>
          {fin && <dl className="grid w-full grid-cols-3 gap-4 rounded-2xl border border-ink-100 bg-white px-5 py-3 text-right shadow-card sm:w-auto dark:border-ink-800 dark:bg-ink-900"><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Budget</dt><dd className="text-lg font-bold">{fmtMoney(c.budget)}</dd></div><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Spend</dt><dd className={clsx('text-lg font-bold', overBudget && 'text-rose-600')}>{fmtMoney(c.spend)}</dd></div><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">ROI</dt><dd className={clsx('text-lg font-bold', c.roi === null ? '' : c.roi >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{c.roi === null ? '—' : `${c.roi >= 0 ? '+' : ''}${c.roi}%`}</dd></div></dl>}
        </div>
        <div className="flex flex-wrap gap-2">
          {a.edit && <Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button>}
          {a.schedule && <Button variant="secondary" icon={CalendarClock} onClick={() => run('schedule', 'Campaign scheduled.')}>Schedule</Button>}
          {a.start && <Button icon={PlayCircle} onClick={() => run('start', 'Campaign started.')}>Start campaign</Button>}
          {a.pause && <Button variant="secondary" icon={PauseCircle} onClick={() => setDlg('pause')}>Pause</Button>}
          {a.resume && <Button icon={PlayCircle} onClick={() => run('resume', 'Campaign resumed.')}>Resume</Button>}
          {a.complete && <Button variant="secondary" icon={CheckCircle2} onClick={() => run('complete', 'Campaign completed.')}>Complete</Button>}
          {a.recordSpend && fin && <Button variant="secondary" icon={IndianRupee} onClick={() => setDlg('spend')}>Record spend</Button>}
          {a.edit && ['Active', 'Paused', 'Completed'].includes(c.status) && <Button variant="ghost" icon={UserPlus} onClick={() => setDlg('attach')}>Attribute existing lead</Button>}
          <Button variant="ghost" icon={StickyNote} onClick={() => setDlg({ kind: 'log', type: 'Note' })}>Add note</Button>
          <Button variant="ghost" icon={CalendarPlus} onClick={() => setDlg({ kind: 'log', type: 'Meeting' })}>Schedule meeting</Button>
          <Button variant="ghost" icon={ListPlus} onClick={() => setDlg({ kind: 'task', preset: preset('Campaign task', { taskType: 'General' }) })}>Create task</Button>
          <Button variant="ghost" icon={UploadCloud} onClick={() => { setTab('documents'); setUploadOpen(true) }}>Upload document</Button>
          {a.cancel && <Button variant="ghost" icon={Ban} onClick={() => setDlg('cancel')}>Cancel</Button>}
          {a.deleteDraft && <Button variant="ghost" icon={Trash2} aria-label="Delete draft" onClick={() => setDlg('delete')} />}
        </div>
        {c.status === 'Scheduled' && c.startDate <= todayKey() && <p className="rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-900/20 dark:text-sky-200">The start date has arrived. The campaign stays Scheduled until someone starts it.</p>}
        {c.status === 'Active' && c.endDate < todayKey() && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">The end date has passed but the campaign is still Active — complete it when it is finished.</p>}
        {overBudget && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Actual spend ({fmtMoney(c.spend)}) is over the budget ({fmtMoney(c.budget)}).</p>}
        {c.status === 'Cancelled' && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Cancelled{c.cancelReason ? `: ${c.cancelReason}` : ''}. Its leads and attribution stay on record.</p>}
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Card title="Campaign details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
            <KV k="Campaign ID"><span className="font-mono">{c.number}</span></KV><KV k="Status">{c.status}</KV><KV k="Type">{c.type}</KV><KV k="Marketing channel">{c.channel}</KV><KV k="Lead source">{c.leadSourceName}</KV><KV k="Start date">{formatDate(c.startDate)}</KV><KV k="End date">{formatDate(c.endDate)}</KV>
            {fin && <><KV k="Budget">{fmtMoney(c.budget)}</KV><KV k="Actual spend">{fmtMoney(c.spend)}</KV></>}<KV k="Target leads">{c.targetLeads || '—'}</KV><KV k="Target audience">{c.targetAudience || '—'}</KV><KV k="Owner">{c.ownerName}</KV><KV k="Assigned team">{c.teamNames.join(', ') || '—'}</KV><KV k="Products / services">{c.productNames.join(', ') || '—'}</KV><KV k="Created by">{getUserById(c.createdBy)?.name || 'Imported record'}</KV>{c.description && <KV k="Description">{c.description}</KV>}
          </dl></Card>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3"><Stat label="Leads" value={c.leads} sub={c.targetLeads ? `target ${c.targetLeads}` : null} /><Stat label="Qualified" value={c.qualifiedLeads} /><Stat label="Deals" value={c.deals} /><Stat label="Customers" value={c.customers} tone="emerald" />{fin && <><Stat label="Revenue collected" value={fmtMoney(c.collected)} tone="emerald" /><Stat label="ROI" value={c.roi === null ? '—' : `${c.roi}%`} tone={c.roi !== null && c.roi < 0 ? 'rose' : 'emerald'} /></>}</div>
            <Card title="Trace"><p className="text-xs text-ink-500">Campaign → {c.leadSourceName} → Lead → Deal → Customer → Invoice → Payment. Revenue counts only invoices of deals and customers that came from this campaign.</p></Card>
          </div>
        </div>
      )}

      {tab === 'performance' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Leads generated" value={c.leads} /><Stat label="Qualified leads" value={c.qualifiedLeads} sub={fmtPct(c.qualificationRate)} /><Stat label="Deals created" value={c.deals} sub={`${c.wonDeals} won`} /><Stat label="Customers" value={c.customers} tone="emerald" /><Stat label="Conversion rate" value={fmtPct(c.conversionRate)} sub="customers ÷ leads" />{fin && <Stat label="Cost per lead" value={fmtMoney(c.costPerLead)} />}</div>
          {fin && <div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Budget" value={fmtMoney(c.budget)} /><Stat label="Actual spend" value={fmtMoney(c.spend)} tone="amber" /><Stat label="Invoiced" value={fmtMoney(c.invoiced)} /><Stat label="Revenue collected" value={fmtMoney(c.collected)} tone="emerald" /><Stat label="Outstanding" value={fmtMoney(c.outstanding)} tone={c.outstanding > 0 ? 'rose' : null} /><Stat label="ROI" value={c.roi === null ? 'No spend yet' : `${c.roi}%`} tone={c.roi !== null && c.roi < 0 ? 'rose' : 'emerald'} sub={c.costPerCustomer ? `${fmtMoney(c.costPerCustomer)} per customer` : null} /></div>}
          <div className="grid gap-5 lg:grid-cols-2"><Card title="Conversion funnel"><Funnel steps={c.funnel} /></Card><Card title="Monthly trend"><TrendChart data={c.trend} lines={[{ key: 'leads', name: 'Leads' }, { key: 'customers', name: 'Customers' }]} /></Card></div>
          <p className="text-xs text-ink-400">ROI = (revenue collected − actual spend) ÷ actual spend. Budget is the plan and is never used as spend; ROI stays blank until spend is recorded.</p>
        </div>
      )}

      {tab === 'related' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={`Leads (${c.leadsList.length})`}>{!c.leadsList.length ? <p className="text-sm text-ink-400">No leads attributed yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{c.leadsList.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">{L(`/leads/${l.id}`, l.name, l.id)}<span className="flex items-center gap-2 text-xs text-ink-400">{l.company}<StatusBadge status={l.status} /></span></li>)}</ul>}</Card>
          <Card title={`Deals (${c.dealsList.length})`}>{!c.dealsList.length ? <p className="text-sm text-ink-400">No deals yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{c.dealsList.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">{L(`/deals/${d.id}`, d.name, d.id)}<span className="flex items-center gap-2 text-xs text-ink-400">{d.value !== null && formatCurrency(d.value, { compact: true })}<StatusBadge status={d.stage} /></span></li>)}</ul>}</Card>
          <Card title={`Customers (${c.customersList.length})`}>{!c.customersList.length ? <p className="text-sm text-ink-400">No customers acquired yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{c.customersList.map((x) => <li key={x.id} className="py-2 text-sm">{L(`/customers/${x.id}`, x.name, x.id)}</li>)}</ul>}</Card>
          <Card title={`Companies (${c.companiesList.length}) · Contacts (${c.contactsList.length})`}><ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{c.companiesList.map((x) => <li key={x.id} className="py-2 text-sm">{L(`/companies/${x.id}`, x.name, x.id)}</li>)}{c.contactsList.map((x) => <li key={x.id} className="py-2 text-sm">{L(`/contacts/${x.id}`, x.name, x.id)}</li>)}{!c.companiesList.length && !c.contactsList.length && <p className="text-sm text-ink-400">None yet.</p>}</ul></Card>
          <Card title={`Enquiries (${c.enquiriesList.length})`} className="lg:col-span-2">{!c.enquiriesList.length ? <p className="text-sm text-ink-400">No enquiries attributed.</p> : <ul className="grid gap-x-6 sm:grid-cols-2">{c.enquiriesList.map((x) => <li key={x.id} className="flex justify-between py-2 text-sm">{L(`/enquiries?open=${x.id}`, x.name, x.id)}<StatusBadge status={x.status} /></li>)}</ul>}</Card>
        </div>
      )}

      {tab === 'spend' && fin && (
        <Card title="Actual spend" action={a.recordSpend ? <Button size="sm" icon={IndianRupee} onClick={() => setDlg('spend')}>Record spend</Button> : null}>
          {!(c.costs || []).length ? <EmptyState icon={IndianRupee} title="No spend recorded" description="Record spend as it happens, or link approved expenses to this campaign (Expenses → Marketing campaign)." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2">Date</th><th className="pb-2">For</th><th className="pb-2">Recorded by</th><th className="pb-2 text-right">Amount</th></tr></thead>
              <tbody>{[...c.costs].sort((x, y) => String(y.date).localeCompare(String(x.date))).map((x) => <tr key={x.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2.5">{formatDate(x.date)}</td><td>{x.note}</td><td>{getUserById(x.by)?.name || 'Imported'}</td><td className="text-right font-medium">{formatCurrency(x.amount)}</td></tr>)}</tbody></table></div>
          )}
          <p className="mt-3 text-xs text-ink-400">Total actual spend {fmtMoney(c.spend)} includes approved expenses linked to this campaign. Spend lines are a financial record and cannot be edited.</p>
        </Card>
      )}

      {tab === 'tasks' && (
        <div className="space-y-5">
          <Card title="Campaign tasks" action={<Button size="sm" icon={ListPlus} onClick={() => setDlg({ kind: 'task', preset: preset('Campaign task', { taskType: 'General' }) })}>New task</Button>}>{!tasks.length ? <EmptyState icon={ListPlus} title="No tasks yet" description="Creating a campaign raises a planning task; starting it raises a review and a lead follow-up task." /> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul>}</Card>
          <Card title="Notes, meetings & follow-ups">{activities.filter((x) => !x.campaignEvent).length === 0 ? <p className="text-sm text-ink-400">Nothing logged yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{activities.filter((x) => !x.campaignEvent).map((x) => <li key={x.id} className="py-2.5 text-sm"><p className="font-medium">{x.subject}</p><p className="text-xs text-ink-400">{x.type} · {getUserById(x.by)?.name || '—'} · {timeAgo(x.date)}</p></li>)}</ul>}</Card>
        </div>
      )}

      {tab === 'calendar' && (
        <Card title="Calendar" action={<Link to={`/calendar?relatedType=Campaign&relatedId=${c.id}`} className="text-xs font-medium text-brand-600 hover:underline">Open in Calendar</Link>}>
          {!events.length ? <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Start / end dates, task due dates and meetings linked to this campaign appear here." /> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{[...events].sort((x, y) => String(x.date).localeCompare(String(y.date))).map((e) => <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="truncate">{e.title}</span><span className="shrink-0 text-xs text-ink-400">{formatDate(e.date)} · {e.state}</span></li>)}</ul>}
        </Card>
      )}

      {tab === 'documents' && <Card title="Creatives, brochures & campaign documents"><DocumentsPanel relatedType="Campaign" relatedId={c.id} defaultCategory="Reports" autoOpen={uploadOpen} canUploadHere={a.edit || false} uploadHint="Creatives, brochures, ad materials, campaign proposals and reports. Files are stored privately and only open for people allowed to see this campaign." /></Card>}

      {tab === 'timeline' && (
        <Card title="Campaign timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span><div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{(e.by && getUserById(e.by)?.name) || e.byName || 'Recorded from CRM data'} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div></li>)}
          </ol>
        </Card>
      )}

      <CampaignFormDialog open={dlg === 'edit'} onClose={close} campaign={c} onSaved={(d) => done(null, d)} />
      {dlg === 'spend' && <SpendDialog campaign={c} onClose={close} onDone={done} />}
      {dlg === 'attach' && <AttachLeadDialog campaign={c} onClose={close} onDone={done} />}
      <ReasonDialog open={dlg === 'pause'} onClose={close} title={`Pause ${c.number}?`} confirmLabel="Pause campaign" danger={false} hint="Tell the team why. Leads already attributed stay attributed." onConfirm={(r) => campaignAction(c.id, 'pause', { reason: r }).then((d) => { close(); done('Campaign paused.', d) })} />
      <ReasonDialog open={dlg === 'cancel'} onClose={close} title={`Cancel ${c.number}?`} confirmLabel="Cancel campaign" hint="It stays on record as Cancelled; its leads, deals and revenue keep their attribution." onConfirm={(r) => campaignAction(c.id, 'cancel', { reason: r }).then((d) => { close(); done('Campaign cancelled.', d) })} />
      <ConfirmDialog open={dlg === 'delete'} onClose={close} title={`Delete draft ${c.number}?`} description="Only a draft with no attributed records can be deleted; a record of the deletion stays in the audit log." confirmLabel="Delete draft" onConfirm={() => deleteCampaign(c.id).then(() => { toast('Draft deleted.', { type: 'success' }); navigate('/campaigns') }).catch((e) => { close(); fail(e) })} />
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={close} related={ref} preset={dlg.preset} onSaved={() => { toast('Task created and linked to the campaign.', { type: 'success' }); close(); load() }} />}
      {dlg?.kind === 'log' && <LogActivityDialog open onClose={close} presetType={dlg.type} related={ref} onLogged={() => { close(); load() }} />}
      <span className="hidden"><Link2 /></span>
    </div>
  )
}
