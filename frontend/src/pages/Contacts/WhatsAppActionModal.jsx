import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { waHref, logContactActivity } from './contactCommunication'

/**
 * WhatsApp quick action, mirroring src/pages/Leads/WhatsAppActionModal.jsx exactly. `wa.me` is
 * a genuine deep link that really opens a WhatsApp conversation pre-filled with the message.
 */
export function WhatsAppActionModal({ open, onClose, contact, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [message, setMessage] = useState('')
  const [attachment, setAttachment] = useState('')
  const [saving, setSaving] = useState(false)

  if (!contact) return null

  const reset = () => { setMessage(''); setAttachment(''); }
  const phone = contact.whatsapp || contact.phone

  const send = () => {
    if (!message.trim()) return
    setSaving(true)
    window.open(waHref(phone, message), '_blank')
    logContactActivity({
      type: 'WhatsApp', relatedId: contact.id, relatedName: contact.name,
      subject: `WhatsApp with ${contact.name}`, notes: message,
      waTo: phone, waMessage: message, waAttachment: attachment || null,
      waStatus: 'Sent',
      by: user.id,
    }).then(() => api.put(`/contacts/${contact.id}`, { lastContactedDate: new Date().toISOString() }))
      .then(() => {
        setSaving(false)
        toast(`WhatsApp logged for ${contact.name}.`, { type: 'success' })
        reset()
        onLogged?.()
        onClose()
      })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="WhatsApp"
      description={`Message ${contact.name} (${contact.companyName}) on WhatsApp.`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={send} loading={saving} disabled={!message.trim()}>Open WhatsApp &amp; Log</Button>
      </>}
    >
      <div className="space-y-4">
        <FormField label="To"><Input value={phone || ''} readOnly className="bg-ink-50 dark:bg-ink-800/60" /></FormField>
        <FormField label="Message" required><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi, following up on our conversation." /></FormField>
        <FormField label="Attachment (optional)" hint="File name only — attach it manually inside WhatsApp; wa.me links can't carry files.">
          <Input value={attachment} onChange={(e) => setAttachment(e.target.value)} placeholder="quotation.pdf" />
        </FormField>
        <p className="text-xs text-ink-400">Opens a real WhatsApp conversation in a new tab with this message pre-filled. Delivery/read status isn't reported back to this CRM.</p>
      </div>
    </Modal>
  )
}
