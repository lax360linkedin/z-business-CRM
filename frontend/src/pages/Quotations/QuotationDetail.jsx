import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useEffect, useRef, useState } from 'react'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Printer, Download, ArrowLeft, CheckCircle2, XCircle, Send, Clock, ClipboardCheck, Target,
  Handshake, Eye, Building2, User, Inbox, Users, FileSignature,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { RecordContractButton } from '../Contracts/RecordContractButton'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { Modal } from '../../components/common/Modal'
import { Logo } from '../../components/common/Logo'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { logAuditEvent } from '../../utils/auditLog'
import { buildQuotationPdf, pdfBytesToBlobUrl } from './quotationPdf'
import { logQuotationActivity } from './quotationActions'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { QuotationAttachmentCard, SendQuotationModal } from './QuotationAttachmentUI'

// Roles with approval authority per the RBAC spec (Sales Manager approves team quotations;
// Admin/Super Admin/MD can approve anything). Kept as a direct role check here rather than
// extending the whole permission matrix schema just for this one workflow.
const APPROVER_ROLES = ['Super Admin', 'Admin', 'MD', 'Sales Manager']

const NEXT_STATUS = {
  Draft: [],
  'Pending Approval': [],
  Sent: ['Viewed', 'Negotiation'],
  Viewed: ['Negotiation', 'Accepted', 'Rejected'],
  Negotiation: ['Accepted', 'Rejected'],
  Accepted: [],
  Rejected: [],
  Expired: [],
}

function RecordChip({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-300">
      <Icon size={13} /> {label}
    </button>
  )
}

