import { useEffect, useRef, useState } from 'react'
import { Mail, Printer, Download, Loader2, FileWarning } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { formatCurrency } from '../../utils/format'
import { uploadDocument } from '../Documents/documentClient'
import { buildInvoicePdf } from './invoicePdf'
import { sendInvoice, cancelInvoice, voidInvoice, useInvoiceConfig, downloadBlob, invErr, invFields } from './invoiceClient'

/** The invoice as a PDF blob (built in the browser from the stored record). */
export async function invoicePdfBlob(invoice, config) {
  const bytes = await buildInvoicePdf({ invoice, config, payments: invoice.payments || [] })
  return new Blob([bytes], { type: 'application/pdf' })
}
export const invoiceFileName = (invoice) => `${invoice.number}.pdf`

// ---- preview / print ------------------------------------------------------------------------------------------------
export function PdfPreviewDialog({ invoice, onClose }) {
  const { config } = useInvoiceConfig()
  const [state, setState] = useState({ loading: true, url: '', error: '' })
  const urlRef = useRef('')
  const frame = useRef(null)
  useEffect(() => {
    if (!invoice) return undefined
    let dead = false
    setState({ loading: true, url: '', error: '' })
    invoicePdfBlob(invoice, config).then((blob) => { if (dead) return; if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = URL.createObjectURL(blob); setState({ loading: false, url: urlRef.current, error: '' }) }).catch(() => !dead && setState({ loading: false, url: '', error: 'The PDF could not be generated.' }))
    return () => { dead = true }
  }, [invoice?.id, invoice?.updatedAt, config]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  if (!invoice) return null
  return (
    <Modal open onClose={onClose} size="xl" title={`${invoice.number} — preview`} description="Exactly what is downloaded, printed and sent."
      footer={<>
        {invoice.perms.print && <Button variant="secondary" icon={Printer} disabled={!state.url} onClick={() => frame.current?.contentWindow?.print()}>Print</Button>}
        {invoice.perms.download && <Button variant="secondary" icon={Download} disabled={!state.url} onClick={() => invoicePdfBlob(invoice, config).then((b) => downloadBlob(b, invoiceFileName(invoice)))}>Download PDF</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {state.loading && <div className="flex h-[60vh] items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div>}
      {state.error && <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center"><FileWarning className="text-rose-500" /><p className="text-sm text-ink-600">{state.error}</p></div>}
      {state.url && <iframe ref={frame} title={`Preview of ${invoice.number}`} src={state.url} className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
    </Modal>
  )
}

// ---- send -----------------------------------------------------------------------------------------------------------
export function SendInvoiceDialog({ invoice, onClose, onDone }) {
  const { toast } = useToast()
  const { config } = useInvoiceConfig()
  const recipients = [...new Set([invoice?.contactEmail, invoice?.snapshot?.contactEmail].filter(Boolean))]
  const [to, setTo] = useState('')
  const [custom, setCustom] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [saveCopy, setSaveCopy] = useState(true)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!invoice) return
    setTo(recipients[0] || ''); setCustom(''); setErrors({}); setError(''); setSaveCopy(invoice.status === 'Draft')
    setSubject(`Invoice ${invoice.number} from ${config.org.name}`)
    setMessage(`Dear ${invoice.contactName || invoice.customerName},\n\nPlease find invoice ${invoice.number}${invoice.amount !== null ? ` for ${formatCurrency(invoice.amount)}` : ''} attached, due on ${invoice.dueDate}.\n\nRegards,\n${config.org.name}`)
  }, [invoice?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!invoice) return null
  const first = invoice.status === 'Draft'
  const address = to === '__other' ? custom : to
  const go = async () => {
    setBusy(true); setError(''); setErrors({})
    try {
      let documentId = null
      if (saveCopy) {
        const blob = await invoicePdfBlob({ ...invoice, status: first ? 'Sent' : invoice.status }, config)
        try { documentId = (await uploadDocument(new File([blob], invoiceFileName(invoice), { type: 'application/pdf' }), { relatedType: 'Invoice', relatedId: invoice.id, category: 'Invoices', source: 'generated', note: `Invoice PDF as sent (${first ? 'first send' : 're-send'})` })).id } catch (e) { if (e?.response?.status !== 409) throw e }
      }
      const r = await sendInvoice(invoice.id, { to: address, subject, message, documentId })
      toast(first ? 'Invoice marked as sent.' : 'Re-send recorded.', { type: 'success' })
      onDone?.(r); onClose()
    } catch (e) { setErrors(invFields(e)); setError(invErr(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} size="md" title={first ? 'Send invoice' : 'Re-send invoice'} description={`${invoice.number} · ${invoice.customerName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Mail} loading={busy} onClick={go}>{first ? 'Send & lock invoice' : 'Record re-send'}</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-800/50">The CRM has no mail integration: this records that you sent the invoice (user and time) and keeps the PDF as sent. {first && 'Once sent, the amounts and line items are final.'}</p>
        <FormField label="To" required error={errors.to}>
          <Select aria-label="Recipient" value={to} onChange={(e) => setTo(e.target.value)}>
            {recipients.map((r) => <option key={r} value={r}>{r}{r === invoice.contactEmail ? ` — ${invoice.contactName || 'contact'}` : ''}</option>)}<option value="__other">Another address on the customer / company record…</option>
          </Select>
          {to === '__other' && <Input aria-label="Other recipient" className="mt-2" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="name@company.com" />}
        </FormField>
        <FormField label="Subject" required error={errors.subject}><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
        <FormField label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[110px]" /></FormField>
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={saveCopy} onChange={(e) => setSaveCopy(e.target.checked)} />Keep the PDF as sent in the invoice’s Documents</label>
        {address && <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline" href={`mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}><Mail size={12} />Open in my email app</a>}
      </div>
    </Modal>
  )
}

// ---- cancel / void / reverse payment ---------------------------------------------------------------------------------
export function ReasonDialog({ open, title, description, confirmLabel, danger = true, onClose, onConfirm, hint }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setReason(''); setError('') } }, [open])
  if (!open) return null
  const go = () => { setBusy(true); setError(''); onConfirm(reason).catch((e) => setError(invErr(e))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title={title} description={description}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 5} onClick={go}>{confirmLabel}</Button></>}>
      <div className="space-y-3">
        {hint && <p className="text-xs text-ink-500">{hint}</p>}
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <FormField label="Reason" required hint="At least 5 characters — kept on the timeline."><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[80px]" /></FormField>
      </div>
    </Modal>
  )
}

export const doCancel = (invoice) => (reason) => cancelInvoice(invoice.id, reason)
export const doVoid = (invoice) => (reason) => voidInvoice(invoice.id, reason)
