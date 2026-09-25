import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Plus, Download, Upload, Trash2, Eye, Pencil, UserCog, ClipboardCheck, Handshake,
  Ban, MoreVertical, X, Copy, AlertOctagon, XCircle, Search,
} from 'lucide-react'
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
import { ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_PRIORITIES, SERVICES, CITIES } from '../../data/constants'
import { salesUsers, getUserById, USERS } from '../../data/users'
import { getDataScope, matchesDataScope } from '../../data/dataScope'
import { canTransition, isQualificationComplete } from '../../data/enquiryWorkflow'
import { formatDate, isOverdue } from '../../utils/format'
import { downloadCsv, parseCsv } from '../../utils/csv'
import { createNotification } from '../../utils/notify'
import { EnquiryFormModal } from './EnquiryFormModal'
import { QualifyEnquiryModal } from './QualifyEnquiryModal'
import { AssignEnquiryModal } from './AssignEnquiryModal'
import { DispositionEnquiryModal } from './DispositionEnquiryModal'
import { ConvertEnquiryToLeadModal } from './ConvertEnquiryToLeadModal'
import {
  genEnquiryId, logEnquiryActivity, assignEnquiry, saveEnquiryQualification,
  closeEnquiry, findOrCreateCompany,
} from './enquiryActions'

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

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: ENQUIRY_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'source', label: 'Sources', options: ENQUIRY_SOURCES.map((s) => ({ value: s, label: s })) },
    { key: 'priority', label: 'Priorities', options: ENQUIRY_PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'assignedUser', label: 'Assigned Users', options: reps.map((r) => ({ value: r.id, label: r.name })) },
    { key: 'interestedService', label: 'Products/Services', options: SERVICES.map((s) => ({ value: s, label: s })) },
    { key: 'city', label: 'Locations', options: CITIES.map((c) => ({ value: c, label: c })) },
  ]

  const advancedActiveCount = Object.values(advanced).filter(Boolean).length
  const closeAllModals = () => { setAssignTarget(null); setQualifyTarget(null); setDispositionTarget(null); setEditTarget(null) }

  const refreshAll = () => crud.refresh()

  const doAssign = (team, userId) => {
    setSaving(true)
    const assignee = getUserById(userId)
    assignEnquiry(assignTarget, { team, userId, by: user.id, byName: user.name, userName: assignee?.name || 'a team member' })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${assignTarget.name} ${assignTarget.assignedUser ? 'reassigned' : 'assigned'} to ${assignee?.name}.`, { type: 'success' })
        refreshAll()
      })
  }

  const doQualify = (qualification, outcome) => {
    setSaving(true)
    saveEnquiryQualification(qualifyTarget, qualification, { by: user.id, outcome })
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
    closeEnquiry(dispositionTarget.row, { targetStatus: dispositionTarget.status, reason, by: user.id })
      .then(() => {
        setSaving(false)
        closeAllModals()
        toast(`${dispositionTarget.row.name} marked as ${dispositionTarget.status}.`, { type: 'success' })
        refreshAll()
      })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const columns = [
    { key: 'id', header: 'Enquiry ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'name', header: 'Name', sortable: true,
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
    { key: 'company', header: 'Company' },
    { key: 'phone', header: 'Phone' },
    { key: 'interestedService', header: 'Interested Product/Service', render: (row) => row.interestedService || row.interestedProduct || '—' },
    { key: 'source', header: 'Source' },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'assignedUser', header: 'Assigned To', render: (row) => getUserById(row.assignedUser)?.name.split(' ')[0] || 'Unassigned' },
    { key: 'createdDate', header: 'Created Date', sortable: true, render: (row) => formatDate(row.createdDate) },
    {
      key: 'nextFollowUp', header: 'Next Follow-up', sortable: true,
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

  const buildPayload = (data, opts) => {
    const tags = typeof data.tags === 'string' ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : (data.tags || [])
    const initials = data.name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase()
    const assignedUser = data.assignedUser || null
    return {
      ...data,
      tags,
      quantity: Number(data.quantity) || 0,
      assignedTeam: data.assignedTeam || null,
      assignedUser,
      assignedBy: assignedUser ? user.id : null,
      assignedAt: assignedUser ? new Date().toISOString() : null,
      status: opts.markDuplicate ? 'Duplicate' : (assignedUser ? 'Assigned' : 'New'),
      date: new Date().toISOString().slice(0, 10),
      attachments: [],
      qualification: null,
      nextFollowUp: null,
      lastContactedDate: null,
      duplicateOfId: opts.markDuplicate ? opts.duplicateOfId : null,
      existingCustomerId: opts.existingCustomerId || null,
      companyId: opts.companyId || null,
      closeReason: opts.markDuplicate ? 'Flagged as a duplicate at creation.' : null,
      closedAt: opts.markDuplicate ? new Date().toISOString() : null,
      closedBy: opts.markDuplicate ? user.id : null,
      convertedLeadId: null, convertedAt: null, convertedBy: null,
      createdDate: new Date().toISOString().slice(0, 10),
      createdBy: user.id,
      initials,
    }
  }

  const createEnquiry = (data, opts = {}) => {
    setSaving(true)
    const id = genEnquiryId(crud.allItems)
    // Company auto-creation happens right here, at Enquiry creation — not deferred until a
    // later Lead conversion — so the Company shows up in Company Management immediately.
    // Only runs when the enquiry actually names a company (spec: "when valid company
    // information is available"); find-or-create by name means a repeat enquiry from an
    // existing company links to that SAME record instead of creating a duplicate.
    const companyLookup = data.company?.trim() ? findOrCreateCompany(data) : Promise.resolve(null)
    companyLookup.then((company) => {
      const payload = { id, ...buildPayload(data, { ...opts, companyId: company?.id || null }) }
      return crud.create(payload).then(() => payload)
    }).then((payload) => {
      setSaving(false)
      setCreateOpen(false)
      toast(opts.markDuplicate ? `Enquiry ${id} created and flagged as duplicate.` : 'Enquiry created successfully.', { type: 'success' })
      logEnquiryActivity({ type: 'Created', enquiryId: id, enquiryName: data.name, subject: `Enquiry received from ${data.source}`, by: user.id })
      if (!opts.markDuplicate) {
        createNotification({ type: 'New Enquiry', message: `New enquiry: ${data.name} (${data.company || '—'}).`, relatedType: 'Enquiry', relatedId: id })
        if (data.priority === 'Critical') {
          createNotification({ type: 'High Priority Enquiry', message: `Critical enquiry: ${data.name} (${data.company || '—'}) needs immediate attention.`, relatedType: 'Enquiry', relatedId: id })
        }
        if (payload.assignedUser) {
          createNotification({ type: 'Enquiry Assignment', message: `${data.name} (${data.company || '—'}) was assigned to you.`, relatedType: 'Enquiry', relatedId: id })
        }
      }
    })
  }

  const saveEdit = (data) => {
    setSaving(true)
    const tags = typeof data.tags === 'string' ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : (data.tags || [])
    crud.update(editTarget.id, { ...data, tags, quantity: Number(data.quantity) || 0 }).then(() => {
      setSaving(false)
      closeAllModals()
      toast('Enquiry updated.', { type: 'success' })
      logEnquiryActivity({ type: 'Note', enquiryId: editTarget.id, enquiryName: editTarget.name, subject: 'Enquiry details updated', by: user.id })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Enquiry "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const handleExport = () => {
    downloadCsv('enquiries.csv', crud.allFiltered, [
      { label: 'Enquiry ID', value: 'id' }, { label: 'Name', value: 'name' }, { label: 'Company', value: 'company' },
      { label: 'Phone', value: 'phone' }, { label: 'Interested Product/Service', value: (r) => r.interestedService || r.interestedProduct || '' },
      { label: 'Source', value: 'source' }, { label: 'Status', value: 'status' }, { label: 'Priority', value: 'priority' },
      { label: 'Assigned To', value: (r) => getUserById(r.assignedUser)?.name || '' },
      { label: 'Created Date', value: 'createdDate' }, { label: 'Last Activity', value: 'lastContactedDate' }, { label: 'Next Follow-up', value: 'nextFollowUp' },
    ])
    toast(`Exported ${crud.allFiltered.length} enquiries.`, { type: 'success' })
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result))
      Promise.all(rows.map((r) => {
        const name = r.name || r.Name || 'Unnamed Enquiry'
        const company = r.company || r.Company || ''
        const id = genEnquiryId(crud.allItems)
        // Same company auto-link as the single-record create path — a CSV import naming a
        // company must find-or-create it too, not just the manual "Add Enquiry" form.
        const companyLookup = company.trim() ? findOrCreateCompany({ company, name, email: r.email || r.Email || '', phone: r.phone || r.Phone || '', city: r.city || r.City || '' }) : Promise.resolve(null)
        return companyLookup.then((matchedCompany) => crud.create({
          id,
          name,
          company,
          email: r.email || r.Email || '',
          phone: r.phone || r.Phone || '',
          alternatePhone: '', whatsapp: '', designation: '',
          country: 'India', state: '', city: r.city || r.City || '', area: '', address: '', pincode: '',
          source: 'Import', campaign: '', enquiryType: 'General Enquiry', priority: 'Medium',
          assignedTeam: null, assignedUser: null, assignedBy: null, assignedAt: null,
          interestedProduct: r.service || r.Service || '', interestedService: r.service || r.Service || '',
          category: '', requirementType: 'New Requirement',
          requirementDescription: r.requirement || 'Imported via CSV upload.',
          quantity: 0, budgetRange: '', expectedPurchaseDate: null, preferredContactMethod: 'Phone',
          tags: [], notes: '', attachments: [], qualification: null,
          nextFollowUp: null, lastContactedDate: null,
          duplicateOfId: null, existingCustomerId: null, companyId: matchedCompany?.id || null,
          closeReason: null, closedAt: null, closedBy: null,
          convertedLeadId: null, convertedAt: null, convertedBy: null,
          date: new Date().toISOString().slice(0, 10),
          createdDate: new Date().toISOString().slice(0, 10),
          createdBy: user.id,
          status: 'New',
          initials: name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase(),
        })).then(() => logEnquiryActivity({ type: 'Created', enquiryId: id, enquiryName: name, subject: 'Enquiry imported via CSV', by: user.id }))
      })).then(() => toast(`Imported ${rows.length} enquiries.`, { type: 'success' }))
    }
    reader.readAsText(file)
    e.target.value = ''
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
            {canCreate && <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />}
            {canCreate && <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>Import</Button>}
            {canExport && <Button variant="secondary" icon={Download} onClick={handleExport}>Export</Button>}
            {canCreate && <Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Enquiry</Button>}
          </>
        }
      />

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
