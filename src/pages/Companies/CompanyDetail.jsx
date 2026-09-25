import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Mail, Phone, Globe, MapPin, IndianRupee, Handshake, FolderKanban, Paperclip, Trash2, Pencil, Inbox } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Tabs } from '../../components/common/Tabs'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { StatCard } from '../../components/common/StatCard'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { FormModal } from '../../components/common/FormModal'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { projectsByCustomer } from '../../data/projects'
import { invoicesByCustomer } from '../../data/invoices'
import { PAYMENTS } from '../../data/payments'
import { DOCUMENTS } from '../../data/documents'
import { TICKETS } from '../../data/tickets'
import { INDUSTRIES, CITIES, CLOSED_DEAL_STAGES } from '../../data/constants'
import { formatCurrency, formatDate } from '../../utils/format'

const COMPANY_STATUSES = ['Active', 'Inactive', 'Prospect']

export default function CompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contacts, setContacts] = useState([])
  const [deals, setDeals] = useState([])
  const [customer, setCustomer] = useState(null)
  const [enquiries, setEnquiries] = useState([])
  const [leads, setLeads] = useState([])
  const [activities, setActivities] = useState([])
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    api.get(`/companies/${id}`).then((res) => setCompany(res.data)).catch(() => setCompany(null)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  // Fetched live (not the frozen ESM-imported seed arrays) so a company/customer/contact/deal/
  // enquiry/lead created moments ago — e.g. by converting a Lead, or by creating an Enquiry
  // that names this company — shows up here immediately, instead of only after a full page
  // reload re-evaluates the static import.
  useEffect(() => {
    if (!company) return
    Promise.all([
      api.get('/contacts', { params: { all: true } }),
      api.get('/deals', { params: { all: true } }),
      api.get('/customers', { params: { all: true } }),
      api.get('/enquiries', { params: { all: true } }),
      api.get('/leads', { params: { all: true } }),
    ]).then(([contactsRes, dealsRes, customersRes, enquiriesRes, leadsRes]) => {
      const companyContacts = contactsRes.data.filter((c) => c.companyId === company.id)
      const companyDeals = dealsRes.data.filter((d) => d.companyId === company.id)
      const matchedCustomer = customersRes.data.find((c) => c.companyId === company.id) || null
      const companyEnquiries = enquiriesRes.data.filter((e) => e.companyId === company.id)
      const companyLeads = leadsRes.data.filter((l) => l.companyId === company.id)
      setContacts(companyContacts)
      setDeals(companyDeals)
      setCustomer(matchedCustomer)
      setEnquiries(companyEnquiries)
      setLeads(companyLeads)
      const ids = new Set([
        ...companyContacts.map((c) => c.id), ...companyDeals.map((d) => d.id), matchedCustomer?.id,
        ...companyEnquiries.map((e) => e.id), ...companyLeads.map((l) => l.id),
      ].filter(Boolean))
      api.get('/activities', { params: { all: true } }).then((res) => {
        setActivities(res.data.filter((a) => ids.has(a.relatedId)).sort((a, b) => new Date(b.date) - new Date(a.date)))
      })
    })
  }, [company])

  const projects = useMemo(() => (customer ? projectsByCustomer(customer.id) : []), [customer])
  const invoices = useMemo(() => (customer ? invoicesByCustomer(customer.id) : []), [customer])
  const payments = useMemo(() => (customer ? PAYMENTS.filter((p) => p.customerId === customer.id) : []), [customer])
  const documents = useMemo(() => (customer ? DOCUMENTS.filter((d) => d.relatedCustomerId === customer.id) : []), [customer])
  const tickets = useMemo(() => (customer ? TICKETS.filter((t) => t.customerId === customer.id) : []), [customer])

  const activeDeals = deals.filter((d) => !CLOSED_DEAL_STAGES.includes(d.stage))
  const wonValue = deals.filter((d) => d.stage === 'Closed Won').reduce((s, d) => s + d.value, 0)

  if (loading) return <div className="py-16 text-center text-sm text-ink-400">Loading company…</div>
  if (!company) return <EmptyState title="Company not found" description="This company may have been removed." />

  const saveEdit = (data) => {
    setSaving(true)
    api.put(`/companies/${company.id}`, { ...data, revenue: Number(data.revenue) || 0 }).then((res) => {
      setSaving(false)
      setEditOpen(false)
      setCompany(res.data)
      toast('Company updated.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    api.delete(`/companies/${company.id}`).then(() => {
      toast(`"${company.name}" deleted.`, { type: 'success' })
      navigate('/companies')
    })
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'enquiries', label: 'Enquiries', count: enquiries.length },
    { value: 'leads', label: 'Leads', count: leads.length },
    { value: 'contacts', label: 'Contacts', count: contacts.length },
    { value: 'deals', label: 'Deals', count: deals.length },
    { value: 'projects', label: 'Projects', count: projects.length },
    { value: 'invoices', label: 'Invoices', count: invoices.length },
    { value: 'payments', label: 'Payments', count: payments.length },
    { value: 'documents', label: 'Documents', count: documents.length },
    { value: 'activities', label: 'Activities', count: activities.length },
    { value: 'tickets', label: 'Tickets', count: tickets.length },
  ]

  return (
    <div>
      <PageHeader
        breadcrumb={<Breadcrumbs items={[{ label: 'Companies', href: '/companies' }, { label: company.name }]} />}
        title={company.name}
        description={company.industry}
        actions={
          <>
            <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>Delete</Button>
          </>
        }
      />

      <div className="mb-6 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={company.name} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{company.name}</p>
                <StatusBadge status={company.status} />
              </div>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{company.industry} · {company.city}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                <span className="flex items-center gap-1"><Mail size={12} /> {company.email}</span>
                <span className="flex items-center gap-1"><Phone size={12} /> {company.phone}</span>
                {company.website && <span className="flex items-center gap-1"><Globe size={12} /> {company.website}</span>}
                <span className="flex items-center gap-1"><MapPin size={12} /> {company.address}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Revenue" value={formatCurrency(company.revenue, { compact: true })} icon={IndianRupee} tone="emerald" />
          <StatCard label="Active Deals" value={activeDeals.length} icon={Handshake} tone="brand" />
          <StatCard label="Won Value" value={formatCurrency(wonValue, { compact: true })} icon={IndianRupee} tone="violet" />
          <StatCard label="Projects" value={projects.length} icon={FolderKanban} tone="sky" />
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Company Information</p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Contact Person</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{company.contactPerson}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Industry</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{company.industry}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">City</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{company.city}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Status</dt><dd><StatusBadge status={company.status} /></dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Customer Since</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{customer ? formatDate(customer.since) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Created</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{formatDate(company.createdDate)}</dd></div>
            </dl>
            {company.tags?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {company.tags.map((t) => <span key={t} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t}</span>)}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Recent Activity</p>
            <ActivityTimeline items={activities.slice(0, 5)} />
          </div>
        </div>
      )}

      {tab === 'enquiries' && (
        enquiries.length === 0 ? <EmptyState title="No enquiries yet" description="No enquiries have named this company." /> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enquiries.map((e) => (
              <button
                key={e.id}
                onClick={() => navigate(`/enquiries/${e.id}`)}
                className="rounded-2xl border border-ink-100 bg-white p-4 text-left transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{e.id}</p>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{e.name}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
                  <span>{e.source}</span>
                  <PriorityBadge priority={e.priority} />
                </div>
                {e.convertedLeadId && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Converted → {e.convertedLeadId}</p>}
              </button>
            ))}
          </div>
        )
      )}

      {tab === 'leads' && (
        leads.length === 0 ? <EmptyState title="No leads yet" description="No leads are linked to this company." /> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leads.map((l) => (
              <button
                key={l.id}
                onClick={() => navigate(`/leads/${l.id}`)}
                className="rounded-2xl border border-ink-100 bg-white p-4 text-left transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{l.id}</p>
                  <StatusBadge status={l.status} />
                </div>
                <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{l.name}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-ink-500 dark:text-ink-400">
                  <span>{l.source}</span>
                  <PriorityBadge priority={l.priority} />
                </div>
                {l.sourceEnquiryId && <p className="mt-2 flex items-center gap-1 text-xs text-ink-400"><Inbox size={11} /> from {l.sourceEnquiryId}</p>}
                {l.dealId && <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Handshake size={11} /> Converted → {l.dealId}</p>}
              </button>
            ))}
          </div>
        )
      )}

      {tab === 'contacts' && (
        contacts.length === 0 ? <EmptyState title="No contacts yet" description="No contacts are linked to this company." /> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{c.name}</p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{c.designation}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-xs text-ink-500 dark:text-ink-400">
                  <p>{c.email}</p>
                  <p>{c.phone}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'deals' && (
        deals.length === 0 ? <EmptyState title="No deals yet" description="No deals have been created for this company." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Deal</th><th className="px-4 py-3">Service</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{d.name}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{d.service}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatCurrency(d.value)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.stage} /></td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(d.expectedClosingDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'projects' && (
        projects.length === 0 ? <EmptyState title="No projects yet" description="No projects are associated with this company." /> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <div key={p.id} className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{p.name}</p>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${p.progress}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{p.progress}% complete · Deadline {formatDate(p.deadline)}</p>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'invoices' && (
        invoices.length === 0 ? <EmptyState title="No invoices yet" description="No invoices have been raised for this company." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[500px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Invoice #</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{inv.number}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatCurrency(inv.amount)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(inv.dueDate)}</td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'payments' && (
        payments.length === 0 ? <EmptyState title="No payments yet" description="No payments have been recorded for this company." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Reference</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{p.reference}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{p.invoiceNumber}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatCurrency(p.amount)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{p.method}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(p.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'documents' && (
        documents.length === 0 ? <EmptyState title="No documents yet" description="No documents have been uploaded for this company." /> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white p-3.5 dark:border-ink-800 dark:bg-ink-900">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"><Paperclip size={16} /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{d.name}</p>
                  <p className="text-xs text-ink-400">{d.category} · {formatDate(d.uploadedDate)}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'activities' && (
        activities.length === 0 ? <EmptyState title="No activity yet" description="No activity has been recorded for this company." /> : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <ActivityTimeline items={activities} />
          </div>
        )
      )}

      {tab === 'tickets' && (
        tickets.length === 0 ? <EmptyState title="No support tickets" description="No support tickets have been raised by this company." /> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tickets.map((t) => (
              <div key={t.id} className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{t.subject}</p>
                  <StatusBadge status={t.status} />
                </div>
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t.category} · {formatDate(t.createdDate)}</p>
              </div>
            ))}
          </div>
        )
      )}

      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Company"
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        defaultValues={company}
        fields={[
          { name: 'name', label: 'Company name', required: true, span: 1 },
          { name: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES.map((i) => ({ value: i, label: i })), required: true, span: 1 },
          { name: 'contactPerson', label: 'Contact person', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'website', label: 'Website', span: 1 },
          { name: 'city', label: 'City', type: 'select', options: CITIES.map((c) => ({ value: c, label: c })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: COMPANY_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'revenue', label: 'Annual Revenue (₹)', type: 'number', span: 1 },
          { name: 'address', label: 'Address', span: 2 },
        ]}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this company?"
        description={`"${company.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Company"
      />
    </div>
  )
}
