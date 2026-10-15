import { useOptions } from '../../hooks/useOptions'
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Select, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { DEAL_STAGES } from '../../data/constants'
import { getAllowedNextStages, isDealLost, probabilityForStage } from '../../data/dealWorkflow'

/**
 * The Deal stage-change interface (spec §9) — shows current stage, lets the user pick the new
 * stage (only legal next stages per DEAL_STAGE_FLOW), previews the auto-derived probability,
 * and — for Closed Lost / Closed Lost – Competition specifically — requires a Lost Reason and
 * accepts optional additional notes before the change can be saved. `presetStage` lets a Kanban
 * drag-drop open this already targeting the dropped-on column (still confirms before saving)
 * instead of forcing the user to re-pick it from the dropdown.
 */
export function ChangeStageModal({ open, onClose, deal, presetStage = null, saving, onSave }) {
  const lostReasons = useOptions('deal_lost_reasons', deal?.lostReason)
  const [newStage, setNewStage] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (open) { setNewStage(presetStage || ''); setReason(''); setNotes('') }
  }, [open, presetStage])

  if (!deal) return null
  const options = getAllowedNextStages(deal.stage)
  const requiresReason = isDealLost(newStage)
  const canSubmit = newStage && (!requiresReason || reason)

  const submit = () => {
    if (!canSubmit) return
    onSave({ newStage, reason: requiresReason ? reason : null, notes: requiresReason ? notes : null })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change Stage"
      description={`Move ${deal.name} to a new pipeline stage.`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={!canSubmit}>Save Stage Change</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 dark:bg-ink-800/50">
          <StatusBadge status={deal.stage} />
          <ArrowRight size={14} className="text-ink-400" />
          {newStage ? <StatusBadge status={newStage} /> : <span className="text-xs text-ink-400">Select a new stage…</span>}
        </div>

        <FormField label="New Stage" required>
          <Select value={newStage} onChange={(e) => setNewStage(e.target.value)}>
            <option value="">Select…</option>
            {DEAL_STAGES.filter((s) => options.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </FormField>

        {newStage && (
          <div className="rounded-xl border border-ink-100 p-3 text-sm dark:border-ink-800">
            <span className="text-ink-400">Probability will update to</span>{' '}
            <span className="font-semibold text-ink-800 dark:text-ink-100">{probabilityForStage(newStage)}%</span>
          </div>
        )}

        {requiresReason && (
          <>
            <FormField label="Lost Reason" required>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">{lostReasons.placeholder}</option>
                {lostReasons.values.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </FormField>
            <FormField label="Additional Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  )
}
