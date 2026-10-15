import { useOptions } from '../../hooks/useOptions'
import { useEffect } from 'react'
import { productByName } from '../../utils/productRules'
import { useProducts, useServiceCatalog, useAllServiceNames } from '../../hooks/useProducts'
import { useForm } from 'react-hook-form'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { canTransition } from '../../data/enquiryWorkflow'

/**
 * Captures the Qualification section (§7) — deliberately a lighter field set than Lead's own
 * qualification (no Decision Maker Yes/No/Partially sub-flow, no scoring) since that deeper
 * capture belongs to the Lead once converted, per "keep Enquiry and Lead responsibilities
 * clearly separated."
 */
export function QualifyEnquiryModal({ open, onClose, enquiry, saving, onSave }) {
  const { register, handleSubmit, reset } = useForm({ defaultValues: {} })
  const { products } = useProducts()
  const catalog = useServiceCatalog(enquiry?.interestedService)
  const serviceNames = catalog.names
  const needs = useOptions('business_needs')
  const timelines = useOptions('qualification_timelines')
  const intents = useOptions('purchase_intents')

  useEffect(() => {
    if (open && enquiry) {
      reset({
        businessNeed: enquiry.qualification?.businessNeed || '',
        budget: enquiry.qualification?.budget || enquiry.budgetRange || '',
        timeline: enquiry.qualification?.timeline || '',
        decisionMaker: enquiry.qualification?.decisionMaker || '',
        purchaseIntent: enquiry.qualification?.purchaseIntent || '',
        productInterest: enquiry.qualification?.productInterest || enquiry.interestedService || enquiry.interestedProduct || '',
        quantity: enquiry.qualification?.quantity ?? enquiry.quantity ?? '',
        competitor: enquiry.qualification?.competitor || '',
        requirementDetailed: enquiry.qualification?.requirementDetailed || enquiry.requirementDescription || '',
        qualificationNotes: enquiry.qualification?.qualificationNotes || '',
      })
    }
  }, [open, enquiry, reset])

  if (!enquiry) return null
  const canQualify = canTransition(enquiry.status, 'Qualified')
  const canReject = canTransition(enquiry.status, 'Unqualified')

  const submit = (outcome) => handleSubmit((data) => {
    onSave({ ...data, productId: productByName(products, data.productInterest)?.id || null, qualifiedAt: new Date().toISOString() }, outcome)
  })()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Qualify Enquiry"
      description={`Capture qualification details for ${enquiry.name} before deciding the outcome.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {canReject && <Button variant="danger" onClick={() => submit('Unqualified')} loading={saving}>Save — Unqualified</Button>}
          {canQualify && <Button onClick={() => submit('Qualified')} loading={saving}>Save — Mark Qualified</Button>}
        </>
      }
    >
      <form className="grid grid-cols-2 gap-4">
        <FormField label="Business Need" required>
          <Select {...register('businessNeed', { required: true })}>
            <option value="">Select…</option>
            {needs.values.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Budget" required>
          <Input placeholder="e.g. ₹2,50,000" {...register('budget', { required: true })} />
        </FormField>
        <FormField label="Timeline" required>
          <Select {...register('timeline', { required: true })}>
            <option value="">Select…</option>
            {timelines.values.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Purchase Intent" required>
          <Select {...register('purchaseIntent', { required: true })}>
            <option value="">Select…</option>
            {intents.values.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Product Interest" required>
          <Select {...register('productInterest', { required: true })}>
            <option value="">{catalog.placeholder}</option>
            {serviceNames.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Quantity">
          <Input type="number" min="0" {...register('quantity')} />
        </FormField>
        <FormField label="Decision Maker">
          <Input placeholder="Name, if known" {...register('decisionMaker')} />
        </FormField>
        <FormField label="Competitor" hint="Optional">
          <Input placeholder="e.g. Evaluating a competitor as well" {...register('competitor')} />
        </FormField>
        <FormField label="Detailed Requirement" required className="col-span-2">
          <Textarea {...register('requirementDetailed', { required: true })} />
        </FormField>
        <FormField label="Qualification Notes" required hint="Also used as the recorded reason if you mark this Unqualified." className="col-span-2">
          <Textarea {...register('qualificationNotes', { required: true })} />
        </FormField>
      </form>
      {!canQualify && !canReject && (
        <p className="mt-3 text-xs text-ink-400">This enquiry's current status ({enquiry.status}) doesn't allow a qualification decision right now.</p>
      )}

    </Modal>
  )
}
