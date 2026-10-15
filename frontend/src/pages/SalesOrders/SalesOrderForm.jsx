import { useOptions } from '../../hooks/useOptions'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, CheckCircle2, Plus, Trash2, Building2, User, Handshake, FileText, Users, AlertTriangle, History } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button, IconButton } from '../../components/common/Button'
import { FormField, Input, Textarea, Select } from '../../components/common/FormField'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { salesUsers } from '../../data/users'
import { useProducts } from '../../hooks/useProducts'
import { ProductSelect } from '../../components/common/ProductSelect'
import { lineFromProduct, catalogDrift } from '../../utils/productRules'
import { formatCurrency } from '../../utils/format'
import {
  computeOrder, inferTaxType, normalizeItem, validateOrderInput, TAX_RATES, DEFAULT_TAX_RATE,
  SO_LIGHT_EDIT_FIELDS,
} from '../../utils/salesOrderCalc'
import { getSalesOrderDraft, createSalesOrder, updateSalesOrder, reviseSalesOrder, soError, soFieldErrors } from './salesOrderClient'

const CONFIRM_ROLES = ['Super Admin', 'Admin', 'Sales Manager']

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
      <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-ink-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function LinkChip({ icon: Icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-ink-100 px-3 py-2 text-left hover:border-brand-400 disabled:cursor-default disabled:hover:border-ink-100 dark:border-ink-800">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><Icon size={15} /></span>
      <span className="min-w-0"><span className="block text-[11px] uppercase tracking-wide text-ink-400">{label}</span><span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span></span>
    </button>
  )
}

