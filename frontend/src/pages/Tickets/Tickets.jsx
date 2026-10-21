import { useOptions, asChoices } from '../../hooks/useOptions'
import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Plus, LifeBuoy, Loader2, CheckCircle2, Clock3 } from 'lucide-react'
import { ExportMenu } from '../../components/common/ExportMenu'
import { filterText } from '../../utils/exporter'
import { PageHeader } from '../../components/common/PageHeader'
import { StatCard } from '../../components/common/StatCard'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea, Select } from '../../components/common/FormField'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { TICKET_STATUSES, PRIORITIES } from '../../data/constants'
import { CUSTOMERS } from '../../data/customers'
import { COMPANIES } from '../../data/companies'
import { CONTACTS } from '../../data/contacts'
import { supportUsers, getUserById, USERS } from '../../data/users'
import { formatDate } from '../../utils/format'
import { useCollections } from '../../api/store'

function CreateTicketModal({ open, onClose, onSuccess }) {
  const sources = useOptions('ticket_sources')
  const categories = useOptions('ticket_categories')
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    defaultValues: { priority: 'Medium', category: '', source: '' }
  })
  const [saving, setSaving] = useState(false)
  const staff = supportUsers()

  const selectedCustomerId = watch('customerId')
  const selectedCompanyId = watch('companyId')
  const selectedContactId = watch('contactId')

  useEffect(() => {
    if (open) reset({ priority: 'Medium', category: '', source: '' })
  }, [open, reset])

  const onSubmit = (data) => {
    setSaving(true)
    const customer = CUSTOMERS.find((c) => c.id === data.customerId)
    const company = COMPANIES.find((c) => c.id === data.companyId)
    const contact = CONTACTS.find((c) => c.id === data.contactId)

    // Only what was entered is sent; the server fills the customer / contact details, the due date, the service level, the creator and the first timeline entry.
    const newTicket = {
      subject: data.subject,
      description: data.description,
      customerId: customer?.id || null,
      companyId: company?.id || null,
      contactId: contact?.id || null,
      source: data.source,
      category: data.category,
      priority: data.priority,
      status: 'New',
      assignedStaff: data.assignedStaff || null,
    }

    onSuccess(newTicket).finally(() => setSaving(false))
  }

  // Filter contacts by selected company
  const availableContacts = selectedCompanyId 
    ? CONTACTS.filter(c => c.companyId === selectedCompanyId)
    : CONTACTS

  // Filter companies by selected customer if any logic exists (customers have 1 companyId)
  const availableCompanies = selectedCustomerId 
    ? COMPANIES.filter(c => c.id === CUSTOMERS.find(cust => cust.id === selectedCustomerId)?.companyId)
    : COMPANIES

  return (
    <Modal open={open} onClose={onClose} title="Raise New Ticket" description="Log a new support request." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={handleSubmit(onSubmit)} loading={saving}>Create Ticket</Button></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
        
        <FormField label="Subject" required error={errors.subject?.message} className="col-span-2">
          <Input {...register('subject', { required: 'Subject is required' })} placeholder="Enter ticket subject" />
        </FormField>

        <FormField label="Description" required error={errors.description?.message} className="col-span-2">
          <Textarea {...register('description', { required: 'Description is required' })} placeholder="Detailed issue description..." className="min-h-[100px]" />
        </FormField>

        <FormField label="Customer" className="col-span-1">
          <Select {...register('customerId')}>
            <option value="">Select Customer...</option>
            {CUSTOMERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>

        <FormField label="Company" className="col-span-1">
          <Select {...register('companyId')}>
            <option value="">Select Company...</option>
            {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>

        <FormField label="Contact" className="col-span-1">
          <Select {...register('contactId')}>
            <option value="">Select Contact...</option>
            {availableContacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>
        
        <FormField label="Source" className="col-span-1" error={errors.source?.message}>
          <Select {...register('source', { required: 'Source required' })}>
            <option value="">{sources.placeholder}</option>
            {sources.values.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </FormField>

        <FormField label="Category" className="col-span-1" error={errors.category?.message}>
          <Select {...register('category', { required: 'Category required' })}>
            <option value="">{categories.placeholder}</option>
            {categories.values.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </FormField>

        <FormField label="Priority" className="col-span-1" error={errors.priority?.message}>
          <Select {...register('priority', { required: 'Priority required' })}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </FormField>

        <FormField label="Assigned Staff" className="col-span-2">
          <Select {...register('assignedStaff')}>
             <option value="">Unassigned</option>
             {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.department})</option>)}
          </Select>
        </FormField>

      </form>
    </Modal>
  )
}

export default function Tickets() {
  const categoryFilter = useOptions('ticket_categories')
  useCollections('customers', 'companies', 'contacts')
  const crud = useCrud('tickets', { searchFields: ['id', 'subject', 'customerName', 'companyName'], pageSize: 10 })
  const navigate = useNavigate()
  const { toast } = useToast()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const staff = supportUsers()

  const stats = useMemo(() => {
    const all = crud.allItems
    const open = all.filter((t) => ['New', 'Open', 'Assigned'].includes(t.status)).length
    const inProgress = all.filter((t) => t.status === 'In Progress').length
    const today = new Date().toDateString()
    const resolvedToday = all.filter((t) => {
      if (!['Resolved', 'Closed'].includes(t.status)) return false
      const last = t.messages?.[t.messages.length - 1]?.date || t.updatedDate
      return last && new Date(last).toDateString() === today
    }).length
    
    // avg response
    const responseTimes = all
      .map((t) => {
        const staffMsg = t.messages?.find((m) => m.from === 'staff')
        if (!staffMsg) return null
        const diffHrs = (new Date(staffMsg.date).getTime() - new Date(t.createdDate).getTime()) / 3.6e6
        return diffHrs >= 0 ? diffHrs : null
      })
      .filter((v) => v !== null)
    const avgResponse = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0
    
    return [
      { label: 'Open Tickets', value: open, icon: LifeBuoy, tone: 'brand' },
      { label: 'In Progress', value: inProgress, icon: Loader2, tone: 'amber' },
      { label: 'Resolved Today', value: resolvedToday, icon: CheckCircle2, tone: 'emerald' },
      { label: 'Avg. Response Time', value: `${avgResponse.toFixed(1)}h`, icon: Clock3, tone: 'sky' },
    ]
  }, [crud.allItems])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: TICKET_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'category', label: 'Categories', options: asChoices(categoryFilter.all) },
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'assignedStaff', label: 'Staff', options: staff.map((s) => ({ value: s.id, label: s.name })) },
  ]

  // Export: every ticket that matches the search and filters on screen
  const exportColumns = [
    { label: 'Ticket ID', value: 'id' }, { label: 'Subject', value: 'subject' }, { label: 'Customer', value: 'customerName' }, { label: 'Company', value: 'companyName' }, { label: 'Category', value: 'category' },
    { label: 'Priority', value: 'priority' }, { label: 'Status', value: 'status' }, { label: 'Assigned staff', value: (t) => getUserById(t.assignedStaff)?.name || '' }, { label: 'SLA', value: 'slaStatus' },
    { label: 'Created', value: 'createdDate' }, { label: 'Due', value: (t) => String(t.dueDate || '').slice(0, 10) }, { label: 'Branch', value: 'branch' },
  ]
  const exportFilters = filterText({ search: crud.search, values: crud.filters, defs: filterDefs })

  const columns = [
    { key: 'id', width: 110, header: 'Ticket ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'customerName', width: 240, header: 'Customer/Company', sortable: true,
      render: (row) => (
         <div>
            <span className="block font-medium text-ink-800 dark:text-ink-100">{row.customerName || 'N/A'}</span>
            <span className="block text-xs text-ink-500">{row.companyName}</span>
         </div>
      ),
    },
    {
      key: 'subject', width: 260, header: 'Subject',
      render: (row) => <span className="line-clamp-1 max-w-[240px]" title={row.subject}>{row.subject}</span>,
    },
    { key: 'category', width: 140, header: 'Category', render: (row) => <Badge tone="info">{row.category}</Badge> },
    { key: 'priority', width: 120, header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'assignedStaff', width: 190, header: 'Assigned Staff',
      render: (row) => {
        const u = getUserById(row.assignedStaff)
        return u ? (
          <div className="flex items-center gap-2">
            <Avatar name={u.name} size="sm" />
            <span className="text-sm">{u.name.split(' ')[0]}</span>
          </div>
        ) : <span className="text-sm text-ink-400">Unassigned</span>
      },
    },
    { key: 'createdDate', width: 130, header: 'Created', sortable: true, render: (row) => formatDate(row.createdDate) },
    { key: 'status', width: 130, header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ]

  const createTicket = (newTicket) => {
    return crud.create(newTicket).then(() => {
      setCreateOpen(false)
      toast('Ticket created successfully.', { type: 'success' })
    })
  }

  return (
    <div>
      <PageHeader
        title="Helpdesk / Tickets"
        description="Track and resolve customer support requests."
        actions={<><ExportMenu title="Tickets" noun="ticket" columns={exportColumns} rows={() => crud.allFiltered} filters={exportFilters} /><Button icon={Plus} onClick={() => setCreateOpen(true)}>New Ticket</Button></>}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="mb-4 mt-5 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search tickets by ID, subject, customer, company..." className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={crud.items}
        loading={crud.loading}
        onRowClick={(row) => navigate(`/tickets/${row.id}`)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No tickets found"
        emptyDescription="Try adjusting your search or filters, or raise a new ticket."
      />

      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={createTicket} />
    </div>
  )
}
