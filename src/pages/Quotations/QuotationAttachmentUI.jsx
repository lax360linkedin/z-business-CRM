import { useEffect, useRef, useState } from 'react'
import { Paperclip, UploadCloud, FileText, FileType2, Eye, Download, RefreshCw, Trash2, Send, X, AlertCircle, Mail } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../utils/format'
import { logAuditEvent } from '../../utils/auditLog'
import { ACCEPT_ATTR, MAX_ATTACHMENT_BYTES, LOCKED_STATUSES, ATTACHMENT_KINDS } from '../../utils/quotationAttachmentRules'
import {
  validateQuotationFile, uploadQuotationAttachment, removeQuotationAttachment, sendQuotationToClient, apiErrorMessage,
  getActiveAttachment, isAttachmentLinked, downloadAttachment, buildAttachmentPreview, formatBytes,
} from './quotationAttachments'

const APPROVER_ROLES = ['Super Admin', 'Admin', 'MD', 'Sales Manager']

function KindIcon({ kind, size = 20 }) {
  const Icon = kind === 'pdf' ? FileText : FileType2
  return <Icon size={size} className={kind === 'pdf' ? 'text-rose-500' : 'text-sky-500'} />
}

/**
 * Drop-zone / button that validates a picked file immediately (type, size, signature, readable,
 * not password-protected, not a duplicate) and only then hands the staged payload up — an invalid
 * file never reaches the quotation. Shared by the Create Quotation dialog and the detail page.
 */
export function QuotationFilePicker({ onStaged, activeAttachment = null, disabled = false, compact = false, label = 'Upload existing quotation (PDF or Word)' }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const handle = async (file) => {
    if (!file || disabled) return
    setError('')
    setChecking(true)
    try {
      onStaged(await validateQuotationFile(file, { activeAttachment }))
    } catch (err) {
      setError(err.message || 'That file could not be used.')
    } finally {
      setChecking(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handle(e.dataTransfer.files?.[0]) }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        className={clsx(
          'flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed text-left transition-colors',
          compact ? 'px-4 py-3' : 'px-5 py-6',
          dragOver ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-900/20' : 'border-ink-200 hover:border-brand-400 dark:border-ink-700',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <UploadCloud size={compact ? 20 : 26} className="shrink-0 text-ink-400" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{checking ? 'Checking file…' : label}</p>
          <p className="text-xs text-ink-400">PDF, DOC or DOCX · up to {MAX_ATTACHMENT_BYTES / 1048576} MB · click or drag a file here</p>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT_ATTR} className="hidden" data-testid="quotation-file-input" onChange={(e) => handle(e.target.files?.[0])} disabled={disabled} />
      </div>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}</p>
      )}
    </div>
  )
}

