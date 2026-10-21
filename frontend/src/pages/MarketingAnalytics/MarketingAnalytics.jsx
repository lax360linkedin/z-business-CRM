import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Megaphone, PlayCircle, CheckCircle2, Wallet, IndianRupee, Users, UserCheck, Percent, Handshake, TrendingUp, Receipt, Target, AlertTriangle, Trophy } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters, documentFromCsv } from '../../utils/exporter'
import { captureReport } from '../../utils/reportCapture'
import { findChartData, setChartData, dropChartData } from '../../utils/chartData'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { FilterToolbar } from '../../components/common/FilterToolbar'
import { FormField, Input, Select } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { LEAD_STATUSES, DEAL_STAGES } from '../../data/constants'
import { CAMPAIGN_STATUSES } from '../../utils/marketingRules'
import { formatCurrency } from '../../utils/format'

import { useAnalytics, useMarketingConfig, exportMarketing, mkErr } from '../Marketing/marketingClient'
import { Funnel, TrendChart, RankBars, SpendVsRevenue, ComparisonBars, fmtMoney, fmtPct } from '../Marketing/MarketingCharts'

const EMPTY = { from: '', to: '', campaignId: '', leadSourceId: '', channel: '', campaignStatus: '', leadStatus: '', dealStage: '', owner: '', team: '', product: '', customerId: '', companyId: '' }
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' }
function Card({ title, children, className, sub }) {
  const id = useId()
  const data = findChartData(children)
  useEffect(() => { setChartData(id, { title, subtitle: sub, data }); return () => dropChartData(id) })
  return <section data-card data-chart-id={id} className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}><h2 data-card-title className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{sub && <p data-card-subtitle className="mb-3 text-xs text-ink-400">{sub}</p>}<div className={sub ? '' : 'mt-3'}>{children}</div></section>
}
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
  // same split as the list pages: the dropdowns sit behind "Filters", the date range and the long lists behind "More Filters"; each is counted and cleared on its own
  const SELECT_KEYS = ['campaignId', 'leadSourceId', 'channel', 'campaignStatus', 'leadStatus', 'dealStage', 'owner', 'team']
  const ADVANCED_KEYS = ['from', 'to', 'product', 'customerId', 'companyId']
  const clearKeys = (keys) => setF((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, ''])) }))
  const advancedCount = ADVANCED_KEYS.filter((k) => f[k]).length
  const opts = (list) => list.map(([value, label]) => ({ value, label }))
  const filterDefs = [
    { key: 'campaignId', label: 'Campaigns', options: opts(lookups.campaigns.map((c) => [c.id, c.name])) },
    { key: 'leadSourceId', label: 'Lead Sources', options: opts(lookups.sources.map((x) => [x.id, x.name])) },
    { key: 'channel', label: 'Channels', options: opts(channels.map((c) => [c, c])) },
    { key: 'campaignStatus', label: 'Campaign Status', options: opts(CAMPAIGN_STATUSES.map((x) => [x, x])) },
    { key: 'leadStatus', label: 'Lead Statuses', options: opts(LEAD_STATUSES.map((x) => [x, x])) },
    { key: 'dealStage', label: 'Deal Stages', options: opts(DEAL_STAGES.map((x) => [x, x])) },
    { key: 'owner', label: 'Owners', options: opts(USERS.filter((u) => u.status !== 'Inactive').map((u) => [u.id, u.name])) },
    { key: 'team', label: 'Teams', options: opts(depts.map((d) => [d, d])) },
  ]
  const field = (label, k, list) => <FormField label={label}><Select aria-label={label} value={f[k]} onChange={(e) => set({ [k]: e.target.value })}><option value="">All</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
  // Export: the page as shown (key figures, charts, tables) and the server's campaign / source performance sheets, all for the filters and dates chosen above
  const root = useRef(null)
  const exportFilters = describeFilters([
    ['Campaign', f.campaignId && (lookups.campaigns.find((c) => c.id === f.campaignId)?.name || f.campaignId)], ['Lead source', f.leadSourceId && (lookups.sources.find((x) => x.id === f.leadSourceId)?.name || f.leadSourceId)],
    ['Channel', f.channel], ['Campaign status', f.campaignStatus], ['Lead status', f.leadStatus], ['Deal stage', f.dealStage], ['Owner', f.owner && (USERS.find((u) => u.id === f.owner)?.name || f.owner)], ['Team', f.team],
    ['Product / service', f.product && (lookups.products.find((p) => p.id === f.product)?.name || f.product)], ['Customer', f.customerId && (lookups.customers.find((c) => c.id === f.customerId)?.name || f.customerId)],
    ['Company', f.companyId && (lookups.companies.find((c) => c.id === f.companyId)?.name || f.companyId)], ['From', f.from], ['To', f.to],
  ])
  const sheet = (type, title) => async (_format, ctx) => documentFromCsv({ title, csv: await exportMarketing(type, clean), filters: exportFilters, ...ctx })
  const exportSets = [
    { label: 'Analytics report (figures, charts, tables)', name: 'marketing-analytics', title: 'Marketing Analytics', getDocument: async (format, ctx) => { const doc = await captureReport(root.current, { title: 'Marketing Analytics', subtitle: `Filters: ${exportFilters}`, user: ctx.user, branch: ctx.branch, withCharts: format === 'pdf' }); return doc } },
    { label: 'Campaign performance', name: 'marketing-campaigns', title: 'Campaign performance', noun: 'campaign', getDocument: sheet('campaigns', 'Campaign performance') },
    { label: 'Source performance', name: 'marketing-sources', title: 'Source performance', noun: 'source', getDocument: sheet('sources', 'Source performance') },
  ]

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load marketing analytics" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const t = data?.totals; const fin = data && !data.financialHidden
  const money = (v) => (fin ? fmtMoney(v) : '—')
  const cards = t ? [['Total campaigns', t.totalCampaigns, Megaphone, 'brand'], ['Active campaigns', t.activeCampaigns, PlayCircle, 'emerald'], ['Completed', t.completedCampaigns, CheckCircle2, 'sky'], ['Marketing budget', money(t.budget), Wallet, 'violet'], ['Actual spend', money(t.spend), IndianRupee, 'amber'], ['Total leads', t.leads, Users, 'brand'], ['Qualified leads', t.qualifiedLeads, UserCheck, 'emerald'], ['Conversion rate', fmtPct(t.conversionRate), Percent, 'sky'], ['Deals created', t.deals, Handshake, 'violet'], ['Customers acquired', t.customers, UserCheck, 'emerald'], ['Revenue collected', money(t.collected), IndianRupee, 'emerald'], ['Outstanding revenue', money(t.outstanding), Receipt, 'rose'], ['Cost per lead', money(t.costPerLead), Target, 'amber'], ['Cost per customer', money(t.costPerCustomer), Target, 'amber'], ['Campaign ROI', fin ? (t.roi === null ? '—' : `${t.roi}%`) : '—', TrendingUp, t.roi !== null && t.roi < 0 ? 'rose' : 'emerald']] : []
  const srcs = data?.sources || []; const cmps = data?.campaigns || []
  const best = (list, k, label) => { const r = [...list].filter((x) => (x[k] ?? 0) > 0).sort((a, b) => b[k] - a[k])[0]; return r ? { label, name: r.name, value: r[k] } : null }
  const insights = data ? [best(srcs, 'leads', 'Most leads'), best(srcs.filter((s) => s.leads >= 3), 'qualificationRate', 'Best lead quality (qualified %)'), best(srcs, 'customers', 'Most customers'), fin ? best(srcs, 'collected', 'Most revenue') : null, best(srcs.filter((s) => s.leads >= 3), 'conversionRate', 'Highest conversion rate')].filter(Boolean) : []

  return (
    <div ref={root}>
      <PageHeader title="Marketing Analytics" description="One analytics layer over campaigns, lead sources, leads, deals, customers, invoices and payments — every figure is computed live from those records." actions={<ExportMenu title="Marketing Analytics" permission={perms.export} datasets={exportSets} />} />
      <FilterToolbar
        filters={filterDefs} values={Object.fromEntries(SELECT_KEYS.map((k) => [k, f[k]]))} onChange={(k, v) => set({ [k]: v === 'all' ? '' : v })} onClear={() => clearKeys(SELECT_KEYS)}
        advancedCount={advancedCount} onClearAdvanced={() => clearKeys(ADVANCED_KEYS)}
        advanced={<>
          <FormField label="From"><Input aria-label="From date" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></FormField>
          <FormField label="To"><Input aria-label="To date" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></FormField>
          {field('Product / service', 'product', lookups.products.map((p) => [p.id, p.name]))}
          {field('Customer', 'customerId', lookups.customers.map((c) => [c.id, c.name]))}
          {field('Company', 'companyId', lookups.companies.map((c) => [c.id, c.name]))}
        </>}
      />
      {!data ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map(([label, value, Icon, tone]) => <div key={label} data-stat className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span data-stat-label className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div><p data-stat-value className="mt-1.5 break-words text-lg font-bold text-ink-900 dark:text-ink-50">{value}</p></div>)}
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
            <div className="overflow-x-auto"><table className="crm-table w-full min-w-[820px] text-sm"><thead><tr className="border-b border-ink-100 text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2 text-left">Source</th><th className={th}>Leads</th><th className={th}>Qualified</th><th className={th}>Deals</th><th className={th}>Customers</th><th className={th}>Revenue</th><th className={th}>Conv.</th><th className={th}>CPL</th><th className={th}>ROI</th></tr></thead>
              <tbody>{[...srcs].sort((a, b) => b.leads - a.leads).filter((s) => s.leads || s.deals || s.customers).map((s) => <tr key={s.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2"><button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(`/lead-sources/${s.id}`)}>{s.name}</button></td><td className="px-3 text-right">{s.leads}</td><td className="px-3 text-right">{s.qualifiedLeads}</td><td className="px-3 text-right">{s.deals}</td><td className="px-3 text-right">{s.customers}</td><td className="px-3 text-right">{money(s.collected)}</td><td className="px-3 text-right">{s.conversionRate}%</td><td className="px-3 text-right">{money(s.costPerLead)}</td><td className="px-3 text-right">{fin ? (s.roi === null ? '—' : `${s.roi}%`) : '—'}</td></tr>)}</tbody></table></div>
          </Card>
          <Card title="Campaign-wise performance">
            <div className="overflow-x-auto"><table className="crm-table w-full min-w-[960px] text-sm"><thead><tr className="border-b border-ink-100 text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2 text-left">Campaign</th><th className="px-3 text-left">Status</th><th className={th}>Budget</th><th className={th}>Spend</th><th className={th}>Leads</th><th className={th}>Qualified</th><th className={th}>Deals</th><th className={th}>Customers</th><th className={th}>Revenue</th><th className={th}>Conv.</th><th className={th}>CPL</th><th className={th}>ROI</th></tr></thead>
              <tbody>{[...cmps].sort((a, b) => b.leads - a.leads).map((c) => <tr key={c.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2"><button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(`/campaigns/${c.id}`)}>{c.name}</button><span className="block text-[11px] text-ink-400">{c.number}</span></td><td className="px-3 text-xs">{c.status}</td><td className="px-3 text-right">{money(c.budget)}</td><td className="px-3 text-right">{money(c.spend)}</td><td className="px-3 text-right">{c.leads}</td><td className="px-3 text-right">{c.qualifiedLeads}</td><td className="px-3 text-right">{c.deals}</td><td className="px-3 text-right">{c.customers}</td><td className="px-3 text-right">{money(c.collected)}</td><td className="px-3 text-right">{c.conversionRate}%</td><td className="px-3 text-right">{money(c.costPerLead)}</td><td className={clsx('px-3 text-right font-semibold', c.roi !== null && c.roi < 0 && 'text-rose-600', c.roi !== null && c.roi >= 0 && 'text-emerald-600')}>{fin ? (c.roi === null ? '—' : `${c.roi}%`) : '—'}</td></tr>)}{!cmps.length && <tr><td colSpan={12} className="py-6 text-center text-sm text-ink-400">No campaigns match these filters.</td></tr>}</tbody></table></div>
          </Card>
          <p className="mt-3 text-xs text-ink-400">{data.unattributedLeads} lead(s) have no campaign or source and are not counted in any group. Revenue is attributed through the deal (or the customer’s first touch) behind each invoice; unrelated revenue is never counted.</p>
        </>
      )}
    </div>
  )
}
