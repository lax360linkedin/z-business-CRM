import { useOptions, asChoices } from '../../hooks/useOptions'
import { FormModal } from '../../components/common/FormModal'

/** The Lead was reviewed but never met the qualification criteria — never a real opportunity
 * to begin with. Reason and Notes are both required, matching the spec exactly. The Lead is
 * never deleted; it stays in the CRM as a permanent, reportable record. */
export function MarkUnqualifiedModal({ open, onClose, lead, saving, onSave }) {
  const reasons = useOptions('lead_unqualified_reasons', lead?.unqualifiedReason)
  if (!lead) return null
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Mark Lead as Unqualified"
      description={`${lead.name} (${lead.company}) will be marked Unqualified. This preserves the lead's full history for reporting — it is never deleted.`}
      submitLabel="Mark as Unqualified"
      loading={saving}
      onSubmit={(data) => onSave({ reason: data.reason, notes: data.notes })}
      defaultValues={{ reason: '', notes: '' }}
      fields={[
        { name: 'reason', label: 'Unqualified Reason', type: 'select', options: asChoices(reasons.values), blank: reasons.placeholder, required: true, span: 2 },
        { name: 'notes', label: 'Notes', type: 'textarea', required: true, span: 2 },
      ]}
    />
  )
}
