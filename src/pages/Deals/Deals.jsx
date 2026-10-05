import { useEffect, useMemo, useState } from 'react'
import { productByName } from '../../utils/productRules'
import { useProducts, useServiceOptions, useAllServiceNames } from '../../hooks/useProducts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, LayoutGrid, Table2, IndianRupee, Scale, Trophy, XCircle } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { StatCard } from '../../components/common/StatCard'
import { KanbanColumn } from '../../components/kanban/KanbanColumn'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { DEAL_STAGES, DEAL_STAGE_PROBABILITY, CLOSED_DEAL_STAGES, PRIORITIES } from '../../data/constants'
import { salesUsers, getUserById, USERS } from '../../data/users'
import { COMPANIES, getCompanyById } from '../../data/companies'
import { getDataScope, matchesDataScope } from '../../data/dataScope'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'
import { genId } from '../../utils/csv'
import { ChangeStageModal } from './ChangeStageModal'
import { changeDealStage, markDealLost } from './dealActions'
import { isDealClosed, isDealLost } from '../../data/dealWorkflow'

export default function Deals() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const scope = getDataScope(user?.role, 'Deals')
  const crud = useCrud('deals', {
    searchFields: ['name', 'companyName', 'contactName', 'service'],
    pageSize: 10,
    filterFn: (row) => matchesDataScope(row, scope, user, 'salesperson', USERS),
  })
  const { products } = useProducts()
  const serviceNames = useServiceOptions()
  const allServiceNames = useAllServiceNames()
  // Kanban is the default landing view for Deal Management — a pipeline board is the primary
  // way sales reps work a deal through its stages; Table remains one click away via the toggle.
  const [view, setView] = useState('kanban')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [stageTarget, setStageTarget] = useState(null)
  const [stagePreset, setStagePreset] = useState(null)
  const [changingStage, setChangingStage] = useState(false)
  const [searchParams] = useSearchParams()
  const { toast } = useToast()

  useEffect(() => {
    const openId = searchParams.get('open')
    if (openId) {
      navigate(`/deals/${openId}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const reps = salesUsers()

  const filterDefs = [
    { key: 'stage', label: 'Stages', options: DEAL_STAGES.map((s) => ({ value: s, label: s })) },
    { key: 'salesperson', label: 'Salespeople', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'service', label: 'Services', options: allServiceNames.map((s) => ({ value: s, label: s })) },
  ]

  const stats = useMemo(() => {
    const list = crud.allFiltered
    const open = list.filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage))
    const pipelineValue = open.reduce((s, d) => s + d.value, 0)
    const weightedValue = open.reduce((s, d) => s + (d.value * d.probability) / 100, 0)
    const wonValue = list.filter((d) => d.stage === 'Closed Won').reduce((s, d) => s + d.value, 0)
    const lostValue = list.filter((d) => isDealLost(d.stage)).reduce((s, d) => s + d.value, 0)
    return { pipelineValue, weightedValue, wonValue, lostValue }
  }, [crud.allFiltered])

  const openDeal = (row) => navigate(`/deals/${row.id}`)

  const columns = [
    { key: 'id', header: 'Deal ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'name', header: 'Deal Name', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.companyName} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.companyName}</p>
          </div>
        </div>
      ),
    },
    { key: 'contactName', header: 'Contact' },
    { key: 'service', header: 'Service' },
    { key: 'value', header: 'Deal Value', sortable: true, render: (row) => formatCurrency(row.value) },
    { key: 'probability', header: 'Probability', sortable: true, render: (row) => `${row.probability}%` },
    { key: 'expectedClosingDate', header: 'Expected Closing', sortable: true, render: (row) => formatDate(row.expectedClosingDate) },
    { key: 'salesperson', header: 'Salesperson', render: (row) => getUserById(row.salesperson)?.name.split(' ')[0] || '—' },
    { key: 'stage', header: 'Stage', render: (row) => <StatusBadge status={row.stage} /> },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'nextFollowUp', header: 'Next Follow-up', sortable: true,
      render: (row) => row.nextFollowUp ? <span className={isOverdue(row.nextFollowUp) ? 'font-medium text-rose-500' : ''}>{formatDate(row.nextFollowUp)}</span> : '—',
    },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createDeal = (data) => {
    setSaving(true)
    const company = getCompanyById(data.companyId)
    const stage = data.stage || 'Deal Created'
    crud.create({
      id: genId('DL'),
      name: data.name || `${company?.name || 'New Company'} — ${data.service}`,
      companyId: data.companyId,
      companyName: company?.name || '',
      contactId: null,
      contactName: data.contactName || company?.contactPerson || '',
      service: data.service,
      productId: productByName(products, data.service)?.id || null, // the catalog item, by ID
      requirement: '',
      customerNeed: '',
      budget: 0,
      expectedPurchaseTimeline: '',
      competitor: '',
      decisionMaker: '',
      notes: '',
      value: Number(data.value) || 0,
      currency: 'INR',
      // Probability is always stage-derived — never accepted from the form (spec §1 "Users
      // should not manually enter probability").
      probability: DEAL_STAGE_PROBABILITY[stage],
      expectedClosingDate: data.expectedClosingDate,
      salesperson: data.salesperson,
      stage,
      stageHistory: [{ stage, changedAt: new Date().toISOString(), changedBy: user.id, note: null }],
      priority: data.priority,
      createdDate: new Date().toISOString().slice(0, 10),
      nextFollowUp: null,
      lastContactedDate: null,
      closedAt: null, closedBy: null,
      lostReason: null, lostNotes: null, lostDate: null, lostBy: null,
      leadId: null, sourceEnquiryId: null, customerId: null,
      quotationIds: [], salesOrderIds: [], invoiceIds: [], paymentIds: [],
      source: null, sourceDetail: '', campaign: '',
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Deal created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Deal "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const updateDeal = (dealId, patch) => crud.update(dealId, patch)

  // Active↔active drags move instantly (matches the board's existing drag-and-drop feel); any
  // drop onto a CLOSED column opens the proper stage-change interface (spec §9) instead, since
  // reaching Closed Won/Closed Lost/Closed Lost – Competition is a deliberate, confirmed action
  // — the two Lost variants also require a reason there before the move is allowed to save.
  const handleDrop = (stage) => (e) => {
    e.preventDefault()
    const dealId = e.dataTransfer.getData('text/plain')
    setDragOverStage(null)
    if (!dealId) return
    const deal = crud.allFiltered.find((d) => d.id === dealId) || crud.allItems.find((d) => d.id === dealId)
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
        title="Deals"
        description={
          <>
            Track sales opportunities as they move through your pipeline.
            {scope !== 'Organization' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                {scope === 'Own' ? 'Showing your assigned deals only' : 'Showing your team\'s deals'}
              </span>
            )}
          </>
        }
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Deal</Button>}
      />

      <div className="mb-4 flex items-center gap-1 rounded-lg border border-ink-100 bg-white p-1 dark:border-ink-800 dark:bg-ink-900 w-fit">
        <button
          onClick={() => setView('table')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'table' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'}`}
        >
          <Table2 size={15} /> Table
        </button>
        <button
          onClick={() => setView('kanban')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === 'kanban' ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'}`}
        >
          <LayoutGrid size={15} /> Kanban
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search deals by name, company, contact…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        {selected.length > 0 && view === 'table' && (
          <span className="text-xs text-ink-500 dark:text-ink-400">{selected.length} selected</span>
        )}
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      {view === 'table' ? (
        <DataTable
          columns={columns}
          data={crud.items}
          loading={crud.loading}
          onRowClick={openDeal}
          selectable
          selected={selected}
          onSelectChange={setSelected}
          sort={crud.sort}
          onSortChange={crud.setSort}
          page={crud.page}
          totalPages={crud.totalPages}
          onPageChange={crud.setPage}
          total={crud.total}
          pageSize={10}
          emptyTitle="No deals found"
          emptyDescription="Try adjusting your search or filters, or add a new deal to get started."
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Pipeline Value" value={formatCurrency(stats.pipelineValue, { compact: true })} icon={IndianRupee} tone="brand" />
            <StatCard label="Weighted Value" value={formatCurrency(stats.weightedValue, { compact: true })} icon={Scale} tone="sky" />
            <StatCard label="Won Value" value={formatCurrency(stats.wonValue, { compact: true })} icon={Trophy} tone="emerald" />
            <StatCard label="Lost Value" value={formatCurrency(stats.lostValue, { compact: true })} icon={XCircle} tone="rose" />
          </div>
          <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-2">
            {DEAL_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                deals={crud.allFiltered.filter((d) => d.stage === stage)}
                onCardClick={openDeal}
                onDrop={handleDrop(stage)}
                isDragOver={dragOverStage === stage}
                onDragOver={() => setDragOverStage(stage)}
                onDragLeave={() => setDragOverStage((s) => (s === stage ? null : s))}
              />
            ))}
          </div>
        </>
      )}

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Deal"
        description="Create a new sales opportunity and assign it to your team."
        submitLabel="Create Deal"
        loading={saving}
        onSubmit={createDeal}
        defaultValues={{ stage: 'Deal Created', priority: 'Medium', salesperson: reps[0]?.id, service: serviceNames[0] || '', companyId: COMPANIES[0]?.id, expectedClosingDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }}
        fields={[
          { name: 'name', label: 'Deal name (optional)', span: 2, placeholder: 'Auto-generated if left blank' },
          { name: 'companyId', label: 'Company', type: 'select', options: COMPANIES.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'contactName', label: 'Contact', span: 1, placeholder: 'Contact person name' },
          { name: 'service', label: 'Service', type: 'select', options: serviceNames.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'value', label: 'Deal value (₹)', type: 'number', required: true, span: 1 },
          { name: 'expectedClosingDate', label: 'Expected closing date', type: 'date', required: true, span: 1 },
          { name: 'salesperson', label: 'Salesperson', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 1 },
          { name: 'stage', label: 'Stage', type: 'select', options: DEAL_STAGES.filter((s) => !CLOSED_DEAL_STAGES.includes(s)).map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), required: true, span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this deal?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Deal"
      />

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
