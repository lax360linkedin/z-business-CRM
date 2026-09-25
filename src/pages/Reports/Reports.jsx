import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, Handshake, Trophy, Percent, Users, Target, Megaphone, Wallet, IndianRupee,
  FolderKanban, CheckCircle2, UserSquare2, AlertTriangle, LifeBuoy, XCircle, Ban,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { StatCard } from '../../components/common/StatCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { DataTable } from '../../components/common/DataTable'
import { Avatar } from '../../components/common/Avatar'
import { CardSkeleton, Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { MONTHLY_PERFORMANCE } from '../../data/monthlySeries'
import { DEAL_STAGES, CLOSED_DEAL_STAGES, LEAD_SOURCES } from '../../data/constants'
import { getUserById, USERS, salesUsers, projectManagers } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { useTheme } from '../../context/ThemeContext'

const TITLES = { sales: 'Sales Reports', leads: 'Lead Reports', marketing: 'Marketing Reports', finance: 'Finance Reports', projects: 'Project Reports', team: 'Team Performance' }
const DESCRIPTIONS = {
  sales: 'Pipeline health, win rates, and rep performance.',
  leads: 'Lead volume, sources, and conversion trends.',
  marketing: 'Campaign performance across every channel.',
  finance: 'Revenue, collections, and expense breakdowns.',
  projects: 'Delivery status and value across active projects.',
  team: 'Individual performance across sales, delivery, and support.',
}

// Fixed categorical hues for multi-series charts — `brand`/accent is intentionally excluded
// here (see the single-series charts below, which read the live accent color via useTheme()
// instead) except as the first qualitative swatch in PIE_COLORS, which stays a fixed default
// purple since it's a plain categorical palette rather than a "this is the brand" signal.
const COLORS = { emerald: '#10b981', amber: '#f59e0b', sky: '#0ea5e9', violet: '#8b5cf6', rose: '#f43f5e', ink: '#94a3b8' }
const STAGE_COLORS = {
  'Deal Created': '#94a3b8', 'Requirement Analysis': '#38bdf8', 'Solution Discussion': '#0ea5e9',
  'Decision Maker Review': '#6366f1', 'Proposal / Quotation': '#f59e0b', Negotiation: '#8b5cf6',
  'Final Decision': '#d946ef', 'Closed Won': '#10b981', 'Closed Lost': '#f43f5e', 'Closed Lost – Competition': '#e11d48',
}
const PROJECT_STATUS_COLORS = { 'Not Started': '#94a3b8', 'In Progress': '#0ea5e9', 'On Hold': '#f59e0b', Delayed: '#f43f5e', Completed: '#10b981' }
const PIE_COLORS = ['#9333ea', COLORS.emerald, COLORS.amber, COLORS.sky, COLORS.violet, COLORS.rose, '#14b8a6', '#f97316']

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

const REPORT_RESOURCES = ['leads', 'deals', 'campaigns', 'invoices', 'expenses', 'projects', 'tickets']

function useReportData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all(REPORT_RESOURCES.map((r) => api.get(`/${r}`, { params: { all: true } })))
      .then((results) => {
        const merged = {}
        REPORT_RESOURCES.forEach((r, i) => { merged[r] = results[i].data })
        setData(merged)
      })
      .finally(() => setLoading(false))
  }, [])

  return { data, loading }
}

