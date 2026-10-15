import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { mailHref, logEnquiryActivity, advanceEnquiryToContactedAfterContact } from './enquiryCommunication'

/**
 * Email quick action, mirroring src/pages/Leads/EmailActionModal.jsx exactly. No live SMTP
 * server is connected, so "Send" opens the salesperson's own email client via `mailto:` — a
 * real hand-off, not a simulation.
 */
export function EmailActionModal({ open, onClose, enquiry, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [attachments, setAttachments] = useState('')
  const [saving, setSaving] = useState(false)

  if (!enquiry) return null

  const reset = () => { setSubject(''); setMessage(''); setAttachments(''); }

  const send = () => {
    if (!subject.trim() || !message.trim()) return
    setSaving(true)
    window.open(mailHref(enquiry.email, subject, message), '_blank')
    logEnquiryActivity({
      type: 'Email', relatedId: enquiry.id, relatedName: enquiry.name,
      subject: `Email: ${subject}`, notes: message,
      emailTo: enquiry.email, emailSubject: subject, emailMessage: message,
      attachments: attachments ? attachments.split(',').map((a) => a.trim()).filter(Boolean) : [],
      emailStatus: 'Sent',
      by: user.id,
    }).then(() => api.put(`/enquiries/${enquiry.id}`, { lastContactedDate: new Date().toISOString() }))
      .then(() => advanceEnquiryToContactedAfterContact(enquiry, { by: user.id, via: 'Email' }))
      .then(() => {
        setSaving(false)
        toast(`Email logged for ${enquiry.name}.`, { type: 'success' })
        reset()
        onLogged?.()
        onClose()
      })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Email"
      description={`Compose an email to ${enquiry.name} (${enquiry.company}).`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={send} loading={saving} disabled={!subject.trim() || !message.trim()}>Send</Button>
      </>}
    >
      <div className="space-y-4">
        <FormField label="To"><Input value={enquiry.email || ''} readOnly className="bg-ink-50 dark:bg-ink-800/60" /></FormField>
        <FormField label="Subject" required><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Regarding your enquiry" /></FormField>
        <FormField label="Message" required><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi, sharing the requested details…" /></FormField>
        <FormField label="Attachments (optional)" hint="File names only — this frontend-only build doesn't upload real files.">
          <Input value={attachments} onChange={(e) => setAttachments(e.target.value)} placeholder="proposal.pdf, pricing.xlsx" />
        </FormField>
        <p className="text-xs text-ink-400">Sending opens your device's email app with this message pre-filled. This CRM has no live mail server connected, so "Sent" reflects that hand-off, not a delivery confirmation.</p>
      </div>
    </Modal>
  )
}
