import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Flame, AlertTriangle, TrendingUp, Target, Lightbulb, ShieldAlert, Sparkles, ArrowRight } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { ChartCard } from '../../components/charts/ChartCard'
import { CardSkeleton, Skeleton } from '../../components/common/LoadingSkeleton'
import { Button } from '../../components/common/Button'
import { api } from '../../api/mockServer'
import { useMonthlyPerformance } from '../../hooks/useMonthlyPerformance'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'

const SOURCE_LIST = ['Website', 'Instagram', 'Google Ads', 'Facebook', 'LinkedIn', 'WhatsApp', 'Google Organic', 'Referral', 'Phone Call', 'Walk-in', 'Other']

const TONE_STYLES = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
}

function InsightCard({ icon: Icon, tone, title, children, action }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_STYLES[tone]}`}>
          <Icon size={18} />
        </span>
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
      </div>
      <div className="text-sm leading-relaxed text-ink-600 dark:text-ink-300">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default function AIInsights() {
  const MONTHLY_PERFORMANCE = useMonthlyPerformance()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      api.get('/leads', { params: { all: true } }),
      api.get('/deals', { params: { all: true } }),
      api.get('/campaigns', { params: { all: true } }),
    ]).then(([leads, deals, campaigns]) => {
      setData({ leads: leads.data, deals: deals.data, campaigns: campaigns.data })
    }).finally(() => setLoading(false))
  }, [])

  const insights = useMemo(() => {
    if (!data) return null
    const { leads, deals } = data
    const openLeads = leads.filter((l) => !['Converted', 'Lost'].includes(l.status))

    const topLead = [...openLeads].sort((a, b) => b.score - a.score)[0]

    const overdueLeads = openLeads.filter((l) => l.nextFollowUp && isOverdue(l.nextFollowUp))

    const lastMonth = MONTHLY_PERFORMANCE.at(-1) || {}
    const prevMonth = MONTHLY_PERFORMANCE.at(-2)
    const revenueChange = prevMonth?.revenue ? (((lastMonth.revenue || 0) - prevMonth.revenue) / prevMonth.revenue) * 100 : 0

    const sourceStats = SOURCE_LIST.map((source) => {
      const sourceLeads = leads.filter((l) => l.source === source)
      const converted = sourceLeads.filter((l) => l.status === 'Converted').length
      return { source, count: sourceLeads.length, rate: sourceLeads.length ? (converted / sourceLeads.length) * 100 : 0 }
    }).filter((s) => s.count >= 2)
    const bestSource = [...sourceStats].sort((a, b) => b.rate - a.rate)[0]

    const atRiskDeal = deals
      .filter((d) => d.stage === 'Negotiation' && isOverdue(d.expectedClosingDate))
      .sort((a, b) => new Date(a.expectedClosingDate) - new Date(b.expectedClosingDate))[0]

    const scoreBuckets = [
      { range: '0-20', count: 0 }, { range: '21-40', count: 0 }, { range: '41-60', count: 0 },
      { range: '61-80', count: 0 }, { range: '81-100', count: 0 },
    ]
    leads.forEach((l) => {
      const idx = Math.min(4, Math.floor(l.score / 20))
      scoreBuckets[idx].count += 1
    })

    return { topLead, overdueLeads, revenueChange, bestSource, atRiskDeal, scoreBuckets, openLeadsCount: openLeads.length }
  }, [data, MONTHLY_PERFORMANCE])

  if (loading || !insights) {
    return (
      <div>
        <PageHeader title="AI Insights" description="Loading recommendations from your business data…" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} className="h-40" />)}
        </div>
        <Skeleton className="mt-5 h-72 rounded-2xl" />
      </div>
    )
  }

  const { topLead, overdueLeads, revenueChange, bestSource, atRiskDeal, scoreBuckets, openLeadsCount } = insights

  return (
    <div>
      <PageHeader
        title="AI Insights"
        description="Smart recommendations generated from patterns in your live CRM data."
        actions={<div className="flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Sparkles size={13} /> Updated just now</div>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {topLead && (
          <InsightCard icon={Flame} tone="rose" title="🔥 High Conversion Lead">
            <p><span className="font-semibold text-ink-800 dark:text-ink-100">{topLead.name}</span> from {topLead.company} has a lead score of <span className="font-semibold">{topLead.score}</span> — among your highest open leads. Prioritize this one.</p>
            <Button size="sm" variant="subtle" className="mt-3" onClick={() => navigate(`/leads?open=${topLead.id}`)}>View Lead <ArrowRight size={13} /></Button>
          </InsightCard>
        )}

        <InsightCard icon={AlertTriangle} tone="amber" title="⚠ Follow-up Overdue">
          <p><span className="font-semibold text-ink-800 dark:text-ink-100">{overdueLeads.length}</span> lead{overdueLeads.length !== 1 ? 's have' : ' has'} a follow-up date that has already passed.</p>
          {overdueLeads.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-500 dark:text-ink-400">
              {overdueLeads.slice(0, 3).map((l) => <li key={l.id}>• {l.name} — due {formatDate(l.nextFollowUp)}</li>)}
            </ul>
          )}
          <Button size="sm" variant="subtle" className="mt-3" onClick={() => navigate('/leads')}>Review Follow-ups <ArrowRight size={13} /></Button>
        </InsightCard>

        <InsightCard icon={TrendingUp} tone="emerald" title="📈 Revenue Trend">
          <p>Monthly revenue is {revenueChange >= 0 ? 'up' : 'down'} <span className="font-semibold text-ink-800 dark:text-ink-100">{Math.abs(revenueChange).toFixed(1)}%</span> compared to last month, based on your revenue trend data.</p>
        </InsightCard>

        {bestSource && (
          <InsightCard icon={Target} tone="violet" title="🎯 Best Performing Lead Source">
            <p><span className="font-semibold text-ink-800 dark:text-ink-100">{bestSource.source}</span> converts at <span className="font-semibold">{bestSource.rate.toFixed(0)}%</span> — your strongest channel among sources with meaningful volume.</p>
            <Button size="sm" variant="subtle" className="mt-3" onClick={() => navigate('/lead-sources')}>View Lead Sources <ArrowRight size={13} /></Button>
          </InsightCard>
        )}

        <InsightCard icon={Lightbulb} tone="sky" title="💡 Recommended Action">
          <p>
            {overdueLeads.length > 5
              ? `Prioritize follow-ups this week — ${overdueLeads.length} leads are awaiting contact.`
              : openLeadsCount > 20
              ? `You have ${openLeadsCount} open leads in the funnel. Consider reviewing stale ones to keep the pipeline healthy.`
              : 'Your pipeline looks healthy — keep up the current follow-up cadence.'}
          </p>
        </InsightCard>

        {atRiskDeal && (
          <InsightCard icon={ShieldAlert} tone="rose" title="⚠ Deal At Risk">
            <p>
              <span className="font-semibold text-ink-800 dark:text-ink-100">{atRiskDeal.companyName}</span> ({formatCurrency(atRiskDeal.value, { compact: true })}) is still in Negotiation past its expected closing date of {formatDate(atRiskDeal.expectedClosingDate)}.
            </p>
            <Button size="sm" variant="subtle" className="mt-3" onClick={() => navigate('/pipeline')}>Open Pipeline <ArrowRight size={13} /></Button>
          </InsightCard>
        )}
      </div>

      <ChartCard title="Lead Score Distribution" subtitle="How your open leads are scored across the funnel" className="mt-5">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={scoreBuckets} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
            <XAxis dataKey="range" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Leads">
              {scoreBuckets.map((b, i) => <Cell key={b.range} fill={['#94a3b8', '#0ea5e9', '#6366f1', '#8b5cf6', '#10b981'][i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
