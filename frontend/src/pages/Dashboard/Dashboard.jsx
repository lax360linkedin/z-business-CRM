import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Users, UserPlus, Target, Handshake, Trophy, UserSquare2, FolderKanban, IndianRupee,
  Wallet, Clock, ArrowRight, Phone, Mail, Users2, Video, CalendarClock, PhoneCall,
  Sprout, XCircle, Percent, AlertTriangle, Inbox, UserCog, ClipboardCheck, Ban, ClipboardList, Receipt, Truck,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { StatCard } from '../../components/common/StatCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { Avatar } from '../../components/common/Avatar'
import { PriorityBadge } from '../../components/common/Badge'
import { CardSkeleton, Skeleton } from '../../components/common/LoadingSkeleton'
import { Button } from '../../components/common/Button'
import { useDashboardData } from '../../hooks/useDashboardData'
import { useMonthlyPerformance } from '../../hooks/useMonthlyPerformance'
import { DEAL_STAGES, CLOSED_DEAL_STAGES, LEAD_STATUSES, ENQUIRY_STATUSES } from '../../data/constants'
import { useLeadSources } from '../../hooks/useLeadSources'
import { getUserById, USERS } from '../../data/users'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useBranch } from '../../context/BranchContext'
import { useBranchSummary, SUMMARY_COLUMNS } from '../../hooks/useBranchSummary'

