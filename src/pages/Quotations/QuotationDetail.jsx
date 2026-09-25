import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Printer, Download, ArrowLeft, CheckCircle2, XCircle, Send, Clock, ClipboardCheck, Target, Handshake } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { Logo } from '../../components/common/Logo'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getCustomerById } from '../../data/customers'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { logAuditEvent } from '../../utils/auditLog'
import { genId } from '../../utils/csv'
import { createNotification } from '../../utils/notify'

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

export default function QuotationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quotation, setQuotation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [converting, setConverting] = useState(false)
  const { toast } = useToast()
  const { user } = useAuth()
  const canApprove = APPROVER_ROLES.includes(user?.role)

  const load = () => {
    setLoading(true)
    api.get(`/quotations/${id}`).then((res) => setQuotation(res.data)).catch(() => setQuotation(null)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

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
    })
  }

  // Accepted → Sales Order — the missing link the spec calls out between Quotation and
  // Invoice. Inherits customer/items/pricing/source straight from the Quotation (never
  // re-entered) and carries the Lead/Deal chain forward so the Sales Order and everything
  // created from it (the Invoice) stay traceable back to the original Lead Source.
  const convertToSalesOrder = () => {
    setConverting(true)
    const soId = genId('SO')
    api.post('/salesOrders', {
      id: soId,
      number: `SO-2026-${soId.split('-').pop()}`,
      quotationId: quotation.id,
      quotationNumber: quotation.number,
      dealId: quotation.dealId,
      leadId: quotation.leadId,
      customerId: quotation.customerId,
      customerName: quotation.customerName,
      source: quotation.source,
      sourceDetail: quotation.sourceDetail,
      items: quotation.items,
      subtotal: quotation.subtotal,
      tax: quotation.tax,
      amount: quotation.amount,
      status: 'Pending',
      salesperson: quotation.assignedTo,
      createdDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      invoiceId: null,
    }).then((soRes) => {
      return api.put(`/quotations/${id}`, { salesOrderId: soRes.data.id }).then((qRes) => {
        setQuotation(qRes.data)
        setConverting(false)
        toast(`Sales Order ${soRes.data.number} created from ${quotation.number}.`, { type: 'success' })
        createNotification({ type: 'Sales Order Created', message: `Sales Order ${soRes.data.number} created for ${quotation.customerName}.`, relatedType: 'Sales Order', relatedId: soRes.data.id })
        logAuditEvent({ user, action: 'Convert Quotation to Sales Order', module: 'Quotations', record: quotation.number, newValue: soRes.data.number })
        navigate(`/sales-orders/${soRes.data.id}`)
      })
    })
  }

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

  const customer = getCustomerById(quotation.customerId)
  const preparedBy = getUserById(quotation.assignedTo)
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
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" icon={Download} onClick={() => toast('PDF export coming soon.', { type: 'info' })}>Download PDF</Button>
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
          {quotation.status === 'Accepted' && !quotation.salesOrderId && (
            <Button size="sm" icon={ClipboardCheck} loading={converting} onClick={convertToSalesOrder}>Convert to Sales Order</Button>
          )}
          {quotation.salesOrderId && (
            <Button variant="secondary" size="sm" icon={ClipboardCheck} onClick={() => navigate(`/sales-orders/${quotation.salesOrderId}`)}>View Sales Order</Button>
          )}
          {!nextOptions.length && !['Draft', 'Pending Approval'].includes(quotation.status) && quotation.status !== 'Accepted' && <span className="text-xs text-ink-400">No further transitions available.</span>}
        </div>
      </div>

      {quotation.source && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-900/20 print:hidden">
          <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-200">
            <Target size={15} /> Original Lead Source: <span className="font-semibold">{quotation.source}</span>{quotation.sourceDetail ? ` — ${quotation.sourceDetail}` : ''}
          </div>
          {quotation.dealId && (
            <Button variant="secondary" size="sm" icon={Handshake} className="ml-auto" onClick={() => navigate(`/deals?open=${quotation.dealId}`)}>View Deal</Button>
          )}
        </div>
      )}

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
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{quotation.customerName}</p>
            {customer && (
              <div className="mt-1 space-y-0.5 text-sm text-ink-500 dark:text-ink-400">
                <p>{customer.contactPerson}</p>
                <p>{customer.email}</p>
                <p>{customer.phone}</p>
                <p>{customer.industry}</p>
              </div>
            )}
          </div>
          <div className="sm:text-right">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Prepared By</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{preparedBy?.name || '—'}</p>
            <p className="text-sm text-ink-500 dark:text-ink-400">{preparedBy?.email}</p>
            {quotation.dealId && <p className="mt-1 text-xs text-ink-400">Related Deal: {quotation.dealId}</p>}
          </div>
        </div>

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

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Terms & Conditions</p>
          <p className="text-sm text-ink-600 dark:text-ink-300">{quotation.terms}</p>
        </div>
      </div>
    </div>
  )
}
