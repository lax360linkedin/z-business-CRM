import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Download, Megaphone, PlayCircle, CheckCircle2, Wallet, IndianRupee, Users, UserCheck, Percent, Handshake, TrendingUp, Receipt, Target, AlertTriangle, X, Trophy } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { LEAD_STATUSES, DEAL_STAGES } from '../../data/constants'
import { CAMPAIGN_STATUSES } from '../../utils/marketingRules'
import { formatCurrency } from '../../utils/format'
import { downloadBlob } from '../Invoices/invoiceClient'
import { useAnalytics, useMarketingConfig, exportMarketing, mkErr } from '../Marketing/marketingClient'
import { Funnel, TrendChart, RankBars, SpendVsRevenue, ComparisonBars, fmtMoney, fmtPct } from '../Marketing/MarketingCharts'

const EMPTY = { from: '', to: '', campaignId: '', leadSourceId: '', channel: '', campaignStatus: '', leadStatus: '', dealStage: '', owner: '', team: '', product: '', customerId: '', companyId: '' }
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' }
const Card = ({ title, children, className, sub }) => <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{sub && <p className="mb-3 text-xs text-ink-400">{sub}</p>}<div className={sub ? '' : 'mt-3'}>{children}</div></section>
const th = 'px-3 py-2.5 text-right'

