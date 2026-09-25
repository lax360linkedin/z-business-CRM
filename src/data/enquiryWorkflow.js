// Pure enquiry-workflow logic only — no dependency on the api/mockServer layer, mirroring
// src/data/leadWorkflow.js (see that file's header for why: it lets src/data/enquiries.js
// import from here at module-eval time without ever forming a circular import). The
// API-dependent action helpers (logEnquiryActivity, changeEnquiryStatus, convertEnquiryToLead)
// live in src/pages/Enquiries/enquiryActions.js instead, imported only by UI components.

// Enforced enquiry lifecycle graph — primary path New → Assigned → Contacted → Qualified →
// Converted, collapsed onto the ENQUIRY_STATUSES enum. New also allows a direct contact (an
// enquiry that gets called/emailed before formal assignment still legitimately advances) —
// New/Assigned both lead to Contacted, matching "New: primary action Contact" alongside the
// assignment-first path. Converted, Duplicate and Spam are terminal (no outgoing edges) — once
// an enquiry is converted or flagged, its history is preserved as a permanent record rather
// than reopened. Unqualified and Not Interested/Closed are deliberately distinct outcomes, same
// principle as Lead's Unqualified vs Lost: Unqualified means it never met the qualification
// criteria; Not Interested/Closed means the prospect simply isn't proceeding. Every status
// change must go through getAllowedNextStatuses()/canTransition() so a status never moves
// outside this graph.
export const ENQUIRY_STATUS_FLOW = {
  New: ['Assigned', 'Contacted', 'Duplicate', 'Spam', 'Not Interested', 'Closed'],
  Assigned: ['Contacted', 'Duplicate', 'Not Interested', 'Closed'],
  // Contacted can qualify directly (spec's primary flow: New → Assigned → Contacted →
  // Qualified) or optionally go through Under Review first — that extra verification step is
  // additive, never mandatory.
  Contacted: ['Under Review', 'Qualified', 'Unqualified', 'Not Interested', 'Closed'],
  'Under Review': ['Qualified', 'Unqualified', 'Not Interested', 'Closed'],
  Qualified: ['Converted', 'Unqualified', 'Closed'],
  Converted: [],
  Unqualified: ['Closed'],
  Duplicate: [],
  Spam: [],
  'Not Interested': ['Closed'],
  Closed: [],
}

export function getAllowedNextStatuses(status) {
  return ENQUIRY_STATUS_FLOW[status] || []
}

export function canTransition(from, to) {
  return getAllowedNextStatuses(from).includes(to)
}

export function isEnquiryClosed(status) {
  return ENQUIRY_STATUS_FLOW[status]?.length === 0
}

// The qualification fields required before an enquiry can be converted to a Lead — a lighter
// set than Lead's own qualification (which owns the deeper Decision Maker/Timeline/Purchase
// Probability capture), matching "do not mix Enquiry and Lead responsibilities."
export function isQualificationComplete(q) {
  if (!q) return false
  return !!(q.businessNeed && q.budget && q.timeline && q.purchaseIntent && q.productInterest && q.requirementDetailed)
}

// Duplicate detection itself lives in src/data/duplicateCheck.js — shared with Lead creation
// (src/pages/Leads/leadActions.js) so "same phone/email/company" matching behaves identically
// for both record types. Re-exported here so existing imports of findDuplicateMatches from
// this module keep working unchanged.
export { findDuplicateMatches } from './duplicateCheck'
