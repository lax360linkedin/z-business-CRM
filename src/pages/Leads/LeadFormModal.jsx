import { FormModal } from '../../components/common/FormModal'
import { LEAD_SOURCES, PRIORITIES, INDUSTRIES, CITIES } from '../../data/constants'
import { useProducts, useServiceOptions } from '../../hooks/useProducts'
import { productByName } from '../../utils/productRules'
import { salesUsers } from '../../data/users'

const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/\S*)?$/

/** Shared field schema for both Add Lead and Edit Lead — a lead's status is never editable here (it only moves through the enforced workflow actions), so 'status' is intentionally absent from this form. */
export function LeadFormModal({ open, onClose, title, description, submitLabel, loading, onSubmit, defaultValues }) {
  const reps = salesUsers()
  const { products } = useProducts()
  const serviceNames = useServiceOptions(defaultValues?.service)
  // the lead keeps the catalog item's ID next to the service name, so everything downstream (deal, quotation …) uses the same item
  const submit = (d) => onSubmit({ ...d, productId: productByName(products, d.service)?.id || null })
  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      submitLabel={submitLabel}
      loading={loading}
      onSubmit={submit}
      size="lg"
      defaultValues={defaultValues}
      fields={[
        { name: 'company', label: 'Company Name', required: true, span: 1 },
        { name: 'name', label: 'Contact Name', required: true, span: 1 },
        { name: 'designation', label: 'Designation', span: 1 },
        { name: 'phone', label: 'Phone', required: true, span: 1, pattern: PHONE_PATTERN, patternMessage: 'Enter a valid phone number' },
        { name: 'email', label: 'Email', type: 'email', required: true, span: 1, pattern: EMAIL_PATTERN, patternMessage: 'Enter a valid email address' },
        { name: 'website', label: 'Website', span: 1, pattern: WEBSITE_PATTERN, patternMessage: 'Enter a valid website' },
        { name: 'industry', label: 'Industry', type: 'select', options: INDUSTRIES.map((i) => ({ value: i, label: i })), span: 1 },
        { name: 'location', label: 'Location', type: 'select', options: CITIES.map((c) => ({ value: c, label: c })), span: 1 },
        { name: 'source', label: 'Lead Source', type: 'select', options: LEAD_SOURCES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
        { name: 'service', label: 'Product / Service', type: 'select', options: serviceNames.map((s) => ({ value: s, label: s })), required: true, span: 1 },
        { name: 'budget', label: 'Budget (₹)', type: 'number', span: 1 },
        { name: 'expectedPurchaseDate', label: 'Expected Purchase Date', type: 'date', span: 1 },
        { name: 'assignedTo', label: 'Assigned Salesperson', type: 'select', options: reps.map((r) => ({ value: r.id, label: r.name })), required: true, span: 1 },
        { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), required: true, span: 1 },
        { name: 'requirement', label: 'Requirement', type: 'textarea', required: true, span: 2 },
        { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
    />
  )
}
