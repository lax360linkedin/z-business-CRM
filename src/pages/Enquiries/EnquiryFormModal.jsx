import { useEffect, useState } from 'react'
import { useProducts, useServiceOptions } from '../../hooks/useProducts'
import { productByName } from '../../utils/productRules'
import { useForm } from 'react-hook-form'
import { AlertTriangle, UserSquare2, Eye, Plus, Copy } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import {
  ENQUIRY_SOURCES, ENQUIRY_TYPES, ENQUIRY_PRIORITIES, ASSIGNED_TEAMS, REQUIREMENT_TYPES,
  PREFERRED_CONTACT_METHODS, INDUSTRIES, CITIES,
} from '../../data/constants'
import { salesUsers } from '../../data/users'
import { findDuplicates, findExistingCustomer } from './enquiryActions'

const SECTION_LABEL = 'mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-400 first:mt-0 col-span-2'
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Section({ children }) {
  return <p className={SECTION_LABEL}>{children}</p>
}

/**
 * Sectioned Add/Edit Enquiry form (Enquiry Information / Contact Information / Location /
 * Requirement / Additional, per spec §6) — deliberately NOT the flat generic FormModal, since
 * the spec requires clear visual sections rather than a wall of fields. On create, runs
 * duplicate + existing-customer detection (§10-11) before actually creating the record, and
 * surfaces a warning panel with real actions rather than silently proceeding.
 */
