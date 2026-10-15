import { FormModal } from '../../components/common/FormModal'
import { salesUsers } from '../../data/users'

export function AssignLeadModal({ open, onClose, lead, saving, onSave }) {
  if (!lead) return null
  const reps = salesUsers()
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={lead.assignedTo ? 'Reassign Lead' : 'Assign Lead'}
      description={`Choose the salesperson responsible for ${lead.name} (${lead.company}).`}
      submitLabel={lead.assignedTo ? 'Reassign' : 'Assign'}
      loading={saving}
      onSubmit={(data) => onSave(data.assignedTo)}
      defaultValues={{ assignedTo: lead.assignedTo || reps[0]?.id }}
      fields={[
        { name: 'assignedTo', label: 'Salesperson', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 2 },
      ]}
    />
  )
}
