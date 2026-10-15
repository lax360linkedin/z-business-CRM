import { useOptions } from '../../hooks/useOptions'
import { useEffect } from 'react'
import { productByName } from '../../utils/productRules'
import { useProducts, useServiceCatalog, useAllServiceNames } from '../../hooks/useProducts'
import { useForm } from 'react-hook-form'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { DECISION_MAKER_STATUSES } from '../../data/constants'
import { computeQualificationScore, canTransition } from '../../data/leadWorkflow'

/**
 * Captures the 8 qualification fields required before a Contacted lead can move to Qualified
 * (and, from there, be converted to a Deal). The score is informational only — submitting this
 * form with every required field filled in is itself what "qualification completed
 * successfully" means, so a valid submit always moves Contacted → Qualified.
 */
export function QualifyLeadModal({ open, onClose, lead, saving, onSave }) {
  const { products } = useProducts()
  const catalog = useServiceCatalog(lead?.service)
  const serviceNames = catalog.names
  const needs = useOptions('business_needs')
  const timelines = useOptions('qualification_timelines')
  const sizes = useOptions('company_sizes')
  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues: {
      requirement: lead?.requirement || '',
      budget: lead?.budget || '',
      decisionMakerIdentified: '',
      decisionMakerName: '',
      decisionMakerDesignation: '',
      timeline: '',
      productInterest: lead?.service || '',
      companySize: '',
      businessNeed: '',
      businessNeedOther: '',
      purchaseProbability: 50,
    },
  })

  useEffect(() => {
    if (open && lead) {
      reset({
        requirement: lead.qualification?.requirement || lead.requirement || '',
        budget: lead.qualification?.budget || lead.budget || '',
        decisionMakerIdentified: lead.qualification?.decisionMakerIdentified || '',
        decisionMakerName: lead.qualification?.decisionMakerName || '',
        decisionMakerDesignation: lead.qualification?.decisionMakerDesignation || '',
        timeline: lead.qualification?.timeline || '',
        productInterest: lead.qualification?.productInterest || lead.service || '',
        companySize: lead.qualification?.companySize || '',
        businessNeed: lead.qualification?.businessNeed || '',
        businessNeedOther: lead.qualification?.businessNeedOther || '',
        purchaseProbability: lead.qualification?.purchaseProbability ?? 50,
      })
    }
  }, [open, lead, reset])

  if (!lead) return null

  const values = watch()
  const score = computeQualificationScore(values)
  const canQualify = canTransition(lead.status, 'Qualified')
  const showDecisionMakerDetails = ['Yes', 'Partially'].includes(values.decisionMakerIdentified)
  const showBusinessNeedOther = values.businessNeed === 'Other'

  const submit = (outcome) => handleSubmit((data) => {
    // Discard the conditional sub-fields when they're not applicable, rather than saving
    // stale/hidden values a later "Decision Maker Identified? No" or non-"Other" pick
    // shouldn't still be carrying.
    const cleaned = {
      ...data,
      decisionMakerName: ['Yes', 'Partially'].includes(data.decisionMakerIdentified) ? data.decisionMakerName : '',
      decisionMakerDesignation: ['Yes', 'Partially'].includes(data.decisionMakerIdentified) ? data.decisionMakerDesignation : '',
      businessNeedOther: data.businessNeed === 'Other' ? data.businessNeedOther : '',
    }
    const qualification = { ...cleaned, productId: productByName(products, cleaned.productInterest)?.id || null, qualificationScore: computeQualificationScore(cleaned), qualifiedAt: new Date().toISOString() }
    onSave(qualification, outcome)
  })()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Qualify Lead"
      description={`Capture qualification details for ${lead.name} before this lead can be converted.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {canQualify && <Button onClick={() => submit('Qualified')} loading={saving}>Save — Mark Qualified</Button>}
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
        <span className="text-sm font-medium text-ink-700 dark:text-ink-200">Qualification Score</span>
        <span className="text-lg font-bold text-brand-600 dark:text-brand-400">{score}/100</span>
      </div>
      <form className="grid grid-cols-2 gap-4">
        <FormField label="Requirement" required className="col-span-2">
          <Textarea {...register('requirement', { required: true })} />
        </FormField>
        <FormField label="Budget (₹)" required>
          <Input type="number" {...register('budget', { required: true })} />
        </FormField>
        <FormField label="Timeline" required>
          <Select {...register('timeline', { required: true })}>
            <option value="">Select…</option>
            {timelines.values.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>

        <FormField label="Decision Maker Identified?" required className={showDecisionMakerDetails ? 'col-span-1' : 'col-span-2'}>
          <Select {...register('decisionMakerIdentified', { required: true })}>
            <option value="">Select…</option>
            {DECISION_MAKER_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        {showDecisionMakerDetails && (
          <>
            <FormField label="Decision Maker Name" required>
              <Input placeholder="e.g. Rajesh Kumar" {...register('decisionMakerName', { required: showDecisionMakerDetails })} />
            </FormField>
            <FormField label="Designation" required className="col-span-2">
              <Input placeholder="e.g. Managing Director" {...register('decisionMakerDesignation', { required: showDecisionMakerDetails })} />
            </FormField>
          </>
        )}

        <FormField label="Product Interest" required>
          <Select {...register('productInterest', { required: true })}>
            <option value="">{catalog.placeholder}</option>
            {serviceNames.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        <FormField label="Company Size" required>
          <Select {...register('companySize', { required: true })}>
            <option value="">Select…</option>
            {sizes.values.map((o) => <option key={o} value={o}>{o} employees</option>)}
          </Select>
        </FormField>

        <FormField label="Business Need" required className={showBusinessNeedOther ? 'col-span-1' : 'col-span-2'}>
          <Select {...register('businessNeed', { required: true })}>
            <option value="">Select…</option>
            {needs.values.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </FormField>
        {showBusinessNeedOther && (
          <FormField label="Specify Business Need" required>
            <Input placeholder="e.g. Need a customized CRM workflow for our sales team" {...register('businessNeedOther', { required: showBusinessNeedOther })} />
          </FormField>
        )}

        <FormField label={`Purchase Probability — ${values.purchaseProbability}%`} className="col-span-2">
          <input type="range" min="0" max="100" step="5" className="w-full accent-brand-600" {...register('purchaseProbability')} />
        </FormField>
      </form>
      {!canQualify && (
        <p className="mt-3 text-xs text-ink-400">This lead's current status ({lead.status}) doesn't allow moving to Qualified.</p>
      )}
    </Modal>
  )
}
