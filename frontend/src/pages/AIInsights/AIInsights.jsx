import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, Flame, Info, RefreshCw, Send, ShieldAlert, Sparkles, TrendingUp, Workflow, Zap,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { ChartCard } from '../../components/charts/ChartCard'
import { CardSkeleton, Skeleton } from '../../components/common/LoadingSkeleton'
import { Button } from '../../components/common/Button'
import { Tabs } from '../../components/common/Tabs'
import { Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Dropdown, DropdownItem } from '../../components/common/Dropdown'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useRefreshHandler } from '../../api/refresh'
import { api, errorMessage } from '../../api/http'
import { formatCurrency, timeAgo } from '../../utils/format'

const SEVERITY = {
  critical: { label: 'Critical', icon: ShieldAlert, bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-900/30 dark:text-rose-300', tile: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' },
  warning: { label: 'Needs attention', icon: AlertTriangle, bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300', tile: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' },
  info: { label: 'Good to know', icon: Info, bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-900/30 dark:text-sky-300', tile: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400' },
  positive: { label: 'Going well', icon: TrendingUp, bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300', tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
}
const KPI_TONE = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
}
const KPI_ICON = { open_leads: Flame, pipeline: TrendingUp, forecast: Sparkles, win_rate: CheckCircle2, overdue_money: AlertTriangle, open_tickets: Clock3 }
const RUN_TONE = { Success: 'success', Failed: 'danger', Running: 'info', Queued: 'neutral' }
const SCORE_COLORS = ['#94a3b8', '#0ea5e9', '#6366f1', '#8b5cf6', '#10b981']
const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }
const axis = { fontSize: 12, fill: '#94a3b8' }

function formatKpi(k) {
  if (k.value === null || k.value === undefined) return '—'
  if (k.format === 'currency') return formatCurrency(k.value, { compact: true })
  if (k.format === 'percent') return `${Number(k.value).toFixed(0)}%`
  return Number(k.value).toLocaleString('en-IN')
}