// Fixed categorical hues for multi-series charts (Deal Pipeline stages, etc) — `brand` is
// deliberately NOT included here since the primary/brand series (Revenue Overview, Lead
// Source Performance, Leads by Salesperson) must follow the live accent color instead; see
// `accentHex` from useTheme() below, read fresh on every render so switching the accent in
// Settings → Appearance recolors these charts immediately, same as every other brand-colored
// element in the app.
const COLORS = { emerald: '#10b981', amber: '#f59e0b', sky: '#0ea5e9', violet: '#8b5cf6', rose: '#f43f5e', ink: '#94a3b8' }
const STAGE_COLORS = {
  'Deal Created': '#94a3b8', 'Requirement Analysis': '#38bdf8', 'Solution Discussion': '#0ea5e9',
  'Decision Maker Review': '#6366f1', 'Proposal / Quotation': '#f59e0b', Negotiation: '#8b5cf6',
  'Final Decision': '#d946ef', 'Closed Won': '#10b981', 'Closed Lost': '#f43f5e', 'Closed Lost – Competition': '#e11d48',
}
const LEAD_STATUS_COLORS = { New: '#94a3b8', Contacted: '#f59e0b', Qualified: '#0ea5e9', Unqualified: '#64748b', Lost: '#f43f5e', Converted: '#10b981' }
const ENQUIRY_STATUS_COLORS = {
  New: '#94a3b8', Assigned: '#0ea5e9', Contacted: '#f59e0b', 'Under Review': '#f59e0b',
  Qualified: '#8b5cf6', Converted: '#10b981', Unqualified: '#64748b', Duplicate: '#64748b',
  Spam: '#f43f5e', 'Not Interested': '#f43f5e', Closed: '#94a3b8',
}
const SCORE_BUCKETS = [{ label: '0-20', min: 0, max: 20 }, { label: '21-40', min: 21, max: 40 }, { label: '41-60', min: 41, max: 60 }, { label: '61-80', min: 61, max: 80 }, { label: '81-100', min: 81, max: 100 }]
// A Lead is "closed" (no more follow-up expected) once it lands on any of its three terminal
// outcomes — Converted, Unqualified or Lost.
const LEAD_TERMINAL_STATUSES = ['Converted', 'Unqualified', 'Lost']

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid var(--tw-tooltip-border, #e2e8f0)', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

export default function Dashboard() {
  const { names: sourceNames } = useLeadSources()
  const { data, loading } = useDashboardData()
  const MONTHLY_PERFORMANCE = useMonthlyPerformance()
  const { user } = useAuth()
  const { isGlobal, isAll, label: branchLabel, activeNames } = useBranch()
  const branchSummary = useBranchSummary(activeNames)
  const sampleNote = ''
  const { accentHex } = useTheme()
  const navigate = useNavigate()

  const stats = useMemo(() => {
    if (!data) return null
    const { leads, deals, customers, projects, invoices, tasks } = data
    const activeDeals = deals.filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage))
    const wonDeals = deals.filter((d) => d.stage === 'Closed Won')
    const pendingPayments = invoices.reduce((s, inv) => s + (['Sent', 'Viewed', 'Overdue', 'Partially Paid'].includes(inv.status) ? (inv.balance ?? (inv.amount - (inv.paidAmount || 0))) || 0 : 0), 0)
    const pendingFollowUps = leads.filter((l) => l.nextFollowUp && !LEAD_TERMINAL_STATUSES.includes(l.status)).length
    return [
      { label: 'Total Leads', value: leads.length, icon: Users, tone: 'brand' },
      { label: 'New Leads', value: leads.filter((l) => l.status === 'New').length, icon: UserPlus, tone: 'sky' },
      { label: 'Qualified Leads', value: leads.filter((l) => l.status === 'Qualified').length, icon: Target, tone: 'violet' },
      { label: 'Active Deals', value: activeDeals.length, icon: Handshake, tone: 'amber' },
      { label: 'Won Deals', value: wonDeals.length, icon: Trophy, tone: 'emerald' },
      { label: 'Active Customers', value: customers.filter((c) => c.status === 'Active').length, icon: UserSquare2, tone: 'brand' },
      { label: 'Active Projects', value: projects.filter((p) => p.status === 'Active').length, icon: FolderKanban, tone: 'sky' },
      { label: isAll ? 'Monthly Revenue' : 'Monthly Revenue (company)', value: MONTHLY_PERFORMANCE.at(-1)?.revenue == null ? '—' : formatCurrency(MONTHLY_PERFORMANCE.at(-1).revenue, { compact: true }), icon: IndianRupee, tone: 'emerald' },
      { label: 'Pending Payments', value: formatCurrency(pendingPayments, { compact: true }), icon: Wallet, tone: 'rose' },
      { label: 'Pending Follow-ups', value: pendingFollowUps, icon: Clock, tone: 'amber' },
    ]
  }, [data, isAll])

  // Order-to-cash KPIs, straight from the live Sales Order / Invoice records (same data the Sales
  // Orders page shows), so a status change or new invoice is reflected here immediately.
  const orderStats = useMemo(() => {
    if (!data) return null
    const orders = data.salesOrders || []
    const open = orders.filter((o) => ['Draft', 'Confirmed', 'Processing', 'Partially Fulfilled'].includes(o.status))
    const live = (id) => (data.invoices || []).find((i) => i.id === id && i.status !== 'Cancelled' && i.status !== 'Void')
    const toInvoice = orders.filter((o) => ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled'].includes(o.status) && !live(o.invoiceId))
    return [
      { label: 'Open Sales Orders', value: open.length, icon: ClipboardList, tone: 'brand' },
      { label: 'Open Order Value', value: formatCurrency(open.reduce((s, o) => s + (o.amount || 0), 0), { compact: true }), icon: IndianRupee, tone: 'violet' },
      { label: 'In Fulfilment', value: orders.filter((o) => ['Processing', 'Partially Fulfilled'].includes(o.status)).length, icon: Truck, tone: 'amber' },
      { label: 'Fulfilled Orders', value: orders.filter((o) => o.status === 'Fulfilled').length, icon: ClipboardCheck, tone: 'emerald' },
      { label: 'Awaiting Invoice', value: toInvoice.length, icon: Receipt, tone: 'sky' },
    ]
  }, [data])

  // Dedicated, clickable Lead-status KPI row — the exact 7 cards the Lead Management module
  // asks for (Total/New/Contacted/Qualified/Unqualified/Lost/Converted), each opening the Lead
  // list pre-filtered to that status. Kept separate from `stats` above (which mixes Lead counts
  // with unrelated Deal/Customer/Project/Revenue metrics that shouldn't all be clickable) and
  // from `leadStats` below (supplementary follow-up/conversion-rate metrics).
  const leadStatusOverview = useMemo(() => {
    if (!data) return null
    const { leads } = data
    const count = (s) => leads.filter((l) => l.status === s).length
    return [
      { label: 'Total Leads', value: leads.length, icon: Users, tone: 'brand', status: null },
      { label: 'New', value: count('New'), icon: UserPlus, tone: 'sky', status: 'New' },
      { label: 'Contacted', value: count('Contacted'), icon: PhoneCall, tone: 'amber', status: 'Contacted' },
      { label: 'Qualified', value: count('Qualified'), icon: Target, tone: 'violet', status: 'Qualified' },
      { label: 'Unqualified', value: count('Unqualified'), icon: XCircle, tone: 'ink', status: 'Unqualified' },
      { label: 'Lost', value: count('Lost'), icon: Ban, tone: 'rose', status: 'Lost' },
      { label: 'Converted', value: count('Converted'), icon: Handshake, tone: 'emerald', status: 'Converted' },
    ]
  }, [data])

  // Lead Management is deliberately just New/Contacted/Qualified/Unqualified/Lost/Converted —
  // everything downstream of a conversion (Opportunities, Quotations, Negotiations, the Deal's
  // own Won/Lost) is Deal reporting instead (see the "Active Deals"/"Won Deals" cards above and
  // Reports → Deals).
  const leadStats = useMemo(() => {
    if (!data) return null
    const { leads } = data
    const today = new Date().toISOString().slice(0, 10)
    const contacted = leads.filter((l) => l.status === 'Contacted').length
    const converted = leads.filter((l) => l.status === 'Converted').length
    const unassigned = leads.filter((l) => !l.assignedTo).length
    const todayFollowUps = leads.filter((l) => l.nextFollowUp === today && !LEAD_TERMINAL_STATUSES.includes(l.status)).length
    const overdueFollowUps = leads.filter((l) => l.nextFollowUp && l.nextFollowUp < today && !LEAD_TERMINAL_STATUSES.includes(l.status)).length
    const conversionRate = leads.length ? Math.round((converted / leads.length) * 1000) / 10 : 0
    // No `change` field on these — there's no prior-period baseline for these newer metrics
    // in this mock, and StatCard renders a "vs last period" comparison whenever `change` is
    // present, so fabricating a number would be misleading.
    return [
      { label: 'Contacted Leads', value: contacted, icon: PhoneCall, tone: 'sky' },
      { label: 'Converted Leads', value: converted, icon: Handshake, tone: 'emerald' },
      { label: 'Unassigned Leads', value: unassigned, icon: UserCog, tone: 'violet' },
      { label: "Today's Follow-ups", value: todayFollowUps, icon: CalendarClock, tone: 'brand' },
      { label: 'Overdue Follow-ups', value: overdueFollowUps, icon: AlertTriangle, tone: 'rose' },
      { label: 'Lead Conversion Rate', value: `${conversionRate}%`, icon: Percent, tone: 'emerald' },
    ]
  }, [data])

  const leadSourceData = useMemo(() => {
    if (!data) return []
    const counts = {}
    sourceNames.forEach((s) => (counts[s] = 0))
    data.leads.forEach((l) => {
      counts[l.source] = (counts[l.source] || 0) + 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [data, sourceNames])

  const leadPipelineData = useMemo(() => {
    if (!data) return []
    return LEAD_STATUSES.map((status) => ({ status, count: data.leads.filter((l) => l.status === status).length }))
  }, [data])

  const leadScoreDistribution = useMemo(() => {
    if (!data) return []
    return SCORE_BUCKETS.map((b) => ({ name: b.label, value: data.leads.filter((l) => l.score >= b.min && l.score <= b.max).length }))
  }, [data])

  const enquiryStats = useMemo(() => {
    if (!data) return null
    const { enquiries } = data
    const today = new Date().toISOString().slice(0, 10)
    const newCount = enquiries.filter((e) => e.status === 'New').length
    const unassigned = enquiries.filter((e) => !e.assignedUser).length
    const todayCount = enquiries.filter((e) => e.date === today).length
    const assigned = enquiries.filter((e) => e.status === 'Assigned').length
    const contacted = enquiries.filter((e) => e.status === 'Contacted').length
    const qualified = enquiries.filter((e) => e.status === 'Qualified').length
    const converted = enquiries.filter((e) => e.status === 'Converted').length
    const unqualified = enquiries.filter((e) => e.status === 'Unqualified').length
    // "Lost / Closed" is a single KPI card per spec §3/§21, combining the two closed-out
    // dispositions for display — the underlying statuses stay distinct everywhere else
    // (filters, Kanban, reports), this is just the one summary number.
    const lostClosed = enquiries.filter((e) => ['Closed', 'Not Interested'].includes(e.status)).length
    const duplicate = enquiries.filter((e) => e.status === 'Duplicate').length
    const overdueFollowUps = enquiries.filter((e) => e.nextFollowUp && e.nextFollowUp < today && !['Converted', 'Duplicate', 'Spam'].includes(e.status)).length
    const conversionRate = enquiries.length ? Math.round((converted / enquiries.length) * 1000) / 10 : 0
    return [
      { label: 'Total Enquiries', value: enquiries.length, icon: Inbox, tone: 'brand', status: null },
      { label: 'New Enquiries', value: newCount, icon: UserPlus, tone: 'sky', status: 'New' },
      { label: 'Assigned', value: assigned, icon: UserCog, tone: 'amber', status: 'Assigned' },
      { label: 'Contacted', value: contacted, icon: PhoneCall, tone: 'sky', status: 'Contacted' },
      { label: 'Qualified', value: qualified, icon: ClipboardCheck, tone: 'violet', status: 'Qualified' },
      { label: 'Converted', value: converted, icon: Trophy, tone: 'emerald', status: 'Converted' },
      { label: 'Unqualified', value: unqualified, icon: XCircle, tone: 'ink', status: 'Unqualified' },
      { label: 'Lost / Closed', value: lostClosed, icon: Ban, tone: 'rose', status: 'Closed' },
      { label: 'Unassigned', value: unassigned, icon: UserCog, tone: 'amber', status: null },
      { label: "Today's Enquiries", value: todayCount, icon: CalendarClock, tone: 'brand', status: null },
      { label: 'Duplicate', value: duplicate, icon: Sprout, tone: 'ink', status: 'Duplicate' },
      { label: 'Overdue Follow-ups', value: overdueFollowUps, icon: AlertTriangle, tone: 'rose', status: null },
      { label: 'Enquiry → Lead Conversion Rate', value: `${conversionRate}%`, icon: Percent, tone: 'emerald', status: null },
    ]
  }, [data])

  const enquirySourceData = useMemo(() => {
    if (!data) return []
    const counts = {}
    sourceNames.forEach((s) => (counts[s] = 0))
    data.enquiries.forEach((e) => { counts[e.source] = (counts[e.source] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [data, sourceNames])

  const enquiryPipelineData = useMemo(() => {
    if (!data) return []
    return ENQUIRY_STATUSES.map((status) => ({ status, count: data.enquiries.filter((e) => e.status === status).length }))
  }, [data])

  const leadsBySalesperson = useMemo(() => {
    if (!data) return []
    const byRep = {}
    data.leads.forEach((l) => { byRep[l.assignedTo] = (byRep[l.assignedTo] || 0) + 1 })
    return Object.entries(byRep)
      .map(([id, value]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [data])

  const funnelData = useMemo(() => {
    if (!data) return []
    return DEAL_STAGES.filter((s) => s !== 'Closed Lost' && s !== 'Closed Lost – Competition').map((stage) => ({
      stage,
      count: data.deals.filter((d) => d.stage === stage).length,
    }))
  }, [data])

  const pipelineData = useMemo(() => {
    if (!data) return []
    return DEAL_STAGES.filter((s) => s !== 'Closed Lost' && s !== 'Closed Lost – Competition').map((stage) => ({
      name: stage,
      value: data.deals.filter((d) => d.stage === stage).reduce((s, d) => s + d.value, 0),
    })).filter((d) => d.value > 0)
  }, [data])

  const teamPerformance = useMemo(() => {
    if (!data) return []
    const byRep = {}
    data.deals.filter((d) => d.stage === 'Closed Won').forEach((d) => {
      byRep[d.salesperson] = (byRep[d.salesperson] || 0) + d.value
    })
    return Object.entries(byRep)
      .map(([id, value]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [data])

  const recentActivities = useMemo(() => {
    if (!data) return []
    return [...data.activities].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6)
  }, [data])

  const upcoming = useMemo(() => {
    if (!data) return []
    const items = [
      ...data.tasks.filter((t) => ['To Do', 'In Progress', 'Waiting / On Hold', 'Reopened'].includes(t.status)).map((t) => ({ id: t.id, kind: 'Task', title: t.title, date: t.dueDate, priority: t.priority, sub: t.relatedName })),
      ...data.leads.filter((l) => l.nextFollowUp && !LEAD_TERMINAL_STATUSES.includes(l.status)).map((l) => ({ id: l.id, kind: 'Follow-up', title: `Follow up with ${l.name}`, date: l.nextFollowUp, priority: l.priority, sub: l.company })),
      ...data.enquiries.filter((e) => e.nextFollowUp && !['Converted', 'Duplicate', 'Spam'].includes(e.status)).map((e) => ({ id: e.id, kind: 'Follow-up', title: `Follow up with ${e.name}`, date: e.nextFollowUp, priority: e.priority, sub: e.company })),
    ]
    return items.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 7)
  }, [data])

  if (loading || !stats) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Loading your business overview…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  const KIND_ICON = { Task: CalendarClock, 'Follow-up': Phone }

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0]}`}
        description={isAll ? "Here's what's happening across your business today." : `Here's what's happening in the ${branchLabel} branch today.`}
        actions={<Button variant="secondary" onClick={() => navigate('/reports/sales')}>View Full Reports</Button>}
      />

      {isGlobal && isAll && (
        <section className="mb-5 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900" aria-label="Branch comparison">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3 dark:border-ink-800">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Branch comparison</h2>
            <Button size="sm" variant="ghost" onClick={() => navigate('/branches')}>Branch management</Button>
          </div>
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead><tr className="bg-ink-50/60 dark:bg-ink-800/40">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Branch</th>
                {SUMMARY_COLUMNS.map(([k, l]) => <th key={k} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-500">{l}</th>)}
              </tr></thead>
              <tbody>
                {[...branchSummary.rows, branchSummary.total].filter((r) => r?.branch).map((r) => (
                  <tr key={r.branch} className={`border-t border-ink-50 dark:border-ink-800/60 ${r.branch === 'All branches' ? 'bg-ink-50/50 font-semibold dark:bg-ink-800/30' : ''}`}>
                    <td className="px-4 py-2 text-ink-800 dark:text-ink-100">{r.branch}</td>
                    {SUMMARY_COLUMNS.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums text-ink-700 dark:text-ink-200">{r[k]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <Button size="sm" icon={UserPlus} onClick={() => navigate('/leads?create=1')}>Add Lead</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads?status=New')}>New Leads</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads?unassigned=1')}>Unassigned</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/calendar')}>Follow-ups</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads?status=Qualified')}>Qualified Leads</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/deals')}>Opportunities</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads?status=Converted')}>Converted Leads</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/lead-sources')}>Leads by Source</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <p className="mb-2.5 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-400">Sales Orders</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {orderStats.map((s) => <StatCard key={s.label} {...s} onClick={() => navigate('/sales-orders')} />)}
      </div>

      <p className="mb-2.5 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-400">Lead Status Overview</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
        {leadStatusOverview.map((s) => (
          <StatCard key={s.label} {...s} onClick={() => navigate(s.status ? `/leads?status=${s.status}` : '/leads')} />
        ))}
      </div>

      <p className="mb-2.5 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-400">Lead Pipeline &amp; Performance</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {leadStats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <p className="mb-2.5 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-400">Enquiry Pipeline &amp; Performance</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {enquiryStats.map((s) => (
          <StatCard
            key={s.label}
            {...s}
            onClick={() => navigate(
              s.label === 'Unassigned' ? '/enquiries?unassigned=1' : s.status ? `/enquiries?status=${s.status}` : '/enquiries',
            )}
          />
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <ChartCard title="Revenue Overview" subtitle={`Actual revenue vs target — last 12 months${sampleNote}`} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={MONTHLY_PERFORMANCE} margin={{ left: -12 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={accentHex} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={accentHex} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={64} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} />
              <Area type="monotone" dataKey="revenue" stroke={accentHex} strokeWidth={2.5} fill="url(#revFill)" name="Revenue" />
              <Area type="monotone" dataKey="target" stroke={COLORS.ink} strokeWidth={1.5} strokeDasharray="4 4" fill="none" name="Target" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sales Funnel" subtitle="Deals by stage">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={78} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}>
                {funnelData.map((d) => <Cell key={d.stage} fill={STAGE_COLORS[d.stage]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Source Performance" subtitle="Top channels by lead volume — click a bar to view its leads">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadSourceData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar
                dataKey="value" fill={accentHex} radius={[6, 6, 0, 0]} name="Leads" cursor="pointer"
                onClick={(d) => navigate(`/leads?source=${encodeURIComponent(d.name)}`)}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Deal Pipeline" subtitle="Open pipeline value by stage">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pipelineData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {pipelineData.map((d) => <Cell key={d.name} fill={STAGE_COLORS[d.name]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly Sales" subtitle={`Deals closed per month${sampleNote}`}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={MONTHLY_PERFORMANCE} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="deals" fill={COLORS.emerald} radius={[6, 6, 0, 0]} name="Deals Closed" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Team Performance" subtitle="Revenue won by sales rep">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={teamPerformance} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.violet} radius={[0, 6, 6, 0]} barSize={18} name="Revenue Won" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Customer Growth" subtitle={`Cumulative customers — last 12 months${sampleNote}`} className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={MONTHLY_PERFORMANCE} margin={{ left: -12 }}>
              <defs>
                <linearGradient id="custFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.sky} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={COLORS.sky} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle()} />
              <Area type="monotone" dataKey="customers" stroke={COLORS.sky} strokeWidth={2.5} fill="url(#custFill)" name="Customers" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Pipeline" subtitle="Leads by status">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadPipelineData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="status" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={78} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                {leadPipelineData.map((d) => <Cell key={d.status} fill={LEAD_STATUS_COLORS[d.status]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Score Distribution" subtitle="Leads grouped by score range">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadScoreDistribution} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.amber} radius={[6, 6, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Leads by Salesperson" subtitle="Open + closed leads assigned per rep">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadsBySalesperson} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={accentHex} radius={[0, 6, 6, 0]} barSize={18} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Enquiries by Source" subtitle="Top channels by enquiry volume">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={enquirySourceData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.sky} radius={[6, 6, 0, 0]} name="Enquiries" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Enquiry Pipeline" subtitle="Enquiries by status">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={enquiryPipelineData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="status" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={82} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16}>
                {enquiryPipelineData.map((d) => <Cell key={d.status} fill={ENQUIRY_STATUS_COLORS[d.status] || COLORS.ink} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card lg:col-span-3 dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Recent Activities</h3>
            <button onClick={() => navigate('/activities')} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <ActivityTimeline items={recentActivities} />
        </div>

        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card lg:col-span-2 dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Upcoming</h3>
            <button onClick={() => navigate('/calendar')} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              Calendar <ArrowRight size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {upcoming.map((item) => {
              const Icon = KIND_ICON[item.kind] || CalendarClock
              const overdue = isOverdue(item.date)
              return (
                <div key={`${item.kind}-${item.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${overdue ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400'}`}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{item.title}</p>
                    <p className="truncate text-xs text-ink-400">{item.sub}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xs font-medium ${overdue ? 'text-rose-500' : 'text-ink-400'}`}>{formatDate(item.date, { year: undefined })}</p>
                    <PriorityBadge priority={item.priority} className="mt-1 !px-1.5 !py-0.5 !text-[10px]" />
                  </div>
                </div>
              )
            })}
            {upcoming.length === 0 && <p className="py-8 text-center text-sm text-ink-400">Nothing scheduled. You're all caught up!</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
