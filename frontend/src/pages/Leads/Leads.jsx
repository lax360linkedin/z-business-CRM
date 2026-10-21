import { useOptions, asChoices } from '../../hooks/useOptions'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Upload, Trash2, Eye, Pencil, UserCog, ClipboardCheck, Handshake, MoreVertical, X, Kanban, Table as TableIcon, XCircle, Ban } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormField, Input } from '../../components/common/FormField'
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '../../components/common/Dropdown'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { LEAD_STATUSES, PRIORITIES } from '../../data/constants'
import { useLeadSources } from '../../hooks/useLeadSources'
import { salesUsers, getUserById, USERS } from '../../data/users'
import { getDataScope, matchesDataScope } from '../../data/dataScope'
import { canTransition } from '../../data/leadWorkflow'
import { formatDate, isOverdue } from '../../utils/format'
import { ExportMenu } from '../../components/common/ExportMenu'
import { filterText } from '../../utils/exporter'
import { ImportDialog } from '../../components/import/ImportDialog'
import { TemplateButton } from '../../components/import/TemplateButton'
import { useBranch } from '../../context/BranchContext'
import { LeadFormModal } from './LeadFormModal'
import { QualifyLeadModal } from './QualifyLeadModal'
import { ConvertToDealModal } from './ConvertToDealModal'
import { MarkUnqualifiedModal } from './MarkUnqualifiedModal'
import { MarkLeadLostModal } from './MarkLeadLostModal'
import { AssignLeadModal } from './AssignLeadModal'
import { reassignLead, saveLeadQualification, findDuplicates, markLeadUnqualified, markLeadLost } from './leadActions'
import { LeadKanbanBoard } from './LeadKanbanBoard'
import { DuplicateLeadModal } from './DuplicateLeadModal'

const EMPTY_ADVANCED = { createdFrom: '', createdTo: '', purchaseFrom: '', purchaseTo: '', followUpFrom: '', followUpTo: '', scoreMin: '', scoreMax: '', unassignedOnly: false }
const VIEW_STORAGE_KEY = 'business_crm_leads_view_v1'
const STATUS_PILLS = ['All', ...LEAD_STATUSES]

function matchesAdvanced(row, adv) {
  const d = (v) => (v ? new Date(v) : null)
  if (adv.unassignedOnly && row.assignedTo) return false
  if (adv.createdFrom && new Date(row.createdDate) < d(adv.createdFrom)) return false
  if (adv.createdTo && new Date(row.createdDate) > d(adv.createdTo)) return false
  if (adv.purchaseFrom && (!row.expectedPurchaseDate || new Date(row.expectedPurchaseDate) < d(adv.purchaseFrom))) return false
  if (adv.purchaseTo && (!row.expectedPurchaseDate || new Date(row.expectedPurchaseDate) > d(adv.purchaseTo))) return false
  if (adv.followUpFrom && (!row.nextFollowUp || new Date(row.nextFollowUp) < d(adv.followUpFrom))) return false
  if (adv.followUpTo && (!row.nextFollowUp || new Date(row.nextFollowUp) > d(adv.followUpTo))) return false
  if (adv.scoreMin && row.score < Number(adv.scoreMin)) return false
  if (adv.scoreMax && row.score > Number(adv.scoreMax)) return false
  return true
}

