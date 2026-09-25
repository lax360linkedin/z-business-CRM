import { FormModal } from '../../components/common/FormModal'
import { LEAD_LOST_REASONS } from '../../data/constants'

/** The Lead WAS a genuine potential customer (Contacted or Qualified) but the business
 * opportunity is no longer progressing — distinct from Unqualified. Lost Reason and Lost Notes
 * are both required. The Lead stays in the CRM as a permanent, reportable record. */
export function MarkLeadLostModal({ open, onClose, lead, saving, onSave }) {
  if (!lead) return null
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Mark Lead as Lost"
      description={`${lead.name} (${lead.company}) will be marked Lost. This preserves the lead's full history for reporting — it is never deleted.`}
      submitLabel="Mark as Lost"
      loading={saving}
      onSubmit={(data) => onSave({ reason: data.reason, notes: data.notes })}
      defaultValues={{ reason: '', notes: '' }}
      fields={[
        { name: 'reason', label: 'Lost Reason', type: 'select', options: LEAD_LOST_REASONS.map((r) => ({ value: r, label: r })), required: true, span: 2 },
        { name: 'notes', label: 'Lost Notes', type: 'textarea', required: true, span: 2 },
      ]}
    />
  )
}
