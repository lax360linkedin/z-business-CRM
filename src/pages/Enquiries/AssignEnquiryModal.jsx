import { FormModal } from '../../components/common/FormModal'
import { ASSIGNED_TEAMS } from '../../data/constants'
import { salesUsers } from '../../data/users'

export function AssignEnquiryModal({ open, onClose, enquiry, saving, onSave }) {
  if (!enquiry) return null
  const reps = salesUsers()
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={enquiry.assignedUser ? 'Reassign Enquiry' : 'Assign Enquiry'}
      description={`Choose the team and team member responsible for ${enquiry.name} (${enquiry.company || 'No company'}).`}
      submitLabel={enquiry.assignedUser ? 'Reassign' : 'Assign'}
      loading={saving}
      onSubmit={(data) => onSave(data.assignedTeam, data.assignedUser)}
      defaultValues={{ assignedTeam: enquiry.assignedTeam || ASSIGNED_TEAMS[0], assignedUser: enquiry.assignedUser || reps[0]?.id }}
      fields={[
        { name: 'assignedTeam', label: 'Assigned Team', type: 'select', options: ASSIGNED_TEAMS.map((t) => ({ value: t, label: t })), required: true, span: 1 },
        { name: 'assignedUser', label: 'Assigned User', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 1 },
      ]}
    />
  )
}
