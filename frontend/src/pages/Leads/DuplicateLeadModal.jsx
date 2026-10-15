import { AlertTriangle, Eye, Plus } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'

/**
 * Shown when findDuplicates() (see leadActions.js) turns up a possible match while creating a
 * Lead — matches the spec's "avoid duplicate Leads" requirement (§9). "Duplicate" is not a Lead
 * status in this CRM (Lead statuses are just New/Contacted/Qualified/Converted), so this modal
 * only ever offers two real choices: go look at the existing record instead, or confirm this is
 * genuinely a separate lead and create it as a normal New lead.
 */
export function DuplicateLeadModal({ open, onClose, matches, saving, onViewMatch, onCreateAnyway }) {
  if (!matches?.length) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Possible Duplicate Lead"
      description="Review the matching record(s) below before creating this lead."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back to Form</Button>
          <Button icon={Plus} onClick={onCreateAnyway} loading={saving}>Create Anyway</Button>
        </>
      }
    >
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle size={16} /> Similar record{matches.length > 1 ? 's' : ''} already exist{matches.length === 1 ? 's' : ''}
      </p>
      <div className="space-y-2">
        {matches.map((m) => (
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
              <Button variant="secondary" size="sm" icon={Eye} onClick={() => onViewMatch(m)}>View Existing</Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
