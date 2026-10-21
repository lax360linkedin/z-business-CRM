import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Megaphone, PlayCircle, CheckCircle2, Wallet, Users, IndianRupee, TrendingUp, AlertTriangle, X, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { describeFilters } from '../../utils/exporter'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { useToast } from '../../context/ToastContext'
import { CAMPAIGN_STATUSES } from '../../utils/marketingRules'
import { formatCurrency, formatDate } from '../../utils/format'

import { useCampaigns, useMarketingConfig, exportMarketing, mkErr } from '../Marketing/marketingClient'
import { CampaignFormDialog } from './CampaignFormDialog'

const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 12
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30' }
const COLS = 'xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_6rem_minmax(0,1fr)_5.5rem_5.5rem_4rem_4.5rem_5.5rem_5rem]'
const roiText = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v}%`)

export default function Campaigns() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { campaigns, error, reload } = useCampaigns()
  const { perms, channels } = useMarketingConfig()
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [f, setF] = useState({ status: 'all', channel: 'all', owner: 'all' })
  const [sort, setSort] = useState({ key: 'startDate', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  useEffect(() => { setPage(1) }, [search, f, sort])

  const hidden = !!campaigns && campaigns.length > 0 && campaigns.every((c) => c.financialHidden)
  const m = useMemo(() => {
    const l = campaigns || []
    const sum = (k) => l.reduce((s, c) => s + (c[k] || 0), 0)
    const spend = sum('spend'); const rev = sum('collected')
    return { total: l.length, active: l.filter((c) => c.status === 'Active').length, completed: l.filter((c) => c.status === 'Completed').length, budget: sum('budget'), spend, leads: sum('leads'), customers: sum('customers'), revenue: rev, roi: spend > 0 ? Math.round((rev - spend) / spend * 100) : null }
  }, [campaigns])
  const owners = useMemo(() => [...new Map((campaigns || []).filter((c) => c.ownerId).map((c) => [c.ownerId, c.ownerName])).entries()], [campaigns])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (campaigns || []).filter((c) => (!q || `${c.number} ${c.name} ${c.channel} ${c.type} ${c.leadSourceName || ''}`.toLowerCase().includes(q)) && (f.status === 'all' || c.status === f.status) && (f.channel === 'all' || c.channel === f.channel) && (f.owner === 'all' || c.ownerId === f.owner))
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (c) => (['budget', 'leads', 'customers', 'collected', 'roi'].includes(sort.key) ? c[sort.key] ?? -Infinity : String(c[sort.key] ?? ''))
    return list.sort((a, b) => { const x = val(a); const y = val(b); return (typeof x === 'number' ? x - y : x.localeCompare(y)) * dir })
  }, [campaigns, search, f, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const active = Object.values(f).filter((v) => v !== 'all').length
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  // Export: every campaign that matches the search and filters on screen (money columns stay empty for roles that may not see them)
  const exportColumns = [
    { label: 'Campaign', value: 'number' }, { label: 'Name', value: 'name' }, { label: 'Type', value: 'type' }, { label: 'Channel', value: 'channel' }, { label: 'Lead source', value: 'leadSourceName' },
    { label: 'Status', value: 'status' }, { label: 'Owner', value: 'ownerName' }, { label: 'Start', value: 'startDate' }, { label: 'End', value: 'endDate' },
    { label: 'Budget', value: (c) => c.budget ?? '', align: 'right' }, { label: 'Spend', value: (c) => c.spend ?? '', align: 'right' }, { label: 'Leads', value: (c) => c.leads ?? 0, align: 'right' },
    { label: 'Qualified leads', value: (c) => c.qualifiedLeads ?? 0, align: 'right' }, { label: 'Customers', value: (c) => c.customers ?? 0, align: 'right' },
    { label: 'Revenue collected', value: (c) => c.collected ?? '', align: 'right' }, { label: 'ROI %', value: (c) => (c.roi === null || c.roi === undefined ? '' : Math.round(c.roi * 10) / 10), align: 'right' },
  ]
  const exportFilters = describeFilters([['Search', search.trim() && `"${search.trim()}"`], ['Status', f.status], ['Channel', f.channel], ['Owner', f.owner !== 'all' && (owners.find(([id]) => id === f.owner)?.[1] || f.owner)]])
  const Sort = ({ k, children }) => <button type="button" onClick={() => toggle(k)} className="inline-flex items-center gap-1 uppercase hover:text-ink-800">{children}{sort.key === k ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}</button>

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load campaigns" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const money = (v) => (hidden ? '—' : formatCurrency(v, { compact: true }))
  const cards = [['Campaigns', m.total, Megaphone, 'brand'], ['Active', m.active, PlayCircle, 'emerald'], ['Completed', m.completed, CheckCircle2, 'sky'], ['Budget', money(m.budget), Wallet, 'violet'], ['Actual spend', money(m.spend), IndianRupee, 'amber'], ['Leads', m.leads, Users, 'brand'], ['Customers', m.customers, Users, 'emerald'], ['Revenue collected', money(m.revenue), IndianRupee, 'emerald'], ['ROI', hidden ? '—' : roiText(m.roi), TrendingUp, m.roi !== null && m.roi < 0 ? 'rose' : 'emerald']]
  return (
    <div>
      <PageHeader title="Campaigns" description="Plan, run and measure marketing campaigns. Every result below is computed from the leads, deals, customers, invoices and payments attributed to the campaign." actions={<><ExportMenu title="Campaigns" noun="campaign" permission={perms.export} columns={exportColumns} rows={() => filtered} filters={exportFilters} />{perms.createCampaign && <Button icon={Plus} onClick={() => setFormOpen(true)}>New campaign</Button>}</>} />
      {!campaigns ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          {cards.map(([label, value, Icon, tone]) => <div key={label} className="rounded-xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div><p className="mt-1.5 break-words text-base font-bold text-ink-900 dark:text-ink-50">{value}</p></div>)}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search campaign, ID, channel, source…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={active} onClick={() => setFiltersOpen((o) => !o)} />
        {active > 0 && <Button variant="ghost" icon={X} onClick={() => setF({ status: 'all', channel: 'all', owner: 'all' })}>Clear</Button>}
      </div>
      {filtersOpen && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card sm:grid-cols-3 dark:border-ink-800 dark:bg-ink-900">
          {[['Status', 'status', CAMPAIGN_STATUSES.map((s) => [s, s])], ['Channel', 'channel', channels.map((c) => [c, c])], ['Owner', 'owner', owners]].map(([label, key, list]) => <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}><option value="all">All</option>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
        </div>
      )}
      {!campaigns ? <CardSkeleton className="h-64" /> : filtered.length === 0 ? <EmptyState icon={Megaphone} title="No campaigns found" description="Adjust the filters, or create a campaign to start tracking leads and revenue by campaign." action={perms.createCampaign ? <Button icon={Plus} onClick={() => setFormOpen(true)}>New campaign</Button> : null} /> : (
        <>
          <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div role="row" className={clsx('hidden gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-500 xl:grid dark:border-ink-800 dark:bg-ink-800/40', COLS)}><Sort k="name">Campaign</Sort><span className="uppercase">Channel</span><span className="uppercase">Status</span><span className="uppercase">Owner</span><Sort k="budget">Budget</Sort><span className="uppercase">Spend</span><Sort k="leads">Leads</Sort><Sort k="customers">Cust.</Sort><Sort k="collected">Revenue</Sort><Sort k="roi">ROI</Sort></div>
            {rows.map((c) => (
              <div key={c.id} role="row" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/campaigns/${c.id}`) }} onClick={() => navigate(`/campaigns/${c.id}`)} className={clsx('grid cursor-pointer grid-cols-1 items-center gap-1.5 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 xl:gap-3 dark:border-ink-800/60 dark:hover:bg-ink-800/30', COLS, c.status === 'Cancelled' && 'opacity-60')}>
                <div className="min-w-0"><p className="truncate font-medium text-brand-700 dark:text-brand-300">{c.name}</p><p className="text-[11px] text-ink-400">{c.number} · {c.type}</p></div>
                <span className="text-xs text-ink-600 dark:text-ink-300">{c.channel}<span className="block text-[11px] text-ink-400">{c.leadSourceName}</span></span>
                <div><StatusBadge status={c.status} /></div>
                <span className="truncate text-xs text-ink-600 dark:text-ink-300">{c.ownerName || '—'}<span className="block text-[11px] text-ink-400">{formatDate(c.startDate)} – {formatDate(c.endDate)}</span></span>
                <span className="text-xs">{c.budget === null ? '—' : formatCurrency(c.budget, { compact: true })}</span>
                <span className="text-xs">{c.spend === null ? '—' : formatCurrency(c.spend, { compact: true })}</span>
                <span className="font-medium">{c.leads}<span className="block text-[11px] font-normal text-ink-400">{c.qualifiedLeads} qual.</span></span>
                <span className="font-medium">{c.customers}</span>
                <span className="text-xs font-medium">{c.collected === null ? '—' : formatCurrency(c.collected, { compact: true })}</span>
                <span className={clsx('text-xs font-semibold', c.roi === null ? 'text-ink-400' : c.roi >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{roiText(c.roi)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>
        </>
      )}
      <CampaignFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={(c) => { reload(); navigate(`/campaigns/${c.id}`) }} />
    </div>
  )
}
