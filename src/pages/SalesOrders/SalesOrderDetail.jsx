import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Printer, ArrowLeft, Receipt, Truck, CheckCircle2, Ban, Target, Handshake, FileText } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { Logo } from '../../components/common/Logo'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { getCustomerById } from '../../data/customers'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'
import { createNotification } from '../../utils/notify'

const NEXT_STATUS = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['In Fulfillment', 'Cancelled'],
  'In Fulfillment': ['Delivered'],
  Delivered: [],
  Invoiced: [],
  Cancelled: [],
}

export default function SalesOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [invoicing, setInvoicing] = useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/salesOrders/${id}`).then((res) => setOrder(res.data)).catch(() => setOrder(null)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const transition = (status) => {
    setUpdating(true)
    api.put(`/salesOrders/${id}`, { status }).then((res) => {
      setOrder(res.data)
      setUpdating(false)
      toast(`Sales order marked as ${status}.`, { type: 'success' })
    })
  }

  // Inherits customer/items/pricing/source straight from the Sales Order — nothing is
  // re-entered, and the full upstream chain (Lead → Deal → Quotation → Sales Order) is
  // preserved on the Invoice via salesOrderId/quotationId/dealId/leadId.
  const createInvoice = () => {
    setInvoicing(true)
    const invId = genId('INV')
    api.post('/invoices', {
      id: invId,
      number: `INV-2026-${invId.split('-').pop()}`,
      customerId: order.customerId,
      customerName: order.customerName,
      projectId: null,
      salesOrderId: order.id,
      quotationId: order.quotationId,
      dealId: order.dealId,
      leadId: order.leadId,
      source: order.source,
      sourceDetail: order.sourceDetail,
      amount: order.amount,
      paidAmount: 0,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      status: 'Draft',
    }).then((invRes) => {
      return api.put(`/salesOrders/${id}`, { status: 'Invoiced', invoiceId: invRes.data.id }).then((soRes) => {
        setOrder(soRes.data)
        setInvoicing(false)
        toast(`Invoice ${invRes.data.number} created from ${order.number}.`, { type: 'success' })
        createNotification({ type: 'Deal Update', message: `Invoice ${invRes.data.number} generated from Sales Order ${order.number}.`, relatedType: 'Invoice', relatedId: invRes.data.id })
        navigate(`/invoices/${invRes.data.id}`)
      })
    })
  }

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!order) return <EmptyState title="Sales order not found" description="This sales order may have been removed." action={<Button onClick={() => navigate('/sales-orders')}>Back to Sales Orders</Button>} />

  const customer = getCustomerById(order.customerId)
  const salesperson = getUserById(order.salesperson)
  const nextOptions = NEXT_STATUS[order.status] || []
  const canInvoice = ['Confirmed', 'In Fulfillment', 'Delivered'].includes(order.status) && !order.invoiceId

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <Breadcrumbs items={[{ label: 'Sales Orders', href: '/sales-orders' }, { label: order.number }]} />
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{order.number}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/sales-orders')}>Back</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500 dark:text-ink-400">Status</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.status === 'Pending' && <Button variant="primary" size="sm" icon={CheckCircle2} loading={updating} onClick={() => transition('Confirmed')}>Confirm Order</Button>}
          {order.status === 'Confirmed' && <Button variant="secondary" size="sm" icon={Truck} loading={updating} onClick={() => transition('In Fulfillment')}>Start Fulfillment</Button>}
          {order.status === 'In Fulfillment' && <Button variant="secondary" size="sm" icon={CheckCircle2} loading={updating} onClick={() => transition('Delivered')}>Mark Delivered</Button>}
          {nextOptions.includes('Cancelled') && <Button variant="danger" size="sm" icon={Ban} loading={updating} onClick={() => transition('Cancelled')}>Cancel</Button>}
          {canInvoice && <Button size="sm" icon={Receipt} loading={invoicing} onClick={createInvoice}>Create Invoice</Button>}
          {order.invoiceId && <Button variant="secondary" size="sm" icon={FileText} onClick={() => navigate(`/invoices/${order.invoiceId}`)}>View Invoice</Button>}
        </div>
      </div>

      {order.source && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-900/20 print:hidden">
          <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-200">
            <Target size={15} /> Original Lead Source: <span className="font-semibold">{order.source}</span>{order.sourceDetail ? ` — ${order.sourceDetail}` : ''}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {order.dealId && <Button variant="secondary" size="sm" icon={Handshake} onClick={() => navigate(`/deals?open=${order.dealId}`)}>View Deal</Button>}
            {order.quotationId && <Button variant="secondary" size="sm" icon={FileText} onClick={() => navigate(`/quotations/${order.quotationId}`)}>View Quotation</Button>}
          </div>
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
            <h3 className="text-lg font-bold uppercase tracking-wide text-ink-900 dark:text-ink-50">Sales Order</h3>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{order.number}</p>
            <p className="text-xs text-ink-400">Created {formatDate(order.createdDate)}</p>
            <p className="text-xs text-ink-400">Expected Delivery {formatDate(order.expectedDeliveryDate)}</p>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Customer</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{order.customerName}</p>
            {customer && (
              <div className="mt-1 space-y-0.5 text-sm text-ink-500 dark:text-ink-400">
                <p>{customer.contactPerson}</p>
                <p>{customer.email}</p>
                <p>{customer.phone}</p>
              </div>
            )}
          </div>
          <div className="sm:text-right">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Salesperson</p>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{salesperson?.name || '—'}</p>
            {order.quotationNumber && <p className="mt-1 text-xs text-ink-400">From Quotation: {order.quotationNumber}</p>}
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
              {(order.items || []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-400">No line items.</td></tr>
              )}
              {(order.items || []).map((item, idx) => {
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

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Subtotal</span><span>{formatCurrency(order.subtotal)}</span></div>
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Tax</span><span>{formatCurrency(order.tax)}</span></div>
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><span>Order Total</span><span>{formatCurrency(order.amount)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
