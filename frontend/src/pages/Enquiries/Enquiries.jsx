import { useOptions, asChoices } from '../../hooks/useOptions'
import { useEffect, useRef, useState } from 'react'
import { useAllServiceNames } from '../../hooks/useProducts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Upload, Trash2, Eye, Pencil, UserCog, ClipboardCheck, Handshake, Ban, MoreVertical, X, Copy, AlertOctagon, XCircle, Search } from 'lucide-react'
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
import { ENQUIRY_STATUSES, ENQUIRY_PRIORITIES } from '../../data/constants'
import { useLeadSources } from '../../hooks/useLeadSources'
import { salesUsers, getUserById, USERS } from '../../data/users'
import { getDataScope, matchesDataScope } from '../../data/dataScope'
import { canTransition, isQualificationComplete } from '../../data/enquiryWorkflow'
import { formatDate, isOverdue } from '../../utils/format'
import { ExportMenu } from '../../components/common/ExportMenu'
import { filterText } from '../../utils/exporter'
import { ImportDialog } from '../../components/import/ImportDialog'
import { TemplateButton } from '../../components/import/TemplateButton'
import { EnquiryFormModal } from './EnquiryFormModal'
import { QualifyEnquiryModal } from './QualifyEnquiryModal'
import { AssignEnquiryModal } from './AssignEnquiryModal'
import { DispositionEnquiryModal } from './DispositionEnquiryModal'
import { ConvertEnquiryToLeadModal } from './ConvertEnquiryToLeadModal'
import { assignEnquiry, saveEnquiryQualification, closeEnquiry } from './enquiryActions'

const EMPTY_ADVANCED = { createdFrom: '', createdTo: '', followUpFrom: '', followUpTo: '', campaign: '', unassignedOnly: false }
const STATUS_PILLS = ['All', ...ENQUIRY_STATUSES]

function matchesAdvanced(row, adv) {
  const d = (v) => (v ? new Date(v) : null)
  if (adv.unassignedOnly && row.assignedUser) return false
  if (adv.createdFrom && new Date(row.createdDate) < d(adv.createdFrom)) return false
  if (adv.createdTo && new Date(row.createdDate) > d(adv.createdTo)) return false
  if (adv.followUpFrom && (!row.nextFollowUp || new Date(row.nextFollowUp) < d(adv.followUpFrom))) return false
  if (adv.followUpTo && (!row.nextFollowUp || new Date(row.nextFollowUp) > d(adv.followUpTo))) return false
  if (adv.campaign && !String(row.campaign || '').toLowerCase().includes(adv.campaign.toLowerCase())) return false
  return true
}

