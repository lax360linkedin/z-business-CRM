import { useEffect, useState } from 'react'
import { AlertCircle, Phone, Mail, MessageCircle, CalendarClock, StickyNote, Send, RefreshCw } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { salesUsers } from '../../data/users'
import { CALL_OUTCOMES, CALL_TYPES, MEETING_TYPES, FOLLOWUP_TYPES } from '../../data/constants'
import { formatCurrency, formatDate } from '../../utils/format'
import { PR_TRANSITIONS, PR_APPROVER_ROLES } from '../../utils/proposalCalc'
import { telHref, waHref, mailHref } from '../Deals/dealCommunication'
import { pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { buildProposalPdf, pdfBytesToDataUrl } from './proposalPdf'
import {
  changeProposalStatus, reviseProposal, sendProposal, logProposalActivity, getClientDiff, refreshClient,
  createQuotationFromProposal, prError, pickTemplate,
} from './proposalClient'
import { getUserById } from '../../data/users'

const today = () => new Date().toISOString().slice(0, 10)
function Err({ children }) {
  if (!children) return null
  return <p role="alert" className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {children}</p>
}

const STATUS_HELP = {
  'Internal Review': 'Submits the proposal for a manager to review before it goes to the client.',
  Draft: 'Sends the proposal back to its owner for more edits.',
  Viewed: 'Record that the client has opened the proposal. (There is no open-tracking, so this is entered by you.)',
  'Revision Requested': 'The client wants changes — record what they asked for, then create a new version.',
  Accepted: 'The client accepted the proposal. This does not create an order, move the deal or record any payment.',
  Rejected: 'The client declined the proposal.',
  Expired: 'The proposal validity ended without a decision.',
}

export function StatusDialog({ open, onClose, proposal, onChanged }) {
  const { toast } = useToast()
  const options = (PR_TRANSITIONS[proposal?.status] || []).filter((s) => s !== 'Sent')
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setStatus(options[0] || ''); setReason(''); setError('') } }, [open, proposal?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const needsReason = ['Rejected', 'Revision Requested'].includes(status)
  const save = () => {
    setSaving(true); setError('')
    changeProposalStatus(proposal.id, status, reason).then((p) => { toast(`Proposal is now ${p.status}.`, { type: 'success' }); onChanged(p); onClose() }).catch((e) => setError(prError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Change proposal status" description={`${proposal?.number} · currently ${proposal?.status}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={status === 'Rejected' ? 'danger' : 'primary'} loading={saving} disabled={!status || (needsReason && !reason.trim())} onClick={save}>Update status</Button></>}>
      <div className="space-y-4">
        {!options.length ? <p className="text-sm text-ink-500">No further status changes from {proposal?.status}.</p> : (
          <>
            <FormField label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{options.map((s) => <option key={s}>{s}</option>)}</Select></FormField>
            <p className="text-xs text-ink-400">{STATUS_HELP[status]}</p>
            {needsReason && <FormField label={status === 'Rejected' ? 'Why was it rejected?' : 'What changes were requested?'} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[80px]" /></FormField>}
          </>
        )}
        <Err>{error}</Err>
      </div>
    </Modal>
  )
}

export function ReviseDialog({ open, onClose, proposal, onRevised }) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setReason(proposal?.revisionRequest || ''); setError('') } }, [open, proposal?.revisionRequest])
  const save = () => {
    setSaving(true); setError('')
    reviseProposal(proposal.id, reason).then((p) => { toast(`${p.number} – Version ${p.version} created.`, { type: 'success' }); onRevised(p); onClose() }).catch((e) => setError(prError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Create revision" description={`Starts ${proposal?.number} – Version ${(proposal?.version || 1) + 1}. Version ${proposal?.version} is preserved exactly as it was.`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!reason.trim()} onClick={save}>Create version {(proposal?.version || 1) + 1}</Button></>}>
      <div className="space-y-3">
        <FormField label="Reason / client feedback" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[90px]" placeholder="What needs to change?" /></FormField>
        <p className="text-xs text-ink-400">The new version starts as a Draft with the same content; the sent document of the current version stays in the version history.</p>
        <Err>{error}</Err>
      </div>
    </Modal>
  )
}

/** Compare the proposal's client block with the master Company/Contact and refresh it deliberately. */
export function ClientRefreshDialog({ open, onClose, proposal, onRefreshed }) {
  const { toast } = useToast()
  const [diff, setDiff] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setDiff(null); setError(''); getClientDiff(proposal.id).then(setDiff) } }, [open, proposal?.id])
  const apply = () => {
    setSaving(true); setError('')
    refreshClient(proposal.id).then((p) => { toast('Client details refreshed.', { type: 'success' }); onRefreshed(p); onClose() }).catch((e) => setError(prError(e))).finally(() => setSaving(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Client details" description="Compare this proposal's client block with the master Company / Contact record." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{diff?.changes.length > 0 && diff.editable && <Button icon={RefreshCw} loading={saving} onClick={apply}>Refresh from master record</Button>}</>}>
      {!diff ? <p className="py-6 text-center text-sm text-ink-400">Comparing…</p> : !diff.changes.length ? <p className="py-6 text-center text-sm text-emerald-600">The proposal already matches the master record.</p> : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
            <table className="w-full text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-3 py-2">Field</th><th className="px-3 py-2">In this proposal</th><th className="px-3 py-2">Master record now</th></tr></thead>
              <tbody>{diff.changes.map((c) => <tr key={c.key} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-3 py-2 font-medium text-ink-700 dark:text-ink-200">{c.label}</td><td className="px-3 py-2 text-ink-500">{c.from || '—'}</td><td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">{c.to || '—'}</td></tr>)}</tbody></table>
          </div>
          {!diff.editable && <p className="text-xs text-amber-600">This version has been sent, so it keeps its original client details. Create a revision to pick up the changes — the sent version stays untouched.</p>}
          <Err>{error}</Err>
        </div>
      )}
    </Modal>
  )
}

