import { useState } from 'react'
import { Handshake, ArrowRight } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { convertLead } from './leadActions'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 py-2 text-sm last:border-0 dark:border-ink-800/60">
      <span className="text-ink-400">{label}</span>
      <span className="font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span>
    </div>
  )
}

/**
 * Spec §6 — "Convert to Deal" is a confirmation step, not a single click: preview the Lead and
 * the Deal it's about to become, let the salesperson confirm, then create it. Reuses the
 * existing convertLead() (already finds-or-creates Company/Contact/Customer rather than
 * duplicating, and already carries every field spec §7 lists forward onto the Deal) —
 * this modal only adds the preview/confirm/result UI around that call.
 */
export function ConvertToDealModal({ open, onClose, lead, onConverted }) {
  const { user } = useAuth()
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  if (!lead) return null
  const owner = getUserById(lead.assignedTo)

  const reset = () => { setResult(null) }
  const closeAll = () => { reset(); onClose() }

  const confirm = () => {
    setSaving(true)
    convertLead(lead, { by: user.id, byName: user.name }).then(({ deal }) => {
      setSaving(false)
      setResult(deal)
      onConverted?.()
    })
  }

  return (
    <Modal
      open={open}
      onClose={closeAll}
      title={result ? 'Deal Created' : 'Convert to Deal'}
      description={result ? undefined : `Review the information below before creating a Deal from ${lead.name}.`}
      footer={result
        ? <Button onClick={closeAll}>Done</Button>
        : <>
          <Button variant="ghost" onClick={closeAll}>Cancel</Button>
          <Button icon={Handshake} onClick={confirm} loading={saving}>Confirm &amp; Create Deal</Button>
        </>}
    >
      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800/50 dark:bg-emerald-900/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Deal Created</p>
          <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200">{result.id}</p>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{result.name}</p>
          <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">Lead {lead.id} is now marked Converted and stays linked to this Deal for full history and source traceability.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 dark:bg-ink-800/50">
            <span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-500 shadow-sm dark:bg-ink-900 dark:text-ink-300">{lead.id}</span>
            <ArrowRight size={14} className="text-ink-400" />
            <span className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">
              <Handshake size={12} /> New Deal
            </span>
          </div>
          <div className="rounded-xl border border-ink-100 p-4 dark:border-ink-800">
            <Row label="Customer / Company" value={lead.company} />
            <Row label="Contact" value={lead.name} />
            <Row label="Product / Service" value={lead.service} />
            <Row label="Requirement" value={lead.requirement} />
            <Row label="Budget" value={lead.budget ? formatCurrency(lead.budget) : null} />
            <Row label="Expected Purchase Date" value={lead.expectedPurchaseDate ? formatDate(lead.expectedPurchaseDate) : null} />
            <Row label="Lead Source" value={lead.source} />
            <Row label="Assigned To" value={owner?.name} />
          </div>
          <p className="text-xs text-ink-400">Contact, Company and Customer records are reused if a match already exists — this will never create a duplicate.</p>
        </div>
      )}
    </Modal>
  )
}
