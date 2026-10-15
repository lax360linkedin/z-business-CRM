import { useOptions, asChoices } from '../../hooks/useOptions'
import { ExpensesPanel } from '../Expenses/ExpensesPanel'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Mail, Phone, IndianRupee, Handshake, FolderKanban, FileText, Wallet, Paperclip,
  LifeBuoy, Trash2, Pencil, Layers, ChevronRight, User, Target,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Tabs } from '../../components/common/Tabs'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { StatCard } from '../../components/common/StatCard'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { FormModal } from '../../components/common/FormModal'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { projectsByCustomer } from '../../utils/projectLookup'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { TICKETS } from '../../data/tickets'
import { getUserById, USERS } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { useCollections } from '../../api/store'

const TIERS = ['Standard', 'Premium', 'Enterprise']
const CUSTOMER_STATUSES = ['Active', 'Inactive']
const TIER_TONES = { Standard: 'neutral', Premium: 'info', Enterprise: 'success' }

export default function CustomerDetail() {
  useCollections('projects', 'tickets')
  const { id } = useParams()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState(null)
  const industries = useOptions('industries', customer?.industry)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contacts, setContacts] = useState([])
  const [deals, setDeals] = useState([])
  const [quotations, setQuotations] = useState([])
  const [salesOrders, setSalesOrders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [activities, setActivities] = useState([])
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    api.get(`/customers/${id}`).then((res) => setCustomer(res.data)).catch(() => setCustomer(null)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  // Fetched live (not the frozen ESM-imported seed arrays) so a contact/deal/quotation
  // created moments ago — e.g. by converting a Lead, or creating a quotation from a deal —
  // shows up here immediately rather than only after a full page reload.
  useEffect(() => {
    if (!customer) return
    Promise.all([
      api.get('/contacts', { params: { all: true } }),
      api.get('/deals', { params: { all: true } }),
      api.get('/quotations', { params: { all: true } }),
      api.get('/salesOrders', { params: { all: true } }),
      api.get('/invoices', { params: { all: true } }),
      api.get('/payments', { params: { all: true } }),
    ]).then(([contactsRes, dealsRes, quotationsRes, ordersRes, invoicesRes, paymentsRes]) => {
      const companyContacts = contactsRes.data.filter((c) => c.companyId === customer.companyId)
      const companyDeals = dealsRes.data.filter((d) => d.companyId === customer.companyId)
      // By companyId, not just customerId — a quotation can exist (and should show here) before
      // it ever gets backfilled onto this specific Customer record.
      const customerQuotations = quotationsRes.data.filter((q) => q.companyId === customer.companyId)
      setContacts(companyContacts)
      setDeals(companyDeals)
      setQuotations(customerQuotations)
      // Live, by customerId — an order/invoice/payment raised moments ago appears immediately.
      const customerOrders = ordersRes.data.filter((o) => o.customerId === customer.id)
      setSalesOrders(customerOrders)
      setInvoices(invoicesRes.data.filter((i) => i.customerId === customer.id))
      setPayments(paymentsRes.data.filter((p) => p.customerId === customer.id))
      const ids = new Set([...companyContacts.map((c) => c.id), ...companyDeals.map((d) => d.id), ...customerOrders.map((o) => o.id), customer.id])
      api.get('/activities', { params: { all: true } }).then((res) => {
        setActivities(res.data.filter((a) => ids.has(a.relatedId) || (a.source === 'manual' && a.links?.customerId === customer.id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
      })
    })
  }, [customer])

  const wonDeals = useMemo(() => deals.filter((d) => d.stage === 'Closed Won'), [deals])
  // What this customer has actually bought: catalog items (by ID) from won deals and from non-cancelled sales orders, with units and value from the order lines.
  const services = useMemo(() => {
    const map = new Map()
    const entry = (productId, name) => {
      const k = productId || `n:${name}`
      if (!map.has(k)) map.set(k, { key: k, productId: productId || null, service: name, code: null, count: 0, orders: 0, units: 0, value: 0 })
      return map.get(k)
    }
    wonDeals.forEach((d) => { entry(d.productId, d.service).count += 1 })
    salesOrders.filter((o) => o.status !== 'Cancelled').forEach((o) => {
      const seen = new Set()
      ;(o.items || []).forEach((it) => {
        const e = entry(it.productId, it.name)
        e.code = e.code || it.productCode || null
        e.units += Number(it.qty) || 0
        e.value += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0) * (1 - (Number(it.discount) || 0) / 100)
        if (!seen.has(e.key)) { seen.add(e.key); e.orders += 1 }
      })
    })
    return Array.from(map.values())
  }, [wonDeals, salesOrders])
  const projects = useMemo(() => (customer ? projectsByCustomer(customer.id) : []), [customer])
  const { docs: documentList } = useDocuments({ relatedType: 'Customer', relatedId: customer?.id, enabled: !!customer?.id })
  const documents = documentList || []
  const tickets = useMemo(() => (customer ? TICKETS.filter((t) => t.customerId === customer.id) : []), [customer])

  // The specific Deal that actually created this Customer (spec §21 "Customer → Original Lead
  // / Deal") — a company can go on to have several deals, so this is deliberately the one whose
  // leadId matches the customer's own originating Lead, not just "any deal for this company".
  const originatingDeal = useMemo(() => deals.find((d) => d.leadId && d.leadId === customer?.leadId) || null, [deals, customer])

  // issued invoices only (drafts, cancelled and void invoices are neither billed nor owed); payments still in force only
  const issuedInvoices = invoices.filter((inv) => ['Sent', 'Viewed', 'Partially Paid', 'Paid', 'Overdue'].includes(inv.status))
  const totalInvoiced = issuedInvoices.reduce((s, inv) => s + (inv.amount || 0), 0)
  const totalPaid = payments.filter((p) => ['Completed', 'Partially Refunded'].includes(p.status)).reduce((s, p) => s + (p.amount || 0) - (p.refundedAmount || 0), 0)
  const outstanding = issuedInvoices.reduce((s, inv) => s + (inv.balance ?? ((inv.amount || 0) - (inv.paidAmount || 0))), 0)

  if (loading) return <div className="py-16 text-center text-sm text-ink-400">Loading customer…</div>
  if (!customer) return <EmptyState title="Customer not found" description="This customer may have been removed." />

  const accountManager = getUserById(customer.accountManager)

  const saveEdit = (data) => {
    setSaving(true)
    api.put(`/customers/${customer.id}`, { ...data, lifetimeValue: Number(data.lifetimeValue) || 0 }).then((res) => {
      setSaving(false)
      setEditOpen(false)
      setCustomer(res.data)
      toast('Customer updated.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    api.delete(`/customers/${customer.id}`).then(() => {
      toast(`"${customer.name}" removed from customers.`, { type: 'success' })
      navigate('/customers')
    })
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'contacts', label: 'Contacts', count: contacts.length },
    { value: 'services', label: 'Services', count: services.length },
    { value: 'deals', label: 'Deals', count: deals.length },
    { value: 'projects', label: 'Projects', count: projects.length },
    { value: 'quotations', label: 'Quotations', count: quotations.length },
    { value: 'salesorders', label: 'Sales Orders', count: salesOrders.length },
    { value: 'invoices', label: 'Invoices', count: invoices.length },
    { value: 'payments', label: 'Payments', count: payments.length },
    { value: 'expenses', label: 'Expenses' },
    { value: 'documents', label: 'Documents', count: documents.length },
    { value: 'communication', label: 'Communication', count: activities.length },
    { value: 'tickets', label: 'Support Tickets', count: tickets.length },
    { value: 'timeline', label: 'Activity Timeline' },
  ]

  const chainSteps = [
    { label: 'Deals', count: deals.length, icon: Handshake },
    { label: 'Quotations', count: quotations.length, icon: FileText },
    { label: 'Projects', count: projects.length, icon: FolderKanban },
    { label: 'Sales Orders', count: salesOrders.length, icon: FileText },
    { label: 'Invoices', count: invoices.length, icon: FileText },
    { label: 'Payments', count: payments.length, icon: Wallet },
    { label: 'Support', count: tickets.length, icon: LifeBuoy },
  ]

  return (
    <div>
      <PageHeader
        breadcrumb={<Breadcrumbs items={[{ label: 'Customers', href: '/customers' }, { label: customer.name }]} />}
        title={customer.name}
        description={customer.industry}
        actions={
          <>
            <RecordTasksButton type="Customer" id={customer.id} label={customer.name} />
            <Button variant="secondary" icon={FileText} onClick={() => navigate(`/quotations?companyId=${customer.companyId}`)}>Create Quotation</Button>
            <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>Delete</Button>
          </>
        }
      />

      <div className="mb-6 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={customer.name} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{customer.name}</p>
                <StatusBadge status={customer.status} />
                <Badge tone={TIER_TONES[customer.tier] || 'neutral'}>{customer.tier}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{customer.industry} · Customer since {formatDate(customer.since)}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                <span className="flex items-center gap-1"><Mail size={12} /> {customer.email}</span>
                <span className="flex items-center gap-1"><Phone size={12} /> {customer.phone}</span>
                <span className="flex items-center gap-1"><User size={12} /> Managed by {accountManager?.name || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Lifetime Value" value={formatCurrency(customer.lifetimeValue, { compact: true })} icon={IndianRupee} tone="emerald" />
          <StatCard label="Total Invoiced" value={formatCurrency(totalInvoiced, { compact: true })} icon={FileText} tone="brand" />
          <StatCard label="Total Paid" value={formatCurrency(totalPaid, { compact: true })} icon={Wallet} tone="violet" />
          <StatCard label="Outstanding" value={formatCurrency(Math.max(outstanding, 0), { compact: true })} icon={IndianRupee} tone={outstanding > 0 ? 'rose' : 'sky'} />
        </div>

        <div className="mt-5 flex items-center gap-1.5 overflow-x-auto rounded-xl bg-ink-50 px-3 py-3 dark:bg-ink-800/50">
          {chainSteps.map((step, i) => (
            <div key={step.label} className="flex shrink-0 items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 shadow-sm dark:bg-ink-900">
                <step.icon size={13} className="text-brand-600 dark:text-brand-400" />
                <span className="text-xs font-medium text-ink-700 dark:text-ink-200">{step.label}</span>
                <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{step.count}</span>
              </div>
              {i < chainSteps.length - 1 && <ChevronRight size={13} className="shrink-0 text-ink-300 dark:text-ink-600" />}
            </div>
          ))}
        </div>
      </div>

      {(customer.leadId || originatingDeal) && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-900/20">
          <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-200">
            <Target size={15} /> This customer originated from a Lead.
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {customer.leadId && <Button variant="secondary" size="sm" icon={Handshake} onClick={() => navigate(`/leads/${customer.leadId}`)}>View Original Lead</Button>}
            {originatingDeal && <Button variant="secondary" size="sm" icon={Handshake} onClick={() => navigate(`/deals?open=${originatingDeal.id}`)}>View Deal {originatingDeal.id}</Button>}
          </div>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Customer Information</p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Contact Person</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{customer.contactPerson}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Industry</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{customer.industry}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Account Manager</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{accountManager?.name || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Tier</dt><dd><Badge tone={TIER_TONES[customer.tier] || 'neutral'}>{customer.tier}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Status</dt><dd><StatusBadge status={customer.status} /></dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Original source</dt><dd className="font-medium">{customer.leadSourceId ? <Link to={`/lead-sources/${customer.leadSourceId}`} className="text-brand-700 hover:underline dark:text-brand-300">{customer.source}</Link> : (customer.source || '—')}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Original campaign</dt><dd className="font-medium">{customer.campaignId ? <Link to={`/campaigns/${customer.campaignId}`} className="text-brand-700 hover:underline dark:text-brand-300">{customer.campaign}</Link> : (customer.campaign || '—')}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500 dark:text-ink-400">Customer Since</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{formatDate(customer.since)}</dd></div>
            </dl>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Recent Activity</p>
            <ActivityTimeline items={activities.slice(0, 5)} />
          </div>
        </div>
      )}

      {tab === 'contacts' && (
        contacts.length === 0 ? <EmptyState title="No contacts yet" description="No contacts are linked to this customer's company." /> : (
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

      {tab === 'services' && (
        services.length === 0 ? <EmptyState icon={Layers} title="No services purchased yet" description="Services will appear here once a deal with this customer's company is won." /> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <div key={s.key} role={s.productId ? 'link' : undefined} tabIndex={s.productId ? 0 : undefined} onClick={() => s.productId && navigate(`/products/${s.productId}`)} onKeyDown={(e) => e.key === 'Enter' && s.productId && navigate(`/products/${s.productId}`)} className={`rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 ${s.productId ? 'cursor-pointer hover:shadow-card-hover' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><Layers size={16} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{s.service}{s.code && <span className="ml-2 font-mono text-[11px] font-normal text-ink-400">{s.code}</span>}</p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{[s.count ? `${s.count} won ${s.count === 1 ? 'deal' : 'deals'}` : null, s.orders ? `${s.orders} ${s.orders === 1 ? 'order' : 'orders'} · ${s.units} units · ${formatCurrency(s.value)}` : null].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'deals' && (
        deals.length === 0 ? <EmptyState title="No deals yet" description="No deals have been created for this customer's company." /> : (
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
        projects.length === 0 ? <EmptyState title="No projects yet" description="No projects have been started for this customer." /> : (
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

      {tab === 'quotations' && (
        quotations.length === 0 ? <EmptyState title="No quotations yet" description="No quotations have been sent to this customer." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[500px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Quotation #</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Valid Until</th><th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{q.number}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatCurrency(q.amount)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(q.validUntil)}</td>
                      <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'salesorders' && (
        salesOrders.length === 0 ? <EmptyState title="No sales orders yet" description="Sales orders appear here once a quotation for this customer is accepted and converted." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Sales Order #</th><th className="px-4 py-3">Quotation</th><th className="px-4 py-3">Order date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrders.map((o) => (
                    <tr key={o.id} onClick={() => navigate(`/sales-orders/${o.id}`)} className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/40">
                      <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{o.number}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{o.quotationNumber || '—'}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(o.orderDate)}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatCurrency(o.amount)}</td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'invoices' && (
        invoices.length === 0 ? <EmptyState title="No invoices yet" description="No invoices have been raised for this customer." /> : (
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
                    <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)} className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/40">
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
        payments.length === 0 ? <EmptyState title="No payments yet" description="No payments have been recorded for this customer." /> : (
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Payment</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3 font-medium"><Link to={`/payments/${p.id}`} className="text-brand-700 hover:underline dark:text-brand-300">{p.number || p.id}</Link></td>
                      <td className="px-4 py-3"><Link to={`/invoices/${p.invoiceId}`} className="text-brand-700 hover:underline dark:text-brand-300">{p.invoiceNumber}</Link></td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{p.amount === null ? '—' : formatCurrency(p.amount)}{p.refundedAmount > 0 && <span className="block text-[11px] text-amber-600">−{formatCurrency(p.refundedAmount)} refunded</span>}</td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{p.method}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-500">{p.reference || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(p.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === 'expenses' && <ExpensesPanel relatedType="Customer" relatedId={customer.id} revenue={{ label: 'Collected', value: totalPaid }} />}

      {tab === 'documents' && <DocumentsPanel relatedType="Customer" relatedId={customer?.id} defaultCategory="Customer Documents" />}

      {tab === 'communication' && (
        activities.length === 0 ? <EmptyState title="No communication logged" description="No calls, emails or notes have been logged for this customer yet." /> : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <ActivityTimeline items={activities} />
          </div>
        )
      )}

      {tab === 'tickets' && (
        <div className="space-y-4">
           {tickets.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-xl font-bold text-ink-900 dark:text-ink-50">{tickets.length}</p>
                    <p className="text-xs text-ink-500 mt-1">Total</p>
                 </div>
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-xl font-bold text-brand-600">{tickets.filter(t => ['New','Open','Assigned','In Progress'].includes(t.status)).length}</p>
                    <p className="text-xs text-ink-500 mt-1">Open</p>
                 </div>
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-xl font-bold text-emerald-600">{tickets.filter(t => t.status === 'Resolved').length}</p>
                    <p className="text-xs text-ink-500 mt-1">Resolved</p>
                 </div>
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-xl font-bold text-ink-500">{tickets.filter(t => t.status === 'Closed').length}</p>
                    <p className="text-xs text-ink-500 mt-1">Closed</p>
                 </div>
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-xl font-bold text-rose-600">{tickets.filter(t => ['High', 'Urgent'].includes(t.priority)).length}</p>
                    <p className="text-xs text-ink-500 mt-1">High/Urgent</p>
                 </div>
                 <div className="p-3 bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 rounded-xl text-center">
                    <p className="text-sm font-bold text-ink-800 dark:text-ink-100 mt-1">{tickets.length > 0 ? formatDate(Math.max(...tickets.map(t => new Date(t.updatedDate || t.createdDate).getTime()))) : '—'}</p>
                    <p className="text-xs text-ink-500 mt-1">Last Interaction</p>
                 </div>
              </div>
           )}
           {tickets.length === 0 ? <EmptyState title="No support tickets" description="No support tickets have been raised by this customer." /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {tickets.sort((a,b) => new Date(b.createdDate) - new Date(a.createdDate)).map((t) => (
                <div key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className="cursor-pointer rounded-2xl border border-ink-100 bg-white p-4 hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink-800 dark:text-ink-100 line-clamp-1">{t.subject}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="flex justify-between mt-2">
                     <p className="text-xs text-ink-500 dark:text-ink-400">{t.id} · {t.category} · {formatDate(t.createdDate)}</p>
                     {['High', 'Urgent'].includes(t.priority) && <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 rounded">{t.priority}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'timeline' && (
        activities.length === 0 ? <EmptyState title="No activity yet" description="Nothing has been recorded across this customer's deals and contacts yet." /> : (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <ActivityTimeline items={activities} />
          </div>
        )
      )}

      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Customer"
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        defaultValues={customer}
        fields={[
          { name: 'name', label: 'Customer name', required: true, span: 1 },
          { name: 'industry', label: 'Industry', type: 'select', options: asChoices(industries.values), blank: industries.placeholder, required: true, span: 1 },
          { name: 'contactPerson', label: 'Contact person', required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'accountManager', label: 'Account manager', type: 'select', options: USERS.map((u) => ({ value: u.id, label: u.name })), required: true, span: 1 },
          { name: 'since', label: 'Customer since', type: 'date', required: true, span: 1 },
          { name: 'tier', label: 'Tier', type: 'select', options: TIERS.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: CUSTOMER_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'lifetimeValue', label: 'Lifetime Value (₹)', type: 'number', span: 1 },
        ]}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this customer?"
        description={`"${customer.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Customer"
      />
    </div>
  )
}