function StagedFileCard({ staged, onClear, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50/60 p-3 dark:border-ink-800 dark:bg-ink-800/40">
      <div className="flex min-w-0 items-center gap-3">
        <KindIcon kind={staged.kind} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{staged.fileName}</p>
          <p className="text-xs text-ink-400">{ATTACHMENT_KINDS[staged.kind].label} · {formatBytes(staged.size)}{staged.pages ? ` · ${staged.pages} page${staged.pages > 1 ? 's' : ''}` : ''} · checked ✓</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {onClear && <button type="button" aria-label="Discard file" onClick={onClear} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-700"><X size={15} /></button>}
      </div>
    </div>
  )
}

/** Full-size preview of an attached document — PDF inline, Word as converted HTML, legacy .doc as a download prompt. */
export function AttachmentPreviewModal({ attachment, onClose }) {
  const [preview, setPreview] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoke = null
    let cancelled = false
    setPreview(null)
    setFailed(false)
    if (attachment) {
      buildAttachmentPreview(attachment)
        .then((p) => { if (cancelled) return; if (p.url) revoke = p.url; setPreview(p) })
        .catch(() => { if (!cancelled) setFailed(true) })
    }
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke) }
  }, [attachment])

  return (
    <Modal
      open={!!attachment}
      onClose={onClose}
      title={attachment ? `${attachment.fileName}` : ''}
      description={attachment ? `Version ${attachment.version} · ${formatBytes(attachment.size)} · attached to ${attachment.quotationNumber} for ${attachment.customerName}` : ''}
      size="xl"
      footer={attachment?.dataUrl ? <Button variant="secondary" icon={Download} onClick={() => downloadAttachment(attachment)}>Download original</Button> : null}
    >
      {failed && <p className="py-10 text-center text-sm text-rose-600">This document could not be previewed. Download it to open it in Word.</p>}
      {!failed && !preview && <p className="py-10 text-center text-sm text-ink-400">Loading preview…</p>}
      {preview?.type === 'pdf' && <iframe src={preview.url} title="Attached PDF preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      {preview?.type === 'html' && (
        <>
          {/* Sandboxed (no scripts) — the document's own content can never execute in the app. */}
          <iframe srcDoc={preview.html} sandbox="" title="Attached Word preview" className="h-[70vh] w-full rounded-lg border border-ink-100 bg-white dark:border-ink-800" />
          <p className="mt-2 text-xs text-ink-400">Approximate preview — fonts and page layout may differ from Word. The client receives the original file unchanged.</p>
        </>
      )}
      {preview?.type === 'none' && (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-ink-700 dark:text-ink-200">Preview isn't available for legacy .doc files.</p>
          <p className="mt-1 text-xs text-ink-400">Download the file to check it, or re-save it as .docx / PDF to preview it here.</p>
        </div>
      )}
    </Modal>
  )
}

