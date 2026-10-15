import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { USERS } from '../../data/users'
import { EXPENSE_KINDS, TAX_RATES, computeExpense, todayKey } from '../../utils/expenseRules'
import { formatCurrency } from '../../utils/format'
import { createExpense, updateExpense, expenseAction, useExpenseConfig, useVendors, saveVendor, expErr, expFields } from './expenseClient'

const blank = () => ({ kind: 'Vendor', date: todayKey(), categoryId: '', description: '', amount: '', taxRate: 18, paymentMethod: '', vendorId: '', vendorBillNumber: '', vendorBillDate: '', dueDate: '', employeeId: '', projectId: '', customerId: '', dealId: '', invoiceId: '', campaignId: '', paymentReference: '', notes: '' })
const opt = (list, label) => list.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)

/** Create or edit an expense. Linked records are chosen, never retyped; the server fills the rest of the chain (project → customer, deal → company …) and recomputes every figure. */
export function ExpenseFormDialog({ open, onClose, expense = null, preset = null, onSaved }) {
  const { toast } = useToast()
  const { categories, methods, perms, user } = useExpenseConfig()
  const { vendors, reload: reloadVendors } = useVendors()
  const [f, setF] = useState(blank)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dup, setDup] = useState(false)
  const [confirmDup, setConfirmDup] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [lists, setLists] = useState({ projects: [], customers: [], deals: [], invoices: [], campaigns: [] })
  const [newVendor, setNewVendor] = useState(null)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setDup(false); setConfirmDup(false); setNewVendor(null)
    setRequestId(`REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`)
    setF(expense ? { ...blank(), ...Object.fromEntries(Object.keys(blank()).map((k) => [k, expense[k] ?? ''])), amount: expense.amount ?? '', taxRate: expense.taxRate ?? 0 } : { ...blank(), ...(preset || {}), employeeId: preset?.employeeId || '' })
    Promise.all([api.get('/projects', { params: { all: true } }), api.get('/customers', { params: { all: true } }), api.get('/deals', { params: { all: true } }), api.get('/invoices', { params: { all: true } }), api.get('/campaigns', { params: { all: true } }).catch(() => ({ data: [] }))])
      .then(([p, c, d, i, m]) => setLists({ projects: p.data, customers: c.data, deals: d.data, invoices: i.data, campaigns: m.data })).catch(() => {})
  }, [open, expense?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeCats = useMemo(() => categories.filter((c) => c.active || c.id === expense?.categoryId), [categories, expense])
  if (!open) return null
  const editAll = !expense || expense.perms?.editAll
  const limited = expense && !editAll
  const calc = computeExpense(f.amount, f.taxRate)
  const activeVendors = (vendors || []).filter((v) => v.active || v.id === expense?.vendorId)
  const emp = f.kind === 'Employee'

  const payload = () => {
    if (limited) return { categoryId: f.categoryId, projectId: f.projectId || null, customerId: f.customerId || null, dealId: f.dealId || null, invoiceId: f.invoiceId || null, notes: f.notes, reason: f.reason }
    const out = { ...f, amount: Number(f.amount), taxRate: Number(f.taxRate), vendorId: f.kind === 'Vendor' ? f.vendorId : null, employeeId: f.kind === 'Employee' ? f.employeeId || user?.id : f.employeeId || null }
    ;['projectId', 'customerId', 'dealId', 'invoiceId', 'campaignId'].forEach((k) => { out[k] = f[k] || null })
    return out
  }
  const save = (thenSubmit = false) => {
    if (busy) return
    setBusy(true); setError(''); setErrors({})
    const run = expense ? updateExpense(expense.id, payload()) : createExpense({ ...payload(), requestId, confirmDuplicate: confirmDup })
    run.then(async (saved) => {
      if (!thenSubmit) { toast(expense ? 'Expense updated.' : `Expense ${saved.number} saved as a draft.`, { type: 'success' }); onSaved?.(saved); onClose(); return }
      try { const sub = await expenseAction(saved.id, 'submit'); toast(`Expense ${sub.number} submitted for approval.`, { type: 'success' }); onSaved?.(sub); onClose() } catch (e) { toast(`Saved as ${saved.number}, but it could not be submitted: ${expErr(e)}`, { type: 'error' }); onSaved?.(saved); onClose() }
    }).catch((e) => { const fl = expFields(e); setErrors(fl); setDup(!!fl.duplicate); setError(expErr(e)) }).finally(() => setBusy(false))
  }
  const addVendor = () => saveVendor(null, newVendor).then((v) => { reloadVendors(); set({ vendorId: v.id }); setNewVendor(null); toast(`Vendor ${v.name} added.`, { type: 'success' }) }).catch((e) => setErrors((x) => ({ ...x, newVendor: expErr(e) })))

  return (
    <Modal open onClose={onClose} size="xl" title={expense ? `Edit ${expense.number}` : 'New expense'} description={limited ? 'This expense is approved — amounts, dates, vendor and employee are final. You can correct its category and linked records, with a reason.' : 'Money the business spends. Customer payments (revenue) are recorded on invoices, not here.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="secondary" loading={busy} onClick={() => save(false)} disabled={dup && !confirmDup}>{expense ? 'Save changes' : 'Save draft'}</Button>{(!expense || expense.status === 'Draft') && perms.create && <Button loading={busy} onClick={() => save(true)} disabled={dup && !confirmDup}>Save & submit</Button>}</>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        {dup && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />This is a genuine second expense with the same date, amount and payee.</label>}
        {editAll && (
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3" role="radiogroup" aria-label="Expense type">
            {EXPENSE_KINDS.map((k) => <button key={k.value} type="button" role="radio" aria-checked={f.kind === k.value} disabled={!!expense && expense.kind !== k.value && false} onClick={() => set({ kind: k.value })} className={`rounded-xl border px-3 py-2 text-left text-sm ${f.kind === k.value ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'}`}><b className="block">{k.label}</b><span className="text-[11px] opacity-80">{k.help}</span></button>)}
          </div>
        )}
        {editAll && <>
          <FormField label="Expense date" required error={errors.date}><Input aria-label="Expense date" type="date" max={todayKey()} value={f.date} onChange={(e) => set({ date: e.target.value })} error={!!errors.date} /></FormField>
          <FormField label="Category" required error={errors.categoryId}><Select aria-label="Category" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })} error={!!errors.categoryId}><option value="">Select a category</option>{opt(activeCats, (c) => c.name)}</Select></FormField>
          <FormField label="Description" required error={errors.description} className="sm:col-span-2"><Input aria-label="Description" value={f.description} onChange={(e) => set({ description: e.target.value })} error={!!errors.description} placeholder="What was this for?" /></FormField>
          <FormField label="Amount (before tax)" required error={errors.amount}><Input aria-label="Amount" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} error={!!errors.amount} /></FormField>
          <FormField label="Tax" error={errors.taxRate}><Select aria-label="Tax rate" value={f.taxRate} onChange={(e) => set({ taxRate: e.target.value })}>{TAX_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'No tax' : `GST ${r}%`}</option>)}</Select></FormField>
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm sm:col-span-2 dark:bg-ink-800/50"><div className="flex justify-between"><span className="text-ink-500">Amount</span><span>{formatCurrency(calc.amount)}</span></div><div className="flex justify-between"><span className="text-ink-500">Tax ({calc.taxRate}%)</span><span>{formatCurrency(calc.tax)}</span></div><div className="flex justify-between border-t border-ink-200 pt-1 font-semibold dark:border-ink-700"><span>Total</span><span aria-label="Total amount">{formatCurrency(calc.total)}</span></div></div>
          <FormField label="Payment method" error={errors.paymentMethod} hint={emp ? 'How the employee paid.' : 'How it is or will be paid.'}><Select aria-label="Payment method" value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}><option value="">Not specified</option>{methods.map((m) => <option key={m}>{m}</option>)}</Select></FormField>
          <FormField label="Paid by"><Input aria-label="Paid by" value={emp ? 'Employee (personal funds)' : 'Company'} readOnly /></FormField>
          {f.kind === 'Vendor' && <>
            <FormField label="Vendor" required error={errors.vendorId}>
              <div className="flex gap-2"><Select aria-label="Vendor" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} error={!!errors.vendorId}><option value="">Select a vendor</option>{opt(activeVendors, (v) => v.name)}</Select>{perms.manageVendors && <Button variant="secondary" size="sm" onClick={() => setNewVendor({ name: '' })}>New</Button>}</div>
              {newVendor && <div className="mt-2 flex gap-2"><Input aria-label="New vendor name" placeholder="Vendor name" value={newVendor.name} onChange={(e) => setNewVendor({ name: e.target.value })} /><Button size="sm" onClick={addVendor}>Add</Button></div>}{errors.newVendor && <p className="text-xs text-rose-500">{errors.newVendor}</p>}
            </FormField>
            <FormField label="Vendor bill / invoice no." required error={errors.vendorBillNumber}><Input aria-label="Vendor bill number" value={f.vendorBillNumber} onChange={(e) => set({ vendorBillNumber: e.target.value })} error={!!errors.vendorBillNumber} /></FormField>
            <FormField label="Bill date" error={errors.vendorBillDate}><Input aria-label="Bill date" type="date" max={todayKey()} value={f.vendorBillDate || ''} onChange={(e) => set({ vendorBillDate: e.target.value })} /></FormField>
            <FormField label="Payment due date" error={errors.dueDate}><Input aria-label="Due date" type="date" value={f.dueDate || ''} onChange={(e) => set({ dueDate: e.target.value })} error={!!errors.dueDate} /></FormField>
          </>}
          {(f.kind === 'Employee' || f.kind === 'Company') && (
            <FormField label={emp ? 'Employee' : 'Incurred by (optional)'} error={errors.employeeId}><Select aria-label="Employee" value={f.employeeId || (emp ? user?.id || '' : '')} onChange={(e) => set({ employeeId: e.target.value })}>{!emp && <option value="">Not applicable</option>}{USERS.filter((u) => u.status !== 'Inactive').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          )}
          <FormField label="Payment reference" hint="Card / UPI / cheque reference of the original payment, if any."><Input aria-label="Payment reference" value={f.paymentReference} onChange={(e) => set({ paymentReference: e.target.value })} /></FormField>
        </>}
        <div className="sm:col-span-2"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Link to CRM records (optional)</p></div>
        {limited && <FormField label="Category" error={errors.categoryId}><Select aria-label="Category" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{opt(activeCats, (c) => c.name)}</Select></FormField>}
        <FormField label="Project" error={errors.projectId} hint="Customer is filled from the project."><Select aria-label="Project" value={f.projectId || ''} onChange={(e) => set({ projectId: e.target.value })}><option value="">None</option>{opt(lists.projects, (p) => p.name)}</Select></FormField>
        <FormField label="Customer" error={errors.customerId}><Select aria-label="Customer" value={f.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">None</option>{opt(lists.customers, (c) => c.name)}</Select></FormField>
        <FormField label="Deal" error={errors.dealId}><Select aria-label="Deal" value={f.dealId || ''} onChange={(e) => set({ dealId: e.target.value })}><option value="">None</option>{opt(lists.deals, (d) => d.name)}</Select></FormField>
        <FormField label="Customer invoice" error={errors.invoiceId} hint="Only to relate a cost to a billed job — it never changes the invoice."><Select aria-label="Invoice" value={f.invoiceId || ''} onChange={(e) => set({ invoiceId: e.target.value })}><option value="">None</option>{opt(lists.invoices, (i) => `${i.number} · ${i.customerName}`)}</Select></FormField>
        <FormField label="Marketing campaign" error={errors.campaignId} hint="Counts as that campaign’s actual spend once approved."><Select aria-label="Campaign" value={f.campaignId || ''} onChange={(e) => set({ campaignId: e.target.value })}><option value="">None</option>{opt(lists.campaigns, (c) => `${c.number} · ${c.name}`)}</Select></FormField>
        {limited && <FormField label="Reason for the change" required error={errors.reason} className="sm:col-span-2"><Input aria-label="Reason" value={f.reason || ''} onChange={(e) => set({ reason: e.target.value })} /></FormField>}
        <FormField label="Notes" className="sm:col-span-2"><Textarea aria-label="Notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[60px]" /></FormField>
        <p className="text-xs text-ink-400 sm:col-span-2">Bills and receipts are attached on the expense page after saving. A receipt is required to submit larger expenses.</p>
      </div>
    </Modal>
  )
}