export default function Leads() {
  const industries = useOptions('industries')
  const cities = useOptions('cities')
  const { user, hasPermission } = useAuth()
  const scope = getDataScope(user?.role, 'Leads')
  const canCreate = hasPermission('Leads', 'create')
  const canEdit = hasPermission('Leads', 'edit')
  const canDelete = hasPermission('Leads', 'delete')
  const canExport = hasPermission('Leads', 'export')

  // Persisted across reloads (not just within this session) so returning to Lead Management
  // later keeps whichever view was last used — Kanban and Table always render from the same
  // `crud.allFiltered`/`crud.items`, so switching between them never resets search/filters.
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'kanban' ? 'kanban' : 'table' } catch { return 'table' }
  })
  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* storage may be unavailable */ }
  }, [view])

  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED)
  const crud = useCrud('leads', {
    searchFields: ['id', 'name', 'company', 'email', 'phone'],
    pageSize: 10,
    filterFn: (row) => matchesDataScope(row, scope, user, 'assignedTo', USERS) && matchesAdvanced(row, advanced),
  })
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [assignTarget, setAssignTarget] = useState(null)
  const [qualifyTarget, setQualifyTarget] = useState(null)
  const [convertTarget, setConvertTarget] = useState(null)
  const [unqualifyTarget, setUnqualifyTarget] = useState(null)
  const [lostTarget, setLostTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [duplicateCheck, setDuplicateCheck] = useState(null)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const fileRef = useRef(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    if (searchParams.get('create') === '1') { setCreateOpen(true); searchParams.delete('create'); setSearchParams(searchParams, { replace: true }) }
    // Every deep link that used to open the drawer now opens the full Lead Detail page
    // instead (spec: "do NOT open only a small modal") — kept as `?open=` so every existing
    // call site (Enquiries, Deals, AI Insights, …) works unchanged.
    const openId = searchParams.get('open')
    if (openId) {
      navigate(`/leads/${openId}`, { replace: true })
      return
    }
    // Deep-link from Lead Sources ("View" on a source row / clicking a source in the Dashboard
    // chart) — actually filters the underlying dataset via crud.filters, not just a visual
    // highlight, per the spec's "must actually filter the underlying Lead dataset" requirement.
    const sourceParam = searchParams.get('source')
    if (sourceParam) {
      crud.setFilters((f) => ({ ...f, source: sourceParam }))
      setFiltersOpen(true)
      searchParams.delete('source')
      setSearchParams(searchParams, { replace: true })
    }
    // Deep-link from Dashboard quick actions ("View New Leads", "View Qualified Leads", …) —
    // drives the same status-pill filter the pill bar itself uses.
    const statusParam = searchParams.get('status')
    if (statusParam) {
      crud.setFilters((f) => ({ ...f, status: statusParam }))
      searchParams.delete('status')
      setSearchParams(searchParams, { replace: true })
    }
    if (searchParams.get('unassigned') === '1') {
      setAdvanced((a) => ({ ...a, unassignedOnly: true }))
      searchParams.delete('unassigned')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, crud.allItems])

  const reps = salesUsers()
  const { names: sourceNames } = useLeadSources()

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: LEAD_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'source', label: 'Sources', options: sourceNames.map((s) => ({ value: s, label: s })) },
    { key: 'assignedTo', label: 'Salespeople', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'industry', label: 'Industries', options: asChoices(industries.all) },
    { key: 'location', label: 'Locations', options: asChoices(cities.all) },
  ]

  const advancedActiveCount = Object.values(advanced).filter(Boolean).length

  const closeAllModals = () => { setAssignTarget(null); setQualifyTarget(null); setEditTarget(null); setUnqualifyTarget(null); setLostTarget(null) }

  const openLead = (row) => navigate(`/leads/${row.id}`)

  const doAssign = (newAssigneeId) => {
    setSaving(true)
    const newAssignee = getUserById(newAssigneeId)
    reassignLead(assignTarget, { newAssigneeId, by: user.id, byName: user.name, newAssigneeName: newAssignee?.name || 'a salesperson' })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${assignTarget.name} ${assignTarget.assignedTo ? 'reassigned' : 'assigned'} to ${newAssignee?.name}.`, { type: 'success' })
        crud.refresh()
      })
  }

  const doQualify = (qualification, outcome) => {
    setSaving(true)
    saveLeadQualification(qualifyTarget, qualification, { by: user.id, outcome })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${qualifyTarget.name} qualification saved${outcome ? ` — moved to ${outcome}` : ''}.`, { type: 'success' })
        crud.refresh()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doMarkUnqualified = ({ reason, notes }) => {
    setSaving(true)
    markLeadUnqualified(unqualifyTarget, { reason, notes, by: user.id })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${unqualifyTarget.name} marked as Unqualified.`, { type: 'success' })
        crud.refresh()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doMarkLost = ({ reason, notes }) => {
    setSaving(true)
    markLeadLost(lostTarget, { reason, notes, by: user.id })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${lostTarget.name} marked as Lost.`, { type: 'success' })
        crud.refresh()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const columns = [
    { key: 'id', width: 110, header: 'Lead ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'company', width: 230, header: 'Company Name', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.company} size="sm" />
          <p className="font-medium text-ink-800 dark:text-ink-100">{row.company}</p>
        </div>
      ),
    },
    {
      key: 'name', width: 210, header: 'Contact Name', sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
          <p className="text-xs text-ink-400">{row.designation}</p>
        </div>
      ),
    },
    { key: 'phone', width: 150, header: 'Phone' },
    { key: 'email', width: 240, header: 'Email' },
    { key: 'source', width: 170, header: 'Lead Source' },
    { key: 'service', width: 200, header: 'Product/Service' },
    { key: 'assignedTo', width: 170, header: 'Assigned Salesperson', render: (row) => getUserById(row.assignedTo)?.name.split(' ')[0] || '—' },
    { key: 'score', width: 120, header: 'Lead Score', sortable: true },
    { key: 'priority', width: 120, header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    { key: 'status', width: 140, header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'nextFollowUp', width: 150, header: 'Next Follow-up', sortable: true,
      render: (row) => row.nextFollowUp ? <span className={isOverdue(row.nextFollowUp) ? 'font-medium text-rose-500' : ''}>{formatDate(row.nextFollowUp)}</span> : '—',
    },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => {
        const isClosed = ['Converted', 'Unqualified', 'Lost'].includes(row.status)
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown align="right" width="w-56" trigger={<IconButton icon={MoreVertical} size="sm" />}>
              <DropdownItem icon={Eye} onClick={() => openLead(row)}>View Details</DropdownItem>
              {canEdit && !isClosed && <DropdownItem icon={Pencil} onClick={() => setEditTarget(row)}>Edit</DropdownItem>}
              {canEdit && !isClosed && <DropdownItem icon={UserCog} onClick={() => setAssignTarget(row)}>{row.assignedTo ? 'Reassign' : 'Assign'}</DropdownItem>}
              {canEdit && !isClosed && (
                <>
                  <DropdownDivider />
                  <DropdownLabel>Workflow</DropdownLabel>
                  {/* "Qualify" only appears once a lead has actually been Contacted — a
                      brand-new lead's next stage is Contact, never Qualify; its real next
                      action lives in the Quick Actions on the Lead Detail page
                      (Call/Email/WhatsApp/Meeting). "Convert to Deal" only appears once
                      Qualified — the two never compete as peer actions. */}
                  {canTransition(row.status, 'Qualified') && (
                    <DropdownItem icon={ClipboardCheck} onClick={() => setQualifyTarget(row)}>Qualify</DropdownItem>
                  )}
                  {canTransition(row.status, 'Converted') && (
                    <DropdownItem icon={Handshake} onClick={() => setConvertTarget(row)}>Convert to Deal</DropdownItem>
                  )}
                  {canTransition(row.status, 'Unqualified') && (
                    <DropdownItem icon={XCircle} onClick={() => setUnqualifyTarget(row)}>Mark Unqualified</DropdownItem>
                  )}
                  {canTransition(row.status, 'Lost') && (
                    <DropdownItem icon={Ban} danger onClick={() => setLostTarget(row)}>Mark Lost</DropdownItem>
                  )}
                </>
              )}
              {canDelete && (
                <>
                  <DropdownDivider />
                  <DropdownItem icon={Trash2} danger onClick={() => setDeleteTarget(row)}>Delete</DropdownItem>
                </>
              )}
            </Dropdown>
          </div>
        )
      },
    },
  ]

  // Only what was entered is sent. The server numbers the lead, stamps when it was captured, who assigned it and when, scores it from what is known about it, links its source and campaign, and writes
  // the "created" timeline entry and the assignment notification.
  const buildLeadPayload = (data) => ({
    ...data,
    budget: Number(data.budget) || 0,
    status: 'New',
    sourceDetail: data.sourceDetail || '',
    captureMethod: data.captureMethod || 'Manual',
  })

  const doCreateLead = (data) => {
    setSaving(true)
    crud.create(buildLeadPayload(data)).then(() => {
      setSaving(false)
      setCreateOpen(false)
      setDuplicateCheck(null)
      toast('Lead created successfully.', { type: 'success' })
    }).catch(() => setSaving(false)) // the reason is shown by the network layer; the form stays open for another try
  }

  // Step 1-4 of the spec's lead-creation logic (receive → identify source → validate → check
  // duplicate) run here before anything is written — see DuplicateLeadModal for the resulting
  // View Existing/Create Anyway choice ("Duplicate" is not a Lead status here, so the only real
  // outcomes are "go look at the existing record" or "confirm this is genuinely separate").
  const createLead = (data) => {
    setCheckingDuplicate(true)
    findDuplicates(data).then((matches) => {
      setCheckingDuplicate(false)
      if (matches.length) {
        setDuplicateCheck({ matches, pendingData: data })
      } else {
        doCreateLead(data)
      }
    })
  }

  const viewDuplicateMatch = (m) => {
    setDuplicateCheck(null)
    setCreateOpen(false)
    if (m.source === 'Lead') navigate(`/leads?open=${m.id}`)
    else if (m.source === 'Enquiry') navigate(`/enquiries?open=${m.id}`)
    else navigate(`/customers/${m.id}`)
  }

  const saveEdit = (data) => {
    setSaving(true)
    crud.update(editTarget.id, { ...data, budget: Number(data.budget) || 0 }).then(() => {
      setSaving(false)
      closeAllModals()
      toast('Lead updated.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Lead "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  // Export: every lead that matches the search and filters on screen (all pages, not only the visible one), for the branch being viewed
  const exportColumns = [
    { label: 'Lead ID', value: 'id' }, { label: 'Contact Name', value: 'name' }, { label: 'Company', value: 'company' },
    { label: 'Designation', value: 'designation' }, { label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' },
    { label: 'Industry', value: 'industry' }, { label: 'Location', value: 'location' }, { label: 'Source', value: 'source' },
    { label: 'Source Detail', value: 'sourceDetail' }, { label: 'Campaign', value: 'campaign' },
    { label: 'Service', value: 'service' }, { label: 'Budget', value: (r) => Number(r.budget) || 0, align: 'right' }, { label: 'Status', value: 'status' },
    { label: 'Priority', value: 'priority' }, { label: 'Score', value: (r) => Number(r.score) || 0, align: 'right' },
    { label: 'Assigned To', value: (r) => getUserById(r.assignedTo)?.name || '' }, { label: 'Branch', value: 'branch' },
    { label: 'Created Date', value: 'createdDate' }, { label: 'Next Follow-up', value: 'nextFollowUp' },
  ]
  const exportFilters = filterText({ search: crud.search, values: crud.filters, defs: filterDefs, extra: [['Created', [advanced.createdFrom, advanced.createdTo].some(Boolean) ? `${advanced.createdFrom || '…'} to ${advanced.createdTo || '…'}` : ''], ['Expected purchase', [advanced.purchaseFrom, advanced.purchaseTo].some(Boolean) ? `${advanced.purchaseFrom || '…'} to ${advanced.purchaseTo || '…'}` : ''], ['Follow-up', [advanced.followUpFrom, advanced.followUpTo].some(Boolean) ? `${advanced.followUpFrom || '…'} to ${advanced.followUpTo || '…'}` : ''], ['Score', [advanced.scoreMin, advanced.scoreMax].some(Boolean) ? `${advanced.scoreMin || '0'} to ${advanced.scoreMax || '100'}` : '']] })

  // Import: the file is read and every row checked (nothing saved) in the import dialog, which then saves the valid rows through the same server rules as the Add form and reports the rest.
  const [importFile, setImportFile] = useState(null)
  const { scope: branchScope, isAll } = useBranch()
  const salesTeam = isAll ? [] : salesUsers().filter((u) => u.branch === branchScope && u.status === 'Active')
  const handleImport = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setImportFile(file)
  }

  return (
    <div>
      <PageHeader
        title="Lead Management"
        description={
          <>
            Track every lead from source through contact, qualification and conversion to a Deal.
            {scope !== 'Organization' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                {scope === 'Own' ? 'Showing your assigned leads only' : "Showing your team's leads"}
              </span>
            )}
          </>
        }
        actions={
          <>
            <div className="mr-1 inline-flex rounded-lg border border-ink-200 p-0.5 dark:border-ink-700">
              <button
                onClick={() => setView('kanban')}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'kanban' ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
                )}
              >
                <Kanban size={15} /> Kanban View
              </button>
              <button
                onClick={() => setView('table')}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'table' ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
                )}
              >
                <TableIcon size={15} /> Table View
              </button>
            </div>
            {canCreate && <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} />}
            {canCreate && <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>Import</Button>}
            {canCreate && <TemplateButton module="leads" />}
            {canExport && <ExportMenu title="Leads" noun="lead" columns={exportColumns} rows={() => crud.allFiltered} filters={exportFilters} permission={canExport} />}
            {canCreate && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Lead</Button>}
          </>
        }
      />
      {importFile && <ImportDialog module="leads" file={importFile} distribute={{ people: salesTeam }} onClose={() => setImportFile(null)} onDone={() => crud.refresh()} />}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_PILLS.map((s) => {
          // The FilterPanel's own status dropdown writes the literal string 'all' for "no
          // filter" (useCrud treats '' and 'all' as equivalent) — checking both here keeps
          // this pill row and that dropdown visually in sync no matter which one was used last.
          const active = s === 'All' ? (!crud.filters.status || crud.filters.status === 'all') : crud.filters.status === s
          return (
            <button
              key={s}
              onClick={() => crud.setFilters((f) => ({ ...f, status: s === 'All' ? '' : s }))}
              className={clsx(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700',
              )}
            >
              {s}
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by Lead ID, company, contact, phone or email…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        <Button variant={advancedOpen ? 'subtle' : 'secondary'} size="md" onClick={() => setAdvancedOpen((o) => !o)}>
          More Filters {advancedActiveCount > 0 && <span className="ml-0.5">({advancedActiveCount})</span>}
        </Button>
        {selected.length > 0 && <span className="text-xs text-ink-500 dark:text-ink-400">{selected.length} selected</span>}
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}
      {advancedOpen && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 sm:grid-cols-4">
          <FormField label="Created From"><Input type="date" value={advanced.createdFrom} onChange={(e) => setAdvanced((a) => ({ ...a, createdFrom: e.target.value }))} /></FormField>
          <FormField label="Created To"><Input type="date" value={advanced.createdTo} onChange={(e) => setAdvanced((a) => ({ ...a, createdTo: e.target.value }))} /></FormField>
          <FormField label="Expected Purchase From"><Input type="date" value={advanced.purchaseFrom} onChange={(e) => setAdvanced((a) => ({ ...a, purchaseFrom: e.target.value }))} /></FormField>
          <FormField label="Expected Purchase To"><Input type="date" value={advanced.purchaseTo} onChange={(e) => setAdvanced((a) => ({ ...a, purchaseTo: e.target.value }))} /></FormField>
          <FormField label="Follow-up From"><Input type="date" value={advanced.followUpFrom} onChange={(e) => setAdvanced((a) => ({ ...a, followUpFrom: e.target.value }))} /></FormField>
          <FormField label="Follow-up To"><Input type="date" value={advanced.followUpTo} onChange={(e) => setAdvanced((a) => ({ ...a, followUpTo: e.target.value }))} /></FormField>
          <FormField label="Lead Score Min"><Input type="number" min="0" max="100" value={advanced.scoreMin} onChange={(e) => setAdvanced((a) => ({ ...a, scoreMin: e.target.value }))} /></FormField>
          <FormField label="Lead Score Max"><Input type="number" min="0" max="100" value={advanced.scoreMax} onChange={(e) => setAdvanced((a) => ({ ...a, scoreMax: e.target.value }))} /></FormField>
          {advancedActiveCount > 0 && (
            <div className="col-span-2 sm:col-span-4">
              <Button variant="ghost" size="sm" icon={X} onClick={() => setAdvanced(EMPTY_ADVANCED)}>Clear advanced filters</Button>
            </div>
          )}
        </div>
      )}

      {view === 'table' ? (
        <DataTable
          columns={columns}
          data={crud.items}
          loading={crud.loading}
          onRowClick={openLead}
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
          emptyTitle="No leads found"
          emptyDescription="Try adjusting your search or filters, or add a new lead to get started."
        />
      ) : (
        // Kanban reads the full filtered/searched/scoped list (not the paginated `crud.items`)
        // since the whole point of the board is to see every matching lead grouped by status
        // at once, not just one page of 10 — the same search/filters/scope still apply, just
        // without the table's page slicing.
        <LeadKanbanBoard leads={crud.allFiltered} onOpenLead={openLead} />
      )}

      <LeadFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Lead"
        description="Capture a new lead and assign it to your sales team."
        submitLabel="Create Lead"
        loading={saving || checkingDuplicate}
        onSubmit={createLead}
        defaultValues={{ priority: 'Medium', assignedTo: reps[0]?.id, source: '' }}
      />

      <DuplicateLeadModal
        open={!!duplicateCheck}
        onClose={() => setDuplicateCheck(null)}
        matches={duplicateCheck?.matches}
        saving={saving}
        onViewMatch={viewDuplicateMatch}
        onCreateAnyway={() => doCreateLead(duplicateCheck.pendingData)}
      />

      {editTarget && (
        <LeadFormModal
          open={!!editTarget}
          onClose={closeAllModals}
          title="Edit Lead"
          description={`Update details for ${editTarget.name}.`}
          submitLabel="Save Changes"
          loading={saving}
          onSubmit={saveEdit}
          defaultValues={editTarget}
        />
      )}

      <AssignLeadModal open={!!assignTarget} onClose={closeAllModals} lead={assignTarget} saving={saving} onSave={doAssign} />
      <QualifyLeadModal open={!!qualifyTarget} onClose={closeAllModals} lead={qualifyTarget} saving={saving} onSave={doQualify} />
      <ConvertToDealModal open={!!convertTarget} onClose={() => setConvertTarget(null)} lead={convertTarget} onConverted={crud.refresh} />
      <MarkUnqualifiedModal open={!!unqualifyTarget} onClose={closeAllModals} lead={unqualifyTarget} saving={saving} onSave={doMarkUnqualified} />
      <MarkLeadLostModal open={!!lostTarget} onClose={closeAllModals} lead={lostTarget} saving={saving} onSave={doMarkLost} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this lead?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Lead"
      />
    </div>
  )
}