/** Call / Email / WhatsApp / Meeting / Note / Follow-up — real device handoffs where they exist, and always a persisted timeline entry. */
export function ActivityDialog({ open, onClose, proposal, kind, onLogged }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const reps = salesUsers()
  const client = proposal?.clientSnapshot || {}
  const blank = { callType: 'Outgoing', outcome: '', minutes: '', seconds: '', notes: '', nextFollowUp: '', subject: '', message: '', title: '', date: '', startTime: '', endTime: '', meetingType: MEETING_TYPES[0], participants: '', content: '', followUpType: 'Call', time: '', assignedTo: proposal?.ownerId || '' }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setF({ ...blank, subject: kind === 'Email' ? `${proposal.title} — ${proposal.number}` : '', assignedTo: proposal.ownerId }); setError('') } }, [open, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  const META = {
    Call: { title: 'Log a call', icon: Phone, ready: f.outcome && f.notes.trim() },
    Email: { title: 'Email the client', icon: Mail, ready: f.subject.trim() && f.message.trim() },
    WhatsApp: { title: 'WhatsApp the client', icon: MessageCircle, ready: f.message.trim() },
    Meeting: { title: 'Schedule a meeting', icon: CalendarClock, ready: f.title.trim() && f.date && f.startTime },
    Note: { title: 'Add a note', icon: StickyNote, ready: f.content.trim() },
    'Follow-up': { title: 'Add a follow-up', icon: CalendarClock, ready: f.date },
  }
  const meta = META[kind] || META.Note

  const payload = () => {
    if (kind === 'Call') return { callType: f.callType, outcome: f.outcome, notes: f.notes, duration: (f.minutes || f.seconds) ? `${String(f.minutes || 0).padStart(2, '0')}:${String(f.seconds || 0).padStart(2, '0')}` : null, nextFollowUp: f.nextFollowUp || null }
    if (kind === 'Email') return { subject: f.subject, message: f.message }
    if (kind === 'WhatsApp') return { message: f.message }
    if (kind === 'Meeting') return { title: f.title, date: f.date, startTime: f.startTime, endTime: f.endTime, meetingType: f.meetingType, participants: f.participants, notes: f.notes }
    if (kind === 'Follow-up') return { followUpType: f.followUpType, date: f.date, time: f.time, assignedTo: f.assignedTo, notes: f.notes }
    return { title: f.title, content: f.content }
  }
  const save = () => {
    setSaving(true); setError('')
    // real handoff first (mail app / WhatsApp), the CRM record is written regardless
    if (kind === 'Email') window.open(mailHref(client.email, f.subject, f.message), '_blank')
    if (kind === 'WhatsApp') window.open(waHref(client.phone, f.message), '_blank')
    logProposalActivity(proposal.id, kind, payload()).then(() => { toast(`${kind === 'Call' ? 'Call' : kind} recorded on the proposal timeline.`, { type: 'success' }); onLogged(); onClose() })
      .catch((e) => setError(prError(e))).finally(() => setSaving(false))
  }
  const Icon = meta.icon
  return (
    <Modal open={open} onClose={onClose} title={meta.title} description={`${proposal?.number} · ${client.contactName} (${client.companyName})`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Icon} loading={saving} disabled={!meta.ready} onClick={save}>{kind === 'Email' ? 'Open mail app & log' : kind === 'WhatsApp' ? 'Open WhatsApp & log' : kind === 'Meeting' ? 'Schedule' : 'Save'}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        {kind === 'Call' && (
          <>
            <div className="col-span-2 flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3 dark:bg-ink-800/50"><div><p className="text-xs text-ink-400">Contact number</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{client.phone || '—'}</p></div><Button size="sm" variant="secondary" icon={Phone} disabled={!client.phone} onClick={() => { window.location.href = telHref(client.phone) }}>Call now</Button></div>
            <FormField label="Call type"><Select value={f.callType} onChange={(e) => set({ callType: e.target.value })}>{CALL_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
            <FormField label="Outcome" required><Select value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">Select…</option>{CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</Select></FormField>
            <FormField label="Minutes"><Input type="number" min="0" value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} /></FormField>
            <FormField label="Seconds"><Input type="number" min="0" max="59" value={f.seconds} onChange={(e) => set({ seconds: e.target.value })} /></FormField>
            <div className="col-span-2"><FormField label="Call notes" required><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[80px]" /></FormField></div>
            <div className="col-span-2"><FormField label="Next follow-up"><DateInput value={f.nextFollowUp} min={today()} onChange={(e) => set({ nextFollowUp: e.target.value })} /></FormField></div>
          </>
        )}
        {kind === 'Email' && (
          <>
            <div className="col-span-2"><FormField label="To"><Input value={client.email || ''} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField></div>
            <div className="col-span-2"><FormField label="Subject" required><Input value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></FormField></div>
            <div className="col-span-2"><FormField label="Message" required><Textarea value={f.message} onChange={(e) => set({ message: e.target.value })} className="min-h-[120px]" /></FormField></div>
          </>
        )}
        {kind === 'WhatsApp' && (
          <>
            <div className="col-span-2"><FormField label="To"><Input value={client.phone || ''} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField></div>
            <div className="col-span-2"><FormField label="Message" required><Textarea value={f.message} onChange={(e) => set({ message: e.target.value })} className="min-h-[110px]" /></FormField></div>
          </>
        )}
        {kind === 'Meeting' && (
          <>
            <div className="col-span-2"><FormField label="Meeting title" required><Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={`${proposal?.title} — walkthrough`} /></FormField></div>
            <FormField label="Date" required><DateInput value={f.date} min={today()} onChange={(e) => set({ date: e.target.value })} /></FormField>
            <FormField label="Type"><Select value={f.meetingType} onChange={(e) => set({ meetingType: e.target.value })}>{MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
            <FormField label="Start time" required><Input type="time" value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></FormField>
            <FormField label="End time"><Input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></FormField>
            <div className="col-span-2"><FormField label="Participants"><Input value={f.participants} onChange={(e) => set({ participants: e.target.value })} placeholder={`${user?.name} (You), ${client.contactName}`} /></FormField></div>
            <div className="col-span-2"><FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[60px]" /></FormField></div>
          </>
        )}
        {kind === 'Note' && (
          <>
            <div className="col-span-2"><FormField label="Title (optional)"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} /></FormField></div>
            <div className="col-span-2"><FormField label="Note" required><Textarea value={f.content} maxLength={2000} onChange={(e) => set({ content: e.target.value })} className="min-h-[110px]" /></FormField></div>
          </>
        )}
        {kind === 'Follow-up' && (
          <>
            <FormField label="Type"><Select value={f.followUpType} onChange={(e) => set({ followUpType: e.target.value })}>{FOLLOWUP_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
            <FormField label="Assigned to"><Select value={f.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
            <FormField label="Date" required><DateInput value={f.date} min={today()} onChange={(e) => set({ date: e.target.value })} /></FormField>
            <FormField label="Time"><Input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></FormField>
            <div className="col-span-2"><FormField label="Notes"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[60px]" /></FormField></div>
          </>
        )}
        <div className="col-span-2"><Err>{error}</Err></div>
      </div>
    </Modal>
  )
}

/** Generates the proposal PDF from the selected template, previews it, and sends exactly that document to the client. */
export function SendProposalDialog({ open, onClose, proposal, onSent }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [bytes, setBytes] = useState(null)
  const [url, setUrl] = useState(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const owner = getUserById(proposal?.ownerId)
  const client = proposal?.clientSnapshot || {}
  const canApprove = PR_APPROVER_ROLES.includes(user?.role)

  useEffect(() => {
    if (!open) return
    let revoke = null
    let cancelled = false
    setBytes(null); setUrl(null); setError('')
    setSubject(`${proposal.title} — ${proposal.number} (Version ${proposal.version})`)
    setMessage(`Hi ${client.contactName || 'there'},\n\nPlease find attached our proposal ${proposal.number} (Version ${proposal.version}), valid until ${formatDate(proposal.validUntil)}.\n\nWe would be glad to walk you through it.\n\nRegards,\n${owner?.name || user?.name || ''}`)
    pickTemplate(proposal).then((template) => buildProposalPdf({ proposal, template, ownerName: owner?.name, ownerEmail: owner?.email })).then((b) => {
      if (cancelled) return
      setBytes(b); revoke = pdfBytesToBlobUrl(b); setUrl(revoke)
    }).catch(() => setError('Could not generate the proposal PDF.'))
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke) }
  }, [open, proposal?.id, proposal?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const blocker = !client.email ? "This proposal's contact has no email address." : proposal?.status !== 'Internal Review' ? 'Submit the proposal for internal review before sending.' : !canApprove ? 'Only a Sales Manager or Admin can approve and send a proposal after internal review.' : ''
  const send = () => {
    setSending(true); setError('')
    sendProposal(proposal.id, { subject, message, templateId: proposal.templateId, document: { fileName: `${proposal.number}-v${proposal.version}.pdf`, dataUrl: pdfBytesToDataUrl(bytes) } })
      .then((r) => { toast(`${proposal.number} sent to ${client.email}.`, { type: 'success' }); onSent(r.proposal); onClose() }).catch((e) => setError(prError(e))).finally(() => setSending(false))
  }
  return (
    <Modal open={open} onClose={onClose} title="Send proposal" description={`${proposal?.number} – Version ${proposal?.version} · ${client.companyName}`} size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Send} loading={sending} disabled={!bytes || !!blocker || !subject.trim()} onClick={send}>Send to client</Button></>}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          {blocker && <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {blocker}</p>}
          <FormField label="To (proposal contact)"><Input value={`${client.contactName || ''} <${client.email || '—'}>`} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField>
          <FormField label="Subject" required><Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></FormField>
          <FormField label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[150px]" /></FormField>
          <Err>{error}</Err>
          <p className="text-xs text-ink-400">No mail server is connected, so the email is recorded but not delivered. Sending stores this exact PDF with Version {proposal?.version}, marks the proposal Sent and logs it on the deal. It does not move the deal stage.</p>
        </div>
        <div>{url ? <iframe src={url} title="Proposal PDF" className="h-[60vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" /> : <p className="py-16 text-center text-sm text-ink-400">Generating PDF…</p>}</div>
      </div>
    </Modal>
  )
}

/** Create Quotation from the proposal's commercial summary — handles the "already open" case explicitly. */
export function QuotationDialog({ open, onClose, proposal, onCreated, navigate }) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState(null)
  useEffect(() => { if (open) { setError(''); setExisting(null) } }, [open])
  const go = (allowAnother) => {
    setSaving(true); setError('')
    createQuotationFromProposal(proposal.id, allowAnother).then((r) => { toast(`Quotation ${r.quotation.number} created.`, { type: 'success' }); onCreated(r); onClose(); navigate(`/quotations/${r.quotation.id}`) })
      .catch((e) => { const id = e?.response?.data?.fields?.existingId; if (id) setExisting(id); setError(prError(e)) }).finally(() => setSaving(false))
  }
  const total = (proposal?.content?.items || []).length
  return (
    <Modal open={open} onClose={onClose} title="Create quotation" description={`From ${proposal?.number} – Version ${proposal?.version}`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>{existing && <Button variant="secondary" onClick={() => { onClose(); navigate(`/quotations/${existing}`) }}>Open existing</Button>}<Button loading={saving} onClick={() => go(!!existing)}>{existing ? 'Create another' : 'Create quotation'}</Button></>}>
      <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
        <p>A new Draft quotation will be created with:</p>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li>The client, company and contact from this proposal ({proposal?.clientSnapshot?.companyName}) and its linked deal</li>
          <li>{total} product / service line{total === 1 ? '' : 's'} from the commercial summary ({formatCurrency(proposal?.value || 0)} excl. tax)</li>
          <li>The requirement, scope and payment terms</li>
          <li>The proposal ID, version and deal ID, so the chain Deal → Proposal → Quotation stays intact</li>
        </ul>
        <Err>{error}</Err>
      </div>
    </Modal>
  )
}
