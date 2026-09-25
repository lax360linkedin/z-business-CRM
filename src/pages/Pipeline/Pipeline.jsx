import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  IndianRupee, Scale, Percent, Target, Clock, CalendarClock, AlertTriangle,
  TrendingUp, Users,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { StatCard } from '../../components/common/StatCard'
import { ChartCard } from '../../components/charts/ChartCard'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { KanbanColumn } from '../../components/kanban/KanbanColumn'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { DEAL_STAGES, DEAL_STAGE_PROBABILITY, CLOSED_DEAL_STAGES, PRIORITIES } from '../../data/constants'
import { salesUsers, getUserById, USERS } from '../../data/users'
import { getDataScope, matchesDataScope } from '../../data/dataScope'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'
import { isDealClosed, isDealLost } from '../../data/dealWorkflow'
import { ChangeStageModal } from '../Deals/ChangeStageModal'
import { changeDealStage, markDealLost } from '../Deals/dealActions'

const STAGE_COLORS = {
  'Deal Created': '#94a3b8', 'Requirement Analysis': '#38bdf8', 'Solution Discussion': '#0ea5e9',
  'Decision Maker Review': '#6366f1', 'Proposal / Quotation': '#f59e0b', Negotiation: '#8b5cf6',
  'Final Decision': '#d946ef', 'Closed Won': '#10b981', 'Closed Lost': '#f43f5e', 'Closed Lost – Competition': '#e11d48',
}
const OUTCOME_COLORS = { 'Closed Won': '#10b981', 'Closed Lost': '#f43f5e', 'Closed Lost – Competition': '#e11d48' }
const FUNNEL_STAGES = DEAL_STAGES.filter((s) => s !== 'Closed Lost' && s !== 'Closed Lost – Competition')
const MONTH_LABEL = { month: 'short' }

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid var(--tw-tooltip-border, #e2e8f0)', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

/**
 * Sales Pipeline — a dedicated forecasting/analytics workspace, deliberately distinct from
 * Deal Management (which owns per-deal CRUD, search and the detail page). This page answers
 * "how healthy is the pipeline and where is it heading", not "let me edit a deal": funnel
 * shape, weighted revenue forecast by expected-close month, stage-wise value distribution,
 * win/loss outcome mix, rep performance, and at-risk (overdue) deals — all derived live from
 * the same `deals` collection via useCrud, so every number here moves the instant a deal is
 * created, edited, or its stage changes (including from the Deal Detail page itself, since
 * that also writes through the same /deals resource). The Kanban board at the bottom is kept
 * for the actual drag-and-drop stage movement this page's own charts describe, but is no
 * longer the centerpiece the way it is on the Deals page.
 */
export default function Pipeline() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { accentHex } = useTheme()
  const scope = getDataScope(user?.role, 'Deals')
  const crud = useCrud('deals', {
    searchFields: ['name', 'companyName', 'contactName', 'service'],
    pageSize: 1000,
    filterFn: (row) => matchesDataScope(row, scope, user, 'salesperson', USERS),
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [stageTarget, setStageTarget] = useState(null)
  const [stagePreset, setStagePreset] = useState(null)
  const [changingStage, setChangingStage] = useState(false)
  const { toast } = useToast()

  const reps = salesUsers()

  const filterDefs = [
    { key: 'salesperson', label: 'Salespeople', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
  ]

  const analytics = useMemo(() => {
    const list = crud.allFiltered
    const open = list.filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage))
    const won = list.filter((d) => d.stage === 'Closed Won')
    const lost = list.filter((d) => isDealLost(d.stage))

    const pipelineValue = open.reduce((s, d) => s + d.value, 0)
    const weightedValue = open.reduce((s, d) => s + (d.value * d.probability) / 100, 0)
    const winRate = won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0
    const avgDealSize = list.length ? list.reduce((s, d) => s + d.value, 0) / list.length : 0
    const cycleDeals = won.filter((d) => d.closedAt && d.createdDate)
    const avgCycleDays = cycleDeals.length
      ? Math.round(cycleDeals.reduce((s, d) => s + (new Date(d.closedAt) - new Date(d.createdDate)) / 86400000, 0) / cycleDeals.length)
      : null

    const now = new Date()
    const closingThisMonth = open.filter((d) => {
      if (!d.expectedClosingDate) return false
      const dt = new Date(d.expectedClosingDate)
      return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()
    })
    const closingThisMonthValue = closingThisMonth.reduce((s, d) => s + d.value, 0)

    const funnelData = FUNNEL_STAGES.map((stage) => ({ stage, count: list.filter((d) => d.stage === stage).length }))

    const stageTable = DEAL_STAGES.map((stage) => {
      const stageDeals = list.filter((d) => d.stage === stage)
      return {
        stage,
        count: stageDeals.length,
        value: stageDeals.reduce((s, d) => s + d.value, 0),
        weighted: stageDeals.reduce((s, d) => s + (d.value * d.probability) / 100, 0),
        probability: DEAL_STAGE_PROBABILITY[stage],
      }
    })

    // Revenue forecast — weighted value of currently OPEN deals grouped by their expected
    // closing month, for the next 6 months. Never a fabricated projection — it's a real sum
    // of real open deals' value × probability, bucketed by the date the rep actually entered.
    const forecastMonths = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      return { key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleDateString('en-IN', MONTH_LABEL), value: 0, weighted: 0 }
    })
    open.forEach((d) => {
      if (!d.expectedClosingDate) return
      const dt = new Date(d.expectedClosingDate)
      const bucket = forecastMonths.find((m) => m.key === `${dt.getFullYear()}-${dt.getMonth()}`)
      if (bucket) { bucket.value += d.value; bucket.weighted += (d.value * d.probability) / 100 }
    })

    const outcomeData = [
      { name: 'Closed Won', value: won.length },
      { name: 'Closed Lost', value: list.filter((d) => d.stage === 'Closed Lost').length },
      { name: 'Closed Lost – Competition', value: list.filter((d) => d.stage === 'Closed Lost – Competition').length },
    ].filter((o) => o.value > 0)

    const repMap = {}
    open.forEach((d) => {
      if (!d.salesperson) return
      if (!repMap[d.salesperson]) repMap[d.salesperson] = { count: 0, value: 0, weighted: 0 }
      repMap[d.salesperson].count += 1
      repMap[d.salesperson].value += d.value
      repMap[d.salesperson].weighted += (d.value * d.probability) / 100
    })
    const repData = Object.entries(repMap)
      .map(([id, v]) => ({ name: getUserById(id)?.name.split(' ')[0] || id, ...v }))
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 8)

    const atRisk = open
      .filter((d) => d.expectedClosingDate && isOverdue(d.expectedClosingDate))
      .sort((a, b) => new Date(a.expectedClosingDate) - new Date(b.expectedClosingDate))

    return {
      pipelineValue, weightedValue, winRate, avgDealSize, avgCycleDays,
      closingThisMonthCount: closingThisMonth.length, closingThisMonthValue,
      funnelData, stageTable, forecastMonths, outcomeData, repData, atRisk,
      openCount: open.length,
    }
  }, [crud.allFiltered])

  const updateDeal = (dealId, patch) => crud.update(dealId, patch)

  const handleDrop = (stage) => (e) => {
    e.preventDefault()
    const dealId = e.dataTransfer.getData('text/plain')
    setDragOverStage(null)
    if (!dealId) return
    const deal = crud.allItems.find((d) => d.id === dealId)
    if (!deal || deal.stage === stage || isDealClosed(deal.stage)) return
    if (isDealClosed(stage)) { setStageTarget(deal); setStagePreset(stage); return }
    changeDealStage(deal, stage, { by: user.id, update: updateDeal }).then(() => {
      toast(`Deal moved to ${stage}.`, { type: 'success' })
    }).catch((err) => toast(err.message, { type: 'error' }))
  }

  const doStageChange = ({ newStage, reason, notes }) => {
    setChangingStage(true)
    const action = reason
      ? markDealLost(stageTarget, { stage: newStage, reason, notes, by: user.id, update: updateDeal })
      : changeDealStage(stageTarget, newStage, { by: user.id, update: updateDeal })
    action.then(() => {
      setChangingStage(false)
      setStageTarget(null)
      setStagePreset(null)
      toast(`Deal moved to ${newStage}.`, { type: 'success' })
    }).catch((err) => { setChangingStage(false); toast(err.message, { type: 'error' }) })
  }

  return (
    <div>
      <PageHeader
        title="Sales Pipeline"
        description="Forecast revenue, track conversion and monitor how deals progress through your sales process."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Open Pipeline" value={formatCurrency(analytics.pipelineValue, { compact: true })} icon={IndianRupee} tone="brand" />
        <StatCard label="Weighted Forecast" value={formatCurrency(analytics.weightedValue, { compact: true })} icon={Scale} tone="sky" />
        <StatCard label="Win Rate" value={`${analytics.winRate.toFixed(1)}%`} icon={Percent} tone="emerald" />
        <StatCard label="Avg Deal Size" value={formatCurrency(analytics.avgDealSize, { compact: true })} icon={Target} tone="violet" />
        <StatCard label="Avg Sales Cycle" value={analytics.avgCycleDays !== null ? `${analytics.avgCycleDays}d` : '—'} icon={Clock} tone="amber" />
        <StatCard label="Closing This Month" value={`${analytics.closingThisMonthCount} · ${formatCurrency(analytics.closingThisMonthValue, { compact: true })}`} icon={CalendarClock} tone="rose" />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search pipeline deals…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-5">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Sales Funnel" subtitle="Deal count by stage — the successful path from creation to close">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.funnelData} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={130} />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                {analytics.funnelData.map((d) => <Cell key={d.stage} fill={STAGE_COLORS[d.stage]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue Forecast" subtitle="Open pipeline value vs. weighted forecast, by expected close month">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.forecastMonths} margin={{ left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v, { compact: true })} width={56} />
              <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" fill="#94a3b8" radius={[6, 6, 0, 0]} name="Pipeline Value" />
              <Bar dataKey="weighted" fill={accentHex} radius={[6, 6, 0, 0]} name="Weighted Forecast" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <ChartCard title="Pipeline by Stage" subtitle="Deal count, value and weighted value at every stage" className="lg:col-span-2" bodyClassName="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:text-ink-400">
                <th className="py-2 pr-3">Stage</th>
                <th className="py-2 pr-3">Deals</th>
                <th className="py-2 pr-3">Value</th>
                <th className="py-2 pr-3">Probability</th>
                <th className="py-2">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {analytics.stageTable.map((s) => (
                <tr key={s.stage} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 font-medium text-ink-800 dark:text-ink-100">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STAGE_COLORS[s.stage] }} />
                      {s.stage}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{s.count}</td>
                  <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{formatCurrency(s.value, { compact: true })}</td>
                  <td className="py-2 pr-3 text-ink-600 dark:text-ink-300">{s.probability}%</td>
                  <td className="py-2 font-medium text-ink-700 dark:text-ink-200">{formatCurrency(s.weighted, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>

        <ChartCard title="Win / Loss Mix" subtitle="All closed deals to date">
          {analytics.outcomeData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center">
              <EmptyState title="No closed deals yet" description="Win/loss outcomes will appear here once deals close." />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={analytics.outcomeData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {analytics.outcomeData.map((d) => <Cell key={d.name} fill={OUTCOME_COLORS[d.name]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <ChartCard title="Sales Rep Performance" subtitle="Open weighted pipeline value by owner">
          {analytics.repData.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center">
              <EmptyState title="No open deals" description="Rep performance will appear once deals are assigned." />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.repData} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                <Bar dataKey="weighted" fill={accentHex} radius={[0, 6, 6, 0]} barSize={18} name="Weighted Pipeline" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="At-Risk Deals"
          subtitle="Open deals past their expected closing date"
          action={analytics.atRisk.length > 0 && <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"><AlertTriangle size={12} /> {analytics.atRisk.length}</span>}
        >
          {analytics.atRisk.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center">
              <EmptyState title="Nothing overdue" description="Every open deal is still within its expected close date." />
            </div>
          ) : (
            <div className="max-h-[260px] space-y-2 overflow-y-auto scrollbar-thin">
              {analytics.atRisk.map((d) => (
                <button
                  key={d.id}
                  onClick={() => navigate(`/deals/${d.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2.5 text-left hover:bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/10 dark:hover:bg-rose-900/20"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{d.name}</p>
                    <p className="text-xs text-ink-400">{d.id} · {formatCurrency(d.value, { compact: true })} · <StatusBadge status={d.stage} /></p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{formatDate(d.expectedClosingDate)}</p>
                    <PriorityBadge priority={d.priority} className="mt-1 !px-1.5 !py-0.5" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-800 dark:text-ink-100"><TrendingUp size={15} /> Pipeline Board</p>
        <p className="flex items-center gap-1.5 text-xs text-ink-400"><Users size={12} /> Drag a deal card to move it between stages</p>
      </div>
      <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-2">
        {DEAL_STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            deals={crud.allFiltered.filter((d) => d.stage === stage)}
            onCardClick={(deal) => navigate(`/deals/${deal.id}`)}
            onDrop={handleDrop(stage)}
            isDragOver={dragOverStage === stage}
            onDragOver={() => setDragOverStage(stage)}
            onDragLeave={() => setDragOverStage((s) => (s === stage ? null : s))}
          />
        ))}
      </div>

      <ChangeStageModal
        open={!!stageTarget}
        onClose={() => { setStageTarget(null); setStagePreset(null) }}
        deal={stageTarget}
        presetStage={stagePreset}
        saving={changingStage}
        onSave={doStageChange}
      />
    </div>
  )
}