export function EnquiryFormModal({ open, onClose, mode = 'create', enquiry, saving, onSubmit: onSubmitProp, onViewMatch }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues: {} })
  const [checking, setChecking] = useState(false)
  const [warning, setWarning] = useState(null) // { matches, existingCustomer, pendingData }
  const reps = salesUsers()
  const { products } = useProducts()
  const serviceNames = useServiceOptions(enquiry?.interestedService || enquiry?.interestedProduct)
  const onSubmit = (d, extra) => onSubmitProp({ ...d, productId: productByName(products, d.interestedService || d.interestedProduct)?.id || null }, extra)

  useEffect(() => {
    if (!open) return
    setWarning(null)
    reset(mode === 'edit' && enquiry ? { ...enquiry, tags: (enquiry.tags || []).join(', ') } : {
      source: ENQUIRY_SOURCES[0],
      enquiryType: ENQUIRY_TYPES[0],
      priority: 'Medium',
      requirementType: REQUIREMENT_TYPES[0],
      preferredContactMethod: 'Phone',
      country: 'India',
    })
  }, [open, mode, enquiry, reset])

  const runCreate = (data) => {
    setChecking(true)
    Promise.all([findDuplicates(data), findExistingCustomer(data)]).then(([matches, existingCustomer]) => {
      setChecking(false)
      if (matches.length || existingCustomer) {
        setWarning({ matches, existingCustomer, pendingData: data })
      } else {
        onSubmit(data, {})
      }
    })
  }

  const submit = handleSubmit((data) => (mode === 'create' ? runCreate(data) : onSubmit(data, {})))

  const createAnyway = () => {
    onSubmit(warning.pendingData, { existingCustomerId: warning.existingCustomer?.id || null })
    setWarning(null)
  }
  const markAsDuplicate = () => {
    onSubmit(warning.pendingData, { markDuplicate: true, duplicateOfId: warning.matches[0]?.id })
    setWarning(null)
  }

  if (warning) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Possible Duplicate Found"
        description="Review the matching record(s) below before creating this enquiry."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWarning(null)}>Back to Form</Button>
            <Button variant="secondary" icon={Copy} onClick={markAsDuplicate}>Mark as Duplicate</Button>
            <Button icon={Plus} onClick={createAnyway} loading={saving}>Create Anyway</Button>
          </>
        }
      >
        {warning.existingCustomer && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-800/50 dark:bg-brand-900/20">
            <UserSquare2 size={18} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
            <div>
              <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">Existing Customer Found</p>
              <p className="mt-0.5 text-sm text-brand-700 dark:text-brand-300">
                {warning.existingCustomer.name} is already a customer. This enquiry will be linked to that account instead of creating a duplicate.
              </p>
            </div>
          </div>
        )}
        {warning.matches.length > 0 && (
          <>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle size={16} /> Similar record{warning.matches.length > 1 ? 's' : ''} already exist{warning.matches.length === 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
              {warning.matches.map((m) => (
                <div key={`${m.source}-${m.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{m.source}</Badge>
                      <span className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{m.id}</span>
                      {m.status && <Badge tone="info">{m.status}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-500 dark:text-ink-400">
                      {m.name} · {m.company} · {m.phone} · {m.email} — matched on {m.matchedOn.join(', ')}
                    </p>
                  </div>
                  {onViewMatch && (
                    <Button variant="secondary" size="sm" icon={Eye} onClick={() => { onViewMatch(m); onClose() }}>View Existing</Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? `Edit Enquiry — ${enquiry?.id}` : 'Add New Enquiry'}
      description={mode === 'edit' ? `Update details for ${enquiry?.name}.` : 'Capture an incoming enquiry. Duplicate and existing-customer checks run automatically on save.'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={saving || checking}>{mode === 'edit' ? 'Save Changes' : 'Create Enquiry'}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Section>Enquiry Information</Section>
        <FormField label="Source" required>
          <Select {...register('source', { required: true })}>{ENQUIRY_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Campaign" hint="Optional — e.g. August CRM Campaign">
          <Input {...register('campaign')} />
        </FormField>
        <FormField label="Enquiry Type" required>
          <Select {...register('enquiryType', { required: true })}>{ENQUIRY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Priority" required>
          <Select {...register('priority', { required: true })}>{ENQUIRY_PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Assigned Team">
          <Select {...register('assignedTeam')}><option value="">Unassigned</option>{ASSIGNED_TEAMS.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Assigned User">
          <Select {...register('assignedUser')}><option value="">Unassigned</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        </FormField>

        <Section>Contact Information</Section>
        <FormField label="Full Name" required error={errors.name?.message}><Input {...register('name', { required: 'This field is required' })} /></FormField>
        <FormField label="Company Name"><Input {...register('company')} /></FormField>
        <FormField label="Email" error={errors.email?.message}>
          <Input type="email" {...register('email', { pattern: { value: EMAIL_PATTERN, message: 'Enter a valid email address' } })} />
        </FormField>
        <FormField label="Phone" required error={errors.phone?.message}>
          <Input {...register('phone', { required: 'This field is required', pattern: { value: PHONE_PATTERN, message: 'Enter a valid phone number' } })} />
        </FormField>
        <FormField label="Alternate Phone"><Input {...register('alternatePhone')} /></FormField>
        <FormField label="WhatsApp Number"><Input {...register('whatsapp')} /></FormField>
        <FormField label="Designation" className="col-span-2"><Input {...register('designation')} /></FormField>

        <Section>Location</Section>
        <FormField label="Country"><Input {...register('country')} /></FormField>
        <FormField label="State"><Input {...register('state')} /></FormField>
        <FormField label="City">
          <Select {...register('city')}><option value="">Select…</option>{CITIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Area"><Input {...register('area')} /></FormField>
        <FormField label="Address" className="col-span-2"><Textarea {...register('address')} /></FormField>
        <FormField label="Pincode"><Input {...register('pincode')} /></FormField>

        <Section>Requirement</Section>
        <FormField label="Interested Product">
          <Select {...register('interestedProduct')}><option value="">Select…</option>{serviceNames.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Interested Service">
          <Select {...register('interestedService')}><option value="">Select…</option>{serviceNames.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Category">
          <Select {...register('category')}><option value="">Select…</option>{INDUSTRIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Requirement Type">
          <Select {...register('requirementType')}>{REQUIREMENT_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>
        <FormField label="Requirement Description" required className="col-span-2" error={errors.requirementDescription?.message}>
          <Textarea {...register('requirementDescription', { required: 'This field is required' })} />
        </FormField>
        <FormField label="Quantity"><Input type="number" min="0" {...register('quantity')} /></FormField>
        <FormField label="Budget Range"><Input placeholder="e.g. ₹1L - ₹5L" {...register('budgetRange')} /></FormField>
        <FormField label="Expected Purchase Date"><DateInput {...register('expectedPurchaseDate')} /></FormField>
        <FormField label="Preferred Contact Method">
          <Select {...register('preferredContactMethod')}>{PREFERRED_CONTACT_METHODS.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </FormField>

        <Section>Additional</Section>
        <FormField label="Tags" hint="Comma-separated" className="col-span-2">
          <Input {...register('tags')} />
        </FormField>
        <FormField label="Notes" className="col-span-2"><Textarea {...register('notes')} /></FormField>
      </form>
    </Modal>
  )
}
