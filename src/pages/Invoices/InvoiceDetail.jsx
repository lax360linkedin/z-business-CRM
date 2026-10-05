import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Printer, Send, CreditCard, Ban, CheckCircle2, Clock, Loader2, ClipboardList, FileText, Handshake, FileSignature } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { FormField, Textarea } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { Logo } from '../../components/common/Logo'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { formatCurrency, formatDate } from '../../utils/format'
import { computeOrder } from '../../utils/salesOrderCalc'
import { RecordPaymentModal } from '../SalesOrders/SalesOrderDialogs'
import { cancelInvoice, soError } from '../SalesOrders/salesOrderClient'

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const [invoice, setInvoice] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [order, setOrder] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusSaving, setStatusSaving] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState('')

  const load = useCallback(() => api.get(`/invoices/${id}`).then(async (res) => {
    const inv = res.data
    setInvoice(inv)
    const get = (p) => api.get(p).then((r) => r.data).catch(() => null)
    const [cust, so, pays] = await Promise.all([
      inv.customerId ? get(`/customers/${inv.customerId}`) : null,
      inv.salesOrderId ? get(`/salesOrders/${inv.salesOrderId}`) : null,
      api.get('/payments', { params: { all: true } }).then((r) => r.data).catch(() => []),
    ])
    setCustomer(cust); setOrder(so)
    setPayments(pays.filter((p) => p.invoiceId === inv.id))
  }).catch(() => setInvoice(null)), [id])

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)) }, [load])

  const updateStatus = (status) => {
    setStatusSaving(true)
    api.put(`/invoices/${id}`, { status }).then((res) => { setInvoice(res.data); toast(`Invoice marked as ${status}.`, { type: 'success' }) })
      .catch((e) => toast(soError(e), { type: 'error' })).finally(() => setStatusSaving(false))
  }

  const doCancel = () => {
    setStatusSaving(true); setCancelError('')
    cancelInvoice(id, cancelReason).then(() => { toast('Invoice cancelled.', { type: 'success' }); setCancelOpen(false); load() })
      .catch((e) => setCancelError(soError(e))).finally(() => setStatusSaving(false))
  }

  if (loading) return <div className="flex h-64 items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div>
  if (!invoice) return <EmptyState title="Invoice not found" description="This invoice may have been removed." />

  const balance = Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0))
  const hasLines = (invoice.items || []).length > 0
  const calc = hasLines ? computeOrder(invoice.items, invoice.taxType) : null
  const canSend = invoice.status === 'Draft'
  const canRecordPayment = hasPermission('Payments', 'create') && !['Paid', 'Cancelled'].includes(invoice.status)
  const canCancel = hasPermission('Invoices', 'edit') && !['Paid', 'Cancelled'].includes(invoice.status) && !(invoice.paidAmount > 0)
  const canMarkOverdue = ['Sent', 'Partially Paid'].includes(invoice.status)

  return (
    <div>
      <div className="print:hidden"><Breadcrumbs items={[{ label: 'Invoices', href: '/invoices' }, { label: invoice.number }]} /></div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{invoice.number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2"><StatusBadge status={invoice.status} />{invoice.salesOrderNumber && <span className="text-xs text-ink-400">from {invoice.salesOrderNumber}</span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order && <Button variant="secondary" icon={ClipboardList} onClick={() => navigate(`/sales-orders/${order.id}`)}>Sales Order</Button>}
          {invoice.proposalId && <Button variant="secondary" icon={FileSignature} onClick={() => navigate(`/proposals/${invoice.proposalId}`)}>Proposal</Button>}
          {invoice.quotationId && <Button variant="secondary" icon={FileText} onClick={() => navigate(`/quotations/${invoice.quotationId}`)}>Quotation</Button>}
          {invoice.dealId && <Button variant="secondary" icon={Handshake} onClick={() => navigate(`/deals/${invoice.dealId}`)}>Deal</Button>}
          {canSend && <Button variant="secondary" icon={Send} loading={statusSaving} onClick={() => updateStatus('Sent')}>Mark as Sent</Button>}
          {canMarkOverdue && <Button variant="secondary" icon={Clock} loading={statusSaving} onClick={() => updateStatus('Overdue')}>Mark Overdue</Button>}
          {canRecordPayment && <Button icon={CreditCard} onClick={() => setPaymentOpen(true)}>Record Payment</Button>}
          {canCancel && <Button variant="danger" icon={Ban} onClick={() => { setCancelReason(''); setCancelError(''); setCancelOpen(true) }}>Cancel Invoice</Button>}
          <RecordTasksButton type="Invoice" id={invoice.id} label={invoice.number} />
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl rounded-2xl border border-ink-100 bg-white p-8 shadow-card dark:border-ink-800 dark:bg-ink-900 print:rounded-none print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-100 pb-6 dark:border-ink-800">
          <div className="flex items-center gap-3">
            <Logo imgClassName="h-11" />
            <div>
              <h2 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">LAX360 Business CRM</h2>
              <p className="mt-0.5 text-xs text-ink-400">Invoicing &amp; Client Billing</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-ink-900 dark:text-ink-50">{invoice.number}</p>
            <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">Issue Date: {formatDate(invoice.issueDate)}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">Due Date: {formatDate(invoice.dueDate)}</p>
            {invoice.salesOrderNumber && <p className="text-xs text-ink-500 dark:text-ink-400">Sales Order: {invoice.salesOrderNumber}</p>}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <p className="mt-1.5 font-semibold text-ink-800 dark:text-ink-100">{invoice.customerName}</p>
            <div className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
              {(invoice.contactName || customer?.contactPerson) && <p>{invoice.contactName || customer.contactPerson}</p>}
              {(order?.contactEmail || customer?.email) && <p>{order?.contactEmail || customer.email}</p>}
              {(order?.contactPhone || customer?.phone) && <p>{order?.contactPhone || customer.phone}</p>}
              {invoice.billingAddress && <p className="whitespace-pre-line">{invoice.billingAddress}</p>}
              {invoice.gstin && <p>GSTIN: {invoice.gstin}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Status</p>
            <div className="mt-1.5"><StatusBadge status={invoice.status} /></div>
            {invoice.paymentTerms && <p className="mt-2 max-w-[220px] text-xs text-ink-500">Terms: {invoice.paymentTerms}</p>}
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-50/60 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/40 dark:text-ink-400">
                <th className="px-4 py-2.5">Description</th>
                {hasLines && <><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Rate</th><th className="px-3 py-2.5 text-right">Disc</th><th className="px-3 py-2.5 text-right">Tax</th></>}
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {hasLines ? invoice.items.map((it, i) => (
                <tr key={i} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-4 py-3 text-ink-700 dark:text-ink-200"><p className="font-medium">{it.name}{it.productCode && <span className="ml-2 font-mono text-[11px] font-normal text-ink-400">{it.productCode}</span>}</p>{it.description && <p className="text-xs text-ink-400">{it.description}</p>}</td>
                  <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.qty}</td>
                  <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{formatCurrency(it.unitPrice)}</td>
                  <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.discount}%</td>
                  <td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.taxRate}%</td>
                  <td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(calc.lines[i].total)}</td>
                </tr>
              )) : (
                <tr className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-4 py-3 text-ink-700 dark:text-ink-200">Professional Services — {invoice.number}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(invoice.amount)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            {hasLines && (
              <>
                <div className="flex justify-between text-ink-500 dark:text-ink-400"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
                {invoice.discountAmount > 0 && <div className="flex justify-between text-ink-500 dark:text-ink-400"><span>Discount</span><span>− {formatCurrency(invoice.discountAmount)}</span></div>}
                <div className="flex justify-between text-ink-500 dark:text-ink-400"><span>Taxable amount</span><span>{formatCurrency(invoice.taxableAmount)}</span></div>
                {invoice.taxType === 'inter'
                  ? <div className="flex justify-between text-ink-500 dark:text-ink-400"><span>IGST</span><span>{formatCurrency(invoice.igst)}</span></div>
                  : (<><div className="flex justify-between text-ink-500 dark:text-ink-400"><span>CGST</span><span>{formatCurrency(invoice.cgst)}</span></div><div className="flex justify-between text-ink-500 dark:text-ink-400"><span>SGST</span><span>{formatCurrency(invoice.sgst)}</span></div></>)}
              </>
            )}
            <div className="flex justify-between border-t border-ink-100 pt-2 font-medium text-ink-500 dark:border-ink-800 dark:text-ink-400"><span>Invoice Amount</span><span className="text-ink-800 dark:text-ink-100">{formatCurrency(invoice.amount)}</span></div>
            <div className="flex justify-between text-ink-500 dark:text-ink-400"><span>Amount Paid</span><span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(invoice.paidAmount)}</span></div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900 dark:border-ink-800 dark:text-ink-50"><span>Balance Due</span><span>{formatCurrency(balance)}</span></div>
          </div>
        </div>

        {invoice.status === 'Paid' && (
          <div className="mt-8 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"><CheckCircle2 size={16} /> This invoice has been paid in full.</div>
        )}
        {invoice.status === 'Cancelled' && (
          <div className="mt-8 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"><Ban size={16} /> Cancelled{invoice.cancelReason ? ` — ${invoice.cancelReason}` : ''}.</div>
        )}

        {payments.length > 0 && (
          <div className="mt-8 print:hidden">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Payments received</p>
            <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-4 py-2.5 font-medium text-ink-700 dark:text-ink-200">{p.reference}</td>
                      <td className="px-3 py-2.5 text-ink-500">{p.method}</td>
                      <td className="px-3 py-2.5 text-ink-500">{formatDate(p.date)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-emerald-600">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <RecordPaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} invoice={invoice} onRecorded={load} />

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this invoice?" description={`${invoice.number} will be cancelled and the sales order can be invoiced again.`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep invoice</Button><Button variant="danger" loading={statusSaving} disabled={!cancelReason.trim()} onClick={doCancel}>Cancel invoice</Button></>}>
        <div className="space-y-3">
          <FormField label="Reason" required><Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="min-h-[80px]" /></FormField>
          {cancelError && <p role="alert" className="text-xs text-rose-600">{cancelError}</p>}
        </div>
      </Modal>
    </div>
  )
}
