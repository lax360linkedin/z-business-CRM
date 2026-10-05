import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { emitProductsChanged } from '../../hooks/useProducts'
import {
  PRODUCT_CATEGORIES, PRODUCT_TYPES, PRODUCT_UNITS, BILLING_CYCLES, PRODUCT_STATUSES, TAX_RATES,
  blankProduct, generateProductCode, validateProduct, normalizeProductInput, nextProductId,
} from '../../utils/productRules'
import { formatCurrency } from '../../utils/format'

const errText = (e) => e?.response?.data?.message || e?.message || 'Could not save the product.'

/**
 * Create / edit / duplicate a catalog item. `product` = edit; `template` = prefill for a new one (duplicate).
 * Validation runs against the live catalog, so a duplicate name or item code is caught before it is saved.
 */
export function ProductFormDialog({ open, onClose, product, template, products, onSaved }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const editing = !!product
  const others = useMemo(() => products.filter((p) => p.id !== product?.id), [products, product?.id])
  const [f, setF] = useState(() => blankProduct(products))
  const [codeTouched, setCodeTouched] = useState(false)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setCodeTouched(editing || !!template)
    if (editing) setF({ ...blankProduct(products), ...product })
    else if (template) setF({ ...blankProduct(products), ...template, code: generateProductCode(template.category, products) })
    else setF(blankProduct(products))
  }, [open, product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onCategory = (category) => set({ category, ...(codeTouched ? {} : { code: generateProductCode(category, others) }) })
  const price = Number(f.price) || 0
  const net = price * (1 - (Number(f.defaultDiscount) || 0) / 100)
  const withTax = net * (1 + (Number(f.taxRate) || 0) / 100)

  const submit = () => {
    const e = validateProduct(f, others)
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({}); setError(''); setSaving(true)
    const data = normalizeProductInput(f)
    const now = new Date().toISOString()
    let req
    if (editing) {
      const priceChanged = Number(product.price) !== data.price
      req = api.put(`/products/${product.id}`, {
        ...data, updatedAt: now,
        ...(priceChanged ? { priceHistory: [...(product.priceHistory || []), { price: data.price, at: now, by: user?.id || null, note: `Changed from ${formatCurrency(product.price)}` }] } : {}),
      })
    } else {
      req = api.post('/products', { id: nextProductId(products), ...data, createdAt: now, updatedAt: now, priceHistory: [{ price: data.price, at: now, by: user?.id || null, note: 'Opening price' }] })
    }
    req.then((r) => { toast(editing ? 'Product updated. New quotations and orders will use the new details; existing documents keep theirs.' : `“${data.name}” added to the catalog.`, { type: 'success' }); emitProductsChanged(); onSaved?.(r.data); onClose() })
      .catch((err) => setError(errText(err))).finally(() => setSaving(false))
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${product.name}` : template ? 'Duplicate product / service' : 'Add product / service'}
      description={editing ? 'Existing quotations, orders and invoices keep the details they were issued with.' : 'Everything entered here fills automatically wherever this item is selected.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Create'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Name" required error={errors.name} className="sm:col-span-2"><Input autoFocus value={f.name} error={errors.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Web Application Development" maxLength={120} /></FormField>
          <FormField label="Item code" required error={errors.code} hint="Unique SKU shown on documents."><Input value={f.code} error={errors.code} onChange={(e) => { setCodeTouched(true); set({ code: e.target.value.toUpperCase() }) }} className="font-mono" /></FormField>
          <FormField label="Category" required error={errors.category}><Select value={f.category} onChange={(e) => onCategory(e.target.value)}>{PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
          <FormField label="Type" required error={errors.type}><Select value={f.type} onChange={(e) => set({ type: e.target.value })}>{PRODUCT_TYPES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
          <FormField label="Status" required><Select value={f.status} onChange={(e) => set({ status: e.target.value })}>{PRODUCT_STATUSES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
        </div>
        <FormField label="Description" error={errors.description} hint="Copied onto quotations, proposals and orders; editable there."><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[72px]" /></FormField>
        <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Pricing</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Standard price (₹)" required error={errors.price}><Input type="number" min="0" step="0.01" value={f.price} error={errors.price} onChange={(e) => set({ price: e.target.value })} /></FormField>
            <FormField label="Unit of sale" required error={errors.unit}><Select value={f.unit} onChange={(e) => set({ unit: e.target.value })}>{PRODUCT_UNITS.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
            <FormField label="Billing cycle" required error={errors.billingCycle}><Select value={f.billingCycle} onChange={(e) => set({ billingCycle: e.target.value })}>{BILLING_CYCLES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
            <FormField label="Default discount (%)" error={errors.defaultDiscount} hint="Pre-filled on new lines; editable per line."><Input type="number" min="0" max="100" step="0.5" value={f.defaultDiscount} error={errors.defaultDiscount} onChange={(e) => set({ defaultDiscount: e.target.value })} /></FormField>
            <FormField label="Tax rate (GST %)" required error={errors.taxRate}><Select value={f.taxRate} onChange={(e) => set({ taxRate: Number(e.target.value) })}>{TAX_RATES.map((t) => <option key={t} value={t}>{t}%</option>)}</Select></FormField>
            <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">
              <p>After discount: <b>{formatCurrency(net)}</b></p>
              <p>With {f.taxRate}% tax: <b>{formatCurrency(withTax)}</b></p>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}