export default function QuotationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quotation, setQuotation] = useState(null)
  const [company, setCompany] = useState(null)
  const [contact, setContact] = useState(null)
  const [lead, setLead] = useState(null)
  const [enquiry, setEnquiry] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [template, setTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [activities, setActivities] = useState([])
  const [sendOpen, setSendOpen] = useState(false)
  const { toast } = useToast()
  const { user, hasPermission } = useAuth()
  const canApprove = APPROVER_ROLES.includes(user?.role)
  const iframeRef = useRef(null)

  const load = () => {
    setLoading(true)
    api.get(`/quotations/${id}`).then((res) => setQuotation(res.data)).catch(() => setQuotation(null)).finally(() => setLoading(false))
  }

  const loadActivities = () => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => belongsTo(a, 'Quotation', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  })

  useEffect(() => { load(); loadActivities() }, [id])

  // Related-record lookups — all live (never a frozen static import), so a Company/Contact/
  // Lead/Enquiry/Customer created moments ago in this session always resolves correctly.
  useEffect(() => {
    if (!quotation) return
    Promise.all([
      quotation.companyId ? api.get(`/companies/${quotation.companyId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      quotation.contactId ? api.get(`/contacts/${quotation.contactId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      quotation.leadId ? api.get(`/leads/${quotation.leadId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      quotation.sourceEnquiryId ? api.get(`/enquiries/${quotation.sourceEnquiryId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      quotation.customerId ? api.get(`/customers/${quotation.customerId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
      quotation.templateId ? api.get(`/quotationTemplates/${quotation.templateId}`).then((r) => r.data).catch(() => null) : Promise.resolve(null),
    ]).then(([comp, cont, l, e, cust, tpl]) => {
      setCompany(comp); setContact(cont); setLead(l); setEnquiry(e); setCustomer(cust); setTemplate(tpl)
    })
  }, [quotation])

  const transition = (status, auditAction) => {
    setUpdating(true)
    const previousStatus = quotation.status
    api.put(`/quotations/${id}`, { status }).then((res) => {
      setQuotation(res.data)
      setUpdating(false)
      toast(`Quotation marked as ${status}.`, { type: 'success' })
      logAuditEvent({
        user, action: auditAction || 'Update Quotation Status', module: 'Quotations',
        record: quotation.number, previousValue: previousStatus, newValue: status,
      })
      logQuotationActivity({ type: 'StatusChange', relatedId: quotation.id, relatedName: quotation.number, subject: `Status changed from ${previousStatus} to ${status}`, fromStatus: previousStatus, toStatus: status, by: user.id }).then(loadActivities)
    })
  }

  // Accepted → Sales Order. The order is built and validated server-side from this quotation and its
  // linked records; the user reviews/edits it on the Sales Order form before saving or confirming.
  const convertToSalesOrder = () => navigate(`/sales-orders/new?quotationId=${quotation.id}`)

  const submitForApproval = () => transition('Pending Approval', 'Submit Quotation for Approval')
  const approveQuotation = () => transition('Sent', 'Approve Quotation')
  const rejectQuotation = () => {
    setUpdating(true)
    const previousStatus = quotation.status
    api.put(`/quotations/${id}`, { status: 'Draft' }).then((res) => {
      setQuotation(res.data)
      setUpdating(false)
      toast('Quotation rejected and returned to Draft for revision.', { type: 'warning' })
      logAuditEvent({ user, action: 'Reject Quotation', module: 'Quotations', record: quotation.number, previousValue: previousStatus, newValue: 'Draft' })
    })
  }

  const preparedBy = getUserById(quotation?.assignedTo)

  const generatePdf = () => buildQuotationPdf({ quotation, preparedByName: preparedBy?.name, template })

  const doPreview = () => {
    setGenerating(true)
    generatePdf().then((bytes) => {
      setPreviewUrl(pdfBytesToBlobUrl(bytes))
      setGenerating(false)
    }).catch(() => { toast('Could not generate the PDF preview.', { type: 'error' }); setGenerating(false) })
  }

  const doDownload = () => {
    setGenerating(true)
    generatePdf().then((bytes) => {
      const url = pdfBytesToBlobUrl(bytes)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${quotation.number}.pdf`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setGenerating(false)
      logAuditEvent({ user, action: 'Download Quotation PDF', module: 'Quotations', record: quotation.number })
    }).catch(() => { toast('Could not generate the PDF.', { type: 'error' }); setGenerating(false) })
  }

  const doPrint = () => {
    setGenerating(true)
    generatePdf().then((bytes) => {
      const url = pdfBytesToBlobUrl(bytes)
      const win = window.open(url, '_blank')
      setGenerating(false)
      if (!win) toast('Your browser blocked the print preview — allow pop-ups for this site and try again.', { type: 'warning' })
      else toast('Opened in a new tab — use your browser\'s Print option there.', { type: 'info' })
    }).catch(() => { toast('Could not generate the PDF.', { type: 'error' }); setGenerating(false) })
  }

  const doSend = () => setSendOpen(true)

  if (loading) {
    return (
      <div>
        <CardSkeleton className="h-40" />
      </div>
    )
  }

  if (!quotation) {
    return <EmptyState title="Quotation not found" description="This quotation may have been deleted." action={<Button onClick={() => navigate('/quotations')}>Back to Quotations</Button>} />
  }

  const nextOptions = NEXT_STATUS[quotation.status] || []

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <Breadcrumbs items={[{ label: 'Quotations', href: '/quotations' }, { label: quotation.number }]} />
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{quotation.number}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/quotations')}>Back</Button>
          <Button variant="secondary" icon={Eye} loading={generating} onClick={doPreview}>Preview</Button>
          <Button variant="secondary" icon={Download} loading={generating} onClick={doDownload}>Download PDF</Button>
          <Button variant="secondary" icon={Printer} loading={generating} onClick={doPrint}>Print</Button>
          <Button variant="secondary" icon={Send} onClick={doSend}>Send</Button>
          <RecordContractButton kind="quotation" record={quotation} />
          <LogActivityButton type="Quotation" id={quotation.id} label={`${quotation.number} · ${quotation.customerName}`} onLogged={loadActivities} />
          <RecordTasksButton type="Quotation" id={quotation.id} label={`${quotation.number} · ${quotation.customerName}`} />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500 dark:text-ink-400">Status</span>
          <StatusBadge status={quotation.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {quotation.status === 'Draft' && (
            <Button variant="secondary" size="sm" icon={Send} loading={updating} onClick={submitForApproval}>Submit for Approval</Button>
          )}
          {quotation.status === 'Pending Approval' && canApprove && (
            <>
              <Button variant="primary" size="sm" icon={CheckCircle2} loading={updating} onClick={approveQuotation}>Approve</Button>
              <Button variant="danger" size="sm" icon={XCircle} loading={updating} onClick={rejectQuotation}>Reject</Button>
            </>
          )}
          {quotation.status === 'Pending Approval' && !canApprove && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><Clock size={13} /> Awaiting manager approval</span>
          )}
          {nextOptions.map((status) => (
            <Button key={status} variant={status === 'Rejected' ? 'danger' : status === 'Accepted' ? 'primary' : 'secondary'} size="sm" loading={updating} onClick={() => transition(status)}>
              Mark as {status}
            </Button>
          ))}
          {quotation.status === 'Accepted' && !quotation.salesOrderId && hasPermission('Sales Orders', 'create') && (
            <Button size="sm" icon={ClipboardCheck} onClick={convertToSalesOrder}>Create Sales Order</Button>
          )}
          {quotation.salesOrderId && (
            <Button variant="secondary" size="sm" icon={ClipboardCheck} onClick={() => navigate(`/sales-orders/${quotation.salesOrderId}`)}>View Sales Order</Button>
          )}
          {!nextOptions.length && !['Draft', 'Pending Approval'].includes(quotation.status) && quotation.status !== 'Accepted' && <span className="text-xs text-ink-400">No further transitions available.</span>}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        {enquiry && <RecordChip icon={Inbox} label={`View Enquiry ${enquiry.id}`} onClick={() => navigate(`/enquiries/${enquiry.id}`)} />}
        {lead && <RecordChip icon={Target} label={`View Lead ${lead.id}`} onClick={() => navigate(`/leads/${lead.id}`)} />}
        {quotation.proposalId && <RecordChip icon={FileSignature} label={`View Proposal ${quotation.proposalNumber || ''}${quotation.proposalVersion ? ` (v${quotation.proposalVersion})` : ''}`} onClick={() => navigate(`/proposals/${quotation.proposalId}`)} />}
        {quotation.dealId && <RecordChip icon={Handshake} label={`View Deal ${quotation.dealId}`} onClick={() => navigate(`/deals/${quotation.dealId}`)} />}
        {company && <RecordChip icon={Building2} label="View Company" onClick={() => navigate(`/companies/${company.id}`)} />}
        {contact && <RecordChip icon={User} label="View Contact" onClick={() => navigate(`/contacts/${contact.id}`)} />}
        {customer && <RecordChip icon={Users} label="View Customer" onClick={() => navigate(`/customers/${customer.id}`)} />}
      </div>

      <QuotationAttachmentCard
        quotation={quotation}
        onQuotationChange={setQuotation}
        onActivity={loadActivities}
        onSendClick={() => setSendOpen(true)}
      />

      <div className="rounded-2xl border border-ink-100 bg-white p-8 shadow-card dark:border-ink-800 dark:bg-ink-900 print:border-0 print:shadow-none">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-ink-100 pb-6 dark:border-ink-800">
          <div className="flex items-center gap-3">
            <Logo imgClassName="h-12" />
            <div>
              <h2 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">LAX360 Business CRM</h2>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">Design · Develop · Service</p>
            </div>
          </div>
          <div className="text-right">
            <h3 className="text-lg font-bold uppercase tracking-wide text-ink-900 dark:text-ink-50">Quotation</h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{quotation.number}</p>
            <p className="text-xs text-ink-400">Created {formatDate(quotation.createdDate)}</p>
            <p className="text-xs text-ink-400">Valid until {formatDate(quotation.validUntil)}</p>
            {template && <p className="mt-1 text-xs text-brand-500">Template: {template.name}</p>}
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{quotation.customerName}</p>
            <div className="mt-1 space-y-0.5 text-sm text-ink-500 dark:text-ink-400">
              {quotation.contactName && <p>{quotation.contactName}</p>}
              {quotation.contactEmail && <p>{quotation.contactEmail}</p>}
              {quotation.contactPhone && <p>{quotation.contactPhone}</p>}
              {quotation.gstin && <p>GSTIN: {quotation.gstin}</p>}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Billing Address</p>
            <p className="whitespace-pre-line text-sm text-ink-600 dark:text-ink-300">{quotation.billingAddress || '—'}</p>
            {quotation.shippingAddress && quotation.shippingAddress !== quotation.billingAddress && (
              <>
                <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Shipping Address</p>
                <p className="whitespace-pre-line text-sm text-ink-600 dark:text-ink-300">{quotation.shippingAddress}</p>
              </>
            )}
          </div>
          <div className="sm:text-right">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Quotation Owner</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{preparedBy?.name || '—'}</p>
            <p className="text-sm text-ink-500 dark:text-ink-400">{preparedBy?.email}</p>
            {quotation.dealId && <p className="mt-1 text-xs text-ink-400">Related Deal: {quotation.dealId}</p>}
          </div>
        </div>

        {quotation.requirement && (
          <div className="mb-8">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Requirement / Scope of Work</p>
            <p className="text-sm text-ink-600 dark:text-ink-300">{quotation.requirement}</p>
          </div>
        )}

        <div className="mb-8 overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                <th className="px-4 py-3">Item / Service</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3 text-right">Discount</th>
                <th className="px-4 py-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-400">No line items added yet.</td></tr>
              )}
              {quotation.items.map((item, idx) => {
                const lineTotal = item.qty * item.unitPrice * (1 - item.discount / 100)
                return (
                  <tr key={idx} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="px-4 py-3 font-medium text-ink-800 dark:text-ink-100">{item.name}</td>
                    <td className="px-4 py-3 text-right text-ink-600 dark:text-ink-300">{item.qty}</td>
                    <td className="px-4 py-3 text-right text-ink-600 dark:text-ink-300">{formatCurrency(item.unitPrice)}</td>
                    <td className="px-4 py-3 text-right text-ink-600 dark:text-ink-300">{item.discount}%</td>
                    <td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(lineTotal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mb-8 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Subtotal</span><span>{formatCurrency(quotation.subtotal)}</span></div>
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Tax (18%)</span><span>{formatCurrency(quotation.tax)}</span></div>
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><span>Total Amount</span><span>{formatCurrency(quotation.amount)}</span></div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {quotation.paymentTerms && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Payment Terms</p>
              <p className="text-sm text-ink-600 dark:text-ink-300">{quotation.paymentTerms}</p>
            </div>
          )}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Terms & Conditions</p>
            <p className="text-sm text-ink-600 dark:text-ink-300">{quotation.terms}</p>
          </div>
        </div>
      </div>

      <section id="documents" className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900 print:hidden">
        <h3 className="mb-3 text-sm font-semibold text-ink-800 dark:text-ink-100">Documents</h3>
        <DocumentsPanel relatedType="Quotation" relatedId={quotation.id} defaultCategory="Quotations" />
      </section>

      <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900 print:hidden" data-testid="quotation-activity">
        <h3 className="mb-4 text-sm font-semibold text-ink-800 dark:text-ink-100">Activity Timeline</h3>
        <ActivityTimeline items={activities} />
      </div>

      <SendQuotationModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        quotation={quotation}
        preparedByName={preparedBy?.name}
        onSent={(q) => { setQuotation(q); loadActivities() }}
      />

      <Modal
        open={!!previewUrl}
        onClose={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
        title={`${quotation.number} — PDF Preview`}
        size="xl"
        footer={<Button variant="secondary" icon={Printer} onClick={() => iframeRef.current?.contentWindow?.print()}>Print</Button>}
      >
        {previewUrl && <iframe ref={iframeRef} src={previewUrl} title="Quotation PDF preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      </Modal>
    </div>
  )
}
