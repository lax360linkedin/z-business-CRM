import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Printer, Send, CreditCard, Ban, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { EmptyState } from '../../components/common/EmptyState'
import { Logo } from '../../components/common/Logo'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getCustomerById } from '../../data/customers'
import { PAYMENT_METHODS } from '../../data/constants'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [statusSaving, setStatusSaving] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentSaving, setPaymentSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/invoices/${id}`)
      .then((res) => setInvoice(res.data))
      .catch(() => setInvoice(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const customer = invoice ? getCustomerById(invoice.customerId) : null
  const balance = invoice ? (invoice.amount || 0) - (invoice.paidAmount || 0) : 0

  const updateStatus = (status) => {
    setStatusSaving(true)
    api.put(`/invoices/${id}`, { status }).then((res) => {
      setInvoice(res.data)
      setStatusSaving(false)
      toast(`Invoice marked as ${status}.`, { type: 'success' })
    })
  }

  const recordPayment = (data) => {
    setPaymentSaving(true)
    const amount = Number(data.amount) || 0
    const newPaidAmount = (invoice.paidAmount || 0) + amount
    const newStatus = newPaidAmount >= invoice.amount ? 'Paid' : 'Partially Paid'

    Promise.all([
      api.post('/payments', {
        id: genId('PAY'),
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        amount,
        method: data.method,
        date: data.date,
        status: 'Completed',
        reference: `TXN${Math.floor(100000 + Math.random() * 900000)}`,
      }),
      api.put(`/invoices/${id}`, { paidAmount: newPaidAmount, status: newStatus }),
    ]).then(([, invRes]) => {
      setInvoice(invRes.data)
      setPaymentSaving(false)
      setPaymentOpen(false)
      toast('Payment recorded successfully.', { type: 'success' })
    })
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div>
  }

  if (!invoice) {
    return <EmptyState title="Invoice not found" description="This invoice may have been removed." />
  }

  const canSend = invoice.status === 'Draft'
  const canRecordPayment = !['Paid', 'Cancelled'].includes(invoice.status)
  const canCancel = !['Paid', 'Cancelled'].includes(invoice.status)
  const canMarkOverdue = ['Sent', 'Partially Paid'].includes(invoice.status)

  return (
    <div>
      <div className="print:hidden">
        <Breadcrumbs items={[{ label: 'Invoices', href: '/invoices' }, { label: invoice.number }]} />
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{invoice.number}</h1>
          <div className="mt-1"><StatusBadge status={invoice.status} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSend && <Button variant="secondary" icon={Send} loading={statusSaving} onClick={() => updateStatus('Sent')}>Mark as Sent</Button>}
          {canMarkOverdue && <Button variant="secondary" icon={Clock} loading={statusSaving} onClick={() => updateStatus('Overdue')}>Mark Overdue</Button>}
          {canRecordPayment && <Button icon={CreditCard} onClick={() => setPaymentOpen(true)}>Record Payment</Button>}
          {canCancel && <Button variant="danger" icon={Ban} loading={statusSaving} onClick={() => updateStatus('Cancelled')}>Cancel Invoice</Button>}
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
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Bill To</p>
            <p className="mt-1.5 font-semibold text-ink-800 dark:text-ink-100">{invoice.customerName}</p>
            {customer && (
              <div className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
                {customer.contactPerson && <p>{customer.contactPerson}</p>}
                {customer.email && <p>{customer.email}</p>}
                {customer.phone && <p>{customer.phone}</p>}
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Status</p>
            <div className="mt-1.5"><StatusBadge status={invoice.status} /></div>
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-50/60 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/40 dark:text-ink-400">
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-4 py-3 text-ink-700 dark:text-ink-200">Professional Services — {invoice.number}</td>
                <td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(invoice.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-ink-500 dark:text-ink-400">
              <span>Invoice Amount</span>
              <span className="font-medium text-ink-800 dark:text-ink-100">{formatCurrency(invoice.amount)}</span>
            </div>
            <div className="flex justify-between text-ink-500 dark:text-ink-400">
              <span>Amount Paid</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(invoice.paidAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900 dark:border-ink-800 dark:text-ink-50">
              <span>Balance Due</span>
              <span>{formatCurrency(balance)}</span>
            </div>
          </div>
        </div>

        {invoice.status === 'Paid' && (
          <div className="mt-8 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            <CheckCircle2 size={16} /> This invoice has been paid in full.
          </div>
        )}
      </div>

      <FormModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title="Record Payment"
        description={`Record a payment against ${invoice.number}.`}
        submitLabel="Record Payment"
        loading={paymentSaving}
        onSubmit={recordPayment}
        defaultValues={{ amount: balance, method: PAYMENT_METHODS[0], date: new Date().toISOString().slice(0, 10) }}
        fields={[
          { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, span: 1 },
          { name: 'method', label: 'Payment method', type: 'select', options: PAYMENT_METHODS.map((m) => ({ value: m, label: m })), required: true, span: 1 },
          { name: 'date', label: 'Payment date', type: 'date', required: true, span: 2 },
        ]}
      />
    </div>
  )
}