/** The "Attached Quotation Document" card on the Quotation Detail page: stage → attach → preview → replace/remove → send, plus the full version history. */
export function QuotationAttachmentCard({ quotation, onQuotationChange, onActivity, onSendClick }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [staged, setStaged] = useState(null)
  const [stagedMode, setStagedMode] = useState('attach') // 'attach' | 'replace'
  const [busy, setBusy] = useState(false)
  const [previewTarget, setPreviewTarget] = useState(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  const active = getActiveAttachment(quotation)
  const history = quotation.attachments || []
  const locked = LOCKED_STATUSES.includes(quotation.status)
  const linked = active ? isAttachmentLinked(active, quotation) : true

  const commit = () => {
    if (!staged || busy) return
    setBusy(true)
    const replacing = stagedMode === 'replace' && !!active
    uploadQuotationAttachment(quotation.id, staged, { replace: replacing })
      .then((q) => {
        onQuotationChange(q)
        onActivity?.()
        toast(replacing ? `Document replaced with "${staged.fileName}".` : `"${staged.fileName}" attached to ${quotation.number}.`, { type: 'success' })
        logAuditEvent({ user, action: replacing ? 'Replace Quotation Attachment' : 'Attach Quotation Document', module: 'Quotations', record: quotation.number, newValue: staged.fileName, previousValue: replacing ? active.fileName : null })
        setStaged(null)
      })
      .catch((err) => toast(apiErrorMessage(err, 'Could not attach the document.'), { type: 'error' }))
      .finally(() => setBusy(false))
  }

  const confirmRemove = () => {
    setBusy(true)
    removeQuotationAttachment(quotation.id, active.id)
      .then((q) => {
        onQuotationChange(q)
        onActivity?.()
        toast('Attachment removed. It stays in the history below.', { type: 'success' })
        logAuditEvent({ user, action: 'Remove Quotation Attachment', module: 'Quotations', record: quotation.number, previousValue: active.fileName })
        setRemoveOpen(false)
      })
      .catch((err) => toast(apiErrorMessage(err, 'Could not remove the attachment.'), { type: 'error' }))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mb-6 rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900 print:hidden" data-testid="attachment-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100"><Paperclip size={15} className="text-brand-500" /> Attached Quotation Document</h3>
        <span className="text-xs text-ink-400">Linked to <b className="font-medium text-ink-600 dark:text-ink-300">{quotation.customerName}</b> · {quotation.number}</span>
      </div>

      {locked && <p className="mb-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-800/50 dark:text-ink-400">This quotation is {quotation.status.toLowerCase()} — its documents are locked.</p>}

      {!active && !staged && (
        <QuotationFilePicker
          disabled={locked}
          onStaged={(s) => { setStaged(s); setStagedMode('attach') }}
        />
      )}

      {staged && (
        <div className="space-y-2">
          <p className="text-xs text-ink-500 dark:text-ink-400">{stagedMode === 'replace' ? `This will replace "${active?.fileName}". The old version stays in the history.` : 'Review the file, then attach it to this quotation.'}</p>
          <StagedFileCard staged={staged} onClear={() => setStaged(null)}>
            <Button size="sm" icon={Paperclip} loading={busy} onClick={commit}>{stagedMode === 'replace' ? 'Replace File' : 'Attach File'}</Button>
          </StagedFileCard>
        </div>
      )}

      {active && !staged && (
        <div className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <KindIcon kind={active.kind} size={24} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{active.fileName}</p>
                <p className="text-xs text-ink-400">{ATTACHMENT_KINDS[active.kind].label} · {formatBytes(active.size)} · v{active.version} · uploaded by {active.uploadedByName} · {formatDateTime(active.uploadedAt)}</p>
              </div>
            </div>
            {active.sentAt
              ? <Badge tone="success">Sent to {active.sentTo}</Badge>
              : <Badge tone="warning">Attached — not sent yet</Badge>}
          </div>
          {!linked && <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-600"><AlertCircle size={13} /> This document is not linked to this quotation/client — remove it and attach it again.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreviewTarget(active)}>Preview</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadAttachment(active)}>Download</Button>
            {!locked && (
              <>
                <ReplaceButton active={active} onStaged={(s) => { setStaged(s); setStagedMode('replace') }} />
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setRemoveOpen(true)}>Remove</Button>
              </>
            )}
            <Button size="sm" icon={Send} onClick={onSendClick} disabled={!linked}>Send to Client</Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Attachment history</p>
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
            {history.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <KindIcon kind={a.kind} size={15} />
                  <span className="truncate font-medium text-ink-700 dark:text-ink-200">{a.fileName}</span>
                  <span className="text-ink-400">v{a.version} · {formatBytes(a.size)} · {a.uploadedByName} · {formatDateTime(a.uploadedAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {a.sentAt && <span className="text-ink-400">sent {formatDateTime(a.sentAt)}</span>}
                  <Badge tone={a.status === 'Active' ? 'success' : a.status === 'Replaced' ? 'neutral' : 'danger'}>{a.status}</Badge>
                  {a.dataUrl && a.status !== 'Active' && (
                    <button type="button" className="text-brand-600 hover:underline" onClick={() => setPreviewTarget(a)}>View</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AttachmentPreviewModal attachment={previewTarget} onClose={() => setPreviewTarget(null)} />
      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={confirmRemove}
        loading={busy}
        title="Remove the attached document?"
        description={`"${active?.fileName}" will no longer be attached to ${quotation.number}. A record of it stays in the attachment history.`}
        confirmLabel="Remove Attachment"
      />
    </div>
  )
}

function ReplaceButton({ active, onStaged }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setOpen(true)}>Replace</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Replace attached document" description={`Choose the new file to use instead of "${active.fileName}".`} size="md">
        <QuotationFilePicker activeAttachment={active} onStaged={(s) => { setOpen(false); onStaged(s) }} label="Choose the replacement (PDF or Word)" />
      </Modal>
    </>
  )
}

/** "Send to Client" dialog: shows exactly who receives what (client email, attachment) before anything goes out. */
export function SendQuotationModal({ open, onClose, quotation, preparedByName, onSent }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [includeGenerated, setIncludeGenerated] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [previewTarget, setPreviewTarget] = useState(null)

  const active = getActiveAttachment(quotation)
  const linked = active ? isAttachmentLinked(active, quotation) : true
  const canApprove = APPROVER_ROLES.includes(user?.role)
  const needsApproval = ['Draft', 'Pending Approval'].includes(quotation.status)

  useEffect(() => {
    if (!open) return
    setSubject(`Quotation ${quotation.number} from LAX360`)
    setMessage(`Hi ${quotation.contactName || 'there'},\n\nPlease find our quotation ${quotation.number}${active ? ' attached' : ''}.\n\nRegards,\n${preparedByName || user?.name || ''}`)
    setIncludeGenerated(!active)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quotation.id, active?.id])

  const send = () => {
    setSending(true)
    setError('')
    sendQuotationToClient(quotation.id, { subject, message, includeGeneratedPdf: includeGenerated })
      .then(({ quotation: q }) => {
        toast(`Quotation ${quotation.number} sent to ${q.contactEmail}.`, { type: 'success' })
        logAuditEvent({ user, action: 'Send Quotation', module: 'Quotations', record: quotation.number, newValue: `${q.contactEmail}${active ? ` (+${active.fileName})` : ''}` })
        onSent(q)
        onClose()
      })
      .catch((err) => setError(apiErrorMessage(err, 'Could not send the quotation.')))
      .finally(() => setSending(false))
  }

  const blocker = !quotation.contactEmail
    ? 'This client has no email address on file — add one on the contact/company record first.'
    : needsApproval && !canApprove
      ? 'This quotation is not approved yet. Submit it for approval first — a manager can then approve and send it.'
      : ['Rejected', 'Expired'].includes(quotation.status) ? `A ${quotation.status.toLowerCase()} quotation can't be sent.` : ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send to Client"
      description={`${quotation.number} · ${quotation.customerName}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={Send} loading={sending} disabled={!!blocker || !linked || (!active && !includeGenerated) || !subject.trim()} onClick={send}>Send Quotation</Button>
        </>
      }
    >
      <div className="space-y-4">
        {blocker && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {blocker}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="To (client on this quotation)">
            <Input value={quotation.contactEmail ? `${quotation.contactName ? `${quotation.contactName} <` : ''}${quotation.contactEmail}${quotation.contactName ? '>' : ''}` : '—'} readOnly className="bg-ink-50 dark:bg-ink-800/50" />
          </FormField>
          <FormField label="Client record"><Input value={`${quotation.customerName}`} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField>
        </div>
        <FormField label="Subject" required><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></FormField>
        <FormField label="Message"><Textarea value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} className="min-h-[120px]" /></FormField>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Attachments</p>
          {active ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
              <div className="flex min-w-0 items-center gap-2.5"><KindIcon kind={active.kind} /><div className="min-w-0"><p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{active.fileName}</p><p className="text-xs text-ink-400">{formatBytes(active.size)} · uploaded document</p></div></div>
              <Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreviewTarget(active)}>Preview</Button>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-ink-200 px-3 py-2.5 text-xs text-ink-400 dark:border-ink-700">No uploaded document attached to this quotation.</p>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
            <input type="checkbox" checked={includeGenerated} onChange={(e) => setIncludeGenerated(e.target.checked)} />
            Also include the system-generated quotation PDF
          </label>
        </div>

        {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}</p>}
        <p className="flex items-start gap-1.5 text-xs text-ink-400"><Mail size={13} className="mt-0.5 shrink-0" /> Demo build: no real email leaves the browser. Sending records the email, its attachment and the status change on this quotation.{needsApproval && !blocker ? ' Sending also marks the quotation as Sent.' : ''}</p>
      </div>
      <AttachmentPreviewModal attachment={previewTarget} onClose={() => setPreviewTarget(null)} />
    </Modal>
  )
}

export { StagedFileCard }
