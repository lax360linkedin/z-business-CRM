import { logManualActivity } from '../../api/activityLog'
import { api } from '../../api/mockServer'
import { canTransition, findDuplicateMatches } from '../../data/leadWorkflow'

/** Thin, shared wrapper so every lead action (call, status change, assignment, qualification, conversion) logs to /activities in the exact same shape — see src/components/common/ActivityTimeline.jsx for the icon/tone each `type` renders as. */
export function logLeadActivity(fields) {
  return logManualActivity('Lead', fields)
}

/**
 * Duplicate detection across live Enquiries/Leads/Customers data — see findDuplicateMatches()
 * in src/data/duplicateCheck.js for the actual matching logic (phone/email/company/name). Run
 * before creating a lead (manually, via CSV import, or via the automatic capture pipeline
 * below) so the CRM never silently creates a duplicate record, per the spec's "Check Duplicate
 * Lead" step.
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

/**
 * The single choke point for changing a lead's status — validates the transition against
 * LEAD_STATUS_FLOW (rejects if illegal), PUTs the new status, and logs a StatusChange activity
 * so status history is always reconstructable from the activity timeline. Never PUT
 * `{status}` to /leads/:id directly outside this function or `convertLead` below (which calls
 * it internally).
 */
export function changeLeadStatus(lead, newStatus, { extraPatch = {} } = {}) {
  if (!canTransition(lead.status, newStatus)) {
    return Promise.reject(new Error(`Cannot move a lead from "${lead.status}" to "${newStatus}".`))
  }
  // the server checks the move again, stamps who closed it and when, keeps the score up to date and writes the timeline entry
  return api.put(`/leads/${lead.id}`, { status: newStatus, ...extraPatch }).then((res) => res.data)
}

/** Administrative override — skips the LEAD_STATUS_FLOW guard in the browser. Only offered to administrators; the server decides whether the move is allowed. */
export function overrideLeadStatus(lead, newStatus) {
  return api.put(`/leads/${lead.id}`, { status: newStatus }).then((res) => res.data)
}

/** The server records who assigned it and when, writes the timeline entry and tells the new owner. */
export function reassignLead(lead, { newAssigneeId }) {
  return api.put(`/leads/${lead.id}`, { assignedTo: newAssigneeId }).then((res) => res.data)
}

/** Unqualified — reviewed but never met the criteria. A reason is required; who and when are recorded by the server. */
export function markLeadUnqualified(lead, { reason, notes }) {
  return changeLeadStatus(lead, 'Unqualified', { extraPatch: { unqualifiedReason: reason, unqualifiedNotes: notes || null } })
}

/** Lost — a genuine opportunity (Contacted or Qualified) that stopped before it became a Deal. A reason is required; who and when are recorded by the server. */
export function markLeadLost(lead, { reason, notes }) {
  return changeLeadStatus(lead, 'Lost', { extraPatch: { lostReason: reason, lostNotes: notes || null } })
}

export function saveLeadQualification(lead, qualification, { outcome }) {
  return api.put(`/leads/${lead.id}`, { qualification }).then((res) => {
    if (outcome && outcome !== lead.status) {
      return changeLeadStatus({ ...res.data }, outcome)
    }
    return res.data
  })
}

/**
 * Lead → Customer/Account → Contact → Opportunity(Deal), per the spec's conversion chain.
 * Finds-or-creates the Company/Contact/Customer (never duplicates an existing match by
 * name/email), carries forward Requirement/Product/Budget/Assigned Salesperson onto the new
 * Deal exactly as the "Data Consistency" mapping specifies, then links everything back onto
 * the Lead (dealId/customerId/contactId/companyId/convertedAt/convertedBy) so the original
 * Lead ID and full history stay intact and traceable — the Lead record itself is never
 * deleted or overwritten, only marked Converted.
 */
export function convertLead(lead) {
  if (!canTransition(lead.status, 'Converted')) {
    return Promise.reject(new Error(`A lead must be Qualified before it can be converted to a Deal (currently "${lead.status}").`))
  }
  // one server transaction: finds or creates the company, contact and customer, creates the deal, marks the lead converted, writes the timeline and notifies the owner
  return api.post(`/leads/${lead.id}/convert`).then((res) => res.data)
}
