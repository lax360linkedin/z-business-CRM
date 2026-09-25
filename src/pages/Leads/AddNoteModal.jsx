import { useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { logLeadActivity } from './leadCommunication'

export function AddNoteModal({ open, onClose, lead, onLogged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  if (!lead) return null
  const reset = () => { setTitle(''); setContent(''); }

  const save = () => {
    if (!content.trim()) return
    setSaving(true)
    logLeadActivity({
      type: 'Note', relatedId: lead.id, relatedName: lead.name,
      subject: title.trim() || `Note on ${lead.name}`, notes: content,
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
      description={`Add an internal note to ${lead.name}'s record.`}
      footer={<>
        <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!content.trim()}>Save Note</Button>
      </>}
    >
      <div className="space-y-4">
        <FormField label="Note title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Revised quotation requested" /></FormField>
        <FormField label="Note" required><Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Client requested a revised quotation." /></FormField>
      </div>
    </Modal>
  )
}
