import { logManualActivity } from '../../api/activityLog'
import { api } from '../../api/mockServer'
import { canTransition, findDuplicateMatches } from '../../data/enquiryWorkflow'
import { logLeadActivity } from '../Leads/leadActions'

/** Thin, shared wrapper so every enquiry action logs to /activities in the exact same shape — reuses the same icon/tone vocabulary as Lead activities (Created, StatusChange, Assignment, Qualification, Conversion, Call/Email/WhatsApp/Meeting/Note) since both timelines render through the same ActivityTimeline component. */
export function logEnquiryActivity(fields) {
  return logManualActivity('Enquiry', fields)
}

/**
 * The single choke point for changing an enquiry's status — validates the transition against
 * ENQUIRY_STATUS_FLOW (rejects if illegal), PUTs the new status, and logs a StatusChange
 * activity. Never PUT `{status}` to /enquiries/:id directly outside this function or the
 * higher-level helpers below (assignEnquiry, closeEnquiry, saveEnquiryQualification,
 * convertEnquiryToLead), which all call it internally.
 */
export function changeEnquiryStatus(enquiry, newStatus, { extraPatch = {} } = {}) {
  if (!canTransition(enquiry.status, newStatus)) {
    return Promise.reject(new Error(`Cannot move an enquiry from "${enquiry.status}" to "${newStatus}".`))
  }
  // the server checks the move again, stamps who closed it and when, and writes the timeline entry
  return api.put(`/enquiries/${enquiry.id}`, { status: newStatus, ...extraPatch }).then((res) => res.data)
}

/** Manual assignment (Team + User) — first assignment on a brand-new enquiry also advances New → Assigned, matching "assignment" being a real lifecycle step, not just a field edit; reassigning an already-assigned enquiry keeps its current status. */
export function assignEnquiry(enquiry, { team, userId }) {
  // the server records who assigned it and when, moves a brand-new enquiry to "Assigned", writes the timeline entry and tells the person it was assigned to
  return api.put(`/enquiries/${enquiry.id}`, { assignedTeam: team, assignedUser: userId }).then((res) => res.data)
}

/** Verification step — Contacted → Under Review, ahead of qualification. */
export function startEnquiryReview(enquiry) {
  return changeEnquiryStatus(enquiry, 'Under Review')
}

/**
 * Saves the Qualification section (Business Need/Budget/Timeline/Decision Maker/Purchase
 * Intent/Product Interest/Quantity/Competitor/Detailed Requirement/Notes) and moves the enquiry
 * to the chosen outcome (Qualified or Unqualified). Unqualified is deliberately distinct from
 * every other disposition — same principle as Lead's Unqualified vs Lost — and, like those,
 * requires a captured reason; the Qualification Notes field is required in the form specifically
 * so it can double as that reason here (closeReason/closedAt/closedBy), rather than leaving
 * Unqualified enquiries with no recorded rationale.
 */
export function saveEnquiryQualification(enquiry, qualification, { outcome }) {
  return api.put(`/enquiries/${enquiry.id}`, { qualification }).then((res) => {
    if (outcome && outcome !== enquiry.status) {
      return changeEnquiryStatus({ ...res.data }, outcome, { extraPatch: outcome === 'Unqualified' ? { closeReason: qualification.qualificationNotes } : {} })
    }
    return res.data
  })
}

/** Unified disposition action for the four non-conversion terminal/near-terminal outcomes (Mark Duplicate / Mark Spam / Mark Not Interested / Close), each requiring a reason. `duplicateOfId` is only set for the Duplicate disposition. */
export function closeEnquiry(enquiry, { targetStatus, reason, duplicateOfId = null }) {
  return changeEnquiryStatus(enquiry, targetStatus, {
    extraPatch: { closeReason: reason, duplicateOfId: targetStatus === 'Duplicate' ? duplicateOfId : enquiry.duplicateOfId },
  })
}

/**
 * Duplicate detection across live Enquiries/Leads/Customers data — see
 * findDuplicateMatches() in src/data/enquiryWorkflow.js for the actual matching logic (phone/
 * email/company/name). Run before creating an enquiry (and can be re-run from the detail page).
 */
export function findDuplicates(candidate, excludeId = null) {
  return Promise.all([
    api.get('/enquiries', { params: { all: true } }),
    api.get('/leads', { params: { all: true } }),
    api.get('/customers', { params: { all: true } }),
  ]).then(([enquiries, leads, customers]) =>
    findDuplicateMatches(candidate, { enquiries: enquiries.data, leads: leads.data, customers: customers.data }, excludeId),
  )
}

/** Existing-Customer detection — if the enquiry's phone/email matches a Customer already on file, surface it so the enquiry can be linked instead of spawning a duplicate Customer record at conversion time. */
export function findExistingCustomer(candidate) {
  return api.get('/customers', { params: { all: true } }).then((res) => {
    const phone = String(candidate.phone || '').replace(/[^\d]/g, '').slice(-10)
    const email = String(candidate.email || '').trim().toLowerCase()
    return res.data.find((c) =>
      (phone && String(c.phone || '').replace(/[^\d]/g, '').slice(-10) === phone) ||
      (email && String(c.email || '').trim().toLowerCase() === email),
    ) || null
  })
}

/**
 * Enquiry → Lead, per the spec's most important integration (§17-18). Transfers source,
 * campaign, requirement, contact info, company info and assigned salesperson onto the new
 * Lead; creates/links the Contact and Company the same way Lead conversion does (never
 * duplicating an existing match by name/email); links the Enquiry to an existing Customer by
 * phone/email if one was already found rather than creating a second Customer record later
 * down the Lead's own conversion path; and links both records back to each other
 * (Lead.sourceEnquiryId / Enquiry.convertedLeadId) so navigation between them is real, not a
 * placeholder. The Enquiry itself is never deleted or overwritten — only marked Converted.
 */
export function convertEnquiryToLead(enquiry) {
  if (enquiry.status !== 'Qualified' || !canTransition(enquiry.status, 'Converted')) {
    return Promise.reject(new Error(`An enquiry must be Qualified before it can be converted to a Lead (currently "${enquiry.status}").`))
  }
  // one server transaction: finds or creates the company and contact, creates the lead, links both records and marks the enquiry converted
  return api.post(`/enquiries/${enquiry.id}/convert`).then((res) => res.data)
}
