import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { logDealActivity } from './dealCommunication'

export function AddNoteModal({ open, onClose, deal, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  if (!deal) return null
  const reset = () => { setTitle(''); setContent(''); }

  const save = () => {
    if (!content.trim()) return
    setSaving(true)
    logDealActivity({
      type: 'Note', relatedId: deal.id, relatedName: deal.name,
      subject: title.trim() || `Note on ${deal.name}`, notes: content,
      noteTitle: title.trim() || null,
      by: user.id,
    }).then(() => {
      setSaving(false)
      toast('Note added.', { type: 'success' })
      reset()
      onLogged?.()
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Add Note"
      description={`Add an internal note to ${deal.name}.`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!content.trim()}>Save Note</Button>
      </>}
    >
      <div className="space-y-4">
        <FormField label="Note title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pricing discussion" /></FormField>
        <FormField label="Note" required><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Client requested a revised quotation." /></FormField>
      </div>
    </Modal>
  )
}
