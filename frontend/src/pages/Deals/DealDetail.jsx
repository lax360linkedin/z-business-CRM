import { useOptions, asChoices } from '../../hooks/useOptions'
import { ExpensesPanel } from '../Expenses/ExpensesPanel'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useEffect, useState } from 'react'
import { RecordProjectButton } from '../Projects/RecordProjectButton'
import { RecordContractButton } from '../Contracts/RecordContractButton'
import { productByName } from '../../utils/productRules'
import { useProducts, useServiceCatalog, useAllServiceNames } from '../../hooks/useProducts'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MessageCircle, StickyNote, CalendarClock,
  Building2, IndianRupee, Gauge, Clock, Briefcase, User, MapPin,
  Pencil, UserSquare2, Contact2, Inbox, Radio, Target,
  MoreVertical, Handshake, Video, FileText, Trash2, Scale, Ban, Trophy,
  FileSignature,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { StatCard } from '../../components/common/StatCard'
import { Dropdown, DropdownItem } from '../../components/common/Dropdown'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getUserById, salesUsers } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { PRIORITIES } from '../../data/constants'
import { isDealClosed, isDealLost } from '../../data/dealWorkflow'
import { changeDealStage, markDealLost, createQuotationFromDeal } from './dealActions'
import { ChangeStageModal } from './ChangeStageModal'
import { CallActionModal } from './CallActionModal'
import { EmailActionModal } from './EmailActionModal'
import { WhatsAppActionModal } from './WhatsAppActionModal'
import { MeetingSchedulerModal } from './MeetingSchedulerModal'
import { MeetingOutcomeModal } from '../../components/common/MeetingOutcomeModal'
import { AddNoteModal } from './AddNoteModal'
import { FollowUpModal } from './FollowUpModal'

// One next-action hint per stage, mirroring LeadDetail's NEXT_STAGE banner.
const NEXT_STAGE = {
  'Deal Created': { label: 'Next Stage: Requirement Analysis', hint: 'Capture the customer\'s requirement in detail, then move this deal forward.' },
  'Requirement Analysis': { label: 'Next Stage: Solution Discussion', hint: 'Once the requirement is understood, discuss the proposed solution with the customer.' },
  'Solution Discussion': { label: 'Next Stage: Decision Maker Review', hint: 'Get the proposed solution in front of the actual decision maker.' },
  'Decision Maker Review': { label: 'Next Stage: Proposal / Quotation', hint: 'Once the decision maker is aligned, send a formal proposal or quotation.' },
  'Proposal / Quotation': { label: 'Next Stage: Negotiation', hint: 'Track the proposal/quotation response and move into negotiation once discussions start.' },
  Negotiation: { label: 'Next Stage: Final Decision', hint: 'Work through terms until the customer is ready to make a final decision.' },
  'Final Decision': { label: 'Next Stage: Close the Deal', hint: 'Move this deal to Closed Won or Closed Lost once the customer decides.' },
  'Closed Won': { label: 'Closed Won', hint: 'This deal was won — see the linked Customer below for everything that happens next.' },
  'Closed Lost': { label: 'Closed Lost', hint: 'This deal did not close — see the reason below. It stays in the CRM for reporting.' },
  'Closed Lost – Competition': { label: 'Closed Lost – Competition', hint: 'This deal was lost to a competitor — see the reason below. It stays in the CRM for reporting.' },
}

function InfoRow({ icon: Icon, label, value, href }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-ink-400">{label}</p>
        {href && value ? (
          (href.startsWith('/') ? <Link to={href} className="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{value}</Link> : <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{value}</a>)
        ) : (
          <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</p>
        )}
      </div>
    </div>
  )
}

function RecordRow({ label, value, onClick }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50">
      <span className="font-medium text-ink-700 dark:text-ink-200">{label}</span>
      <span className="text-xs text-ink-400">{value}</span>
    </button>
  )
}

/**
 * Full-page Deal Detail, mirroring LeadDetail.jsx's overall structure and section layout:
 * summary cards, Deal Information / Business Requirement cards, real Quick Actions (Call/Email/
 * WhatsApp/Meeting/Note/Follow-up — same honest tel:/wa.me/mailto: pattern as Lead/Enquiry/
 * Contact, never simulated), Activity Timeline, and a right column surfacing every related CRM
 * record (Source Enquiry/Lead, Contact, Company, Customer, Quotations, Sales Orders, Invoices,
 * Payments) plus Stage History and the Closed Won/Lost outcome panels.
 */
