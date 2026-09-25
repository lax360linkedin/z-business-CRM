import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Wallet, Users, IndianRupee, Percent } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { StatCard } from '../../components/common/StatCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { CardSkeleton, Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { LEAD_SOURCES } from '../../data/constants'
import { formatCurrency } from '../../utils/format'
import { useTheme } from '../../context/ThemeContext'

const COLORS = { emerald: '#10b981', amber: '#f59e0b', sky: '#0ea5e9', violet: '#8b5cf6', rose: '#f43f5e', ink: '#94a3b8' }
const CHANNEL_PALETTE = ['#9333ea', '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#94a3b8', '#ec4899']

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid var(--tw-tooltip-border, #e2e8f0)', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

function truncate(str, n) {
  return str.length > n ? `${str.slice(0, n)}…` : str
}

export default function MarketingAnalytics() {
  const { accentHex } = useTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/campaigns', { params: { all: true } }),
      api.get('/leads', { params: { all: true } }),
    ])
      .then(([campaignsRes, leadsRes]) => setData({ campaigns: campaignsRes.data, leads: leadsRes.data }))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    if (!data) return null
    const { campaigns } = data
    const totalSpend = campaigns.reduce((s, c) => s + c.budget, 0)
    const totalLeads = campaigns.reduce((s, c) => s + c.leadsGenerated, 0)
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
    const blendedRoi = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0
    return [
      { label: 'Total Marketing Spend', value: formatCurrency(totalSpend, { compact: true }), icon: Wallet, tone: 'amber' },
      { label: 'Total Leads Generated', value: totalLeads.toLocaleString('en-IN'), icon: Users, tone: 'brand' },
      { label: 'Total Revenue Attributed', value: formatCurrency(totalRevenue, { compact: true }), icon: IndianRupee, tone: 'emerald' },
      { label: 'Blended ROI', value: `${blendedRoi >= 0 ? '+' : ''}${blendedRoi}%`, icon: Percent, tone: blendedRoi >= 0 ? 'emerald' : 'rose' },
    ]
  }, [data])

  const campaignRevenueData = useMemo(() => {
    if (!data) return []
    return [...data.campaigns]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((c) => ({ name: truncate(c.name, 16), value: c.revenue }))
  }, [data])

  const channelLeadsData = useMemo(() => {
    if (!data) return []
    const byChannel = {}
    data.campaigns.forEach((c) => { byChannel[c.channel] = (byChannel[c.channel] || 0) + c.leadsGenerated })
    return Object.entries(byChannel)
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [data])

  const roiData = useMemo(() => {
    if (!data) return []
    return [...data.campaigns]
      .sort((a, b) => b.roi - a.roi)
      .slice(0, 10)
      .map((c) => ({ name: truncate(c.name, 14), roi: c.roi }))
  }, [data])

  const leadSourceData = useMemo(() => {
    if (!data) return []
    const counts = {}
    LEAD_SOURCES.forEach((s) => (counts[s] = 0))
    data.leads.forEach((l) => { counts[l.source] = (counts[l.source] || 0) + 1 })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [data])

  if (loading || !stats) {
    return (
      <div>
        <PageHeader title="Marketing Analytics" description="Loading campaign and channel performance…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Marketing Analytics"
        description="Campaign performance, channel effectiveness, and lead source ROI at a glance."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Campaign Performance" subtitle="Revenue by campaign — top 8">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={campaignRevenueData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={64} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={accentHex} radius={[6, 6, 0, 0]} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Channel Performance" subtitle="Leads generated by channel">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={channelLeadsData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                {channelLeadsData.map((d, i) => <Cell key={d.name} fill={CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="ROI by Campaign" subtitle="Return on investment — top 10 campaigns">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={roiData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={92} />
              <Tooltip formatter={(v) => `${v}%`} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="roi" radius={[0, 6, 6, 0]} barSize={16} name="ROI">
                {roiData.map((d) => <Cell key={d.name} fill={d.roi >= 0 ? COLORS.emerald : COLORS.rose} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Source Funnel" subtitle="Lead volume by source — top 8">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={leadSourceData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="value" fill={COLORS.violet} radius={[6, 6, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}
