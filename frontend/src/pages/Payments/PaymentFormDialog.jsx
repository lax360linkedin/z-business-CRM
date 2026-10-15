import { useEffect, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { formatCurrency } from '../../utils/format'
import { todayKey, round2 } from '../../utils/invoiceRules'
import { createPayment, usePaymentConfig, payErr, payFields } from './paymentClient'

/**
 * Record a payment against an invoice. Everything the invoice already knows (customer, company, contact, order, deal, project, totals, what has been paid)
 * is shown, not asked for. Only what is new is entered: amount, date, method, reference, account, status, receiver and notes.
 */
export function RecordPaymentModal({ open, onClose, invoice, onRecorded }) {
  const { toast } = useToast()
  const { methods, accounts, me } = usePaymentConfig()
  const balance = invoice ? round2(Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0))) : 0
  const [f, setF] = useState({ amount: '', date: todayKey(), method: '', reference: '', bankAccount: '', status: 'Completed', receivedBy: '', notes: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [dup, setDup] = useState(false)
  const [confirmDup, setConfirmDup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { if (open) { setF({ amount: String(balance), date: todayKey(), method: methods[0] || '', reference: '', bankAccount: '', status: 'Completed', receivedBy: me?.id || '', notes: '' }); setErrors({}); setError(''); setDup(false); setConfirmDup(false); setRequestId(`REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`) } }, [open, invoice?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !f.method && methods.length) set({ method: methods[0] }) }, [methods, open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !invoice) return null
  const amt = Number(f.amount) || 0
  const remaining = f.status === 'Failed' ? balance : round2(balance - amt)
  const save = () => {
    if (busy) return
    const e = {}
    if (!(amt > 0)) e.amount = 'Enter an amount greater than zero.'
    else if (f.status !== 'Failed' && amt > balance + 0.005) e.amount = `Cannot exceed the balance due (${formatCurrency(balance)}).`
    if (!f.date || f.date > todayKey()) e.date = 'Date cannot be in the future.'
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true); setError('')
    createPayment(invoice.id, { ...f, amount: amt, requestId, confirmDuplicate: confirmDup }).then((r) => { toast(`Payment ${r.payment.number} ${f.status === 'Completed' ? 'recorded' : `saved as ${f.status}`}.`, { type: 'success' }); onRecorded?.(r); onClose() })
      .catch((err) => { const fl = payFields(err); setErrors((x) => ({ ...x, ...fl })); setDup(!!fl.duplicate); setError(payErr(err)) }).finally(() => setBusy(false))
  }
  const chips = [['Customer', invoice.customerName], ['Company', invoice.companyName], ['Contact', invoice.contactName], ['Sales order', invoice.salesOrderNumber], ['Deal', invoice.dealName], ['Project', invoice.projectName]].filter(([, v]) => v)
  return (
    <Modal open onClose={onClose} size="lg" title="Record payment" description={`${invoice.number} · balance due ${formatCurrency(balance)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={dup && !confirmDup}>{f.status === 'Completed' ? 'Record payment' : `Save as ${f.status}`}</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-800/50">
          <div className="flex flex-wrap gap-x-5 gap-y-1">{chips.map(([k, v]) => <span key={k}><span className="text-ink-400">{k}</span> <b className="text-ink-700 dark:text-ink-200">{v}</b></span>)}</div>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><dt className="text-ink-400">Invoice total</dt><dd className="font-semibold">{formatCurrency(invoice.amount)}</dd></div><div><dt className="text-ink-400">Previously paid</dt><dd className="font-semibold">{formatCurrency(invoice.paidAmount)}</dd></div>
            <div><dt className="text-ink-400">This payment</dt><dd className="font-semibold text-brand-600">{formatCurrency(f.status === 'Failed' ? 0 : amt)}</dd></div><div><dt className="text-ink-400">Remaining balance</dt><dd className="font-semibold">{formatCurrency(Math.max(0, remaining))}</dd></div>
          </dl>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        {dup && <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />This is a genuine second payment with the same amount, date and method.</label>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Amount (₹)" required error={errors.amount}><Input aria-label="Amount" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} error={!!errors.amount} /></FormField>
          <FormField label="Payment date" required error={errors.date}><Input aria-label="Payment date" type="date" max={todayKey()} value={f.date} onChange={(e) => set({ date: e.target.value })} error={!!errors.date} /></FormField>
          <FormField label="Payment method" required error={errors.method}><Select aria-label="Payment method" value={f.method} onChange={(e) => set({ method: e.target.value })}>{methods.map((m) => <option key={m}>{m}</option>)}</Select></FormField>
          <FormField label="Transaction / reference no." error={errors.reference} hint="UTR, cheque or card reference — generated for completed payments if left blank."><Input aria-label="Reference" value={f.reference} onChange={(e) => set({ reference: e.target.value })} error={!!errors.reference} /></FormField>
          <FormField label="Bank / account"><Select aria-label="Bank account" value={f.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })}><option value="">Not specified</option>{accounts.map((a) => <option key={a}>{a}</option>)}</Select></FormField>
          <FormField label="Status" hint="Pending (e.g. a cheque not yet cleared) does not count until completed."><Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}><option>Completed</option><option>Pending</option><option>Failed</option></Select></FormField>
          <FormField label="Received by"><Select aria-label="Received by" value={f.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })}>{USERS.filter((u) => u.status === 'Active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[40px]" /></FormField>
        </div>
        <p className="text-xs text-ink-400">Payment proof (screenshot, cheque copy, receipt) can be uploaded on the payment page right after recording.</p>
      </div>
    </Modal>
  )
}
