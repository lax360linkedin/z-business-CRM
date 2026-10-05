import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { canTransition, findDuplicateMatches } from '../../data/enquiryWorkflow'
import { createNotification } from '../../utils/notify'
import { logLeadActivity } from '../Leads/leadActions'

/** ENQ-2026-000001 — auto-generated, sequential per year, per spec §4. Never manually entered. */
export function genEnquiryId(existingEnquiries = []) {
  const year = new Date().getFullYear()
  const prefix = `ENQ-${year}-`
  const maxSeq = existingEnquiries
    .filter((e) => e.id?.startsWith(prefix))
    .reduce((max, e) => Math.max(max, Number(e.id.slice(prefix.length)) || 0), 0)
  return `${prefix}${String(maxSeq + 1).padStart(6, '0')}`
}

/** Thin, shared wrapper so every enquiry action logs to /activities in the exact same shape — reuses the same icon/tone vocabulary as Lead activities (Created, StatusChange, Assignment, Qualification, Conversion, Call/Email/WhatsApp/Meeting/Note) since both timelines render through the same ActivityTimeline component. */
export function logEnquiryActivity({ type, enquiryId, enquiryName, subject, notes, by }) {
  return api.post('/activities', {
    id: genId('ACT'),
    type,
    relatedType: 'Enquiry',
    relatedId: enquiryId,
    relatedName: enquiryName,
    subject,
    notes: notes || null,
    date: new Date().toISOString(),
    by,
    status: 'Completed',
  })
}

/**
 * The single choke point for changing an enquiry's status — validates the transition against
 * ENQUIRY_STATUS_FLOW (rejects if illegal), PUTs the new status, and logs a StatusChange
 * activity. Never PUT `{status}` to /enquiries/:id directly outside this function or the
 * higher-level helpers below (assignEnquiry, closeEnquiry, saveEnquiryQualification,
 * convertEnquiryToLead), which all call it internally.
 */
export function changeEnquiryStatus(enquiry, newStatus, { by, extraPatch = {}, note } = {}) {
  if (!canTransition(enquiry.status, newStatus)) {
    return Promise.reject(new Error(`Cannot move an enquiry from "${enquiry.status}" to "${newStatus}".`))
  }
  return api.put(`/enquiries/${enquiry.id}`, { status: newStatus, ...extraPatch }).then((res) => {
    logEnquiryActivity({
      type: 'StatusChange',
      enquiryId: enquiry.id,
      enquiryName: enquiry.name,
      subject: `Status changed from ${enquiry.status} to ${newStatus}`,
      notes: note,
      by,
    })
    return res.data
  })
}

/** Manual assignment (Team + User) — first assignment on a brand-new enquiry also advances New → Assigned, matching "assignment" being a real lifecycle step, not just a field edit; reassigning an already-assigned enquiry keeps its current status. */
export function assignEnquiry(enquiry, { team, userId, by, byName, userName }) {
  const patch = { assignedTeam: team, assignedUser: userId, assignedBy: by, assignedAt: new Date().toISOString() }
  const advance = enquiry.status === 'New' && canTransition('New', 'Assigned')
  const request = advance
    ? api.put(`/enquiries/${enquiry.id}`, { ...patch, status: 'Assigned' })
    : api.put(`/enquiries/${enquiry.id}`, patch)
  return request.then((res) => {
    logEnquiryActivity({
      type: 'Assignment',
      enquiryId: enquiry.id,
      enquiryName: enquiry.name,
      subject: enquiry.assignedUser ? `Reassigned from ${byName || 'a team member'} to ${userName} (${team} team)` : `Assigned to ${userName} (${team} team)`,
      by,
    })
    createNotification({ type: 'Enquiry Assignment', message: `${enquiry.name} (${enquiry.company}) was assigned to you.`, relatedType: 'Enquiry', relatedId: enquiry.id })
    return res.data
  })
}