export default function Reports() {
  const { type } = useParams()
  const { data, loading } = useReportData()

  if (loading || !data) {
    return (
      <div>
        <PageHeader title={TITLES[type] || 'Reports'} description="Loading report data…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={TITLES[type] || 'Reports'} description={DESCRIPTIONS[type] || 'Business performance reporting.'} />
      {type === 'sales' && <SalesReport data={data} />}
      {type === 'leads' && <LeadsReport data={data} />}
      {type === 'marketing' && <MarketingReport data={data} />}
      {type === 'finance' && <FinanceReport data={data} />}
      {type === 'projects' && <ProjectsReport data={data} />}
      {type === 'team' && <TeamReport data={data} />}
      {!TITLES[type] && <p className="text-sm text-ink-400">Unknown report type.</p>}
    </div>
  )
}

function SalesReport({ data }) {
  const { accentHex } = useTheme()
  const { deals } = data
  const won = useMemo(() => deals.filter((d) => d.stage === 'Closed Won'), [deals])
  const lost = useMemo(() => deals.filter((d) => d.stage === 'Closed Lost' || d.stage === 'Closed Lost – Competition'), [deals])
  const active = useMemo(() => deals.filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage)), [deals])
  const pipelineValue = active.reduce((s, d) => s + d.value, 0)
  const winRate = won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0

  const stats = [
    { label: 'Total Deals', value: deals.length, icon: Handshake, tone: 'brand' },
    { label: 'Won Deals', value: won.length, icon: Trophy, tone: 'emerald' },
    { label: 'Win Rate', value: `${winRate.toFixed(1)}%`, icon: Percent, tone: 'violet' },
    { label: 'Pipeline Value', value: formatCurrency(pipelineValue, { compact: true }), icon: Wallet, tone: 'amber' },
  ]

  const funnelData = DEAL_STAGES.filter((s) => s !== 'Closed Lost' && s !== 'Closed Lost – Competition').map((stage) => ({ stage, count: deals.filter((d) => d.stage === stage).length }))
  const winLossData = [{ name: 'Won', value: won.length }, { name: 'Lost', value: lost.length }]

  const repData = useMemo(() => {
    const byRep = {}
    won.forEach((d) => { byRep[d.salesperson] = (byRep[d.salesperson] || 0) + d.value })
    return Object.entries(byRep).map(([id, value]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [won])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Deals by Stage" subtitle="Funnel across the active pipeline">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={80} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}>
                {funnelData.map((d) => <Cell key={d.stage} fill={STAGE_COLORS[d.stage]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Monthly Won Value" subtitle="Revenue trend — last 12 months">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={MONTHLY_PERFORMANCE} margin={{ left: -12 }}>
              <defs>
                <linearGradient id="repRevFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={accentHex} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={accentHex} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={64} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} />
              <Area type="monotone" dataKey="revenue" stroke={accentHex} strokeWidth={2.5} fill="url(#repRevFill)" name="Revenue" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Win / Loss Ratio" subtitle="Closed deals breakdown">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={winLossData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                <Cell fill={COLORS.emerald} />
                <Cell fill={COLORS.rose} />
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Sales by Rep" subtitle="Revenue won per sales executive">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={repData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.violet} radius={[0, 6, 6, 0]} barSize={18} name="Revenue Won" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  )
}

function LeadsReport({ data }) {
  const { accentHex } = useTheme()
  const { leads, deals } = data
  const converted = leads.filter((l) => l.status === 'Converted').length
  const unqualified = leads.filter((l) => l.status === 'Unqualified').length
  const lost = leads.filter((l) => l.status === 'Lost').length
  const conversionRate = leads.length ? (converted / leads.length) * 100 : 0

  const stats = [
    { label: 'Total Leads', value: leads.length, icon: Users, tone: 'brand' },
    { label: 'New Leads', value: leads.filter((l) => l.status === 'New').length, icon: Target, tone: 'sky' },
    { label: 'Converted', value: converted, icon: Trophy, tone: 'emerald' },
    // Unqualified and Lost are deliberately separate cards, never merged into one "closed"
    // metric — Unqualified means it was never a real opportunity, Lost means it was one but
    // the business didn't happen.
    { label: 'Unqualified Leads', value: unqualified, icon: XCircle, tone: 'ink' },
    { label: 'Lost Leads', value: lost, icon: Ban, tone: 'rose' },
    { label: 'Conversion Rate', value: `${conversionRate.toFixed(1)}%`, icon: Percent, tone: 'violet' },
  ]

  const bySource = useMemo(() => {
    const counts = {}
    LEAD_SOURCES.forEach((s) => (counts[s] = 0))
    leads.forEach((l) => { counts[l.source] = (counts[l.source] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [leads])

  const byStaff = useMemo(() => {
    const counts = {}
    leads.forEach((l) => { counts[l.assignedTo] = (counts[l.assignedTo] || 0) + 1 })
    return Object.entries(counts).map(([id, value]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [leads])

  const byService = useMemo(() => {
    const counts = {}
    leads.forEach((l) => { counts[l.service] = (counts[l.service] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [leads])

  // Full source performance — Leads → Qualified → Converted → Conversion Rate → Revenue →
  // Pipeline Value, per spec §7/§22. Revenue/Pipeline Value are read from the Deal's own
  // `source` field (carried forward from the originating Lead at conversion time — see
  // convertLead() in src/pages/Leads/leadActions.js) rather than re-deriving them from
  // unrelated data, so a Deal created directly (not from a Lead) simply doesn't count toward
  // any source's numbers instead of being guessed at.
  const sourceConversion = useMemo(() => {
    const bySrc = {}
    const ensure = (source) => {
      if (!bySrc[source]) bySrc[source] = { total: 0, qualified: 0, converted: 0, unqualified: 0, lost: 0, revenue: 0, pipeline: 0 }
      return bySrc[source]
    }
    leads.forEach((l) => {
      const row = ensure(l.source)
      row.total += 1
      if (['Qualified', 'Converted'].includes(l.status)) row.qualified += 1
      if (l.status === 'Converted') row.converted += 1
      // Source-wise Unqualified/Lost, kept as two separate counters (never merged) so a
      // channel's "never a real opportunity" rate is reportable apart from its "opportunity
      // fell through" rate.
      if (l.status === 'Unqualified') row.unqualified += 1
      if (l.status === 'Lost') row.lost += 1
    })
    deals.forEach((d) => {
      if (!d.source) return
      const row = ensure(d.source)
      if (d.stage === 'Closed Won') row.revenue += d.value
      else if (!CLOSED_DEAL_STAGES.includes(d.stage)) row.pipeline += d.value
    })
    return Object.entries(bySrc)
      .map(([source, v]) => ({ source, ...v, rate: v.total ? (v.converted / v.total) * 100 : 0 }))
      .sort((a, b) => b.rate - a.rate)
  }, [leads, deals])

  // Salesperson-wise Unqualified/Lost — kept as two separate columns for the same reason
  // (never merge the two outcomes together).
  const bySalespersonOutcome = useMemo(() => {
    const byRep = {}
    const ensure = (id) => {
      if (!byRep[id]) byRep[id] = { unqualified: 0, lost: 0 }
      return byRep[id]
    }
    leads.forEach((l) => {
      if (l.status === 'Unqualified') ensure(l.assignedTo).unqualified += 1
      if (l.status === 'Lost') ensure(l.assignedTo).lost += 1
    })
    return Object.entries(byRep)
      .map(([id, v]) => ({ name: getUserById(id)?.name || id, ...v }))
      .filter((r) => r.unqualified > 0 || r.lost > 0)
      .sort((a, b) => (b.unqualified + b.lost) - (a.unqualified + a.lost))
  }, [leads])

  const unqualifiedReasons = useMemo(() => {
    const counts = {}
    leads.filter((l) => l.status === 'Unqualified' && l.unqualifiedReason).forEach((l) => {
      counts[l.unqualifiedReason] = (counts[l.unqualifiedReason] || 0) + 1
    })
    return Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  }, [leads])

  const lostReasons = useMemo(() => {
    const counts = {}
    leads.filter((l) => l.status === 'Lost' && l.lostReason).forEach((l) => {
      counts[l.lostReason] = (counts[l.lostReason] || 0) + 1
    })
    return Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  }, [leads])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Leads by Source" subtitle="Top channels by volume">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bySource} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={accentHex} radius={[6, 6, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Leads by Assigned Staff" subtitle="Workload distribution across reps">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byStaff} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.sky} radius={[0, 6, 6, 0]} barSize={18} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Leads by Service" subtitle="Interest across service lines">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byService} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.amber} radius={[6, 6, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Source Performance" subtitle="Leads → Qualified → Converted → Revenue by channel, with source-wise Unqualified/Lost" className="lg:col-span-2" bodyClassName="max-h-[320px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400">
                <th className="py-2">Source</th>
                <th className="py-2 text-right">Leads</th>
                <th className="py-2 text-right">Qualified</th>
                <th className="py-2 text-right">Converted</th>
                <th className="py-2 text-right">Unqualified</th>
                <th className="py-2 text-right">Lost</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Pipeline Value</th>
                <th className="py-2 text-right">Revenue (Won)</th>
              </tr>
            </thead>
            <tbody>
              {sourceConversion.map((r) => (
                <tr key={r.source} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                  <td className="py-2 text-ink-700 dark:text-ink-200">{r.source}</td>
                  <td className="py-2 text-right text-ink-500">{r.total}</td>
                  <td className="py-2 text-right text-ink-500">{r.qualified}</td>
                  <td className="py-2 text-right text-ink-500">{r.converted}</td>
                  <td className="py-2 text-right text-ink-500">{r.unqualified}</td>
                  <td className="py-2 text-right text-rose-500">{r.lost}</td>
                  <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">{r.rate.toFixed(0)}%</td>
                  <td className="py-2 text-right text-ink-500">{formatCurrency(r.pipeline, { compact: true })}</td>
                  <td className="py-2 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(r.revenue, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>

        <ChartCard title="Unqualified Reasons" subtitle="Why leads never met the qualification criteria">
          {unqualifiedReasons.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No unqualified leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {unqualifiedReasons.map((r) => (
                  <tr key={r.reason} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="py-2 text-ink-700 dark:text-ink-200">{r.reason}</td>
                    <td className="py-2 text-right font-medium text-ink-800 dark:text-ink-100">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard title="Lost Reasons" subtitle="Why genuine opportunities didn't proceed">
          {lostReasons.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No lost leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {lostReasons.map((r) => (
                  <tr key={r.reason} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="py-2 text-ink-700 dark:text-ink-200">{r.reason}</td>
                    <td className="py-2 text-right font-medium text-rose-600 dark:text-rose-400">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>

        <ChartCard title="Salesperson-wise Unqualified &amp; Lost" subtitle="Kept as two separate columns — never merged" className="lg:col-span-2">
          {bySalespersonOutcome.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No unqualified or lost leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400">
                  <th className="py-2">Salesperson</th>
                  <th className="py-2 text-right">Unqualified</th>
                  <th className="py-2 text-right">Lost</th>
                </tr>
              </thead>
              <tbody>
                {bySalespersonOutcome.map((r) => (
                  <tr key={r.name} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="py-2 text-ink-700 dark:text-ink-200">{r.name}</td>
                    <td className="py-2 text-right text-ink-500">{r.unqualified}</td>
                    <td className="py-2 text-right text-rose-500">{r.lost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>
    </>
  )
}

function MarketingReport({ data }) {
  const { accentHex } = useTheme()
  const { campaigns } = data
  const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0)
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
  const avgRoi = campaigns.length ? campaigns.reduce((s, c) => s + c.roi, 0) / campaigns.length : 0

  const stats = [
    { label: 'Campaigns', value: campaigns.length, icon: Megaphone, tone: 'brand' },
    { label: 'Total Budget', value: formatCurrency(totalBudget, { compact: true }), icon: Wallet, tone: 'amber' },
    { label: 'Total Revenue', value: formatCurrency(totalRevenue, { compact: true }), icon: IndianRupee, tone: 'emerald' },
    { label: 'Avg. ROI', value: `${avgRoi.toFixed(0)}%`, icon: TrendingUp, tone: 'violet' },
  ]

  const revenueByCampaign = useMemo(() => [...campaigns].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((c) => ({ name: c.name, value: c.revenue })), [campaigns])

  const byChannel = useMemo(() => {
    const counts = {}
    campaigns.forEach((c) => { counts[c.channel] = (counts[c.channel] || 0) + c.leadsGenerated })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [campaigns])

  const roiData = useMemo(() => [...campaigns].sort((a, b) => b.roi - a.roi).slice(0, 8).map((c) => ({ name: c.name, roi: c.roi })), [campaigns])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Campaign Performance" subtitle="Revenue generated per campaign" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={revenueByCampaign} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={70} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={accentHex} radius={[6, 6, 0, 0]} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Channel Performance" subtitle="Leads generated by channel">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byChannel} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {byChannel.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="ROI Comparison" subtitle="Return on investment per campaign">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={roiData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={100} />
              <Tooltip formatter={(v) => `${v}%`} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="roi" radius={[0, 6, 6, 0]} barSize={16} name="ROI">
                {roiData.map((d) => <Cell key={d.name} fill={d.roi >= 0 ? COLORS.emerald : COLORS.rose} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </>
  )
}

function FinanceReport({ data }) {
  const { invoices, expenses } = data
  const totalPaid = invoices.reduce((s, inv) => s + (inv.paidAmount || 0), 0)
  const totalOutstanding = invoices.reduce((s, inv) => s + (inv.amount - (inv.paidAmount || 0)), 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const overdueInvoices = invoices.filter((inv) => inv.status === 'Overdue')

  const stats = [
    { label: 'Revenue (this month)', value: formatCurrency(MONTHLY_PERFORMANCE.at(-1).revenue, { compact: true }), icon: IndianRupee, tone: 'emerald' },
    { label: 'Collected', value: formatCurrency(totalPaid, { compact: true }), icon: Wallet, tone: 'brand' },
    { label: 'Outstanding', value: formatCurrency(totalOutstanding, { compact: true }), icon: AlertTriangle, tone: 'rose' },
    { label: 'Total Expenses', value: formatCurrency(totalExpenses, { compact: true }), icon: TrendingUp, tone: 'amber' },
  ]

  const collectionsData = [{ name: 'Received', value: totalPaid }, { name: 'Outstanding', value: totalOutstanding }]

  const expenseByCategory = useMemo(() => {
    const counts = {}
    expenses.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + e.amount })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [expenses])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Revenue Trend" subtitle="Actual revenue vs target — last 12 months" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={MONTHLY_PERFORMANCE} margin={{ left: -12 }}>
              <defs>
                <linearGradient id="finRevFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={64} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} />
              <Area type="monotone" dataKey="revenue" stroke={COLORS.emerald} strokeWidth={2.5} fill="url(#finRevFill)" name="Revenue" />
              <Area type="monotone" dataKey="target" stroke={COLORS.ink} strokeWidth={1.5} strokeDasharray="4 4" fill="none" name="Target" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Payments Received vs Outstanding" subtitle="Across all invoices">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={collectionsData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Amount">
                <Cell fill={COLORS.emerald} />
                <Cell fill={COLORS.rose} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Expense Breakdown" subtitle="Spend by category">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={expenseByCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {expenseByCategory.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Overdue Invoices" subtitle={`${overdueInvoices.length} invoice(s) past due date`} className="lg:col-span-2" bodyClassName="max-h-[280px] overflow-y-auto scrollbar-thin">
          {overdueInvoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No overdue invoices. Great work!</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400">
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-right">Outstanding</th>
                  <th className="py-2 text-right">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {overdueInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="py-2 font-medium text-ink-700 dark:text-ink-200">{inv.number}</td>
                    <td className="py-2 text-ink-600 dark:text-ink-300">{inv.customerName}</td>
                    <td className="py-2 text-right text-ink-500">{formatCurrency(inv.amount)}</td>
                    <td className="py-2 text-right font-medium text-rose-600 dark:text-rose-400">{formatCurrency(inv.amount - (inv.paidAmount || 0))}</td>
                    <td className="py-2 text-right text-ink-500">{formatDate(inv.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>
    </>
  )
}

function ProjectsReport({ data }) {
  const { accentHex } = useTheme()
  const { projects } = data
  const completed = projects.filter((p) => p.status === 'Completed').length
  const completionRate = projects.length ? (completed / projects.length) * 100 : 0
  const delayed = projects.filter((p) => p.status === 'Delayed')

  const stats = [
    { label: 'Total Projects', value: projects.length, icon: FolderKanban, tone: 'brand' },
    { label: 'Completed', value: completed, icon: CheckCircle2, tone: 'emerald' },
    { label: 'Completion Rate', value: `${completionRate.toFixed(0)}%`, icon: Percent, tone: 'violet' },
    { label: 'Delayed', value: delayed.length, icon: AlertTriangle, tone: 'rose' },
  ]

  const statusBreakdown = useMemo(() => {
    const counts = {}
    projects.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [projects])

  const valueByStatus = useMemo(() => {
    const sums = {}
    projects.forEach((p) => { sums[p.status] = (sums[p.status] || 0) + p.budget })
    return Object.entries(sums).map(([name, value]) => ({ name, value }))
  }, [projects])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Project Status Breakdown" subtitle="Share of projects by status">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {statusBreakdown.map((d) => <Cell key={d.name} fill={PROJECT_STATUS_COLORS[d.name] || COLORS.ink} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Project Value by Status" subtitle="Budget allocation across statuses">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={valueByStatus} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Budget">
                {valueByStatus.map((d) => <Cell key={d.name} fill={PROJECT_STATUS_COLORS[d.name] || accentHex} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Delayed Projects" subtitle={`${delayed.length} project(s) currently delayed`} className="lg:col-span-2" bodyClassName="max-h-[280px] overflow-y-auto scrollbar-thin">
          {delayed.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">No delayed projects right now.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800 dark:text-ink-400">
                  <th className="py-2">Project</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2">Manager</th>
                  <th className="py-2 text-right">Progress</th>
                  <th className="py-2 text-right">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {delayed.map((p) => (
                  <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="py-2 font-medium text-ink-700 dark:text-ink-200">{p.name}</td>
                    <td className="py-2 text-ink-600 dark:text-ink-300">{p.customerName}</td>
                    <td className="py-2 text-ink-600 dark:text-ink-300">{getUserById(p.manager)?.name.split(' ')[0] || '—'}</td>
                    <td className="py-2 text-right text-ink-500">{p.progress}%</td>
                    <td className="py-2 text-right font-medium text-rose-600 dark:text-rose-400">{formatDate(p.deadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartCard>
      </div>
    </>
  )
}

function TeamReport({ data }) {
  const { deals, projects, tickets } = data

  const rows = useMemo(() => {
    return USERS.filter((u) => u.status === 'Active').map((u) => {
      let metric = '—'
      if (u.department === 'Sales') {
        const won = deals.filter((d) => d.salesperson === u.id && d.stage === 'Closed Won')
        metric = `${won.length} deals won · ${formatCurrency(won.reduce((s, d) => s + d.value, 0), { compact: true })}`
      } else if (u.role === 'Project Manager') {
        const active = projects.filter((p) => p.manager === u.id && p.status !== 'Completed')
        metric = `${active.length} active project${active.length !== 1 ? 's' : ''}`
      } else if (u.department === 'Support') {
        const resolved = tickets.filter((t) => t.assignedStaff === u.id && ['Resolved', 'Closed'].includes(t.status))
        metric = `${resolved.length} ticket${resolved.length !== 1 ? 's' : ''} resolved`
      }
      return { ...u, metric }
    })
  }, [deals, projects, tickets])

  const topSales = useMemo(() => {
    const byRep = {}
    deals.filter((d) => d.stage === 'Closed Won').forEach((d) => { byRep[d.salesperson] = (byRep[d.salesperson] || 0) + d.value })
    return Object.entries(byRep).map(([id, value]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [deals])

  const stats = [
    { label: 'Active Employees', value: rows.length, icon: UserSquare2, tone: 'brand' },
    { label: 'Sales Reps', value: salesUsers().length, icon: Handshake, tone: 'violet' },
    { label: 'Project Managers', value: projectManagers().length, icon: FolderKanban, tone: 'sky' },
    { label: 'Support Staff', value: rows.filter((r) => r.department === 'Support').length, icon: LifeBuoy, tone: 'amber' },
  ]

  const columns = [
    {
      key: 'name', header: 'Employee',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.designation}</p>
          </div>
        </div>
      ),
    },
    { key: 'department', header: 'Department' },
    { key: 'role', header: 'Role' },
    { key: 'metric', header: 'Performance', render: (row) => <span className="text-ink-700 dark:text-ink-200">{row.metric}</span> },
  ]

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mt-5">
        <ChartCard title="Top Sales Performers" subtitle="Revenue won by sales executive">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topSales} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.violet} radius={[6, 6, 0, 0]} name="Revenue Won" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="mt-5">
        <DataTable columns={columns} data={rows} loading={false} emptyTitle="No employees found" />
      </div>
    </>
  )
}
