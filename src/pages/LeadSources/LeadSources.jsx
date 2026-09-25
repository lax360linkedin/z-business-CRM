import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Plus, Trash2, Radio, Zap, Eye, Wifi, WifiOff } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { ChartCard } from '../../components/charts/ChartCard'
import { DataTable } from '../../components/common/DataTable'
import { Button, IconButton } from '../../components/common/Button'
import { Input, Select } from '../../components/common/FormField'
import { Badge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { LEAD_SOURCES, LEAD_SOURCE_TYPES, LEAD_CAPTURE_METHODS, SERVICES } from '../../data/constants'
import { SOURCE_DETAILS } from '../../data/leads'
import { getLeadSourceConfig, saveLeadSourceConfig } from '../../data/leadSourceConfig'
import { captureLead } from '../Leads/leadCaptureService'
import { genId } from '../../utils/csv'
import { formatDate, timeAgo } from '../../utils/format'
import { useToast } from '../../context/ToastContext'
import {
  resetSeed, pick, personName, companyName, phoneNumber, companyEmail,
} from '../../utils/generators'

function tooltipStyle() {
  return { borderRadius: 12, border: '1px solid var(--tw-tooltip-border, #e2e8f0)', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
}

function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        checked ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-ink-700',
      )}
    >
      <span className={clsx('inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-1')} />
    </button>
  )
}

/** Generates a plausible incoming-lead payload for a given source — stands in for a real
 * webhook/form/API submission (see captureLead() for what happens once this "arrives"). */
function fakeIncomingPayload(source) {
  resetSeed(Date.now() % 100000)
  const company = companyName()
  const name = personName()
  const detailOptions = SOURCE_DETAILS[source]
  return {
    name,
    company,
    email: companyEmail(company, name),
    phone: phoneNumber(),
    source,
    sourceDetail: detailOptions ? pick(detailOptions) : '',
    service: pick(SERVICES),
    requirement: `Interested in ${pick(SERVICES).toLowerCase()} — submitted via ${source}.`,
    campaign: '',
  }
}

