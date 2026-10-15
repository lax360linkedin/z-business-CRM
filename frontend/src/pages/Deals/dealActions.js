import { logManualActivity } from '../../api/activityLog'
import { api } from '../../api/mockServer'
import { createNotification } from '../../utils/notify'
import { canTransition, isDealClosed, isDealLost, probabilityForStage } from '../../data/dealWorkflow'
import { resolveSourceFromDeal, createQuotation } from '../Quotations/quotationActions'

/**
 * Thin, shared wrapper so every Deal action logs to /activities in the exact same shape as
 * Lead/Enquiry/Contact — see src/components/common/ActivityTimeline.jsx for the icon/tone each
 * `type` renders as. Callers pass `id` explicitly for types that need a stable,
 * independently-addressable id (Meeting — reuses the same MTG-prefixed id as the Lead/Enquiry/
 * Contact modules' `/meetings/:id` join route).
 */
export function logDealActivity(fields) {
  return logManualActivity('Deal', fields)
}

/**
 * The single choke point for moving a Deal between pipeline stages — validates the transition
 * against DEAL_STAGE_FLOW (rejects if illegal, e.g. moving out of an already-closed stage),
 * derives probability from the stage itself (never accepted from the caller — spec: "Users
 * should not manually enter probability"), stamps closedAt/closedBy the moment a deal reaches
 * ANY closed stage, appends a stageHistory entry, and logs a StatusChange timeline activity.
 * Closed Lost / Closed Lost – Competition must go through markDealLost() instead of calling
 * this directly, since those require a reason. Closed Won triggers the Deal → Customer workflow
 * automatically once the stage write succeeds.
 */
export function changeDealStage(deal, newStage, { note, extra = {}, update }) {
  if (!canTransition(deal.stage, newStage)) {
    return Promise.reject(new Error(`Cannot move a deal from "${deal.stage}" to "${newStage}".`))
  }
  // The server owns the probability (derived from the stage), who/when a deal closed, the stage history, the timeline entry, the notifications and - on Closed Won - the link to
  // the customer. The browser only says which stage and why.
  return update(deal.id, { stage: newStage, stageNote: note || undefined, ...extra })
}

/**
 * Closed Lost / Closed Lost – Competition, requiring a reason + optional notes (spec §11).
 * `stage` must be one of the two Lost variants — the calling UI (ChangeStageModal) is
 * responsible for only offering this path for those two stages.
 */
export function markDealLost(deal, { stage, reason, notes, by, update }) {
  if (!reason) return Promise.reject(new Error('A Lost Reason is required before this deal can be closed.'))
  return changeDealStage(deal, stage, {
    by,
    note: `Reason: ${reason}${notes ? ` — ${notes}` : ''}`,
    extra: { lostReason: reason, lostNotes: notes || null, lostDate: new Date().toISOString(), lostBy: by },
    update,
  })
}

/**
 * Deal → Customer, per spec §10. A Deal already carries companyId (set either at creation via
 * the company picker, or carried forward from convertLead()) and usually already carries
 * contactId/customerId too if it came from a converted Lead — this only fills in whichever of
 * Contact/Customer is still missing, by finding an existing match on the company first (never
 * duplicating), and is a no-op patch-wise if the Deal already has a customerId. Never touches
 * or re-creates the Company itself, since the Deal's companyId is always already valid.
 */
export function convertDealToCustomer(deal) {
  // done by the server when the deal reaches Closed Won (it links - or creates - the customer and contact in the same transaction)
  return Promise.resolve(deal)
}

/**
 * Create Quotation from Deal (spec §12) — resolves the Deal's actual linked Company/Contact/
 * Customer (never duplicates, never guesses — see resolveSourceFromDeal in
 * src/pages/Quotations/quotationActions.js), seeds a real line item from the Deal's own
 * service/value so the quotation's totals are never internally inconsistent, carries the full
 * Enquiry→Lead→Deal chain forward, and — unlike the drawer this replaced — actually stores the
 * new Quotation's id back onto the Deal's own quotationIds list and logs a Deal-timeline
 * activity, so "Deal Detail should show Quotation number/status/value/date" has something real
 * to read from.
 */
export function createQuotationFromDeal(deal) {
  // the server links the new quotation to the deal and writes the deal's timeline entry
  return resolveSourceFromDeal(deal).then((payload) => createQuotation(payload))
}