function KpiCard({ kpi, onOpen }) {
  const Icon = KPI_ICON[kpi.key] || Sparkles
  return (
    <button type="button" onClick={() => onOpen(kpi.to)} className="group rounded-2xl border border-ink-100 bg-white p-4 text-left shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-500 dark:text-ink-400">{kpi.label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${KPI_TONE[kpi.tone] || KPI_TONE.brand}`}><Icon size={15} /></span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{formatKpi(kpi)}</p>
      <p className="mt-0.5 truncate text-xs text-ink-400">{kpi.hint}</p>
    </button>
  )
}

function InsightCard({ insight, canAutomate, onSend, sending, onOpen }) {
  const s = SEVERITY[insight.severity] || SEVERITY.info
  const Icon = s.icon
  const workflows = insight.workflows || []
  return (
    <article className="relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-5 pl-6 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${s.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.tile}`}><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{insight.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.chip}`}>{s.label}</span>
            <span className="text-[11px] uppercase tracking-wide text-ink-400">{insight.category}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{insight.summary}</p>
        </div>
        {insight.metric && (
          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{insight.metric.format === 'currency' ? formatCurrency(insight.metric.value, { compact: true }) : insight.metric.value}</p>
            <p className="text-[11px] text-ink-400">{insight.metric.label}</p>
          </div>
        )}
      </div>
      {insight.items.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
          {insight.items.map((item) => (
            <li key={item.id}>
              <Link to={item.to} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                <span className="min-w-0"><span className="block truncate font-medium text-ink-800 dark:text-ink-100">{item.label}</span><span className="block truncate text-xs text-ink-400">{item.detail}</span></span>
                <ArrowRight size={13} className="shrink-0 text-ink-300" />
              </Link>
            </li>
          ))}
          {insight.total > insight.items.length && <li className="px-3 py-1.5 text-xs text-ink-400">and {insight.total - insight.items.length} more</li>}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {insight.action && <Button size="sm" variant="subtle" onClick={() => onOpen(insight.action.to)}>{insight.action.label} <ArrowRight size={13} /></Button>}
        {canAutomate && workflows.length === 1 && (
          <Button size="sm" variant="secondary" icon={Send} loading={sending === insight.key} onClick={() => onSend(insight, workflows[0])}>Send to n8n</Button>
        )}
        {canAutomate && workflows.length > 1 && (
          <Dropdown width="w-60" trigger={<Button size="sm" variant="secondary" icon={Send} loading={sending === insight.key}>Send to n8n</Button>}>
            {workflows.map((w) => <DropdownItem key={w.id} icon={Workflow} onClick={() => onSend(insight, w)}>{w.name}</DropdownItem>)}
          </Dropdown>
        )}
      </div>
    </article>
  )
}

function RecentRuns({ runs }) {
  if (!runs) return null
  return (
    <section className="mt-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Zap size={16} className="text-brand-500" /><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Workflow activity</h2></div>
        <Link to="/settings/automation" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Manage automation</Link>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">No workflow has run yet. Connect n8n and add a workflow in Settings → Automation, then insights and CRM events can trigger it.</p>
      ) : (
        <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-medium text-ink-800 dark:text-ink-100">{r.workflowName}</span><span className="ml-2 text-xs text-ink-400">{r.recordLabel || r.event} · {timeAgo(r.createdAt)}</span></span>
              <span className="flex items-center gap-2">{r.status === 'Failed' && <span className="max-w-[28ch] truncate text-xs text-rose-500" title={r.message}>{r.message}</span>}<Badge tone={RUN_TONE[r.status]}>{r.status}</Badge></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function AIInsights() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Super Admin', 'Admin'].includes(user?.accessLevel)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [category, setCategory] = useState('All')
  const [sending, setSending] = useState('')
  const [runs, setRuns] = useState(null)

  const load = useCallback((manual = false) => {
    if (manual) setRefreshing(true)
    return Promise.all([
      api.get('/insights', { noCache: true }),
      isAdmin ? api.get('/automation/runs', { params: { pageSize: 5 }, noCache: true }).then((r) => r.data.data).catch(() => null) : Promise.resolve(null),
    ]).then(([res, recent]) => { setData(res.data); setRuns(recent); setError('') })
      .catch((e) => setError(errorMessage(e, 'Could not load insights.')))
      .finally(() => setRefreshing(false))
  }, [isAdmin])

  useRefreshHandler(() => load())
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])

  const send = (insight, workflow) => {
    setSending(insight.key)
    api.post(`/automation/insights/${insight.key}/run`, { workflowId: workflow.id }, { silent: true })
      .then((res) => {
        const run = res.data
        if (run.status === 'Failed') toast(`“${workflow.name}” could not be started: ${run.message}`, { type: 'error' })
        else toast(run.status === 'Running' ? `Sent to “${workflow.name}”. Waiting for n8n to finish.` : `Sent to “${workflow.name}”.`, { type: 'success' })
        load()
      })
      .catch((e) => toast(errorMessage(e), { type: 'error' }))
      .finally(() => setSending(''))
  }

  const categories = useMemo(() => {
    if (!data) return []
    const counts = data.insights.reduce((acc, i) => ({ ...acc, [i.category]: (acc[i.category] || 0) + 1 }), {})
    return [{ value: 'All', label: 'All', count: data.insights.length }, ...Object.keys(counts).sort().map((c) => ({ value: c, label: c, count: counts[c] }))]
  }, [data])
  const shown = data ? data.insights.filter((i) => category === 'All' || i.category === category) : []

  if (error && !data) {
    return (
      <div>
        <PageHeader title="AI Insights" description="Prioritised findings from your live CRM data." />
        <EmptyState icon={AlertTriangle} title="Couldn’t load insights" description={error} action={<Button variant="secondary" icon={RefreshCw} onClick={() => load(true)}>Try again</Button>} />
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        <PageHeader title="AI Insights" description="Analysing your business data…" />
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} className="h-24" />)}</div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} className="h-44" />)}</div>
        <Skeleton className="mt-5 h-72 rounded-2xl" />
      </div>
    )
  }

  const { kpis, charts, counts } = data
  const hasScore = charts.scoreBuckets.some((b) => b.count > 0)
  const attention = counts.critical + counts.warning
  return (
    <div>
      <PageHeader
        title="AI Insights"
        description="Prioritised findings and trends from your live CRM data, limited to your branch and the records you can open."
        actions={<>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Sparkles size={13} /> Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </>}
      />
      {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Could not refresh: {error} Showing the last result.</p>}

      {kpis.length > 0 && <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{kpis.map((k) => <KpiCard key={k.key} kpi={k} onOpen={navigate} />)}</div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600 dark:text-ink-300">
          {attention > 0
            ? <><span className="font-semibold text-ink-900 dark:text-ink-50">{attention}</span> {attention === 1 ? 'thing needs' : 'things need'} your attention{counts.critical > 0 && <> — <span className="font-semibold text-rose-600 dark:text-rose-400">{counts.critical} critical</span></>}.</>
            : 'Nothing needs urgent attention right now.'}
        </p>
        <p className="text-xs text-ink-400">{data.method}</p>
      </div>
      <Tabs tabs={categories} active={category} onChange={setCategory} className="mb-5" />

      {shown.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={data.insights.length ? 'Nothing in this category' : 'Everything looks healthy'} description={data.insights.length ? 'Choose another category to see other findings.' : 'No overdue follow-ups, stalled deals, late invoices or support risks were found in the data you can see. New findings appear here as your data changes.'} />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {shown.map((i) => <InsightCard key={i.key} insight={i} canAutomate={isAdmin} sending={sending} onSend={send} onOpen={navigate} />)}
        </div>
      )}

      {(charts.pipelineByStage.length > 0 || hasScore || charts.sources.length > 0 || charts.revenue.length > 0) && (
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {charts.pipelineByStage.length > 0 && (
            <ChartCard title="Pipeline by stage" subtitle="Open deal value and its probability-weighted forecast">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={charts.pipelineByStage} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
                  <XAxis dataKey="stage" tick={{ ...axis, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} tickFormatter={(s) => (s.length > 11 ? `${s.slice(0, 10)}…` : s)} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => formatCurrency(v, { compact: true })} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" name="Deal value" fill="#c7d2fe" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="weighted" name="Weighted" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {charts.revenue.length > 0 && (
            <ChartCard title="Revenue collected" subtitle="Monthly collections against target">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={charts.revenue} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
                  <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => formatCurrency(v, { compact: true })} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Line dataKey="target" name="Target" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {charts.sources.length > 0 && (
            <ChartCard title="Lead sources" subtitle="Leads received and the share that converted">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={charts.sources} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-ink-100 dark:stroke-ink-800" />
                  <XAxis type="number" tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="source" tick={axis} axisLine={false} tickLine={false} width={96} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, name, item) => (name === 'Leads' ? [`${v} (${item.payload.rate}% converted)`, name] : [v, name])} />
                  <Bar dataKey="leads" name="Leads" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {hasScore && (
            <ChartCard title="Lead score distribution" subtitle="How your open leads are scored">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={charts.scoreBuckets} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
                  <XAxis dataKey="range" tick={axis} axisLine={false} tickLine={false} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Leads">{charts.scoreBuckets.map((b, i) => <Cell key={b.range} fill={SCORE_COLORS[i]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {isAdmin && <RecentRuns runs={runs} />}
    </div>
  )
}