export default function SalesOrderForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const quotationId = params.get('quotationId')
  const isNew = !id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, hasPermission } = useAuth()
  const { products, byId: productById } = useProducts()
  const reps = salesUsers()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [order, setOrder] = useState(null) // the draft (new) or the stored order (edit)
  const [form, setForm] = useState(null)
  const termOptions = useOptions('payment_terms', form?.paymentTerms)
  const [contacts, setContacts] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    const load = isNew
      ? (quotationId ? getSalesOrderDraft(quotationId) : Promise.reject(Object.assign(new Error('Open a sales order from an Accepted quotation.'), { response: { data: { message: 'Choose an Accepted quotation to create a sales order from.' } } })))
      : api.get(`/salesOrders/${id}`).then((r) => r.data)
    load.then((o) => {
      setOrder(o)
      setForm({
        orderDate: o.orderDate, expectedDeliveryDate: o.expectedDeliveryDate, salesperson: o.salesperson || '', contactId: o.contactId || '',
        billingAddress: o.billingAddress || '', shippingAddress: o.shippingAddress || '', gstin: o.gstin || '', taxType: o.taxType || inferTaxType(o.gstin),
        paymentTerms: o.paymentTerms || '', deliveryTerms: o.deliveryTerms || '', notes: o.notes || '', internalRemarks: o.internalRemarks || '',
        items: (o.items || []).map(normalizeItem),
      })
    }).catch((err) => setLoadError(soError(err, 'Could not load this order.'))).finally(() => setLoading(false))
  }, [id, quotationId, isNew])

  useEffect(() => {
    if (!order?.companyId) return
    api.get('/contacts', { params: { all: true } }).then((r) => setContacts(r.data.filter((c) => c.companyId === order.companyId)))
  }, [order?.companyId])

  const mode = isNew ? 'create' : order?.status === 'Draft' ? 'edit' : ['Confirmed', 'Processing', 'Partially Fulfilled'].includes(order?.status) && !order?.invoiceId && !(order?.items || []).some((i) => i.fulfilledQty > 0) ? 'revise' : 'light'
  const commercialLocked = mode === 'light' // items/prices/terms can't change any more
  const canConfirm = CONFIRM_ROLES.includes(user?.role)

  const totals = useMemo(() => (form ? computeOrder(form.items, form.taxType) : null), [form])
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setItem = (idx, patch) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }))
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, normalizeItem({ qty: 1, taxRate: DEFAULT_TAX_RATE })] }))
  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  // a catalog item fills name, code, category, description, unit, price, discount and tax rate from the master record
  const onProduct = (idx, p) => setItem(idx, p ? lineFromProduct(p, { qty: form.items[idx]?.qty || 1 }) : { productId: null, productCode: null, category: null, unit: null, billingCycle: null })
  const onGstin = (value) => set({ gstin: value.toUpperCase(), taxType: inferTaxType(value) })

  const check = () => {
    const e = validateOrderInput({ ...form })
    if (mode === 'revise' && !reason.trim()) e.reason = 'Give a reason for the revision.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleError = (err) => {
    setSaving(false)
    setErrors((e) => ({ ...e, ...soFieldErrors(err) }))
    toast(soError(err, 'Could not save the order.'), { type: 'error' })
  }

  const submit = (confirm = false) => {
    if (saving) return
    if (!check()) { toast('Please fix the highlighted fields.', { type: 'error' }); return }
    setSaving(true)
    const payload = { ...form, items: form.items.map(normalizeItem) }
    if (mode === 'create') {
      createSalesOrder(order.quotationId, payload, confirm).then((so) => {
        toast(`Sales Order ${so.number} ${confirm ? 'created and confirmed' : 'saved as draft'}.`, { type: 'success' })
        navigate(`/sales-orders/${so.id}`)
      }).catch(handleError)
    } else if (mode === 'revise') {
      reviseSalesOrder(order.id, { reason, order: { items: payload.items, paymentTerms: payload.paymentTerms, deliveryTerms: payload.deliveryTerms, taxType: payload.taxType, gstin: payload.gstin, billingAddress: payload.billingAddress, expectedDeliveryDate: payload.expectedDeliveryDate } })
        .then((so) => updateSalesOrder(order.id, pickLight(payload)).catch(() => so).then(() => {
          toast(`Order revised (revision ${so.revision}). The previous version is kept in the history.`, { type: 'success' })
          navigate(`/sales-orders/${order.id}`)
        })).catch(handleError)
    } else {
      updateSalesOrder(order.id, mode === 'light' ? pickLight(payload) : payload).then(() => {
        toast('Sales order updated.', { type: 'success' })
        navigate(`/sales-orders/${order.id}`)
      }).catch(handleError)
    }
  }

  if (loading) return <CardSkeleton className="h-60" />
  if (loadError || !order) {
    return <EmptyState icon={AlertTriangle} title="Can't open the sales order form" description={loadError || 'Not found.'} action={<Button onClick={() => navigate('/sales-orders')}>Back to Sales Orders</Button>} />
  }
  if (!hasPermission('Sales Orders', isNew ? 'create' : 'edit')) {
    return <EmptyState title="Not authorized" description="Your role can't create or edit sales orders." action={<Button onClick={() => navigate('/sales-orders')}>Back</Button>} />
  }

  const title = mode === 'create' ? 'Create Sales Order' : mode === 'revise' ? `Revise ${order.number}` : `Edit ${order.number}`
  const disabledCommercial = commercialLocked
  const fe = (k) => errors[k]

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Sales Orders', href: '/sales-orders' }, { label: mode === 'create' ? 'New' : order.number }]} />
      <div className="mb-5 mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{title}</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            {mode === 'create' && 'Review the details carried over from the accepted quotation, adjust if needed, then save as a draft or confirm.'}
            {mode === 'edit' && 'This order is still a draft — everything below can be changed.'}
            {mode === 'revise' && 'This order is confirmed. Changes create a new revision and the current version is kept in the order history.'}
            {mode === 'light' && 'Only delivery details, owner and notes can change at this stage.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(mode === 'create' ? `/quotations/${order.quotationId}` : `/sales-orders/${order.id}`)}>Cancel</Button>
          {mode === 'create' && <Button variant="secondary" icon={Save} loading={saving} onClick={() => submit(false)}>Save as Draft</Button>}
          {mode === 'create' && <Button icon={CheckCircle2} disabled={!canConfirm} title={canConfirm ? undefined : 'Only a Sales Manager or Admin can confirm an order'} onClick={() => { if (check()) setConfirmOpen(true); else toast('Please fix the highlighted fields.', { type: 'error' }) }}>Create &amp; Confirm</Button>}
          {mode === 'edit' && <Button icon={Save} loading={saving} onClick={() => submit(false)}>Save Changes</Button>}
          {mode === 'revise' && <Button icon={History} loading={saving} onClick={() => submit(false)}>Save Revision</Button>}
          {mode === 'light' && <Button icon={Save} loading={saving} onClick={() => submit(false)}>Save Changes</Button>}
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Some fields need attention — they're marked below.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Section title="Linked records" description="Carried over from the quotation — these links are fixed so the order always traces back to the right deal, customer and quotation.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <LinkChip icon={Users} label="Customer" value={order.customerName} onClick={order.customerId ? () => navigate(`/customers/${order.customerId}`) : undefined} />
              <LinkChip icon={Building2} label="Company" value={order.companyName} onClick={order.companyId ? () => navigate(`/companies/${order.companyId}`) : undefined} />
              <LinkChip icon={Handshake} label="Linked deal" value={order.dealName || order.dealId} onClick={order.dealId ? () => navigate(`/deals/${order.dealId}`) : undefined} />
              <LinkChip icon={FileText} label="Linked quotation" value={order.quotationNumber} onClick={order.quotationId ? () => navigate(`/quotations/${order.quotationId}`) : undefined} />
              <div className="sm:col-span-2">
                <FormField label="Contact person">
                  <Select value={form.contactId} onChange={(e) => set({ contactId: e.target.value })} disabled={disabledCommercial}>
                    {!contacts.length && <option value="">{order.contactName || '—'}</option>}
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
                  </Select>
                </FormField>
              </div>
            </div>
            {order.customerWillBeCreated && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{order.companyName} isn't a Customer yet — one customer record will be created for it (and reused for every later order).</p>}
          </Section>

          <Section title="Order information">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Sales order number"><Input value={mode === 'create' ? 'Assigned on save (SO-YYYY-00001)' : order.number} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField>
              <FormField label="Order date" required error={fe('orderDate')}><Input type="date" value={form.orderDate} disabled={disabledCommercial} onChange={(e) => set({ orderDate: e.target.value })} error={!!fe('orderDate')} /></FormField>
              <FormField label="Expected delivery date" required error={fe('expectedDeliveryDate')}><Input type="date" value={form.expectedDeliveryDate} min={form.orderDate} onChange={(e) => set({ expectedDeliveryDate: e.target.value })} error={!!fe('expectedDeliveryDate')} /></FormField>
              <FormField label="Salesperson / owner" required error={fe('salesperson')}>
                <Select value={form.salesperson} onChange={(e) => set({ salesperson: e.target.value })} error={!!fe('salesperson')}>
                  <option value="">Select owner…</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Payment terms" required error={fe('paymentTerms')}>
                <Select value={termOptions.values.includes(form.paymentTerms) ? form.paymentTerms : '__custom'} disabled={disabledCommercial} onChange={(e) => set({ paymentTerms: e.target.value === '__custom' ? '' : e.target.value })}>
                  {termOptions.values.map((t) => <option key={t} value={t}>{t}</option>)}
                  <option value="__custom">Custom…</option>
                </Select>
                {!termOptions.values.includes(form.paymentTerms) && <Input className="mt-2" value={form.paymentTerms} disabled={disabledCommercial} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="e.g. 30% advance, balance in 30 days" error={!!fe('paymentTerms')} />}
              </FormField>
              <FormField label="GSTIN" error={fe('gstin')} hint={form.gstin ? (form.taxType === 'inter' ? 'Different state → IGST applies.' : 'Same state → CGST + SGST apply.') : 'No GSTIN → CGST + SGST by default.'}>
                <Input value={form.gstin} disabled={disabledCommercial} maxLength={15} onChange={(e) => onGstin(e.target.value)} placeholder="29AABCT1332L1ZV" error={!!fe('gstin')} />
              </FormField>
              <div className="sm:col-span-2 lg:col-span-3">
                <FormField label="Delivery terms"><Textarea value={form.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} className="min-h-[70px]" /></FormField>
              </div>
            </div>
          </Section>

          <Section title="Addresses">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Billing address" required error={fe('billingAddress')}><Textarea value={form.billingAddress} disabled={disabledCommercial} onChange={(e) => set({ billingAddress: e.target.value })} error={!!fe('billingAddress')} className="min-h-[80px]" /></FormField>
              <FormField label="Shipping / service address"><Textarea value={form.shippingAddress} onChange={(e) => set({ shippingAddress: e.target.value })} className="min-h-[80px]" /></FormField>
            </div>
          </Section>

          <Section title="Products / services" description={commercialLocked ? 'Locked — this order has progressed too far to change its lines.' : 'Quantities, prices, discounts and taxes update the totals instantly.'}>
            {fe('items') && <p role="alert" className="mb-2 text-xs text-rose-600">{fe('items')}</p>}
            <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                    <th className="px-3 py-2.5">Product / service</th><th className="px-3 py-2.5 w-20">Qty</th><th className="px-3 py-2.5 w-28">Unit price</th>
                    <th className="px-3 py-2.5 w-20">Disc %</th><th className="px-3 py-2.5 w-24">Tax %</th><th className="px-3 py-2.5 w-28 text-right">Line total</th><th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, idx) => {
                    const line = totals.lines[idx]
                    return (
                      <tr key={idx} className="border-b border-ink-50 align-top last:border-0 dark:border-ink-800/60">
                        <td className="px-3 py-2">
                          <ProductSelect products={products} value={it.productId || ''} disabled={commercialLocked} onSelect={(p) => onProduct(idx, p)} className="mb-1 h-9 text-xs" />
                          {it.productId && <p className="mb-1 text-[11px] text-ink-400">{it.productCode}{it.unit ? ` · per ${it.unit}` : ''}{productById.get(it.productId)?.status === 'Inactive' ? ' · inactive in catalog' : ''}</p>}
                          {!commercialLocked && catalogDrift(it, productById.get(it.productId)) && <button type="button" className="mb-1 block text-[11px] font-medium text-amber-600 hover:underline" onClick={() => onProduct(idx, productById.get(it.productId))}>Catalog price/tax changed — update line</button>}
                          <Input value={it.name} disabled={commercialLocked} onChange={(e) => setItem(idx, { name: e.target.value })} placeholder="Name" className="mb-1 h-9 text-xs" error={!!fe(`item-${idx}-name`)} />
                          <Input value={it.description} disabled={commercialLocked} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="Description (optional)" className="h-9 text-xs" />
                          {fe(`item-${idx}-name`) && <p className="mt-1 text-[11px] text-rose-600">{fe(`item-${idx}-name`)}</p>}
                        </td>
                        <td className="px-3 py-2"><Input type="number" min="1" step="1" disabled={commercialLocked} value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} className="h-9 text-xs" error={!!fe(`item-${idx}-qty`)} />{fe(`item-${idx}-qty`) && <p className="mt-1 text-[11px] text-rose-600">{fe(`item-${idx}-qty`)}</p>}</td>
                        <td className="px-3 py-2"><Input type="number" min="0" disabled={commercialLocked} value={it.unitPrice} onChange={(e) => setItem(idx, { unitPrice: e.target.value })} className="h-9 text-xs" error={!!fe(`item-${idx}-unitPrice`)} /></td>
                        <td className="px-3 py-2"><Input type="number" min="0" max="100" disabled={commercialLocked} value={it.discount} onChange={(e) => setItem(idx, { discount: e.target.value })} className="h-9 text-xs" error={!!fe(`item-${idx}-discount`)} />{fe(`item-${idx}-discount`) && <p className="mt-1 text-[11px] text-rose-600">{fe(`item-${idx}-discount`)}</p>}</td>
                        <td className="px-3 py-2">
                          <Select value={TAX_RATES.includes(Number(it.taxRate)) ? it.taxRate : DEFAULT_TAX_RATE} disabled={commercialLocked} onChange={(e) => setItem(idx, { taxRate: Number(e.target.value) })} className="h-9 text-xs">
                            {TAX_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(line?.total || 0)}</td>
                        <td className="px-1 py-2 text-center">{!commercialLocked && form.items.length > 1 && <IconButton icon={Trash2} size="sm" aria-label="Remove line" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => removeItem(idx)} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!commercialLocked && <Button variant="secondary" size="sm" icon={Plus} className="mt-3" onClick={addItem}>Add line</Button>}
          </Section>

          <Section title="Notes">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Notes" hint="Visible on the order document."><Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[90px]" /></FormField>
              <FormField label="Internal remarks" hint="Internal only — never printed."><Textarea value={form.internalRemarks} onChange={(e) => set({ internalRemarks: e.target.value })} className="min-h-[90px]" /></FormField>
            </div>
          </Section>

          {mode === 'revise' && (
            <Section title="Reason for revision" description="Recorded in the order history together with the previous version.">
              <FormField label="Reason" required error={fe('reason')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} error={!!fe('reason')} placeholder="e.g. Customer added 2 more licences on a call" className="min-h-[80px]" /></FormField>
            </Section>
          )}
        </div>

        <aside className="min-w-0">
          <div className="space-y-4 xl:sticky xl:top-20">
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">Order summary</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Subtotal" value={totals.subtotal} />
                <Row label="Discount" value={-totals.discountAmount} />
                <Row label="Taxable amount" value={totals.taxableAmount} strong />
                {form.taxType === 'intra' ? (<><Row label="CGST" value={totals.cgst} /><Row label="SGST" value={totals.sgst} /></>) : <Row label="IGST" value={totals.igst} />}
                <div className="flex items-center justify-between border-t border-ink-200 pt-2.5 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><dt>Grand total</dt><dd>{formatCurrency(totals.amount)}</dd></div>
              </dl>
              <div className="mt-4">
                <FormField label="Tax type" className="mb-0">
                  <Select value={form.taxType} disabled={disabledCommercial} onChange={(e) => set({ taxType: e.target.value })}>
                    <option value="intra">Intra-state — CGST + SGST</option>
                    <option value="inter">Inter-state — IGST</option>
                  </Select>
                </FormField>
              </div>
            </div>
            {mode === 'create' && order.quotationAmount != null && Math.abs(order.quotationAmount - totals.amount) > 0.5 && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">The order total ({formatCurrency(totals.amount)}) differs from the accepted quotation ({formatCurrency(order.quotationAmount)}).</p>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); submit(true) }}
        tone="primary"
        title="Create and confirm this order?"
        description={`A confirmed order is locked for commercial edits (changes need a revision) and can be invoiced. Grand total: ${formatCurrency(totals?.amount || 0)}.`}
        confirmLabel="Create & Confirm"
        loading={saving}
      />
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold text-ink-800 dark:text-ink-100' : 'text-ink-600 dark:text-ink-300'}`}>
      <dt>{label}</dt><dd>{value < 0 ? `− ${formatCurrency(-value)}` : formatCurrency(value)}</dd>
    </div>
  )
}

function pickLight(p) {
  const out = {}
  SO_LIGHT_EDIT_FIELDS.forEach((k) => { if (p[k] !== undefined) out[k] = p[k] })
  return out
}