export default function Enquiries() {
  const cities = useOptions('cities')
  const { user, hasPermission } = useAuth()
  const navigate = useNavigate()
  const scope = getDataScope(user?.role, 'Enquiries')
  const canCreate = hasPermission('Enquiries', 'create')
  const canEdit = hasPermission('Enquiries', 'edit')
  const canDelete = hasPermission('Enquiries', 'delete')
  const canExport = hasPermission('Enquiries', 'export')

  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED)
  const crud = useCrud('enquiries', {
    searchFields: ['id', 'name', 'company', 'email', 'phone'],
    pageSize: 10,
    filterFn: (row) => matchesDataScope(row, scope, user, 'assignedUser', USERS) && matchesAdvanced(row, advanced),
  })
  const allServiceNames = useAllServiceNames()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [assignTarget, setAssignTarget] = useState(null)
  const [qualifyTarget, setQualifyTarget] = useState(null)
  const [dispositionTarget, setDispositionTarget] = useState(null)
  const [convertTarget, setConvertTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const fileRef = useRef(null)
  const { toast } = useToast()

  useEffect(() => {
    if (searchParams.get('create') === '1') { setCreateOpen(true); searchParams.delete('create'); setSearchParams(searchParams, { replace: true }) }
    // Every deep link that used to open the drawer now opens the full Enquiry Detail page
    // instead (spec: "do NOT use a basic small popup") — kept as `?open=` so every existing
    // call site works unchanged.
    const openId = searchParams.get('open')
    if (openId) {
      navigate(`/enquiries/${openId}`, { replace: true })
      return
    }
    // Deep-link from Dashboard KPI cards ("New", "Qualified", …) — drives the same
    // status-pill filter the pill bar itself uses.
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
    { key: 'status', label: 'Statuses', options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'source', label: 'Sources', options: sourceNames.map((s) => ({ value: s, label: s })) },
    { key: 'priority', label: 'Priorities', options: ENQUIRY_PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'assignedUser', label: 'Assigned Users', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'interestedService', label: 'Products/Services', options: allServiceNames.map((s) => ({ value: s, label: s })) },
    { key: 'city', label: 'Locations', options: asChoices(cities.all) },
  ]

  const advancedActiveCount = Object.values(advanced).filter(Boolean).length
  const closeAllModals = () => { setAssignTarget(null); setQualifyTarget(null); setDispositionTarget(null); setEditTarget(null) }

  const refreshAll = () => crud.refresh()

  const doAssign = (team, userId) => {
    setSaving(true)
    const assignee = getUserById(userId)
    assignEnquiry(assignTarget, { team, userId })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${assignTarget.name} ${assignTarget.assignedUser ? 'reassigned' : 'assigned'} to ${assignee?.name}.`, { type: 'success' })
        refreshAll()
      })
  }

  const doQualify = (qualification, outcome) => {
    setSaving(true)
    saveEnquiryQualification(qualifyTarget, qualification, { outcome })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${qualifyTarget.name} qualification saved${outcome ? ` — moved to ${outcome}` : ''}.`, { type: 'success' })
        refreshAll()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doDisposition = (reason) => {
    setSaving(true)
    closeEnquiry(dispositionTarget.row, { targetStatus: dispositionTarget.status, reason })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${dispositionTarget.row.name} marked as ${dispositionTarget.status}.`, { type: 'success' })
        refreshAll()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const columns = [
    { key: 'id', width: 120, header: 'Enquiry ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'name', width: 270, header: 'Name', sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <div>
            <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
            <p className="text-xs text-ink-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'company', width: 200, header: 'Company' },
    { key: 'phone', width: 150, header: 'Phone' },
    { key: 'interestedService', width: 220, header: 'Interested Product/Service', render: (row) => row.interestedService || row.interestedProduct || '—' },
    { key: 'source', width: 170, header: 'Source' },
    { key: 'priority', width: 120, header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    { key: 'status', width: 140, header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'assignedUser', width: 150, header: 'Assigned To', render: (row) => getUserById(row.assignedUser)?.name.split(' ')[0] || 'Unassigned' },
    { key: 'createdDate', width: 140, header: 'Created Date', sortable: true, render: (row) => formatDate(row.createdDate) },
    {
      key: 'nextFollowUp', width: 150, header: 'Next Follow-up', sortable: true,
      render: (row) => row.nextFollowUp ? <span className={isOverdue(row.nextFollowUp) ? 'font-medium text-rose-500' : ''}>{formatDate(row.nextFollowUp)}</span> : '—',
    },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => {
        const isTerminal = ['Converted', 'Duplicate', 'Spam'].includes(row.status)
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown align="right" width="w-56" trigger={<IconButton icon={MoreVertical} size="sm" />}>
              <DropdownItem icon={Eye} onClick={() => navigate(`/enquiries/${row.id}`)}>View Details</DropdownItem>
              {canEdit && !isTerminal && <DropdownItem icon={Pencil} onClick={() => setEditTarget(row)}>Edit</DropdownItem>}
              {canEdit && !isTerminal && <DropdownItem icon={UserCog} onClick={() => setAssignTarget(row)}>{row.assignedUser ? 'Reassign' : 'Assign'}</DropdownItem>}
              {canEdit && !isTerminal && (
                <>
                  <DropdownDivider />
                  <DropdownLabel>Workflow</DropdownLabel>
                  {(canTransition(row.status, 'Qualified') || canTransition(row.status, 'Unqualified')) && (
                    <DropdownItem icon={ClipboardCheck} onClick={() => setQualifyTarget(row)}>Qualify</DropdownItem>
                  )}
                  {row.status === 'Qualified' && (
                    <DropdownItem icon={Handshake} onClick={() => setConvertTarget(row)} disabled={!isQualificationComplete(row.qualification)}>Convert to Lead</DropdownItem>
                  )}
                  {canTransition(row.status, 'Duplicate') && <DropdownItem icon={Copy} onClick={() => setDispositionTarget({ row, status: 'Duplicate' })}>Mark Duplicate</DropdownItem>}
                  {canTransition(row.status, 'Spam') && <DropdownItem icon={AlertOctagon} onClick={() => setDispositionTarget({ row, status: 'Spam' })}>Mark Spam</DropdownItem>}
                  {canTransition(row.status, 'Not Interested') && <DropdownItem icon={XCircle} onClick={() => setDispositionTarget({ row, status: 'Not Interested' })}>Not Interested</DropdownItem>}
                  {canTransition(row.status, 'Closed') && <DropdownItem icon={Ban} danger onClick={() => setDispositionTarget({ row, status: 'Closed' })}>Close</DropdownItem>}
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

  // Only what was entered is sent. The server numbers the enquiry, stamps the date, who captured / assigned it and when, takes the initials, moves an assigned enquiry to "Assigned", closes one flagged
  // as a duplicate, finds or creates the company it names (never a second copy) and writes the "created" timeline entry and the assignment notification.
  const buildPayload = (data, opts) => {
    const tags = typeof data.tags === 'string' ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : (data.tags || [])
    return {
      ...data,
      tags,
      quantity: Number(data.quantity) || 0,
      assignedTeam: data.assignedTeam || null,
      assignedUser: data.assignedUser || null,
      ...(opts.markDuplicate ? { status: 'Duplicate', duplicateOfId: opts.duplicateOfId } : {}),
      existingCustomerId: opts.existingCustomerId || null,
    }
  }

  const createEnquiry = (data, opts = {}) => {
    setSaving(true)
    crud.create(buildPayload(data, opts)).then((created) => {
      setSaving(false)
      setCreateOpen(false)
      toast(opts.markDuplicate ? `Enquiry ${created?.id || ''} created and flagged as duplicate.` : 'Enquiry created successfully.', { type: 'success' })
    }).catch(() => setSaving(false)) // the reason is shown by the network layer; the form stays open for another try
  }

  const saveEdit = (data) => {
    setSaving(true)
    const tags = typeof data.tags === 'string' ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : (data.tags || [])
    crud.update(editTarget.id, { ...data, tags, quantity: Number(data.quantity) || 0 }).then(() => {
      setSaving(false)
      closeAllModals()
      toast('Enquiry updated.', { type: 'success' })
    }).catch(() => setSaving(false))
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Enquiry "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  // Export: every enquiry that matches the search and filters on screen (all pages, not only the visible one), for the branch being viewed
  const exportColumns = [
    { label: 'Enquiry ID', value: 'id' }, { label: 'Name', value: 'name' }, { label: 'Email', value: 'email' }, { label: 'Company', value: 'company' },
    { label: 'Phone', value: 'phone' }, { label: 'City', value: 'city' }, { label: 'Interested Product/Service', value: (r) => r.interestedService || r.interestedProduct || '' },
    { label: 'Source', value: 'source' }, { label: 'Status', value: 'status' }, { label: 'Priority', value: 'priority' },
    { label: 'Assigned To', value: (r) => getUserById(r.assignedUser)?.name || '' }, { label: 'Branch', value: 'branch' },
    { label: 'Created Date', value: 'createdDate' }, { label: 'Last Activity', value: 'lastContactedDate' }, { label: 'Next Follow-up', value: 'nextFollowUp' },
  ]
  const exportFilters = filterText({ search: crud.search, values: crud.filters, defs: filterDefs, extra: [['Created', [advanced.createdFrom, advanced.createdTo].some(Boolean) ? `${advanced.createdFrom || '…'} to ${advanced.createdTo || '…'}` : ''], ['Follow-up', [advanced.followUpFrom, advanced.followUpTo].some(Boolean) ? `${advanced.followUpFrom || '…'} to ${advanced.followUpTo || '…'}` : ''], ['Campaign', advanced.campaign]] })

  // Import: the file is read and every row checked (nothing saved) in the import dialog, which then saves the valid rows through the same server rules as the Add form and reports the rest.
  const [importFile, setImportFile] = useState(null)
  const handleImport = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setImportFile(file)
  }

  const openMatch = (m) => {
    if (m.source === 'Enquiry') navigate(`/enquiries?open=${m.id}`)
    else if (m.source === 'Lead') navigate(`/leads?open=${m.id}`)
    else navigate(`/customers/${m.id}`)
  }

  return (
    <div>
      <PageHeader
        title="Enquiry Management"
        description={
          <>
            Capture, verify and qualify incoming interest before it becomes a Lead.
            {scope !== 'Organization' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                {scope === 'Own' ? 'Showing your assigned enquiries only' : "Showing your team's enquiries"}
              </span>
            )}
          </>
        }
        actions={
          <>
            {canCreate && <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} />}
            {canCreate && <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>Import</Button>}
            {canCreate && <TemplateButton module="enquiries" />}
            {canExport && <ExportMenu title="Enquiries" noun="enquiry" columns={exportColumns} rows={() => crud.allFiltered} filters={exportFilters} permission={canExport} />}
            {canCreate && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Enquiry</Button>}
          </>
        }
      />
      {importFile && <ImportDialog module="enquiries" file={importFile} onClose={() => setImportFile(null)} onDone={() => crud.refresh()} />}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATUS_PILLS.map((s) => {
          const active = s === 'All' ? (!crud.filters.status || crud.filters.status === 'all') : crud.filters.status === s
          return (
            <button
              key={s}
              onClick={() => crud.setFilters((f) => ({ ...f, status: s === 'All' ? '' : s }))}
              className={active
                ? 'rounded-full bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors'
                : 'rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700'}
            >
              {s}
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by Enquiry ID, name, company, phone or email…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        <Button variant={advancedOpen ? 'subtle' : 'secondary'} size="md" icon={Search} onClick={() => setAdvancedOpen((o) => !o)}>
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
          <FormField label="Follow-up From"><Input type="date" value={advanced.followUpFrom} onChange={(e) => setAdvanced((a) => ({ ...a, followUpFrom: e.target.value }))} /></FormField>
          <FormField label="Follow-up To"><Input type="date" value={advanced.followUpTo} onChange={(e) => setAdvanced((a) => ({ ...a, followUpTo: e.target.value }))} /></FormField>
          <FormField label="Campaign" className="sm:col-span-2"><Input value={advanced.campaign} onChange={(e) => setAdvanced((a) => ({ ...a, campaign: e.target.value }))} /></FormField>
          {advancedActiveCount > 0 && (
            <div className="col-span-2 sm:col-span-4">
              <Button variant="ghost" size="sm" icon={X} onClick={() => setAdvanced(EMPTY_ADVANCED)}>Clear advanced filters</Button>
            </div>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        data={crud.items}
        loading={crud.loading}
        onRowClick={(row) => navigate(`/enquiries/${row.id}`)}
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
        emptyTitle="No enquiries found"
        emptyDescription="Try adjusting your search or filters, or add a new enquiry to get started."
      />

      <EnquiryFormModal open={createOpen} onClose={() => setCreateOpen(false)} mode="create" saving={saving} onSubmit={createEnquiry} onViewMatch={openMatch} />
      {editTarget && (
        <EnquiryFormModal open={!!editTarget} onClose={closeAllModals} mode="edit" enquiry={editTarget} saving={saving} onSubmit={saveEdit} />
      )}

      <AssignEnquiryModal open={!!assignTarget} onClose={closeAllModals} enquiry={assignTarget} saving={saving} onSave={doAssign} />
      <QualifyEnquiryModal open={!!qualifyTarget} onClose={closeAllModals} enquiry={qualifyTarget} saving={saving} onSave={doQualify} />
      <DispositionEnquiryModal
        open={!!dispositionTarget}
        onClose={closeAllModals}
        enquiry={dispositionTarget?.row}
        targetStatus={dispositionTarget?.status}
        saving={saving}
        onSave={doDisposition}
      />
      <ConvertEnquiryToLeadModal open={!!convertTarget} onClose={() => setConvertTarget(null)} enquiry={convertTarget} onConverted={refreshAll} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this enquiry?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Enquiry"
      />
    </div>
  )
}
