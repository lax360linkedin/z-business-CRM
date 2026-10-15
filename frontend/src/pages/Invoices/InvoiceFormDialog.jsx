import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Plus, Trash2, ClipboardList, PenLine, Info } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { useProducts } from '../../hooks/useProducts'
import { lineFromProduct } from '../../utils/productRules'
import { computeInvoice, inferTaxType, dueDateFrom, todayKey, validateInvoiceInput, termsToDays, normalizeInvoiceItem, DEFAULT_TAX_RATE } from '../../utils/invoiceRules'
import { TAX_RATES } from '../../utils/salesOrderCalc'
import { formatCurrency, formatDate } from '../../utils/format'
import { createInvoiceFromOrder, createManualInvoice, updateInvoice, eligibleOrders, useInvoiceConfig, invErr, invFields } from './invoiceClient'

const blankLine = () => ({ productId: null, name: '', description: '', qty: 1, unit: '', unitPrice: 0, discount: 0, taxRate: DEFAULT_TAX_RATE })
const num = (v) => (v === '' ? '' : Number(v))
const cellInput = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100'

/** Line items with live totals. Prices come from the catalog snapshot the moment a product is chosen and can be adjusted on a draft. */
export function InvoiceItemsEditor({ items, onChange, taxType, extraTaxes, roundOff, errors = {}, readOnly = false }) {
  const { active } = useProducts()
  const calc = useMemo(() => computeInvoice(items, { taxType, extraTaxes, roundOff }), [items, taxType, extraTaxes, roundOff])
  const set = (i, patch) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)))
  const pick = (i, id) => { const p = active.find((x) => x.id === id); if (p) set(i, lineFromProduct(p, { qty: items[i].qty || 1 })) }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-3 py-2">Product / service</th><th className="w-20 px-2 py-2">Qty</th><th className="w-20 px-2 py-2">Unit</th><th className="w-28 px-2 py-2">Unit price</th><th className="w-20 px-2 py-2">Disc %</th><th className="w-24 px-2 py-2">GST %</th><th className="w-28 px-3 py-2 text-right">Line total</th><th className="w-8" /></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-ink-50 align-top last:border-0 dark:border-ink-800/60">
                <td className="px-3 py-2">
                  {!readOnly && <select aria-label={`Catalog item for line ${i + 1}`} className={clsx(cellInput, 'mb-1 text-xs')} value={it.productId || ''} onChange={(e) => pick(i, e.target.value)}><option value="">{it.productId ? it.name : 'Pick from catalog…'}</option>{active.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}</select>}
                  <input aria-label={`Name for line ${i + 1}`} className={clsx(cellInput, errors[`item-${i}-name`] && 'border-rose-400')} value={it.name} readOnly={readOnly} onChange={(e) => set(i, { name: e.target.value })} placeholder="Item name" />
                  <input aria-label={`Description for line ${i + 1}`} className={clsx(cellInput, 'mt-1 text-xs')} value={it.description || ''} readOnly={readOnly} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description (optional)" />
                </td>
                <td className="px-2 py-2"><input aria-label={`Quantity for line ${i + 1}`} type="number" min="0" step="any" className={clsx(cellInput, errors[`item-${i}-qty`] && 'border-rose-400')} value={it.qty} readOnly={readOnly} onChange={(e) => set(i, { qty: num(e.target.value) })} /></td>
                <td className="px-2 py-2"><input aria-label={`Unit for line ${i + 1}`} className={cellInput} value={it.unit || ''} readOnly={readOnly} onChange={(e) => set(i, { unit: e.target.value })} placeholder="unit" /></td>
                <td className="px-2 py-2"><input aria-label={`Unit price for line ${i + 1}`} type="number" min="0" step="0.01" className={clsx(cellInput, errors[`item-${i}-unitPrice`] && 'border-rose-400')} value={it.unitPrice} readOnly={readOnly} onChange={(e) => set(i, { unitPrice: num(e.target.value) })} /></td>
                <td className="px-2 py-2"><input aria-label={`Discount for line ${i + 1}`} type="number" min="0" max="100" step="any" className={clsx(cellInput, errors[`item-${i}-discount`] && 'border-rose-400')} value={it.discount} readOnly={readOnly} onChange={(e) => set(i, { discount: num(e.target.value) })} /></td>
                <td className="px-2 py-2"><select aria-label={`GST rate for line ${i + 1}`} className={cellInput} disabled={readOnly} value={it.taxRate} onChange={(e) => set(i, { taxRate: Number(e.target.value) })}>{[...new Set([...TAX_RATES, Number(it.taxRate)])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
                <td className="px-3 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(calc.lines[i]?.total || 0)}</td>
                <td className="px-1 py-2">{!readOnly && items.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(items.filter((_, k) => k !== i))} className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.items && <p role="alert" className="text-xs text-rose-500">{errors.items}</p>}
      {!readOnly && <Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...items, blankLine()])}>Add line</Button>}
      <dl className="ml-auto grid max-w-xs gap-1 text-sm">
        <div className="flex justify-between text-ink-500"><dt>Subtotal</dt><dd>{formatCurrency(calc.subtotal)}</dd></div>
        {calc.discountAmount > 0 && <div className="flex justify-between text-ink-500"><dt>Discount</dt><dd>− {formatCurrency(calc.discountAmount)}</dd></div>}
        <div className="flex justify-between text-ink-500"><dt>Taxable amount</dt><dd>{formatCurrency(calc.taxableAmount)}</dd></div>
        {taxType === 'inter' ? <div className="flex justify-between text-ink-500"><dt>IGST</dt><dd>{formatCurrency(calc.igst)}</dd></div> : <><div className="flex justify-between text-ink-500"><dt>CGST</dt><dd>{formatCurrency(calc.cgst)}</dd></div><div className="flex justify-between text-ink-500"><dt>SGST</dt><dd>{formatCurrency(calc.sgst)}</dd></div></>}
        {calc.extraTaxes.map((t) => <div key={t.name} className="flex justify-between text-ink-500"><dt>{t.name} ({t.rate}%)</dt><dd>{formatCurrency(t.amount)}</dd></div>)}
        {calc.roundOff !== 0 && <div className="flex justify-between text-ink-500"><dt>Round off</dt><dd>{calc.roundOff > 0 ? '+' : '−'} {formatCurrency(Math.abs(calc.roundOff))}</dd></div>}
        <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold text-ink-900 dark:border-ink-800 dark:text-ink-50"><dt>Grand total</dt><dd>{formatCurrency(calc.amount)}</dd></div>
      </dl>
    </div>
  )
}

