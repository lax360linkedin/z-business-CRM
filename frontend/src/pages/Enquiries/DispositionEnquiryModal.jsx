import { FormModal } from '../../components/common/FormModal'

const TITLES = {
  Duplicate: 'Mark as Duplicate',
  Spam: 'Mark as Spam',
  'Not Interested': 'Mark as Not Interested',
  Closed: 'Close Enquiry',
  Unqualified: 'Mark as Unqualified',
}

/** Generic reason-capture modal reused for every non-conversion disposition (Duplicate/Spam/Not Interested/Close/Unqualified) — one component instead of five near-identical ones. */
export function DispositionEnquiryModal({ open, onClose, enquiry, targetStatus, saving, onSave }) {
  if (!enquiry || !targetStatus) return null
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={TITLES[targetStatus] || `Mark as ${targetStatus}`}
      description={`${enquiry.name} (${enquiry.company || 'No company'}) will be marked "${targetStatus}". This preserves the enquiry's full history.`}
      submitLabel={TITLES[targetStatus] || 'Save'}
      loading={saving}
      onSubmit={(data) => onSave(data.reason)}
      defaultValues={{ reason: '' }}
      fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2, placeholder: 'Why is this enquiry being marked this way?' }]}
    />
  )
}
