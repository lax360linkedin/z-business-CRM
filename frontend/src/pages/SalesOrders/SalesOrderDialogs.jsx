import { useEffect, useRef, useState } from 'react'
import { AlertCircle, UploadCloud } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { salesUsers } from '../../data/users'
import { FOLLOWUP_TYPES } from '../../data/constants'
import { formatCurrency } from '../../utils/format'
import { sha256Hex, formatBytes } from '../../utils/quotationAttachmentRules'
import { SO_TRANSITIONS } from '../../utils/salesOrderCalc'
import {
  changeSalesOrderStatus, recordFulfilment, addSalesOrderNote, addSalesOrderFollowUp, attachSalesOrderDocument,
  createInvoiceFromOrder, recordInvoicePayment, soError, soFieldErrors, fileToDataUrl,
} from './salesOrderClient'

function ErrorLine({ children }) {
  if (!children) return null
  return <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {children}</p>
}

const today = () => new Date().toISOString().slice(0, 10)

/** Change Status — only the moves the lifecycle allows from the current status; cancelling needs a reason. */
export function StatusDialog({ open, onClose, order, onChanged, onRecordFulfilment }) {
  const { toast } = useToast()
  const options = (SO_TRANSITIONS[order?.status] || []).filter((s) => s !== 'Partially Fulfilled')
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setStatus(options[0] || ''); setReason(''); setError('') } }, [open, order?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    setSaving(true); setError('')
    changeSalesOrderStatus(order.id, status, reason).then((o) => { toast(`Order is now ${o.status}.`, { type: 'success' }); onChanged(o); onClose() })
      .catch((e) => setError(soError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Change order status" description={`${order?.number} · currently ${order?.status}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={status === 'Cancelled' ? 'danger' : 'primary'} loading={saving} disabled={!status || (status === 'Cancelled' && !reason.trim())} onClick={save}>{status === 'Cancelled' ? 'Cancel order' : 'Update status'}</Button></>}>
      <div className="space-y-4">
        {!options.length ? <p className="text-sm text-ink-500">No further status changes are possible from {order?.status}.</p> : (
          <>
            <FormField label="New status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>{options.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            </FormField>
            {order?.status === 'Processing' && <p className="text-xs text-ink-400">Delivered part of the order? <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => { onClose(); onRecordFulfilment() }}>Record fulfilment quantities</button> instead.</p>}
            {status === 'Fulfilled' && <p className="text-xs text-ink-400">All lines will be marked fully delivered.</p>}
            {status === 'Cancelled' && <FormField label="Reason for cancelling" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this order being cancelled?" className="min-h-[80px]" /></FormField>}
          </>
        )}
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  )
}

export function FulfilmentDialog({ open, onClose, order, onChanged }) {
  const { toast } = useToast()
  const [qty, setQty] = useState([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open && order) { setQty(order.items.map((i) => i.fulfilledQty || 0)); setNote(''); setError('') } }, [open, order])
  const save = () => {
    setSaving(true); setError('')
    recordFulfilment(order.id, qty.map((q, index) => ({ index, fulfilledQty: Number(q) })), note).then((o) => { toast(`Fulfilment recorded — order is ${o.status}.`, { type: 'success' }); onChanged(o); onClose() })
      .catch((e) => setError(soError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Record fulfilment" description="Enter the total quantity delivered so far for each line." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save fulfilment</Button></>}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="w-28 px-3 py-2 text-right">Delivered</th></tr></thead>
            <tbody>
              {(order?.items || []).map((it, i) => (
                <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                  <td className="px-3 py-2 font-medium text-ink-800 dark:text-ink-100">{it.name}</td>
                  <td className="px-3 py-2 text-right text-ink-600 dark:text-ink-300">{it.qty}</td>
                  <td className="px-3 py-2"><Input type="number" min={it.fulfilledQty || 0} max={it.qty} value={qty[i] ?? 0} onChange={(e) => setQty((q) => q.map((v, j) => (j === i ? e.target.value : v)))} className="h-9 text-right text-xs" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FormField label="Delivery note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" /></FormField>
        <p className="text-xs text-ink-400">When every line is fully delivered the order becomes Fulfilled; otherwise it becomes Partially Fulfilled.</p>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  )
}

export function NoteDialog({ open, onClose, order, onSaved }) {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setText(''); setError('') } }, [open])
  const save = () => {
    setSaving(true); setError('')
    addSalesOrderNote(order.id, text).then(() => { toast('Note added.', { type: 'success' }); onSaved(); onClose() }).catch((e) => setError(soError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Add note" description={order?.number} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!text.trim()} onClick={save}>Add note</Button></>}>
      <div className="space-y-3">
        <FormField label="Note"><Textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} className="min-h-[110px]" autoFocus /></FormField>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  )
}

export function FollowUpDialog({ open, onClose, order, onSaved }) {
  const { toast } = useToast()
  const reps = salesUsers()
  const [f, setF] = useState({ type: 'Call', date: '', time: '', assignedTo: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setF({ type: 'Call', date: '', time: '', assignedTo: order?.salesperson || '', notes: '' }); setError('') } }, [open, order?.salesperson])
  const save = () => {
    setSaving(true); setError('')
    addSalesOrderFollowUp(order.id, f).then(() => { toast('Follow-up scheduled.', { type: 'success' }); onSaved(); onClose() }).catch((e) => setError(soError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Add follow-up" description={`Schedule the next touchpoint for ${order?.number}.`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!f.date} onClick={save}>Schedule</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{FOLLOWUP_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
        <FormField label="Assigned to"><Select value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
        <FormField label="Date" required><DateInput value={f.date} min={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="Time"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></FormField>
        <div className="col-span-2"><FormField label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-[70px]" /></FormField></div>
        <div className="col-span-2"><ErrorLine>{error}</ErrorLine></div>
      </div>
    </Modal>
  )
}

export const DOC_CATEGORIES = ['Purchase Order', 'Contract', 'Delivery Note', 'Other']

/** Reusable document-attach dialog (Sales Orders by default; Proposals pass their own uploadFn/categories). */
export function DocumentDialog({ open, onClose, order, onSaved, uploadFn, categories = DOC_CATEGORIES }) {
  const { toast } = useToast()
  const inputRef = useRef(null)
  const [category, setCategory] = useState(categories[0])
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setFile(null); setError(''); setCategory(categories[0]) } }, [open])

  const pick = (f) => {
    setError('')
    if (!f) return
    if (!/\.(pdf|docx?|xlsx|png|jpe?g)$/i.test(f.name)) { setFile(null); setError('Only PDF, Word, Excel (.xlsx), PNG and JPG files can be attached.'); return }
    if (f.size === 0) { setFile(null); setError('The file is empty.'); return }
    if (f.size > 2 * 1024 * 1024) { setFile(null); setError(`The file is too large (${formatBytes(f.size)}). The maximum is 2 MB.`); return }
    setFile(f)
  }
  const save = async () => {
    setSaving(true); setError('')
    try {
      const buffer = await file.arrayBuffer()
      const hash = await sha256Hex(buffer)
      const dataUrl = await fileToDataUrl(file)
      const payload = { fileName: file.name, mimeType: file.type, dataUrl, hash, category }
      await (uploadFn ? uploadFn(payload) : attachSalesOrderDocument(order.id, payload))
      toast('Document attached.', { type: 'success' }); onSaved(); onClose()
    } catch (e) { setError(soError(e)) } finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Attach document" description={`Stored with ${order?.number}. PDF, Word, Excel, PNG or JPG, up to 2 MB.`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!file} onClick={save}>Attach</Button></>}>
      <div className="space-y-4">
        <FormField label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</Select></FormField>
        <div onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click() }} className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-ink-200 px-4 py-5 hover:border-brand-400 dark:border-ink-700">
          <UploadCloud size={22} className="text-ink-400" />
          <div className="min-w-0"><p className="truncate text-sm font-medium text-ink-700 dark:text-ink-200">{file ? file.name : 'Choose a file'}</p><p className="text-xs text-ink-400">{file ? formatBytes(file.size) : 'Click to browse'}</p></div>
          <input ref={inputRef} data-testid="so-doc-input" type="file" accept=".pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  )
}

/** Create Invoice — the invoice is built server-side from the order; the user only picks dates. */
export function InvoiceDialog({ open, onClose, order, onCreated }) {
  const { toast } = useToast()
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setIssueDate(today()); setDueDate(new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)); setError('') } }, [open])
  const save = () => {
    if (saving) return
    setSaving(true); setError('')
    createInvoiceFromOrder(order.id, { issueDate, dueDate }).then((r) => { toast(`Invoice ${r.invoice.number} created from ${order.number}.`, { type: 'success' }); onCreated(r) })
      .catch((e) => setError(soError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Create invoice" description={`Invoice for ${formatCurrency(order?.amount || 0)} from ${order?.number}`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Create invoice</Button></>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-xs text-ink-500 dark:bg-ink-800/50 dark:text-ink-400">Customer, contact, company, lines, quantities, prices, discounts and taxes are copied from the order — nothing is re-entered. One invoice per order.</p>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Issue date" required><DateInput value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></FormField>
          <FormField label="Due date" required><DateInput value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} /></FormField>
        </div>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  )
}

/** Record Payment against an invoice — validated server-side (amount ≤ balance, date not in the future, idempotent per dialog). */
export { RecordPaymentModal } from '../Payments/PaymentFormDialog'
