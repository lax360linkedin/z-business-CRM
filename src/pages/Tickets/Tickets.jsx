import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LifeBuoy, Loader2, CheckCircle2, Clock3 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { StatCard } from '../../components/common/StatCard'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { TICKET_STATUSES, TICKET_CATEGORIES, PRIORITIES } from '../../data/constants'
import { CUSTOMERS } from '../../data/customers'
import { supportUsers, getUserById } from '../../data/users'
import { formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

export default function Tickets() {
  const crud = useCrud('tickets', { searchFields: ['id', 'subject', 'customerName'], pageSize: 10 })
  const navigate = useNavigate()
  const { toast } = useToast()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const staff = supportUsers()

  const stats = useMemo(() => {
    const all = crud.allItems
    const open = all.filter((t) => t.status === 'Open').length
    const inProgress = all.filter((t) => t.status === 'In Progress').length
    const today = new Date().toDateString()
    const resolvedToday = all.filter((t) => {
      if (!['Resolved', 'Closed'].includes(t.status)) return false
      const last = t.messages?.[t.messages.length - 1]?.date
      return last && new Date(last).toDateString() === today
    }).length
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
    { key: 'category', label: 'Categories', options: TICKET_CATEGORIES.map((c) => ({ value: c, label: c })) },
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'assignedStaff', label: 'Staff', options: staff.map((s) => ({ value: s.id, label: s.name })) },
  ]

  const columns = [
    { key: 'id', header: 'Ticket ID', sortable: true, className: 'font-medium text-ink-500 text-xs' },
    {
      key: 'customerName', header: 'Customer', sortable: true,
      render: (row) => <span className="font-medium text-ink-800 dark:text-ink-100">{row.customerName}</span>,
    },
    {
      key: 'subject', header: 'Subject',
      render: (row) => <span className="line-clamp-1 max-w-[240px]">{row.subject}</span>,
    },
    { key: 'category', header: 'Category', render: (row) => <Badge tone="info">{row.category}</Badge> },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'assignedStaff', header: 'Assigned Staff',
      render: (row) => {
        const u = getUserById(row.assignedStaff)
        return u ? (
          <div className="flex items-center gap-2">
            <Avatar name={u.name} size="sm" />
            <span className="text-sm">{u.name.split(' ')[0]}</span>
          </div>
        ) : '—'
      },
    },
    { key: 'createdDate', header: 'Created', sortable: true, render: (row) => formatDate(row.createdDate) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ]

  const createTicket = (data) => {
    setSaving(true)
    const customer = CUSTOMERS.find((c) => c.id === data.customerId)
    crud.create({
      id: genId('TK'),
      customerId: data.customerId,
      customerName: customer?.name || 'Unknown Customer',
      subject: data.subject,
      category: data.category,
      priority: data.priority,
      assignedStaff: data.assignedStaff,
      createdDate: new Date().toISOString().slice(0, 10),
      status: 'Open',
      messages: [],
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Ticket created successfully.', { type: 'success' })
    })
  }

  return (
    <div>
      <PageHeader
        title="Helpdesk / Tickets"
        description="Track and resolve customer support requests."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>New Ticket</Button>}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="mb-4 mt-5 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search tickets by ID, subject, customer…" className="w-full max-w-xs" />
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

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Raise New Ticket"
        description="Log a new support request on behalf of a customer."
        submitLabel="Create Ticket"
        loading={saving}
        onSubmit={createTicket}
        defaultValues={{ category: TICKET_CATEGORIES[0], priority: 'Medium', assignedStaff: staff[0]?.id, customerId: CUSTOMERS[0]?.id }}
        fields={[
          { name: 'customerId', label: 'Customer', type: 'select', options: CUSTOMERS.map((c) => ({ value: c.id, label: c.name })), required: true, span: 2 },
          { name: 'subject', label: 'Subject', required: true, span: 2 },
          { name: 'category', label: 'Category', type: 'select', options: TICKET_CATEGORIES.map((c) => ({ value: c, label: c })), required: true, span: 1 },
          { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), required: true, span: 1 },
          { name: 'assignedStaff', label: 'Assign to', type: 'select', options: staff.map((s) => ({ value: s.id, label: s.name })), required: true, span: 2 },
        ]}
      />
    </div>
  )
}
