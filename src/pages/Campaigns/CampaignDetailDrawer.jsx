import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Users, Target, Trophy, IndianRupee, TrendingUp, TrendingDown, Calendar, Wallet } from 'lucide-react'
import { Drawer } from '../../components/common/Drawer'
import { StatCard } from '../../components/common/StatCard'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { formatCurrency, formatDate } from '../../utils/format'

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid var(--tw-tooltip-border, #e2e8f0)', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

export function CampaignDetailDrawer({ campaign, open, onClose }) {
  if (!campaign) return null

  const funnelData = [
    { name: 'Leads', value: campaign.leadsGenerated, color: '#6366f1' },
    { name: 'Qualified', value: campaign.qualifiedLeads, color: '#8b5cf6' },
    { name: 'Customers', value: campaign.customersWon, color: '#10b981' },
  ]

  const roiPositive = campaign.roi >= 0
  const days = campaign.startDate && campaign.endDate
    ? Math.max(0, Math.round((new Date(campaign.endDate) - new Date(campaign.startDate)) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={campaign.name}
      subtitle={`${campaign.channel} • ${campaign.id}`}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={campaign.status} />
        <Badge tone="neutral">{campaign.channel}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Leads Generated" value={campaign.leadsGenerated} icon={Users} tone="brand" />
        <StatCard label="Qualified Leads" value={campaign.qualifiedLeads} icon={Target} tone="violet" />
        <StatCard label="Customers Won" value={campaign.customersWon} icon={Trophy} tone="emerald" />
        <StatCard label="Revenue" value={formatCurrency(campaign.revenue, { compact: true })} icon={IndianRupee} tone="sky" />
        <StatCard
          label="ROI"
          value={`${campaign.roi}%`}
          icon={roiPositive ? TrendingUp : TrendingDown}
          tone={roiPositive ? 'emerald' : 'rose'}
        />
        <StatCard label="Budget" value={formatCurrency(campaign.budget, { compact: true })} icon={Wallet} tone="amber" />
      </div>

      <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Performance Funnel</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={funnelData} margin={{ left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
            <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
              {funnelData.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
        <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Campaign Details</h3>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400"><Calendar size={13} /> Start Date</dt>
          <dd className="text-right font-medium text-ink-800 dark:text-ink-100">{formatDate(campaign.startDate)}</dd>
          <dt className="flex items-center gap-1.5 text-ink-500 dark:text-ink-400"><Calendar size={13} /> End Date</dt>
          <dd className="text-right font-medium text-ink-800 dark:text-ink-100">{formatDate(campaign.endDate)}</dd>
          {days !== null && (
            <>
              <dt className="text-ink-500 dark:text-ink-400">Duration</dt>
              <dd className="text-right font-medium text-ink-800 dark:text-ink-100">{days} days</dd>
            </>
          )}
          <dt className="text-ink-500 dark:text-ink-400">Cost per Lead</dt>
          <dd className="text-right font-medium text-ink-800 dark:text-ink-100">
            {campaign.leadsGenerated > 0 ? formatCurrency(campaign.budget / campaign.leadsGenerated) : '—'}
          </dd>
          <dt className="text-ink-500 dark:text-ink-400">Conversion Rate</dt>
          <dd className="text-right font-medium text-ink-800 dark:text-ink-100">
            {campaign.leadsGenerated > 0 ? `${Math.round((campaign.customersWon / campaign.leadsGenerated) * 1000) / 10}%` : '—'}
          </dd>
        </dl>
      </div>
    </Drawer>
  )
}