export default function MarketingAnalytics() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { perms, channels } = useMarketingConfig()
  const [f, setF] = useState(EMPTY)
  const [lookups, setLookups] = useState({ customers: [], companies: [], products: [], campaigns: [], sources: [] })
  const clean = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f])
  const { data, error, reload } = useAnalytics(clean)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => {
    Promise.all([api.get('/customers', { params: { all: true } }), api.get('/companies', { params: { all: true } }), api.get('/products', { params: { all: true } }), api.get('/campaigns', { params: { all: true } }).catch(() => ({ data: [] })), api.get('/lead-sources').catch(() => ({ data: [] }))])
      .then(([c, co, p, cm, s]) => setLookups({ customers: c.data, companies: co.data, products: p.data, campaigns: cm.data, sources: s.data })).catch(() => {})
  }, [])
  const depts = useMemo(() => [...new Set(USERS.map((u) => u.department).filter(Boolean))].sort(), [])
  const active = Object.keys(clean).length
  const exportCsv = (type) => exportMarketing(type, clean).then((csv) => { downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `marketing-${type}.csv`); toast('Report exported.', { type: 'success' }) }).catch((e) => toast(mkErr(e), { type: 'error' }))

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load marketing analytics" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const t = data?.totals; const fin = data && !data.financialHidden
  const money = (v) => (fin ? fmtMoney(v) : '—')
  const cards = t ? [['Total campaigns', t.totalCampaigns, Megaphone, 'brand'], ['Active campaigns', t.activeCampaigns, PlayCircle, 'emerald'], ['Completed', t.completedCampaigns, CheckCircle2, 'sky'], ['Marketing budget', money(t.budget), Wallet, 'violet'], ['Actual spend', money(t.spend), IndianRupee, 'amber'], ['Total leads', t.leads, Users, 'brand'], ['Qualified leads', t.qualifiedLeads, UserCheck, 'emerald'], ['Conversion rate', fmtPct(t.conversionRate), Percent, 'sky'], ['Deals created', t.deals, Handshake, 'violet'], ['Customers acquired', t.customers, UserCheck, 'emerald'], ['Revenue collected', money(t.collected), IndianRupee, 'emerald'], ['Outstanding revenue', money(t.outstanding), Receipt, 'rose'], ['Cost per lead', money(t.costPerLead), Target, 'amber'], ['Cost per customer', money(t.costPerCustomer), Target, 'amber'], ['Campaign ROI', fin ? (t.roi === null ? '—' : `${t.roi}%`) : '—', TrendingUp, t.roi !== null && t.roi < 0 ? 'rose' : 'emerald']] : []
  const srcs = data?.sources || []; const cmps = data?.campaigns || []
  const best = (list, k, label) => { const r = [...list].filter((x) => (x[k] ?? 0) > 0).sort((a, b) => b[k] - a[k])[0]; return r ? { label, name: r.name, value: r[k] } : null }
  const insights = data ? [best(srcs, 'leads', 'Most leads'), best(srcs.filter((s) => s.leads >= 3), 'qualificationRate', 'Best lead quality (qualified %)'), best(srcs, 'customers', 'Most customers'), fin ? best(srcs, 'collected', 'Most revenue') : null, best(srcs.filter((s) => s.leads >= 3), 'conversionRate', 'Highest conversion rate')].filter(Boolean) : []
  const Sel = ({ label, k, list }) => <label className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })}><option value="">All</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>

  return (
    <div>
      <PageHeader title="Marketing Analytics" description="One analytics layer over campaigns, lead sources, leads, deals, customers, invoices and payments — every figure is computed live from those records." actions={perms.export ? <><Button variant="secondary" icon={Download} onClick={() => exportCsv('campaigns')}>Export campaigns</Button><Button variant="secondary" icon={Download} onClick={() => exportCsv('sources')}>Export sources</Button></> : null} />
      <div className="mb-5 rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-ink-500">From<input aria-label="From date" type="date" className={clsx(sel, 'mt-1')} value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="text-xs font-medium text-ink-500">To<input aria-label="To date" type="date" className={clsx(sel, 'mt-1')} value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
          <Sel label="Campaign" k="campaignId" list={lookups.campaigns.map((c) => [c.id, c.name])} /><Sel label="Lead source" k="leadSourceId" list={lookups.sources.map((s) => [s.id, s.name])} />
          <Sel label="Channel" k="channel" list={channels.map((c) => [c, c])} /><Sel label="Campaign status" k="campaignStatus" list={CAMPAIGN_STATUSES.map((s) => [s, s])} /><Sel label="Lead status" k="leadStatus" list={LEAD_STATUSES.map((s) => [s, s])} /><Sel label="Deal stage" k="dealStage" list={DEAL_STAGES.map((s) => [s, s])} />
          <Sel label="Owner" k="owner" list={USERS.filter((u) => u.status !== 'Inactive').map((u) => [u.id, u.name])} /><Sel label="Team" k="team" list={depts.map((d) => [d, d])} /><Sel label="Product / service" k="product" list={lookups.products.map((p) => [p.id, p.name])} /><Sel label="Customer" k="customerId" list={lookups.customers.map((c) => [c.id, c.name])} />
          <Sel label="Company" k="companyId" list={lookups.companies.map((c) => [c.id, c.name])} />
          <div className="flex items-end">{active > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear {active} filter{active > 1 ? 's' : ''}</Button>}</div>
        </div>
      </div>
      {!data ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map(([label, value, Icon, tone]) => <div key={label} className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div><p className="mt-1.5 break-words text-lg font-bold text-ink-900 dark:text-ink-50">{value}</p></div>)}
          </div>
          {insights.length > 0 && <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{insights.map((i) => <div key={i.label} className="rounded-xl border border-brand-100 bg-brand-50/50 p-3 dark:border-brand-900/40 dark:bg-brand-900/10"><p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300"><Trophy size={12} />{i.label}</p><p className="mt-1 text-sm font-bold text-ink-900 dark:text-ink-50">{i.name}</p><p className="text-xs text-ink-500">{typeof i.value === 'number' && i.label.includes('%') ? `${i.value}%` : i.label.includes('revenue') ? fmtMoney(i.value) : i.label.includes('rate') ? `${i.value}%` : i.value}</p></div>)}</div>}
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card title="Conversion funnel" sub="Enquiries → leads → deals → customers → invoiced → collected (attributed records only)"><Funnel steps={data.funnel} /></Card>
            <Card title="Monthly lead trend"><TrendChart data={data.trend} lines={[{ key: 'leads', name: 'Leads' }, { key: 'qualified', name: 'Qualified' }, { key: 'customers', name: 'Customers' }]} /></Card>
            <Card title="Monthly conversion trend" sub="Customers acquired ÷ leads created, by month"><TrendChart data={data.trend} lines={[{ key: 'conversionRate', name: 'Conversion %' }]} /></Card>
            {fin && <Card title="Monthly revenue collected"><TrendChart data={data.trend} lines={[{ key: 'revenue', name: 'Revenue' }]} money /></Card>}
            <Card title="Leads by source"><RankBars rows={srcs} valueKey="leads" onClick={(r) => navigate(`/lead-sources/${r.id}`)} /></Card>
            <Card title="Leads by campaign"><RankBars rows={cmps} valueKey="leads" onClick={(r) => navigate(`/campaigns/${r.id}`)} /></Card>
            <Card title="Source conversion rate" sub="Customers ÷ leads (%)"><ComparisonBars rows={srcs.filter((s) => s.leads >= 1)} valueKey="conversionRate" percent /></Card>
            {fin && <Card title="Revenue by source"><RankBars rows={srcs} valueKey="collected" format={fmtMoney} onClick={(r) => navigate(`/lead-sources/${r.id}`)} /></Card>}
            {fin && <Card title="Revenue by campaign"><RankBars rows={cmps} valueKey="collected" format={fmtMoney} onClick={(r) => navigate(`/campaigns/${r.id}`)} /></Card>}
            {fin && <Card title="Marketing spend vs revenue" sub="Actual spend against revenue collected, per campaign"><SpendVsRevenue rows={cmps} /></Card>}
            {fin && <Card title="ROI comparison" sub="(Revenue collected − spend) ÷ spend. Campaigns without recorded spend are not shown."><ComparisonBars rows={cmps.filter((c) => c.roi !== null)} valueKey="roi" percent /></Card>}
          </div>
          <Card title="Source-wise performance" className="mb-5" sub="Cost per lead and ROI appear only where campaigns on that source have recorded spend.">
            <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-ink-100 text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2 text-left">Source</th><th className={th}>Leads</th><th className={th}>Qualified</th><th className={th}>Deals</th><th className={th}>Customers</th><th className={th}>Revenue</th><th className={th}>Conv.</th><th className={th}>CPL</th><th className={th}>ROI</th></tr></thead>
              <tbody>{[...srcs].sort((a, b) => b.leads - a.leads).filter((s) => s.leads || s.deals || s.customers).map((s) => <tr key={s.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2"><button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(`/lead-sources/${s.id}`)}>{s.name}</button></td><td className="px-3 text-right">{s.leads}</td><td className="px-3 text-right">{s.qualifiedLeads}</td><td className="px-3 text-right">{s.deals}</td><td className="px-3 text-right">{s.customers}</td><td className="px-3 text-right">{money(s.collected)}</td><td className="px-3 text-right">{s.conversionRate}%</td><td className="px-3 text-right">{money(s.costPerLead)}</td><td className="px-3 text-right">{fin ? (s.roi === null ? '—' : `${s.roi}%`) : '—'}</td></tr>)}</tbody></table></div>
          </Card>
          <Card title="Campaign-wise performance">
            <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm"><thead><tr className="border-b border-ink-100 text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2 text-left">Campaign</th><th className="px-3 text-left">Status</th><th className={th}>Budget</th><th className={th}>Spend</th><th className={th}>Leads</th><th className={th}>Qualified</th><th className={th}>Deals</th><th className={th}>Customers</th><th className={th}>Revenue</th><th className={th}>Conv.</th><th className={th}>CPL</th><th className={th}>ROI</th></tr></thead>
              <tbody>{[...cmps].sort((a, b) => b.leads - a.leads).map((c) => <tr key={c.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2"><button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(`/campaigns/${c.id}`)}>{c.name}</button><span className="block text-[11px] text-ink-400">{c.number}</span></td><td className="px-3 text-xs">{c.status}</td><td className="px-3 text-right">{money(c.budget)}</td><td className="px-3 text-right">{money(c.spend)}</td><td className="px-3 text-right">{c.leads}</td><td className="px-3 text-right">{c.qualifiedLeads}</td><td className="px-3 text-right">{c.deals}</td><td className="px-3 text-right">{c.customers}</td><td className="px-3 text-right">{money(c.collected)}</td><td className="px-3 text-right">{c.conversionRate}%</td><td className="px-3 text-right">{money(c.costPerLead)}</td><td className={clsx('px-3 text-right font-semibold', c.roi !== null && c.roi < 0 && 'text-rose-600', c.roi !== null && c.roi >= 0 && 'text-emerald-600')}>{fin ? (c.roi === null ? '—' : `${c.roi}%`) : '—'}</td></tr>)}{!cmps.length && <tr><td colSpan={12} className="py-6 text-center text-sm text-ink-400">No campaigns match these filters.</td></tr>}</tbody></table></div>
          </Card>
          <p className="mt-3 text-xs text-ink-400">{data.unattributedLeads} lead(s) have no campaign or source and are not counted in any group. Revenue is attributed through the deal (or the customer’s first touch) behind each invoice; unrelated revenue is never counted.</p>
        </>
      )}
    </div>
  )
}