/** Verification step — Contacted → Under Review, ahead of qualification. */
export function startEnquiryReview(enquiry, { by }) {
  return changeEnquiryStatus(enquiry, 'Under Review', { by, note: 'Moved to verification/review before qualification.' })
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
export function saveEnquiryQualification(enquiry, qualification, { by, outcome }) {
  return api.put(`/enquiries/${enquiry.id}`, { qualification }).then((res) => {
    logEnquiryActivity({
      type: 'Qualification',
      enquiryId: enquiry.id,
      enquiryName: enquiry.name,
      subject: 'Qualification details captured',
      by,
    })
    if (outcome && outcome !== enquiry.status) {
      const extraPatch = outcome === 'Unqualified'
        ? { closeReason: qualification.qualificationNotes, closedAt: new Date().toISOString(), closedBy: by }
        : {}
      return changeEnquiryStatus({ ...res.data }, outcome, {
        by,
        extraPatch,
        note: outcome === 'Unqualified' ? `Reason: ${qualification.qualificationNotes}` : undefined,
      }).then((updated) => {
        if (outcome === 'Qualified') {
          createNotification({ type: 'Enquiry Qualified', message: `${enquiry.name} (${enquiry.company}) was qualified.`, relatedType: 'Enquiry', relatedId: enquiry.id })
        }
        return updated
      })
    }
    return res.data
  })
}

/** Unified disposition action for the four non-conversion terminal/near-terminal outcomes (Mark Duplicate / Mark Spam / Mark Not Interested / Close), each requiring a reason. `duplicateOfId` is only set for the Duplicate disposition. */
export function closeEnquiry(enquiry, { targetStatus, reason, by, duplicateOfId = null }) {
  return changeEnquiryStatus(enquiry, targetStatus, {
    by,
    note: reason,
    extraPatch: {
      closeReason: reason,
      closedAt: new Date().toISOString(),
      closedBy: by,
      duplicateOfId: targetStatus === 'Duplicate' ? duplicateOfId : enquiry.duplicateOfId,
    },
  }).then((updated) => {
    if (targetStatus === 'Closed') {
      createNotification({ type: 'Enquiry Closed', message: `${enquiry.name} (${enquiry.company}) was closed.`, relatedType: 'Enquiry', relatedId: enquiry.id })
    }
    return updated
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

// Case-insensitive find-or-create so converting an enquiry for a company that already exists
// (from an earlier conversion, or seeded data) links to the SAME company record instead of
// creating a duplicate. Mirrors findOrCreateCompany/Contact/Customer in leadActions.js exactly.
// Exported so Enquiries.jsx can also call it at ENQUIRY CREATION time (not just at conversion),
// per spec: a Company must exist in Company Management as soon as an enquiry names one, not
// only once that enquiry later becomes a Lead.
export function findOrCreateCompany(enquiry) {
  return api.get('/companies', { params: { all: true } }).then((res) => {
    const match = res.data.find((c) => c.name.toLowerCase() === (enquiry.company || '').toLowerCase())
    if (match) return match
    return api.post('/companies', {
      id: genId('CMP'),
      name: enquiry.company || `${enquiry.name}'s Company`,
      industry: enquiry.category || '',
      contactPerson: enquiry.name,
      email: enquiry.email,
      phone: enquiry.phone,
      website: '',
      city: enquiry.city || '',
      address: enquiry.address || '',
      billingAddress: enquiry.address || '',
      shippingAddress: enquiry.address || '',
      gstin: '',
      revenue: 0,
      status: 'Prospect',
      createdDate: new Date().toISOString().slice(0, 10),
      tags: [],
    }).then((r) => r.data)
  })
}

// Matches on email OR phone (whichever the enquiry actually has — Enquiry's own Email field is
// optional, unlike Lead's, so an email-only match would silently create a second Contact for
// the same person every time an email-less enquiry from them gets converted). Guards against a
// contact record missing either field rather than assuming both are always populated.
function findOrCreateContact(enquiry, company) {
  return api.get('/contacts', { params: { all: true } }).then((res) => {
    const email = (enquiry.email || '').toLowerCase()
    const phone = enquiry.phone || ''
    const match = res.data.find((c) => c.companyId === company.id && (
      (email && (c.email || '').toLowerCase() === email) ||
      (phone && c.phone === phone)
    ))
    if (match) return match
    return api.post('/contacts', {
      id: genId('CT'),
      name: enquiry.name,
      designation: enquiry.designation || '',
      email: enquiry.email,
      phone: enquiry.phone,
      whatsapp: enquiry.whatsapp || enquiry.phone,
      companyId: company.id,
      companyName: company.name,
      groups: ['Primary Contact'],
      createdDate: new Date().toISOString().slice(0, 10),
      nextFollowUp: null,
      lastContactedDate: null,
      notes: '',
      initials: enquiry.initials,
      avatarColor: enquiry.avatarColor,
    }).then((r) => r.data)
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
export function convertEnquiryToLead(enquiry, { by, byName }) {
  if (enquiry.status !== 'Qualified' || !canTransition(enquiry.status, 'Converted')) {
    return Promise.reject(new Error(`An enquiry must be Qualified before it can be converted to a Lead (currently "${enquiry.status}").`))
  }
  let company
  return findOrCreateCompany(enquiry)
    .then((c) => { company = c; return findOrCreateContact(enquiry, company) })
    .then((contact) => {
      const leadId = genId('LD')
      return api.post('/leads', {
        id: leadId,
        name: enquiry.name,
        company: enquiry.company || company.name,
        designation: enquiry.designation || '',
        email: enquiry.email,
        phone: enquiry.phone,
        website: '',
        industry: enquiry.category || '',
        location: enquiry.city || '',
        source: enquiry.source,
        service: enquiry.qualification?.productInterest || enquiry.interestedService || enquiry.interestedProduct,
        productId: enquiry.qualification?.productId || enquiry.productId || null,
        requirement: enquiry.qualification?.requirementDetailed || enquiry.requirementDescription,
        // Best-effort numeric parse of the qualification budget (a free-text string like
        // "₹2,50,000") — Lead.budget is numeric, Enquiry's isn't, so this is the one field that
        // can't be carried forward byte-for-byte; 0 only when nothing was ever captured.
        budget: Number(String(enquiry.qualification?.budget || '').replace(/[^\d]/g, '')) || 0,
        expectedPurchaseDate: enquiry.expectedPurchaseDate,
        campaign: enquiry.campaign || '',
        // Falls back to the converting user when the enquiry itself was never assigned —
        // otherwise the new Lead's assignedTo stays null and silently disappears from Lead
        // Management for every non-Organization-scope role (Sales Executive/Manager/Marketing
        // all filter by assignedTo === user.id or team), even though the record was created
        // successfully. The converting user taking ownership also matches how every other
        // Lead-creation path in this app works (manual Add Lead and CSV import both always
        // assign a salesperson at creation; Enquiry conversion was the one path that didn't).
        assignedTo: enquiry.assignedUser || by,
        assignedBy: by,
        assignedAt: new Date().toISOString(),
        status: 'New',
        priority: enquiry.priority === 'Critical' ? 'Urgent' : enquiry.priority,
        score: 45,
        qualification: null,
        nextFollowUp: enquiry.nextFollowUp,
        lastContactedDate: enquiry.lastContactedDate,
        notes: enquiry.notes || '',
        createdDate: new Date().toISOString().slice(0, 10),
        createdBy: by,
        convertedAt: null, convertedBy: null, dealId: null, customerId: enquiry.existingCustomerId || null, contactId: contact.id, companyId: company.id,
        unqualifiedReason: null, unqualifiedNotes: null, unqualifiedDate: null, unqualifiedBy: null,
        lostReason: null, lostNotes: null, lostDate: null, lostBy: null,
        sourceEnquiryId: enquiry.id,
        initials: enquiry.initials,
        avatarColor: enquiry.avatarColor,
      }).then((res) => ({ lead: res.data, contact }))
    })
    .then(({ lead, contact }) => {
      logLeadActivity({
        type: 'Created',
        leadId: lead.id,
        leadName: lead.name,
        subject: `Lead created from Enquiry ${enquiry.id}`,
        by,
      })
      return { lead, contact }
    })
    .then(({ lead, contact }) =>
      changeEnquiryStatus(enquiry, 'Converted', {
        by,
        note: `Converted to Lead ${lead.id}.`,
        // Backfills companyId onto the ORIGINAL enquiry too — normally already set at
        // Enquiry-creation time (see Enquiries.jsx's createEnquiry), but this guarantees it
        // even for enquiries created before that existed, or any edge case where it was
        // skipped, so the Enquiry always shows up under this Company in Company Management.
        extraPatch: { convertedLeadId: lead.id, convertedAt: new Date().toISOString(), convertedBy: by, companyId: enquiry.companyId || company.id },
      }).then((updatedEnquiry) => {
        logEnquiryActivity({
          type: 'Conversion',
          enquiryId: enquiry.id,
          enquiryName: enquiry.name,
          subject: `Converted by ${byName || 'a team member'} — created Lead ${lead.id}`,
          by,
        })
        createNotification({ type: 'Enquiry Converted', message: `${enquiry.name} (${enquiry.company}) was converted to a lead.`, relatedType: 'Lead', relatedId: lead.id })
        return { enquiry: updatedEnquiry, lead, company, contact }
      }),
    )
}
