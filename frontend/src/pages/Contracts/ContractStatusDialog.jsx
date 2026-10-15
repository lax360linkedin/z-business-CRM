import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { effectiveStatus, isRejection, REASON_REQUIRED, todayKey } from '../../utils/contractRules'
import { changeContractStatus, errText } from './contractActions'

const TEXT = {
  'Internal Review': ['Submit for internal review', 'Colleagues review the draft before approval.'],
  'Pending Approval': ['Submit for approval', 'An approver must approve it before it can be sent.'],
  Approved: ['Approve contract', 'Approving records you as the approver and unlocks sending.'],
  Sent: ['Mark as sent', 'Records that the contract went to the client.'],
  Signed: ['Record signature', 'Records that the client (and you) signed. Upload the signed copy under Documents.'],
  Active: ['Activate contract', 'The contract is now in force.'],
  Terminated: ['Terminate contract', 'Ends the contract early. This cannot be undone.'],
  Cancelled: ['Cancel contract', 'The contract never took effect. It stays in the history.'],
  Draft: ['Return to draft', 'Sends the contract back for changes.'],
  'Internal Review:reject': ['Return for review', 'Sends the contract back to internal review.'],
}

/** One dialog for every lifecycle move: asks only for what that move needs (reason, comments, signing date, how it was sent). */
export function ContractStatusDialog({ contract, to, perms, config, contact, onClose, onDone }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [comments, setComments] = useState('')
  const [date, setDate] = useState(todayKey())
  const [method, setMethod] = useState('Email')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setReason(''); setComments(''); setDate(todayKey()); setMethod('Email'); setError('') }, [contract?.id, to])
  if (!contract || !to) return null
  const from = effectiveStatus(contract, config)
  const rejection = isRejection(from, to)
  const [title, text] = TEXT[rejection ? 'Internal Review:reject' : to] && rejection && to === 'Internal Review' ? TEXT['Internal Review:reject'] : TEXT[to]
  const needsReason = REASON_REQUIRED[to] || rejection
  const go = () => {
    setBusy(true); setError('')
    changeContractStatus(contract, to, { perms, config, reason, comments, date, method })
      .then((c) => { toast(`${contract.number}: ${rejection ? `returned to ${to}` : to.toLowerCase()}.`, { type: 'success' }); onDone?.(c); onClose() }).catch((e) => setError(errText(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="sm" title={rejection ? (to === 'Draft' ? 'Reject — return to draft' : title) : title} description={`${contract.number} · ${contract.title}`}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={['Terminated', 'Cancelled'].includes(to) ? 'danger' : 'primary'} loading={busy} onClick={go}>{rejection ? 'Return contract' : title}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600 dark:text-ink-300">{rejection ? 'Rejected contracts go back to an earlier stage — no duplicate is created.' : text}</p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        {(to === 'Signed' || to === 'Terminated') && <FormField label={to === 'Signed' ? 'Date signed' : 'Effective date'} required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={to === 'Signed' ? todayKey() : undefined} /></FormField>}
        {to === 'Sent' && (
          <>
            <FormField label="Sent how?"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{['Email', 'Hand delivery', 'Courier', 'E-signature platform'].map((m) => <option key={m}>{m}</option>)}</Select></FormField>
            <p className="text-xs text-ink-400">The CRM does not send email or e-signature requests — this records that you sent it.{contact?.email && <> <a className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline" href={`mailto:${contact.email}?subject=${encodeURIComponent(`Contract ${contract.number}`)}`}><Mail size={12} />Open an email to {contact.name}</a></>}</p>
          </>
        )}
        {needsReason && <FormField label="Reason" required><Textarea autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} className="min-h-[72px]" placeholder={rejection ? 'What needs to change?' : 'Why?'} /></FormField>}
        {to === 'Approved' && <FormField label="Approval comments (optional)"><Textarea value={comments} onChange={(e) => setComments(e.target.value)} className="min-h-[60px]" /></FormField>}
      </div>
    </Modal>
  )
}