export default function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const { toast } = useToast()
  const canEdit = hasPermission('Deals', 'edit')
  const canDelete = hasPermission('Deals', 'delete')

  const [deal, setDeal] = useState(null)
  const [activities, setActivities] = useState([])
  const [contact, setContact] = useState(null)
  const [company, setCompany] = useState(null)
  const [sourceLead, setSourceLead] = useState(null)
  const [sourceEnquiry, setSourceEnquiry] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [quotations, setQuotations] = useState([])
  const [salesOrders, setSalesOrders] = useState([])
  const [proposals, setProposals] = useState([])
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [outcomeTarget, setOutcomeTarget] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = () => api.get(`/deals/${id}`).then((res) => setDeal(res.data)).catch(() => setDeal(null))
  const loadActivities = () => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => belongsTo(a, 'Deal', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  })

  useEffect(() => {
    setLoading(true)
    Promise.all([load(), loadActivities()]).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Related-record lookups — all live (never the frozen ESM seed arrays), so a Contact/Customer/
  // Quotation created moments ago (e.g. by this very page's own Closed Won / Create Quotation
  // actions) shows up immediately.
  useEffect(() => {
    if (!deal) return
    Promise.all([
      deal.contactId ? api.get(`/contacts/${deal.contactId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      deal.companyId ? api.get(`/companies/${deal.companyId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      deal.leadId ? api.get(`/leads/${deal.leadId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      deal.sourceEnquiryId ? api.get(`/enquiries/${deal.sourceEnquiryId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      deal.customerId ? api.get(`/customers/${deal.customerId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      api.get('/quotations', { params: { all: true } }),
      api.get('/salesOrders', { params: { all: true } }).catch(() => ({ data: [] })),
      api.get('/invoices', { params: { all: true } }),
      api.get('/payments', { params: { all: true } }),
      api.get('/proposals', { params: { all: true } }).catch(() => ({ data: [] })),
    ]).then(([c, comp, l, e, cust, quotesRes, ordersRes, invoicesRes, paymentsRes, proposalsRes]) => {
      setContact(c); setCompany(comp); setSourceLead(l); setSourceEnquiry(e); setCustomer(cust)
      setQuotations(quotesRes.data.filter((q) => q.dealId === deal.id))
      setProposals(proposalsRes.data.filter((p) => p.dealId === deal.id))
      setSalesOrders(ordersRes.data.filter((so) => so.dealId === deal.id))
      setInvoices(invoicesRes.data.filter((inv) => inv.dealId === deal.id))
      setPayments(paymentsRes.data.filter((p) => invoicesRes.data.some((inv) => inv.dealId === deal.id && inv.id === p.invoiceId)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id, deal?.contactId, deal?.companyId, deal?.leadId, deal?.sourceEnquiryId, deal?.customerId])

  const refresh = () => { load(); loadActivities() }

  // hooks must run before the early returns below
  const { products } = useProducts()
  const catalog = useServiceCatalog(deal?.service)
  const timelines = useOptions('qualification_timelines', deal?.expectedPurchaseTimeline)
  const serviceNames = catalog.names

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!deal) return <EmptyState title="Deal not found" description="This deal may have been deleted." action={<Button onClick={() => navigate('/deals')}>Back to Deals</Button>} />

  const owner = getUserById(deal.salesperson)
  const isClosed = isDealClosed(deal.stage)
  const meetings = activities.filter((a) => a.type === 'Meeting' && a.meetingStatus)
  const lastActivity = activities[0]
  const nextStage = NEXT_STAGE[deal.stage]
  const weightedValue = (deal.value * deal.probability) / 100
  const daysOpen = Math.max(0, Math.round((new Date(deal.closedAt || Date.now()) - new Date(deal.createdDate)) / 86400000))
  const stageHistory = [
    { id: 'created', label: 'Deal Created', date: deal.createdDate, detail: deal.leadId ? `Converted from Lead ${deal.leadId}` : 'Deal created' },
    ...(deal.stageHistory || []).slice(1).map((h, i) => ({ id: `${h.stage}-${i}`, label: `Stage changed to ${h.stage}`, date: h.changedAt, detail: h.note, by: h.changedBy })),
  ]

  const updateDeal = (dealId, patch) => api.put(`/deals/${dealId}`, patch).then((r) => r.data)

  const doStageChange = ({ newStage, reason, notes }) => {
    setSaving(true)
    const action = reason
      ? markDealLost(deal, { stage: newStage, reason, notes, by: user.id, update: updateDeal })
      : changeDealStage(deal, newStage, { by: user.id, update: updateDeal })
    action.then(() => {
      setSaving(false); setStageOpen(false)
      toast(`Deal moved to ${newStage}.`, { type: 'success' })
      refresh()
    }).catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doCreateQuotation = () => {
    setSaving(true)
    createQuotationFromDeal(deal).then((quotation) => {
      setSaving(false)
      toast(`Quotation ${quotation.number} created.`, { type: 'success' })
      navigate(`/quotations/${quotation.id}`)
    }).catch((err) => { setSaving(false); toast(err.message || 'Could not create the quotation.', { type: 'error' }) })
  }

  const saveEdit = (data) => {
    setSaving(true)
    api.put(`/deals/${deal.id}`, { ...data, productId: productByName(products, data.service)?.id || null, value: Number(data.value) || 0, budget: Number(data.budget) || 0 }).then(() => {
      setSaving(false); setEditOpen(false); toast('Deal updated.', { type: 'success' }); refresh()
    })
  }

  const confirmDelete = () => {
    api.delete(`/deals/${deal.id}`).then(() => { toast(`"${deal.name}" deleted.`, { type: 'success' }); navigate('/deals') })
  }

  const reps = salesUsers()

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Breadcrumbs items={[{ label: 'Deals', href: '/deals' }, { label: deal.id }]} />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{deal.name}</h1>
            <StatusBadge status={deal.stage} />
            <PriorityBadge priority={deal.priority} />
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{deal.id} · {deal.companyName} · {deal.contactName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/deals')}>Back</Button>
          <RecordProjectButton kind="deal" record={deal} />
          <RecordContractButton kind="deal" record={deal} />
          {canEdit && !isClosed && <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit Deal</Button>}
          {canEdit && !isClosed && <Button variant="secondary" icon={Gauge} onClick={() => setStageOpen(true)}>Change Stage</Button>}
          {hasPermission('Proposals', 'create') && !isClosed && <Button variant="secondary" icon={FileSignature} onClick={() => navigate(`/proposals/new?dealId=${deal.id}`)}>Create Proposal</Button>}
          {canEdit && <Button variant="secondary" icon={FileText} onClick={doCreateQuotation} loading={saving}>Create Quotation</Button>}
          {canEdit && <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Add Follow-up</Button>}
          {canEdit && <LogActivityButton type="Deal" id={deal.id} label={deal.name} onLogged={loadActivities} />}
          <RecordTasksButton type="Deal" id={deal.id} label={deal.name} />
          {canEdit && <Button variant="secondary" icon={StickyNote} onClick={() => setNoteOpen(true)}>Add Note</Button>}
          <Dropdown align="right" trigger={<Button variant="secondary" icon={MoreVertical}>More Actions</Button>}>
            {canDelete && <DropdownItem icon={Trash2} danger onClick={() => setDeleteOpen(true)}>Delete Deal</DropdownItem>}
          </Dropdown>
        </div>
      </div>

      {nextStage && (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-900/20">
          <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">{nextStage.label}</p>
          <p className="mt-0.5 text-xs text-brand-700 dark:text-brand-300">{nextStage.hint}</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Deal Value" value={formatCurrency(deal.value, { compact: true })} icon={IndianRupee} tone="brand" />
        <StatCard label="Probability" value={`${deal.probability}%`} icon={Gauge} tone="sky" />
        <StatCard label="Weighted Value" value={formatCurrency(weightedValue, { compact: true })} icon={Scale} tone="violet" />
        <StatCard label="Current Stage" value={deal.stage} icon={Target} tone="amber" />
        <StatCard label="Expected Close" value={formatDate(deal.expectedClosingDate)} icon={CalendarClock} tone="ink" />
        <StatCard label="Days Open" value={daysOpen} icon={Clock} tone="ink" />
        <StatCard label="Last Activity" value={lastActivity ? formatDate(lastActivity.date) : 'None yet'} icon={Clock} tone="ink" />
        <StatCard label="Next Follow-up" value={deal.nextFollowUp ? formatDate(deal.nextFollowUp) : '—'} icon={CalendarClock} tone="ink" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Deal Information</p>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Handshake} label="Deal ID" value={deal.id} />
              <InfoRow icon={IndianRupee} label="Deal Value" value={`${formatCurrency(deal.value)} (${deal.currency || 'INR'})`} />
              <InfoRow icon={Gauge} label="Probability" value={`${deal.probability}%`} />
              <InfoRow icon={Target} label="Priority" value={deal.priority} />
              <InfoRow icon={CalendarClock} label="Expected Close Date" value={formatDate(deal.expectedClosingDate)} />
              <InfoRow icon={Clock} label="Created Date" value={formatDate(deal.createdDate)} />
              <InfoRow icon={User} label="Assigned Owner" value={owner?.name} />
              <InfoRow icon={Briefcase} label="Service" value={deal.service} href={deal.productId ? `/products/${deal.productId}` : null} />
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Business Requirement</p>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Briefcase} label="Product / Service" value={deal.service} href={deal.productId ? `/products/${deal.productId}` : null} />
              <InfoRow icon={IndianRupee} label="Budget" value={deal.budget ? formatCurrency(deal.budget) : null} />
              <InfoRow icon={Clock} label="Expected Purchase Timeline" value={deal.expectedPurchaseTimeline} />
              <InfoRow icon={Target} label="Competitor" value={deal.competitor} />
              <InfoRow icon={User} label="Decision Maker" value={deal.decisionMaker} />
            </div>
            {(deal.requirement || deal.customerNeed) && (
              <div className="mt-4 space-y-3">
                {deal.requirement && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Requirement</p>
                    <p className="text-sm text-ink-600 dark:text-ink-300">{deal.requirement}</p>
                  </div>
                )}
                {deal.customerNeed && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Customer Need</p>
                    <p className="text-sm text-ink-600 dark:text-ink-300">{deal.customerNeed}</p>
                  </div>
                )}
              </div>
            )}
            {deal.notes && (
              <>
                <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">Notes</p>
                <p className="text-sm text-ink-600 dark:text-ink-300">{deal.notes}</p>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Quick Actions</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Phone} onClick={() => setCallOpen(true)} disabled={!contact?.phone}>Call</Button>
              <Button variant="secondary" icon={Mail} onClick={() => setEmailOpen(true)} disabled={!contact?.email}>Email</Button>
              <Button variant="secondary" icon={MessageCircle} onClick={() => setWaOpen(true)} disabled={!(contact?.whatsapp || contact?.phone)}>WhatsApp</Button>
              <Button variant="secondary" icon={Video} onClick={() => setMeetingOpen(true)}>Meeting</Button>
              <Button variant="secondary" icon={StickyNote} onClick={() => setNoteOpen(true)}>Add Note</Button>
              <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Follow-up</Button>
            </div>
            {!contact && <p className="mt-2 text-xs text-ink-400">No linked contact yet — Call/Email/WhatsApp need a Contact record.</p>}
          </div>

          {meetings.length > 0 && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Meetings</p>
              <div className="space-y-2.5">
                {meetings.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                    <div>
                      <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{m.title}</p>
                      <p className="text-xs text-ink-400">{formatDate(m.meetingDate)} · {m.meetingStartTime} · {m.meetingType}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={m.meetingStatus} />
                      {m.meetingLink && <Button variant="ghost" size="sm" onClick={() => navigate(m.meetingLink)}>Open</Button>}
                      {m.meetingStatus === 'Scheduled' && <Button variant="secondary" size="sm" onClick={() => setOutcomeTarget(m)}>Update</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Activity Timeline</p>
            <ActivityTimeline items={activities} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Radio size={12} /> Source Information</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-ink-400">Source</span><p className="font-medium text-ink-700 dark:text-ink-200">{deal.leadSourceId ? <Link to={`/lead-sources/${deal.leadSourceId}`} className="text-brand-700 hover:underline dark:text-brand-300">{deal.source}</Link> : (deal.source || '—')}</p></div>
              <div><span className="text-ink-400">Campaign</span><p className="font-medium text-ink-700 dark:text-ink-200">{deal.campaignId ? <Link to={`/campaigns/${deal.campaignId}`} className="text-brand-700 hover:underline dark:text-brand-300">{deal.campaign}</Link> : (deal.campaign || '—')}</p></div>
            </div>
            <div className="mt-3 space-y-2">
              {sourceEnquiry && (
                <Button variant="secondary" size="sm" icon={Inbox} className="w-full" onClick={() => navigate(`/enquiries/${sourceEnquiry.id}`)}>View Source Enquiry {sourceEnquiry.id}</Button>
              )}
              {sourceLead && (
                <Button variant="secondary" size="sm" icon={Handshake} className="w-full" onClick={() => navigate(`/leads/${sourceLead.id}`)}>View Source Lead {sourceLead.id}</Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Contact2 size={12} /> Contact</p>
            {contact ? (
              <>
                <div className="flex items-center gap-3 border-b border-ink-100 pb-3 dark:border-ink-800">
                  <Avatar name={contact.name} size="md" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{contact.name}</p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{contact.designation}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs text-ink-500 dark:text-ink-400">
                  <p className="flex items-center gap-1.5"><Phone size={12} /> {contact.phone || '—'}</p>
                  <p className="flex items-center gap-1.5"><MessageCircle size={12} /> {contact.whatsapp || '—'}</p>
                  <p className="flex items-center gap-1.5"><Mail size={12} /> {contact.email || '—'}</p>
                </div>
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate(`/contacts/${contact.id}`)}>View Contact</Button>
              </>
            ) : <p className="text-sm text-ink-400">{deal.contactName || 'No linked contact yet.'}</p>}
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Building2 size={12} /> Company</p>
            {company ? (
              <>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{company.name}</p>
                <div className="mt-2 space-y-1.5 text-xs text-ink-500 dark:text-ink-400">
                  <p>{company.industry}</p>
                  {company.website && <p className="flex items-center gap-1.5"><MapPin size={12} /> {company.website}</p>}
                  <p className="flex items-center gap-1.5"><Phone size={12} /> {company.phone}</p>
                  <p className="flex items-center gap-1.5"><Mail size={12} /> {company.email}</p>
                  <p>{company.address}</p>
                </div>
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate(`/companies/${company.id}`)}>View Company</Button>
              </>
            ) : <p className="text-sm text-ink-400">{deal.companyName}</p>}
          </div>

          {customer && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/50 dark:bg-emerald-900/20">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><UserSquare2 size={12} /> Customer</p>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{customer.name}</p>
              <Button variant="secondary" size="sm" icon={UserSquare2} className="mt-2 w-full" onClick={() => navigate(`/customers/${customer.id}`)}>View Customer</Button>
            </div>
          )}

          {(proposals.length > 0 || quotations.length > 0 || salesOrders.length > 0 || invoices.length > 0 || payments.length > 0) && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Related Records</p>
              <div className="space-y-2">
                {proposals.map((p) => (
                  <RecordRow key={p.id} label={`Proposal ${p.number} – v${p.version}`} value={`${p.status} · ${formatCurrency(p.value, { compact: true })}`} onClick={() => navigate(`/proposals/${p.id}`)} />
                ))}
                {quotations.map((q) => (
                  <RecordRow key={q.id} label={`Quotation ${q.number}`} value={`${q.status} · ${formatCurrency(q.amount, { compact: true })}`} onClick={() => navigate(`/quotations/${q.id}`)} />
                ))}
                {salesOrders.map((so) => (
                  <RecordRow key={so.id} label={`Sales Order ${so.number}`} value={so.status} onClick={() => navigate(`/sales-orders/${so.id}`)} />
                ))}
                {invoices.map((inv) => (
                  <RecordRow key={inv.id} label={`Invoice ${inv.number}`} value={`${inv.status} · ${formatCurrency(inv.amount, { compact: true })}`} onClick={() => navigate(`/invoices/${inv.id}`)} />
                ))}
                {payments.map((p) => (
                  <RecordRow key={p.id} label={`Payment ${p.reference}`} value={formatCurrency(p.amount, { compact: true })} onClick={() => navigate('/payments')} />
                ))}
              </div>
            </div>
          )}

          {isDealLost(deal.stage) && deal.lostReason && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-800/50 dark:bg-rose-900/20">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300"><Ban size={12} /> {deal.stage} Reason</p>
              <p className="mt-1 text-sm font-semibold text-rose-800 dark:text-rose-200">{deal.lostReason}</p>
              {deal.lostNotes && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{deal.lostNotes}</p>}
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{formatDateTime(deal.lostDate)}{deal.lostBy ? ` · ${getUserById(deal.lostBy)?.name || ''}` : ''}</p>
            </div>
          )}

          {deal.stage === 'Closed Won' && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/50 dark:bg-emerald-900/20">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><Trophy size={12} /> Closed Won</p>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                {customer ? `Customer ${customer.name} created/linked.` : 'Finalizing customer link…'}
              </p>
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{formatDateTime(deal.closedAt)}{deal.closedBy ? ` · ${getUserById(deal.closedBy)?.name || ''}` : ''}</p>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Stage History</p>
            <ol className="space-y-3">
              {stageHistory.map((h, idx) => (
                <li key={h.id} className="relative pl-4">
                  <span className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${idx === stageHistory.length - 1 ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-600'}`} />
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{h.label}</p>
                  <p className="text-xs text-ink-400">{formatDateTime(h.date)}{h.by ? ` · ${getUserById(h.by)?.name || ''}` : ''}</p>
                  {h.detail && <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{h.detail}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <section id="expenses" className="mt-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Deal costs (expenses)</h2>
        <p className="mb-3 text-xs text-ink-400">Costs linked to this deal are tracked separately as business cost — they never change the deal value ({formatCurrency(deal.value)}).</p>
        <ExpensesPanel relatedType="Deal" relatedId={deal.id} revenue={{ label: 'Deal value', value: deal.value }} />
      </section>

      <section id="documents" className="mt-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Documents</h2>
        <DocumentsPanel relatedType="Deal" relatedId={deal.id} defaultCategory="Proposals" />
      </section>
      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Deal"
        description={`Update details for ${deal.name}.`}
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        defaultValues={deal}
        fields={[
          { name: 'name', label: 'Deal name', required: true, span: 2 },
          { name: 'service', label: 'Product / Service', type: 'select', options: serviceNames.map((s) => ({ value: s, label: s })), required: true, blank: catalog.placeholder, span: 1 },
          { name: 'value', label: 'Deal value (₹)', type: 'number', required: true, span: 1 },
          { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), required: true, span: 1 },
          { name: 'expectedClosingDate', label: 'Expected closing date', type: 'date', required: true, span: 1 },
          { name: 'salesperson', label: 'Assigned Owner', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 1 },
          { name: 'expectedPurchaseTimeline', label: 'Expected Purchase Timeline', type: 'select', options: asChoices(timelines.values), blank: timelines.placeholder, span: 1 },
          { name: 'budget', label: 'Budget (₹)', type: 'number', span: 1 },
          { name: 'decisionMaker', label: 'Decision Maker', span: 1 },
          { name: 'competitor', label: 'Competitor', span: 1 },
          { name: 'requirement', label: 'Requirement', type: 'textarea', span: 2 },
          { name: 'customerNeed', label: 'Customer Need', type: 'textarea', span: 2 },
          { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ]}
      />

      <ChangeStageModal open={stageOpen} onClose={() => setStageOpen(false)} deal={deal} saving={saving} onSave={doStageChange} />
      <CallActionModal open={callOpen} onClose={() => setCallOpen(false)} deal={deal} contact={contact} onLogged={refresh} />
      <EmailActionModal open={emailOpen} onClose={() => setEmailOpen(false)} deal={deal} contact={contact} onLogged={refresh} />
      <WhatsAppActionModal open={waOpen} onClose={() => setWaOpen(false)} deal={deal} contact={contact} onLogged={refresh} />
      <MeetingSchedulerModal open={meetingOpen} onClose={() => setMeetingOpen(false)} deal={deal} contact={contact} onLogged={refresh} />
      <MeetingOutcomeModal open={!!outcomeTarget} onClose={() => setOutcomeTarget(null)} meeting={outcomeTarget} relatedType="Deal" relatedId={deal.id} onUpdated={refresh} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} deal={deal} onLogged={refresh} />
      <FollowUpModal open={followUpOpen} onClose={() => setFollowUpOpen(false)} deal={deal} onLogged={refresh} />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this deal?"
        description={`"${deal.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Deal"
      />
    </div>
  )
}