/**
 * New invoice (from a confirmed sales order — everything is copied from the CRM records — or, for finance roles, manually) and Edit
 * (a draft is fully editable; once sent only due date, notes, owner, address and links can change, and the due date needs a reason).
 */
export function InvoiceFormDialog({ open, onClose, invoice, preset, onSaved }) {
  const { toast } = useToast()
  const { config, perms } = useInvoiceConfig()
  const editing = !!invoice
  const draft = editing && invoice.status === 'Draft'
  const [mode, setMode] = useState('order')
  const [orders, setOrders] = useState([])
  const [orderId, setOrderId] = useState('')
  const [refs, setRefs] = useState({ customers: [], contacts: [], deals: [], projects: [], contracts: [] })
  const [f, setF] = useState(null)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (!open) return
    setErrors({}); setError('')
    const today = todayKey()
    if (editing) {
      setF({ ...invoice, items: (invoice.items || []).map(normalizeInvoiceItem), extraTaxes: invoice.extraTaxes || [], dueDateReason: '', roundOff: invoice.roundOff !== 0 || config.roundOff })
    } else {
      setF({ customerId: '', contactId: '', dealId: '', projectId: '', contractId: '', issueDate: today, dueDate: dueDateFrom('', today, config.defaultTermsDays), paymentTerms: `Net ${config.defaultTermsDays} days`, billingAddress: '', shippingAddress: '', gstin: '', taxType: 'intra', extraTaxes: config.extraTaxes, items: [blankLine()], notes: '', terms: config.terms, ownerId: '', roundOff: config.roundOff })
      setOrderId(preset?.salesOrderId || '')
      setMode('order')
      eligibleOrders().then((l) => { setOrders(l); if (!l.length && perms.createManual) setMode('manual') }).catch(() => setOrders([]))
    }
  }, [open, invoice?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const get = (c) => api.get(`/${c}`, { params: { all: true } }).then((r) => r.data).catch(() => [])
    Promise.all(['customers', 'contacts', 'deals', 'projects', 'contracts'].map(get)).then(([customers, contacts, deals, projects, contracts]) => setRefs({ customers, contacts, deals, projects, contracts }))
  }, [open])

  const order = orders.find((o) => o.id === orderId)
  const customer = refs.customers.find((c) => c.id === (editing ? invoice?.customerId : f?.customerId))
  const companyId = editing ? invoice?.companyId : customer?.companyId
  const contacts = refs.contacts.filter((c) => c.companyId === companyId)
  const mine = (list) => list.filter((x) => x.customerId === customer?.id)
  const pickCustomer = (id) => {
    const c = refs.customers.find((x) => x.id === id)
    const co = c?.companyId
    const g = String(c?.gstin || '').toUpperCase()
    set({ customerId: id, contactId: '', dealId: '', projectId: '', contractId: '', billingAddress: c?.billingAddress || c?.address || '', shippingAddress: c?.shippingAddress || c?.billingAddress || '', gstin: g, taxType: inferTaxType(g) })
    void co
  }
  const setTerms = (v) => set({ paymentTerms: v, ...(termsToDays(v) !== null && f.issueDate ? { dueDate: dueDateFrom(v, f.issueDate, config.defaultTermsDays) } : {}) })

  const submit = async () => {
    setBusy(true); setError(''); setErrors({})
    try {
      let result
      if (editing) {
        const patch = draft
          ? { items: f.items, issueDate: f.issueDate, dueDate: f.dueDate, paymentTerms: f.paymentTerms, billingAddress: f.billingAddress, shippingAddress: f.shippingAddress, gstin: f.gstin, taxType: f.taxType, extraTaxes: f.extraTaxes, contactId: f.contactId || null, projectId: f.projectId || null, contractId: f.contractId || null, notes: f.notes, terms: f.terms, ownerId: f.ownerId, roundOff: f.roundOff }
          : { dueDate: f.dueDate, dueDateReason: f.dueDateReason, notes: f.notes, shippingAddress: f.shippingAddress, ownerId: f.ownerId, projectId: f.projectId || null, contractId: f.contractId || null }
        if (draft) { const e = validateInvoiceInput(f); if (Object.keys(e).length) { setErrors(e); setBusy(false); return } }
        result = await updateInvoice(invoice.id, patch)
        toast('Invoice updated.', { type: 'success' })
      } else if (mode === 'order') {
        if (!orderId) { setErrors({ order: 'Choose a confirmed sales order.' }); setBusy(false); return }
        const r = await createInvoiceFromOrder(orderId, { issueDate: f.issueDate, dueDate: f.dueDate, paymentTerms: f.paymentTerms, notes: f.notes })
        result = r.invoice
        toast(`Invoice ${result.number} created from ${order?.number}.`, { type: 'success' })
      } else {
        if (!f.customerId) { setErrors({ customerId: 'Choose a customer.' }); setBusy(false); return }
        const e = validateInvoiceInput(f)
        if (Object.keys(e).length) { setErrors(e); setBusy(false); return }
        result = await createManualInvoice({ ...f, contactId: f.contactId || null, dealId: f.dealId || null, projectId: f.projectId || null, contractId: f.contractId || null })
        toast(`Invoice ${result.number} created.`, { type: 'success' })
      }
      onSaved?.(result); onClose()
    } catch (e) { setErrors((x) => ({ ...x, ...invFields(e) })); setError(invErr(e)) } finally { setBusy(false) }
  }

  if (!open || !f) return null
  const light = editing && !draft
  const full = draft || (!editing && mode === 'manual')
  return (
    <Modal open onClose={onClose} size="xl" title={editing ? `Edit ${invoice.number}` : 'New invoice'} description={editing ? (draft ? 'A draft is fully editable until it is sent.' : 'This invoice has been sent — its financial content is final. Only the fields below can change.') : 'Invoices are raised from a confirmed sales order so nothing is re-typed.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>{editing ? 'Save changes' : 'Create invoice'}</Button></>}>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        {!editing && (
          <div className="flex gap-2" role="tablist" aria-label="How to create">
            <button type="button" role="tab" aria-selected={mode === 'order'} onClick={() => setMode('order')} className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', mode === 'order' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}><ClipboardList size={13} />From a sales order ({orders.length})</button>
            {perms.createManual && <button type="button" role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')} className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium', mode === 'manual' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}><PenLine size={13} />Without an order</button>}
          </div>
        )}

        {!editing && mode === 'order' && (
          <>
            <FormField label="Confirmed sales order" required error={errors.order} hint={!orders.length ? 'No confirmed order is waiting for an invoice.' : undefined}>
              <Select aria-label="Sales order" value={orderId} onChange={(e) => { setOrderId(e.target.value); const o = orders.find((x) => x.id === e.target.value); if (o) setTerms(o.paymentTerms || f.paymentTerms) }}>
                <option value="">Choose…</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.customerName}{o.amount !== null ? ` · ${formatCurrency(o.amount)}` : ''}</option>)}
              </Select>
            </FormField>
            {order && (
              <div className="grid gap-2 rounded-xl bg-ink-50 p-4 text-sm sm:grid-cols-2 dark:bg-ink-800/40">
                <p className="sm:col-span-2 flex items-start gap-2 text-xs text-ink-500"><Info size={13} className="mt-0.5 shrink-0" />Copied from the order: customer, company, contact, deal, quotation, products, quantities, prices, discounts, tax, billing &amp; service address, GSTIN, payment terms, owner and project.</p>
                <p><span className="text-ink-400">Customer</span> <b>{order.customerName}</b></p><p><span className="text-ink-400">Deal</span> <b>{order.dealName || '—'}</b></p>
                <p><span className="text-ink-400">Order date</span> <b>{formatDate(order.orderDate)}</b></p><p><span className="text-ink-400">Order total</span> <b>{order.amount !== null ? formatCurrency(order.amount) : '—'}</b></p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Invoice date" required error={errors.issueDate}><Input type="date" value={f.issueDate} max={todayKey()} onChange={(e) => set({ issueDate: e.target.value, dueDate: dueDateFrom(f.paymentTerms, e.target.value, config.defaultTermsDays) })} /></FormField>
              <FormField label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => setTerms(e.target.value)} /></FormField>
              <FormField label="Due date" required error={errors.dueDate} hint="Follows the payment terms."><Input type="date" min={f.issueDate} value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></FormField>
            </div>
            <FormField label="Note on the invoice (optional)"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[60px]" /></FormField>
          </>
        )}

        {full && (
          <>
            {!editing && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Customer" required error={errors.customerId}><Select aria-label="Customer" value={f.customerId} onChange={(e) => pickCustomer(e.target.value)}><option value="">Choose…</option>{refs.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
                <FormField label="Contact" error={errors.contactId}><Select aria-label="Contact" value={f.contactId} onChange={(e) => set({ contactId: e.target.value })}><option value="">None</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
                <FormField label="Deal" error={errors.dealId}><Select aria-label="Deal" value={f.dealId} onChange={(e) => set({ dealId: e.target.value })}><option value="">None</option>{mine(refs.deals).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FormField>
                <FormField label="Owner"><Select aria-label="Owner" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}><option value="">Me</option>{USERS.filter((u) => u.status === 'Active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Invoice date" required error={errors.issueDate}><Input type="date" value={f.issueDate} max={todayKey()} onChange={(e) => set({ issueDate: e.target.value, dueDate: dueDateFrom(f.paymentTerms, e.target.value, config.defaultTermsDays) })} /></FormField>
              <FormField label="Payment terms"><Input value={f.paymentTerms} onChange={(e) => setTerms(e.target.value)} /></FormField>
              <FormField label="Due date" required error={errors.dueDate}><Input type="date" min={f.issueDate} value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></FormField>
              <FormField label="Billing address" required error={errors.billingAddress} className="sm:col-span-2"><Textarea value={f.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} className="min-h-[60px]" /></FormField>
              <FormField label="GSTIN" error={errors.gstin}><Input value={f.gstin} onChange={(e) => { const g = e.target.value.toUpperCase(); set({ gstin: g, taxType: g.length === 15 ? inferTaxType(g) : f.taxType }) }} placeholder="29AABCT1332L1ZV" /></FormField>
              <FormField label="Shipping / service address" className="sm:col-span-2"><Textarea value={f.shippingAddress} onChange={(e) => set({ shippingAddress: e.target.value })} className="min-h-[60px]" /></FormField>
              <FormField label="Tax type" hint="IGST when the customer is in another state."><Select value={f.taxType} onChange={(e) => set({ taxType: e.target.value })}><option value="intra">Intra-state (CGST + SGST)</option><option value="inter">Inter-state (IGST)</option></Select></FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Project"><Select aria-label="Project" value={f.projectId || ''} onChange={(e) => set({ projectId: e.target.value })}><option value="">None</option>{mine(refs.projects).map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}</Select></FormField>
              <FormField label="Contract"><Select aria-label="Contract" value={f.contractId || ''} onChange={(e) => set({ contractId: e.target.value })}><option value="">None</option>{mine(refs.contracts).map((c) => <option key={c.id} value={c.id}>{c.number} · {c.title}</option>)}</Select></FormField>
            </div>
            <InvoiceItemsEditor items={f.items} onChange={(items) => set({ items })} taxType={f.taxType} extraTaxes={f.extraTaxes} roundOff={f.roundOff} errors={errors} />
            <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Other taxes (optional)</p><Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ extraTaxes: [...f.extraTaxes, { name: '', rate: '' }] })}>Add tax</Button></div>
              {f.extraTaxes.map((t, i) => (
                <div key={i} className="flex gap-2"><Input aria-label={`Other tax ${i + 1} name`} className="max-w-[12rem]" placeholder="e.g. Cess" value={t.name} error={errors[`tax-${i}-name`]} onChange={(e) => set({ extraTaxes: f.extraTaxes.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} /><Input aria-label={`Other tax ${i + 1} rate`} className="max-w-[7rem]" type="number" placeholder="%" value={t.rate} error={errors[`tax-${i}-rate`]} onChange={(e) => set({ extraTaxes: f.extraTaxes.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)) })} /><Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove other tax ${i + 1}`} onClick={() => set({ extraTaxes: f.extraTaxes.filter((_, k) => k !== i) })} /></div>
              ))}
              <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={!!f.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} />Round the grand total to the nearest rupee</label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2"><FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[70px]" /></FormField><FormField label="Terms & conditions"><Textarea value={f.terms} onChange={(e) => set({ terms: e.target.value })} className="min-h-[70px]" /></FormField></div>
          </>
        )}

        {light && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Due date" error={errors.dueDate}><Input type="date" min={invoice.issueDate} value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></FormField>
            <FormField label="Reason for changing the due date" error={errors.dueDateReason} hint={f.dueDate !== invoice.dueDate ? 'Required — recorded on the timeline.' : 'Only needed if you change the date.'}><Input value={f.dueDateReason} onChange={(e) => set({ dueDateReason: e.target.value })} /></FormField>
            <FormField label="Owner"><Select value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>{USERS.filter((u) => u.status === 'Active' || u.id === f.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Shipping / service address"><Input value={f.shippingAddress || ''} onChange={(e) => set({ shippingAddress: e.target.value })} /></FormField>
            <FormField label="Project"><Select value={f.projectId || ''} onChange={(e) => set({ projectId: e.target.value })}><option value="">None</option>{mine(refs.projects).map((p) => <option key={p.id} value={p.id}>{p.id} · {p.name}</option>)}</Select></FormField>
            <FormField label="Contract"><Select value={f.contractId || ''} onChange={(e) => set({ contractId: e.target.value })}><option value="">None</option>{mine(refs.contracts).map((c) => <option key={c.id} value={c.id}>{c.number} · {c.title}</option>)}</Select></FormField>
            <FormField label="Notes" className="sm:col-span-2"><Textarea value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} className="min-h-[70px]" /></FormField>
          </div>
        )}
      </div>
    </Modal>
  )
}