export default function LeadSources() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState(() => getLeadSourceConfig(LEAD_SOURCES))
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState(LEAD_SOURCE_TYPES[0])
  const [newMethod, setNewMethod] = useState(LEAD_CAPTURE_METHODS[0])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [simulating, setSimulating] = useState(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  const loadLeads = () => {
    setLoading(true)
    api.get('/leads', { params: { all: true } }).then((res) => setLeads(res.data)).finally(() => setLoading(false))
  }
  useEffect(() => { loadLeads() }, [])

  const performance = useMemo(() => {
    const map = {}
    sources.forEach((s) => { map[s.name] = { ...s, count: 0, converted: 0, lastReceived: null } })
    leads.forEach((l) => {
      if (!map[l.source]) map[l.source] = { id: null, name: l.source, active: true, sourceType: 'Digital', captureMethod: 'Manual', connected: false, createdDate: null, count: 0, converted: 0, lastReceived: null }
      map[l.source].count += 1
      if (l.status === 'Converted') map[l.source].converted += 1
      const receivedAt = l.capturedAt || l.createdDate
      if (receivedAt && (!map[l.source].lastReceived || receivedAt > map[l.source].lastReceived)) map[l.source].lastReceived = receivedAt
    })
    return Object.values(map)
      .map((m) => ({ ...m, conversionRate: m.count > 0 ? Math.round((m.converted / m.count) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count)
  }, [leads, sources])

  const chartData = performance.slice(0, 8).map((p) => ({ name: p.name, value: p.count }))

  const addSource = () => {
    const name = newName.trim()
    if (!name) return
    if (sources.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast('That lead source already exists.', { type: 'warning' })
      return
    }
    const updated = [...sources, {
      id: genId('LS'), name, active: true, sourceType: newType, captureMethod: newMethod,
      connected: newMethod === 'Manual' || newMethod === 'Form',
      createdDate: new Date().toISOString().slice(0, 10),
    }]
    setSources(updated)
    saveLeadSourceConfig(updated)
    setNewName('')
    toast(`Lead source "${name}" added.`, { type: 'success' })
  }

  const toggleActive = (id) => {
    const updated = sources.map((s) => (s.id === id ? { ...s, active: !s.active } : s))
    setSources(updated)
    saveLeadSourceConfig(updated)
  }

  const confirmDelete = () => {
    const updated = sources.filter((s) => s.id !== deleteTarget.id)
    setSources(updated)
    saveLeadSourceConfig(updated)
    toast(`Lead source "${deleteTarget.name}" removed.`, { type: 'success' })
    setDeleteTarget(null)
  }

  // Real, working demonstration of the automatic-capture architecture (spec §4/§24) — runs the
  // exact same validate → duplicate-check → create → assign → notify pipeline a genuine
  // webhook/API/form submission would go through. Only available on sources marked Connected +
  // Active, matching "do not fake a successful integration for a source that isn't wired up."
  const simulateIncoming = (source) => {
    setSimulating(source.name)
    const payload = fakeIncomingPayload(source.name)
    captureLead(payload, { captureMethod: source.captureMethod }).then((result) => {
      setSimulating(null)
      if (result.duplicate) {
        toast(`Simulated lead from ${source.name} matched an existing record — not created (see the Leads list to review).`, { type: 'warning' })
        return
      }
      toast(`Lead ${result.lead.id} automatically captured from ${source.name}.`, { type: 'success' })
      loadLeads()
    }).catch((err) => {
      setSimulating(null)
      toast(err.message, { type: 'error' })
    })
  }

  const columns = [
    {
      key: 'name', header: 'Source Name', sortable: true,
      render: (row) => (
        <div>
          <p className={clsx('font-medium', row.active ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400 line-through dark:text-ink-600')}>{row.name}</p>
        </div>
      ),
    },
    { key: 'sourceType', header: 'Source Type', render: (row) => <Badge tone="neutral">{row.sourceType}</Badge> },
    {
      key: 'connected', header: 'Status',
      render: (row) => row.connected
        ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><Wifi size={13} /> Connected</span>
        : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-400"><WifiOff size={13} /> Not Connected</span>,
    },
    { key: 'captureMethod', header: 'Capture Method', render: (row) => <Badge tone="info">{row.captureMethod}</Badge> },
    { key: 'count', header: 'Leads Count', sortable: true, className: 'font-medium' },
    { key: 'lastReceived', header: 'Last Lead Received', render: (row) => row.lastReceived ? timeAgo(row.lastReceived) : '—' },
    { key: 'createdDate', header: 'Created Date', render: (row) => row.createdDate ? formatDate(row.createdDate) : '—' },
    {
      key: 'active', header: 'Active', render: (row) => row.id ? <Switch checked={row.active} onChange={() => toggleActive(row.id)} /> : <span className="text-xs text-ink-400">—</span>,
    },
    {
      key: 'actions', header: '', headerClassName: 'w-56',
      render: (row) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary" size="sm" icon={Zap}
            disabled={!row.connected || !row.active || simulating === row.name}
            loading={simulating === row.name}
            onClick={() => simulateIncoming(row)}
          >
            Simulate Incoming Lead
          </Button>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/leads?source=${encodeURIComponent(row.name)}`)} />
          {row.id && <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Lead Sources"
        description="Configure where your leads come from, and see exactly which sources can automatically capture a lead into the CRM."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {loading ? (
            <CardSkeleton className="h-72" />
          ) : (
            <ChartCard title="Lead Volume by Source" subtitle="Top channels by number of leads captured">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-ink-100 dark:stroke-ink-800" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={56} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                  <Bar dataKey="value" fill="#9333ea" radius={[6, 6, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <DataTable
            columns={columns}
            data={performance}
            rowKey="name"
            loading={loading}
            onRowClick={(row) => navigate(`/leads?source=${encodeURIComponent(row.name)}`)}
            emptyTitle="No lead source data"
            emptyDescription="Leads will appear here once they start coming in."
          />
        </div>

        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-1 flex items-center gap-2">
            <Radio size={16} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Add a Lead Source</h3>
          </div>
          <p className="mb-4 text-xs text-ink-500 dark:text-ink-400">New sources default to Not Connected — an admin can wire up the real integration later without losing any captured history.</p>

          <div className="mb-4 space-y-2.5">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Source name…" className="text-sm" />
            <Select value={newType} onChange={(e) => setNewType(e.target.value)} className="text-sm">
              {LEAD_SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select value={newMethod} onChange={(e) => setNewMethod(e.target.value)} className="text-sm">
              {LEAD_CAPTURE_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <Button icon={Plus} size="md" className="w-full" onClick={addSource}>Add Source</Button>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">All Sources</p>
          <ul className="scrollbar-thin max-h-[320px] space-y-1 overflow-y-auto">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-ink-50 dark:hover:bg-ink-800/60">
                <span className={clsx('truncate text-sm', s.active ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400 line-through dark:text-ink-600')}>{s.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {s.connected ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not Connected</Badge>}
                  <Switch checked={s.active} onChange={() => toggleActive(s.id)} />
                </div>
              </li>
            ))}
            {sources.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No sources configured yet.</p>}
          </ul>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Remove this lead source?"
        description={`"${deleteTarget?.name}" will no longer be available when capturing new leads. Leads already captured from it keep their history.`}
        confirmLabel="Remove Source"
      />
    </div>
  )
}
