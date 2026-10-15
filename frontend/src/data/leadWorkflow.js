// Pure lead-workflow logic only — deliberately has NO dependency on the api/mockServer layer
// (which itself depends on the seed data files, including this module's own consumer
// src/data/leads.js) so importing this from a seed file at module-eval time can never form a
// circular import. The API-dependent action helpers (logLeadActivity, changeLeadStatus) live
// in src/pages/Leads/leadActions.js instead, imported only by UI components.

// Enforced lead lifecycle graph — the only source of truth for which status transitions are
// legal. Primary path: New → Contacted → Qualified → Converted. Unqualified and Lost are the
// two alternative terminal outcomes, reachable only from the stages the spec allows (a lead
// can't be Unqualified from Qualified — by then it's already been judged a real opportunity, so
// the outcome there is Lost, never Unqualified) and are deliberately kept distinct from each
// other: Unqualified means it was never a genuine opportunity; Lost means it was one but the
// business didn't happen. Converted is terminal — once a Lead becomes a Deal, the Lead's own
// history is preserved as-is and every subsequent sales outcome (Quotation, Negotiation, the
// Deal's own Won/Lost) happens on the Deal instead (see src/pages/Deals/dealActions.js); a Deal
// falling through later does NOT reopen or change the Lead — it stays Converted, because it did
// successfully become a Deal. Every place that changes a lead's status must go through
// getAllowedNextStatuses()/changeLeadStatus() so a status never moves outside this graph.
export const LEAD_STATUS_FLOW = {
  New: ['Contacted', 'Unqualified'],
  Contacted: ['Qualified', 'Unqualified', 'Lost'],
  Qualified: ['Converted', 'Lost'],
  Unqualified: [],
  Lost: [],
  Converted: [],
}

export function getAllowedNextStatuses(status) {
  return LEAD_STATUS_FLOW[status] || []
}

export function canTransition(from, to) {
  return getAllowedNextStatuses(from).includes(to)
}

export function isLeadClosed(status) {
  return LEAD_STATUS_FLOW[status]?.length === 0
}

// Duplicate detection lives in src/data/duplicateCheck.js — shared with Enquiry creation so
// "same phone/email/company" matching behaves identically for both record types.
export { findDuplicateMatches } from './duplicateCheck'

// Business Need is complete once a real option is chosen — and, if that option is "Other",
// only once the free-text specification has actually been filled in too (an unfinished
// "Other" pick shouldn't silently count as a filled field).
function hasBusinessNeed(q) {
  return !!q.businessNeed && (q.businessNeed !== 'Other' || !!q.businessNeedOther)
}

// Decision Maker is complete as soon as "No" is explicitly recorded (there's nothing further
// to capture), or once "Yes"/"Partially" is paired with an actual name + designation — picking
// Yes/Partially and leaving the name blank isn't a complete answer.
function hasDecisionMaker(q) {
  if (q.decisionMakerIdentified === 'No') return true
  return ['Yes', 'Partially'].includes(q.decisionMakerIdentified) && !!q.decisionMakerName && !!q.decisionMakerDesignation
}

// Qualification score: a simple, defensible weighted formula rather than a black box —
// budget/decision-maker/timeline/business-need each contribute a fixed weight when filled in,
// and the salesperson's own purchase-probability estimate carries the largest single weight
// since it's their direct judgment call. Score is 0-100; nothing here is passed/failed
// automatically — the salesperson still explicitly decides the outcome (see QualifyLeadModal).
// A "Partially" identified decision maker earns half credit — real progress, but not as
// strong a signal as a fully confirmed one.
export function computeQualificationScore(q) {
  if (!q) return 0
  let score = 0
  if (q.budget) score += 15
  if (q.decisionMakerIdentified === 'Yes' && q.decisionMakerName && q.decisionMakerDesignation) score += 15
  else if (q.decisionMakerIdentified === 'Partially' && q.decisionMakerName && q.decisionMakerDesignation) score += 8
  if (q.timeline) score += 15
  if (q.productInterest) score += 10
  if (q.companySize) score += 10
  if (hasBusinessNeed(q)) score += 15
  score += Math.round((Number(q.purchaseProbability) || 0) * 0.2) // up to 20 more
  return Math.min(100, score)
}

// A lead can't be converted until this returns true — mirrors the required-fields list from
// the qualification spec (Requirement/Budget/Decision Maker/Timeline/Product Interest/Company
// Size/Business Need/Purchase Probability all present).
export function isQualificationComplete(q) {
  if (!q) return false
  return !!(q.requirement && q.budget && hasDecisionMaker(q) && q.timeline && q.productInterest && q.companySize && hasBusinessNeed(q) && q.purchaseProbability)
}
