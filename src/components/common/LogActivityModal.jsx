import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Modal } from './Modal'
import { FormField, Textarea, DateInput } from './FormField'
import { Button } from './Button'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { genId } from '../../utils/csv'
import { useToast } from '../../context/ToastContext'

/**
 * Generic activity logger reused across Leads/Deals/Customers/etc. detail views.
 * Posts a new record to /activities scoped to { relatedType, relatedId, relatedName }.
 */
export function LogActivityModal({ open, onClose, type, relatedType, relatedId, relatedName, onLogged }) {
  const { register, handleSubmit, reset } = useForm()
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()
  const { toast } = useToast()

  const submit = (data) => {
    setLoading(true)
    const payload = {
      id: genId('ACT'),
      type,
      relatedType,
      relatedId,
      relatedName,
      subject: `${type} with ${relatedName}`,
      notes: data.notes,
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      by: user?.id,
      status: 'Completed',
    }
    api.post('/activities', payload).then(() => {
      setLoading(false)
      toast(`${type} logged for ${relatedName}.`, { type: 'success' })
      reset()
      onLogged?.(payload)
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Log ${type}`}
      description={`Record a ${type.toLowerCase()} activity for ${relatedName}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit(submit)} loading={loading}>Save Activity</Button>
      </>}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <FormField label="Date">
          <DateInput defaultValue={new Date().toISOString().slice(0, 10)} {...register('date')} />
        </FormField>
        <FormField label="Notes" required>
          <Textarea placeholder={`What was discussed during this ${type.toLowerCase()}?`} {...register('notes', { required: true })} />
        </FormField>
      </form>
    </Modal>
  )
}
