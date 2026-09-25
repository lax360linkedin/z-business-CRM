import { useState } from 'react'
import { Handshake, ArrowRight } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { getUserById } from '../../data/users'
import { formatDate } from '../../utils/format'
import { isQualificationComplete } from '../../data/enquiryWorkflow'
import { convertEnquiryToLead } from './enquiryActions'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 py-2 text-sm last:border-0 dark:border-ink-800/60">
      <span className="text-ink-400">{label}</span>
      <span className="font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span>
    </div>
  )
}

/**
 * Spec §17 — "Convert to Lead" is a professional review/confirm step, not a single click:
 * preview the enquiry/contact/requirement/source/assigned salesperson, confirm, then create.
 * Mirrors src/pages/Leads/ConvertToDealModal.jsx's confirm-preview-then-result pattern exactly.
 * Reuses the existing convertEnquiryToLead() (already finds-or-creates Company/Contact rather
 * than duplicating, already links both records back to each other) — this modal only adds the
 * preview/confirm/result UI around that call. The created Lead always starts at status "New"
 * (never Contacted/Qualified directly), per spec.
 */
export function ConvertEnquiryToLeadModal({ open, onClose, enquiry, onConverted }) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  if (!enquiry) return null
  const owner = getUserById(enquiry.assignedUser)
  const ready = enquiry.status === 'Qualified' && isQualificationComplete(enquiry.qualification)

  const reset = () => { setResult(null); setError(null) }
  const closeAll = () => { reset(); onClose() }

  const confirm = () => {
    setSaving(true)
    setError(null)
    convertEnquiryToLead(enquiry, { by: user.id, byName: user.name }).then(({ lead }) => {
      setSaving(false)
      setResult(lead)
      onConverted?.()
    }).catch((err) => { setSaving(false); setError(err.message) })
  }

  return (
    <Modal
      open={open}
      onClose={closeAll}
      title={result ? 'Lead Created' : 'Convert to Lead'}
      description={result ? undefined : `Review the information below before creating a Lead from ${enquiry.name}.`}
      footer={result
        ? <Button onClick={closeAll}>Done</Button>
        : <>
          <Button variant="ghost" onClick={closeAll}>Cancel</Button>
          <Button icon={Handshake} onClick={confirm} loading={saving} disabled={!ready}>Confirm &amp; Create Lead</Button>
        </>}
    >
      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-900/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Lead Created</p>
          <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200">{result.id}</p>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{result.name} — status: New</p>
          <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">Enquiry {enquiry.id} is now marked Converted and stays linked to this Lead for full history and source traceability.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 dark:bg-ink-800/50">
            <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-500 shadow-sm dark:bg-ink-900 dark:text-ink-300">{enquiry.id}</span>
            <ArrowRight size={14} className="text-ink-400" />
            <span className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">
              <Handshake size={12} /> New Lead
            </span>
          </div>
          <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
            <Row label="Contact" value={enquiry.name} />
            <Row label="Company" value={enquiry.company} />
            <Row label="Phone" value={enquiry.phone} />
            <Row label="Email" value={enquiry.email} />
            <Row label="Product/Service Interest" value={enquiry.qualification?.productInterest || enquiry.interestedService || enquiry.interestedProduct} />
            <Row label="Requirement" value={enquiry.qualification?.requirementDetailed || enquiry.requirementDescription} />
            <Row label="Budget" value={enquiry.qualification?.budget || enquiry.budgetRange} />
            <Row label="Expected Purchase Date" value={enquiry.expectedPurchaseDate ? formatDate(enquiry.expectedPurchaseDate) : null} />
            <Row label="Enquiry Source" value={enquiry.source} />
            <Row label="Assigned Salesperson" value={owner?.name} />
          </div>
          {!ready && (
            <p className="text-xs text-rose-500">
              {enquiry.status !== 'Qualified' ? 'This enquiry must be Qualified before it can be converted.' : 'Complete the qualification details before converting.'}
            </p>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <p className="text-xs text-ink-400">Contact and Company records are reused if a match already exists — this will never create a duplicate. The new Lead always starts at status "New".</p>
        </div>
      )}
    </Modal>
  )
}
