// Pure deal-workflow logic only — no dependency on the api/mockServer layer, mirroring
// src/data/leadWorkflow.js and src/data/enquiryWorkflow.js (see those files' headers for why:
// it lets src/data/deals.js import from here at module-eval time without ever forming a
// circular import). The API-dependent action helpers (logDealActivity, changeDealStage,
// convertDealToCustomer) live in src/pages/Deals/dealActions.js instead, imported only by UI
// components.
import { DEAL_STAGE_PROBABILITY, CLOSED_DEAL_STAGES, LOST_DEAL_STAGES } from './constants'

const ACTIVE_STAGES = Object.keys(DEAL_STAGE_PROBABILITY).filter((s) => !CLOSED_DEAL_STAGES.includes(s))

// Enforced deal pipeline graph — any active stage can move to any other active stage (a deal
// can legitimately move back a step, e.g. Negotiation back to Solution Discussion if the scope
// changes) or forward into any of the three closed outcomes. Once a deal reaches a closed stage
// it is terminal — no outgoing edges — matching the spec's "do not allow a closed deal to
// remain in an active pipeline stage" by simply never offering a path back out, the same
// terminal-status pattern already used for Lead's Converted and Enquiry's Converted/Duplicate/
// Spam.
export const DEAL_STAGE_FLOW = Object.fromEntries([
  ...ACTIVE_STAGES.map((stage) => [stage, [...ACTIVE_STAGES.filter((s) => s !== stage), ...CLOSED_DEAL_STAGES]]),
  ...CLOSED_DEAL_STAGES.map((stage) => [stage, []]),
])

export function getAllowedNextStages(stage) {
  return DEAL_STAGE_FLOW[stage] || []
}

export function canTransition(from, to) {
  return getAllowedNextStages(from).includes(to)
}

export function isDealClosed(stage) {
  return CLOSED_DEAL_STAGES.includes(stage)
}

export function isDealLost(stage) {
  return LOST_DEAL_STAGES.includes(stage)
}

export function probabilityForStage(stage) {
  return DEAL_STAGE_PROBABILITY[stage] ?? 0
}
