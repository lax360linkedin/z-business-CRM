import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Pencil, ArrowRightLeft, Receipt, StickyNote, CalendarClock, Paperclip, Download, Printer, FileText, Handshake, Users, Building2, User,
  Truck, CheckCircle2, AlertTriangle, Trash2, IndianRupee, Wallet, CreditCard, History, ArrowLeft, Package, Clock, FileSignature,
} from 'lucide-react'
import clsx from 'clsx'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button, IconButton } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { StatCard } from '../../components/common/StatCard'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { formatBytes, dataUrlToBytes } from '../../utils/quotationAttachmentRules'
import { computeOrder, fulfilmentPercent, paymentStatusOf, PAYMENT_STATUS_TONES, SO_TRANSITIONS } from '../../utils/salesOrderCalc'
import { pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { buildSalesOrderPdf } from './salesOrderPdf'
import { loadOrderLinks, deleteSalesOrder, removeSalesOrderDocument, soError } from './salesOrderClient'
import { StatusDialog, FulfilmentDialog, NoteDialog, FollowUpDialog, DocumentDialog, InvoiceDialog, RecordPaymentModal } from './SalesOrderDialogs'

const STEPS = ['Draft', 'Confirmed', 'Processing', 'Fulfilled']
const stepIndex = (status) => (status === 'Partially Fulfilled' ? 2 : STEPS.indexOf(status))

function Info({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink-800 dark:text-ink-100">{children || '—'}</dd>
    </div>
  )
}

function Card({ title, icon: Icon, action, children, className }) {
  return (
    <section className={clsx('rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900', className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{Icon && <Icon size={15} className="text-brand-500" />} {title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function RelatedRow({ icon: Icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-ink-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-ink-800/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><Icon size={14} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] uppercase tracking-wide text-ink-400">{label}</span><span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span></span>
    </button>
  )
}

function StatusStepper({ status }) {
  if (status === 'Cancelled') {
    return <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"><AlertTriangle size={15} /> This order was cancelled.</div>
  }
  const current = stepIndex(status)
  return (
    <ol className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i < current || status === 'Fulfilled'
        const active = i === current && status !== 'Fulfilled'
        return (
          <li key={s} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span className={clsx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-emerald-500 text-white' : active ? 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900/40' : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>
                {done ? <CheckCircle2 size={15} /> : i + 1}
              </span>
              <span className={clsx('text-[11px] font-medium', active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400')}>{active && status === 'Partially Fulfilled' ? 'Partly Fulfilled' : s}</span>
            </div>
            {i < STEPS.length - 1 && <span className={clsx('mx-2 mb-4 h-0.5 flex-1 rounded-full', i < current || status === 'Fulfilled' ? 'bg-emerald-400' : 'bg-ink-100 dark:bg-ink-800')} />}
          </li>
        )
      })}
    </ol>
  )
}

function Line({ label, value, strong }) {
  return (
    <div className={clsx('flex justify-between', strong ? 'font-semibold text-ink-800 dark:text-ink-100' : 'text-ink-600 dark:text-ink-300')}>
      <dt>{label}</dt><dd>{value < 0 ? `− ${formatCurrency(-value)}` : formatCurrency(value)}</dd>
    </div>
  )
}

export default function SalesOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('Sales Orders', 'edit')
  const canDelete = hasPermission('Sales Orders', 'delete')
  const canInvoice = hasPermission('Invoices', 'create')
  const canPay = hasPermission('Payments', 'create')

  const [order, setOrder] = useState(null)
  const [links, setLinks] = useState({})
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState(null) // status | fulfil | note | followup | doc | invoice | payment | delete
  const [busy, setBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const loadActivities = useCallback(() => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => belongsTo(a, 'Sales Order', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  }), [id])

  const load = useCallback(() => api.get(`/salesOrders/${id}`).then(async (res) => {
    setOrder(res.data)
    setLinks(await loadOrderLinks(res.data))
  }).catch(() => setOrder(null)), [id])

  const refresh = useCallback(() => Promise.all([load(), loadActivities()]), [load, loadActivities])
  useEffect(() => { setLoading(true); refresh().finally(() => setLoading(false)) }, [refresh])

  const { customer, company, contact, deal, quotation, invoice, payments = [] } = links
  const liveInvoice = invoice && invoice.status !== 'Cancelled' ? invoice : null
  const owner = getUserById(order?.salesperson)
  const calc = useMemo(() => (order ? computeOrder(order.items, order.taxType) : null), [order])

  if (loading) return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-64" /></div>
  if (!order) return <EmptyState title="Sales order not found" description="This sales order may have been removed." action={<Button onClick={() => navigate('/sales-orders')}>Back to Sales Orders</Button>} />

  const nextStatuses = SO_TRANSITIONS[order.status] || []
  const payStatus = paymentStatusOf(order, invoice)
  const paidTotal = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const balance = liveInvoice ? Math.max(0, (liveInvoice.amount || 0) - (liveInvoice.paidAmount || 0)) : 0
  const pct = fulfilmentPercent(order.items)
  const canInvoiceNow = canInvoice && ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled'].includes(order.status) && !liveInvoice
  const quotationChanged = quotation && order.quotationSnapshot && (Math.abs((quotation.amount || 0) - order.quotationSnapshot.amount) > 0.5 || (quotation.items || []).length !== order.quotationSnapshot.itemCount)
  const canRevise = canEdit && ['Confirmed', 'Processing', 'Partially Fulfilled'].includes(order.status) && !liveInvoice && !order.items.some((i) => i.fulfilledQty > 0)

  const pdf = async (mode) => {
    setPdfBusy(true)
    try {
      const bytes = await buildSalesOrderPdf({ order, ownerName: owner?.name, invoice: liveInvoice })
      const url = pdfBytesToBlobUrl(bytes)
      if (mode === 'print') {
        if (!window.open(url, '_blank')) toast('Allow pop-ups to open the print view.', { type: 'warning' })
      } else {
        const a = document.createElement('a'); a.href = url; a.download = `${order.number}.pdf`; document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch { toast('Could not generate the PDF.', { type: 'error' }) } finally { setPdfBusy(false) }
  }

  const downloadDoc = (d) => {
    const url = URL.createObjectURL(new Blob([dataUrlToBytes(d.dataUrl)], { type: d.mimeType || 'application/octet-stream' }))
    const a = document.createElement('a'); a.href = url; a.download = d.fileName; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  const removeDoc = (d) => removeSalesOrderDocument(order.id, d.id).then(() => { toast('Document removed.', { type: 'success' }); refresh() }).catch((e) => toast(soError(e), { type: 'error' }))
  const confirmDelete = () => {
    setBusy(true)
    deleteSalesOrder(order.id).then(() => { toast(`${order.number} deleted.`, { type: 'success' }); navigate('/sales-orders') }).catch((e) => { toast(soError(e), { type: 'error' }); setBusy(false); setDialog(null) })
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Sales Orders', href: '/sales-orders' }, { label: order.number }]} />

      <div className="mb-5 mt-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{order.number}</h1>
            <StatusBadge status={order.status} />
            {order.revision > 1 && <Badge tone="info">Revision {order.revision}</Badge>}
            <Badge tone={PAYMENT_STATUS_TONES[payStatus] || 'neutral'}>{payStatus}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{order.customerName} · {formatCurrency(order.amount)} · ordered {formatDate(order.orderDate)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/sales-orders')}>Back</Button>
          {canEdit && order.status !== 'Cancelled' && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/sales-orders/${order.id}/edit`)}>{canRevise ? 'Edit / Revise' : 'Edit'}</Button>}
          {canEdit && nextStatuses.length > 0 && <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setDialog('status')}>Change Status</Button>}
          {canEdit && ['Processing', 'Partially Fulfilled'].includes(order.status) && <Button variant="secondary" icon={Truck} onClick={() => setDialog('fulfil')}>Record Fulfilment</Button>}
          {canInvoiceNow && <Button icon={Receipt} onClick={() => setDialog('invoice')}>Create Invoice</Button>}
          {liveInvoice && <Button variant="secondary" icon={FileText} onClick={() => navigate(`/invoices/${liveInvoice.id}`)}>View Invoice</Button>}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {canEdit && <Button size="sm" variant="ghost" icon={StickyNote} onClick={() => setDialog('note')}>Add Note</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={CalendarClock} onClick={() => setDialog('followup')}>Add Follow-up</Button>}
        {canEdit && <LogActivityButton size="sm" variant="ghost" type="Sales Order" id={order.id} label={`${order.number} · ${order.customerName}`} onLogged={loadActivities} />}
          <RecordTasksButton size="sm" variant="ghost" type="Sales Order" id={order.id} label={`${order.number} · ${order.customerName}`} />
        {canEdit && order.status !== 'Cancelled' && <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => setDialog('doc')}>Attach Document</Button>}
        <Button size="sm" variant="ghost" icon={Download} loading={pdfBusy} onClick={() => pdf('download')}>Download PDF</Button>
        <Button size="sm" variant="ghost" icon={Printer} onClick={() => pdf('print')}>Print</Button>
        {canDelete && order.status === 'Draft' && <Button size="sm" variant="ghost" icon={Trash2} className="text-rose-600" onClick={() => setDialog('delete')}>Delete draft</Button>}
      </div>

      {quotationChanged && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="flex items-center gap-2"><AlertTriangle size={15} /> Quotation {order.quotationNumber} has changed since this order was created ({formatCurrency(order.quotationSnapshot.amount)} → {formatCurrency(quotation.amount)}). This order is untouched; revise it if it should follow.</span>
          {canRevise && <Button size="sm" variant="secondary" onClick={() => navigate(`/sales-orders/${order.id}/edit`)}>Review &amp; revise</Button>}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Order total" value={formatCurrency(order.amount)} icon={IndianRupee} tone="brand" />
        <StatCard label="Fulfilment" value={`${pct}%`} icon={Package} tone={pct === 100 ? 'emerald' : 'amber'} />
        <StatCard label="Invoiced" value={liveInvoice ? formatCurrency(liveInvoice.amount) : 'Not invoiced'} icon={Receipt} tone="sky" />
        <StatCard label={liveInvoice ? 'Balance due' : 'Paid'} value={liveInvoice ? formatCurrency(balance) : formatCurrency(0)} icon={Wallet} tone={liveInvoice && balance === 0 ? 'emerald' : 'rose'} />
      </div>

      <div className="mb-5 rounded-2xl border border-ink-100 bg-white px-6 py-5 dark:border-ink-800 dark:bg-ink-900"><StatusStepper status={order.status} /></div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Order information" icon={FileText}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              <Info label="Sales order #">{order.number}</Info>
              <Info label="Order date">{formatDate(order.orderDate)}</Info>
              <Info label="Expected delivery">{formatDate(order.expectedDeliveryDate)}</Info>
              <Info label="Salesperson">{owner?.name}</Info>
              <Info label="Linked quotation">{order.quotationNumber}</Info>
              <Info label="Linked deal">{deal?.name || order.dealId}</Info>
              <Info label="Payment terms">{order.paymentTerms}</Info>
              <Info label="GSTIN">{order.gstin}</Info>
              <div className="col-span-2"><Info label="Billing address"><span className="whitespace-pre-line">{order.billingAddress}</span></Info></div>
              <div className="col-span-2"><Info label="Shipping / service address"><span className="whitespace-pre-line">{order.shippingAddress}</span></Info></div>
              <div className="col-span-2 lg:col-span-4"><Info label="Delivery terms">{order.deliveryTerms}</Info></div>
              {order.source && <Info label="Original lead source">{order.source}{order.sourceDetail ? ` — ${order.sourceDetail}` : ''}</Info>}
              {order.cancelReason && <div className="col-span-2 lg:col-span-4"><Info label="Cancellation reason">{order.cancelReason}</Info></div>}
            </dl>
          </Card>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Card title="Customer" icon={Users}>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{customer?.name || order.customerName}</p>
              <p className="mt-1 text-xs text-ink-500">{customer?.industry}{customer?.tier ? ` · ${customer.tier}` : ''}</p>
              {customer && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate(`/customers/${customer.id}`)}>View customer</Button>}
            </Card>
            <Card title="Contact" icon={User}>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{contact?.name || order.contactName || '—'}</p>
              <div className="mt-1 space-y-0.5 text-xs text-ink-500"><p>{contact?.email || order.contactEmail}</p><p>{contact?.phone || order.contactPhone}</p></div>
              {contact && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate(`/contacts/${contact.id}`)}>View contact</Button>}
            </Card>
            <Card title="Company" icon={Building2}>
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{company?.name || order.companyName}</p>
              <div className="mt-1 space-y-0.5 text-xs text-ink-500"><p>{company?.industry}</p><p>{company?.city || company?.address}</p></div>
              {company && <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigate(`/companies/${company.id}`)}>View company</Button>}
            </Card>
          </div>

          <Card title="Products / services" icon={Package}>
            <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-4 py-3">Item / service</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Unit price</th><th className="px-3 py-3 text-right">Disc</th><th className="px-3 py-3 text-right">Tax</th><th className="px-3 py-3 text-right">Delivered</th><th className="px-4 py-3 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it, i) => (
                    <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-3"><p className="font-medium text-ink-800 dark:text-ink-100">{it.name}{it.productCode && <span className="ml-2 font-mono text-[11px] font-normal text-ink-400">{it.productCode}</span>}</p>{it.description && <p className="text-xs text-ink-400">{it.description}</p>}</td>
                      <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.qty}</td>
                      <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{formatCurrency(it.unitPrice)}</td>
                      <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.discount}%</td>
                      <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.taxRate}%</td>
                      <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.fulfilledQty || 0}/{it.qty}</td>
                      <td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(calc.lines[i]?.total || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <dl className="w-full max-w-xs space-y-1.5 text-sm">
                <Line label="Subtotal" value={order.subtotal} />
                {order.discountAmount > 0 && <Line label="Discount" value={-order.discountAmount} />}
                <Line label="Taxable amount" value={order.taxableAmount} strong />
                {order.taxType === 'inter' ? <Line label="IGST" value={order.igst} /> : (<><Line label="CGST" value={order.cgst} /><Line label="SGST" value={order.sgst} /></>)}
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><dt>Grand total</dt><dd>{formatCurrency(order.amount)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card title="Invoice & payment" icon={CreditCard} action={liveInvoice && canPay && liveInvoice.status !== 'Paid' ? <Button size="sm" onClick={() => setDialog('payment')}>Record payment</Button> : null}>
            {!invoice ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">No invoice yet. {canInvoiceNow ? 'Create one from this order when you are ready to bill.' : order.status === 'Draft' ? 'Confirm the order first.' : ''}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => navigate(`/invoices/${invoice.id}`)} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{invoice.number}</button>
                  <div className="flex items-center gap-2"><StatusBadge status={invoice.status} /><Badge tone={PAYMENT_STATUS_TONES[payStatus] || 'neutral'}>{payStatus}</Badge></div>
                </div>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Info label="Invoice amount">{formatCurrency(invoice.amount)}</Info>
                  <Info label="Paid">{formatCurrency(invoice.paidAmount)}</Info>
                  <Info label="Balance">{formatCurrency(Math.max(0, invoice.amount - invoice.paidAmount))}</Info>
                  <Info label="Due date">{formatDate(invoice.dueDate)}</Info>
                </dl>
                {payments.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                      <tbody>{payments.map((p) => (
                        <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-3 py-2 font-medium text-ink-700 dark:text-ink-200">{p.reference}</td><td className="px-3 py-2 text-ink-500">{p.method}</td><td className="px-3 py-2 text-ink-500">{formatDate(p.date)}</td><td className="px-3 py-2 text-right font-medium text-emerald-600">{formatCurrency(p.amount)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-ink-400">No payments recorded yet. The order is never treated as paid until a payment is recorded against the invoice.</p>}
                {payments.length > 0 && <p className="text-xs text-ink-400">Total received: <b className="text-ink-600 dark:text-ink-300">{formatCurrency(paidTotal)}</b></p>}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Card title="Notes"><p className="whitespace-pre-line text-sm text-ink-700 dark:text-ink-200">{order.notes || <span className="text-ink-400">No notes.</span>}</p></Card>
            <Card title="Internal remarks"><p className="whitespace-pre-line text-sm text-ink-700 dark:text-ink-200">{order.internalRemarks || <span className="text-ink-400">No internal remarks.</span>}</p></Card>
          </div>

          <Card title="Documents / attachments" icon={Paperclip} action={canEdit && order.status !== 'Cancelled' ? <Button size="sm" variant="secondary" icon={Paperclip} onClick={() => setDialog('doc')}>Attach</Button> : null}>
            {!(order.documents || []).length ? <p className="text-sm text-ink-400">No documents attached.</p> : (
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
                {order.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{d.fileName}</p><p className="text-xs text-ink-400">{d.category} · {formatBytes(d.size)} · {d.uploadedByName} · {formatDateTime(d.uploadedAt)}</p></div>
                    <div className="flex items-center gap-1"><IconButton icon={Download} size="sm" aria-label="Download" onClick={() => downloadDoc(d)} />{canEdit && <IconButton icon={Trash2} size="sm" aria-label="Remove" className="hover:text-rose-600" onClick={() => removeDoc(d)} />}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(order.revisions || []).length > 0 && (
            <Card title="Revision history" icon={History}>
              <ul className="space-y-3">
                {order.revisions.map((r) => (
                  <li key={r.revision} className="rounded-xl border border-ink-100 px-4 py-3 text-sm dark:border-ink-800">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink-800 dark:text-ink-100">Revision {r.revision} <span className="font-normal text-ink-400">(superseded)</span></span><span className="text-xs text-ink-400">{formatDateTime(r.at)} · {r.byName}</span></div>
                    <p className="mt-1 text-ink-600 dark:text-ink-300">Reason: {r.reason}</p>
                    <p className="mt-0.5 text-xs text-ink-400">Total then: {formatCurrency(r.amount)} · {r.items.length} line{r.items.length === 1 ? '' : 's'}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title="Related records">
            <div className="-mx-1.5 space-y-0.5">
              {order.proposalId && <RelatedRow icon={FileSignature} label="Proposal" value={order.proposalNumber} onClick={() => navigate(`/proposals/${order.proposalId}`)} />}
              <RelatedRow icon={FileText} label="Quotation" value={order.quotationNumber ? `${order.quotationNumber}${quotation ? ` · ${quotation.status}` : ''}` : null} onClick={order.quotationId ? () => navigate(`/quotations/${order.quotationId}`) : undefined} />
              <RelatedRow icon={Handshake} label="Deal" value={deal ? `${deal.name} · ${deal.stage}` : order.dealId} onClick={order.dealId ? () => navigate(`/deals/${order.dealId}`) : undefined} />
              <RelatedRow icon={Users} label="Customer" value={order.customerName} onClick={order.customerId ? () => navigate(`/customers/${order.customerId}`) : undefined} />
              <RelatedRow icon={Receipt} label="Invoice" value={invoice ? `${invoice.number} · ${invoice.status}` : null} onClick={invoice ? () => navigate(`/invoices/${invoice.id}`) : undefined} />
              <RelatedRow icon={CreditCard} label="Payments" value={payments.length ? `${payments.length} · ${formatCurrency(paidTotal)}` : null} onClick={payments.length ? () => navigate('/payments') : undefined} />
            </div>
          </Card>
          <Card title="Activity timeline" icon={Clock}>
            <ActivityTimeline items={activities} />
          </Card>
        </aside>
      </div>

      <StatusDialog open={dialog === 'status'} onClose={() => setDialog(null)} order={order} onChanged={refresh} onRecordFulfilment={() => setDialog('fulfil')} />
      <FulfilmentDialog open={dialog === 'fulfil'} onClose={() => setDialog(null)} order={order} onChanged={refresh} />
      <NoteDialog open={dialog === 'note'} onClose={() => setDialog(null)} order={order} onSaved={refresh} />
      <FollowUpDialog open={dialog === 'followup'} onClose={() => setDialog(null)} order={order} onSaved={refresh} />
      <DocumentDialog open={dialog === 'doc'} onClose={() => setDialog(null)} order={order} onSaved={refresh} />
      <InvoiceDialog open={dialog === 'invoice'} onClose={() => setDialog(null)} order={order} onCreated={(r) => { setDialog(null); navigate(`/invoices/${r.invoice.id}`) }} />
      {liveInvoice && <RecordPaymentModal open={dialog === 'payment'} onClose={() => setDialog(null)} invoice={liveInvoice} onRecorded={refresh} />}
      <ConfirmDialog open={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={confirmDelete} loading={busy} title="Delete this draft?" description={`${order.number} will be permanently removed and the quotation becomes available for a new sales order.`} confirmLabel="Delete draft" />
    </div>
  )
}
