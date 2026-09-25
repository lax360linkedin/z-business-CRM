import { useState } from 'react'
import { Phone } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { CALL_TYPES, CALL_OUTCOMES } from '../../data/constants'
import { telHref, logLeadActivity, advanceToContactedAfterContact } from './leadCommunication'

/**
 * Call quick action (spec §6/§7/§21). "Call Now" is a real `tel:` handoff to the OS dialer —
 * on desktop without telephony it simply does nothing visible, which is honest (no fake
 * "connecting…" state). The Call Log below is what actually gets recorded regardless of
 * whether the tel: link did anything, since only the salesperson knows what really happened
 * on the call.
 */
export function CallActionModal({ open, onClose, lead, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [callType, setCallType] = useState('Outgoing')
  const [outcome, setOutcome] = useState('')
  const [minutes, setMinutes] = useState('')
  const [seconds, setSeconds] = useState('')
  const [notes, setNotes] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [saving, setSaving] = useState(false)

  if (!lead) return null

  const reset = () => { setCallType('Outgoing'); setOutcome(''); setMinutes(''); setSeconds(''); setNotes(''); setNextFollowUp(''); }

  const callNow = () => { window.location.href = telHref(lead.phone) }

  const submit = () => {
    if (!outcome || !notes.trim()) return
    setSaving(true)
    const duration = (minutes || seconds) ? `${String(minutes || 0).padStart(2, '0')}:${String(seconds || 0).padStart(2, '0')}` : null
    logLeadActivity({
      type: 'Call', relatedId: lead.id, relatedName: lead.name,
      subject: `Call with ${lead.name}`, notes,
      callType, callOutcome: outcome, duration, nextFollowUp: nextFollowUp || null,
      by: user.id,
    }).then(() => {
      const patch = { lastContactedDate: new Date().toISOString() }
      if (nextFollowUp) patch.nextFollowUp = nextFollowUp
      return api.put(`/leads/${lead.id}`, patch)
    }).then(() => advanceToContactedAfterContact(lead, { by: user.id, via: 'Call' })).then(() => {
      setSaving(false)
      toast('Call logged to activity timeline.', { type: 'success' })
      reset()
      onLogged?.()
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Call"
      description={`Log a call with ${lead.name} (${lead.company}).`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={!outcome || !notes.trim()}>Save Call Log</Button>
      </>}
    >
      <div className="mb-4 flex items-center justify-between rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
        <div>
          <p className="text-xs text-ink-400">Contact Number</p>
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lead.phone || '—'}</p>
        </div>
        <Button variant="secondary" size="sm" icon={Phone} onClick={callNow} disabled={!lead.phone}>Call Now</Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Call Type">
          <Select value={callType} onChange={(e) => setCallType(e.target.value)}>
            {CALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        <FormField label="Outcome" required>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Select…</option>
            {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>

        <FormField label="Duration (minutes)"><Input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></FormField>
        <FormField label="Duration (seconds)"><Input type="number" min="0" max="59" value={seconds} onChange={(e) => setSeconds(e.target.value)} /></FormField>

        <FormField label="Call Notes" required className="col-span-2">
          <Textarea placeholder="Discussed website requirement and requested quotation." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        <FormField label="Next Follow-up" className="col-span-2">
          <DateInput value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  )
}
