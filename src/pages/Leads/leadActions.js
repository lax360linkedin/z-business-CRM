import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { canTransition, findDuplicateMatches } from '../../data/leadWorkflow'
import { createNotification } from '../../utils/notify'
import { DEAL_STAGE_PROBABILITY } from '../../data/constants'

/** Thin, shared wrapper so every lead action (call, status change, assignment, qualification, conversion) logs to /activities in the exact same shape — see src/components/common/ActivityTimeline.jsx for the icon/tone each `type` renders as. */
export function logLeadActivity({ type, leadId, leadName, subject, notes, by }) {
  return api.post('/activities', {
    id: genId('ACT'),
    type,
    relatedType: 'Lead',
    relatedId: leadId,
    relatedName: leadName,
    subject,
    notes: notes || null,
    date: new Date().toISOString(),
    by,
    status: 'Completed',
  })
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
export function changeLeadStatus(lead, newStatus, { by, extraPatch = {}, note } = {}) {
  if (!canTransition(lead.status, newStatus)) {
    return Promise.reject(new Error(`Cannot move a lead from "${lead.status}" to "${newStatus}".`))
  }
  return api.put(`/leads/${lead.id}`, { status: newStatus, ...extraPatch }).then((res) => {
    logLeadActivity({
      type: 'StatusChange',
      leadId: lead.id,
      leadName: lead.name,
      subject: `Status changed from ${lead.status} to ${newStatus}`,
      notes: note,
      by,
    })
    return res.data
  })
}

/**
 * Administrative override — skips the LEAD_STATUS_FLOW guard entirely. Only ever called from a
 * role-gated UI control (LeadDetail's Change Status menu restricts this to Super Admin/Admin/
 * MD); the caller is also responsible for writing the audit-log entry via logAuditEvent, same
 * pattern QuotationDetail.jsx uses for its own approval actions.
 */
export function overrideLeadStatus(lead, newStatus, { by, note } = {}) {
  return api.put(`/leads/${lead.id}`, { status: newStatus }).then((res) => {
    logLeadActivity({
      type: 'StatusChange',
      leadId: lead.id,
      leadName: lead.name,
      subject: `Status changed from ${lead.status} to ${newStatus} (administrative override)`,
      notes: note,
      by,
    })
    return res.data
  })
}

export function reassignLead(lead, { newAssigneeId, by, byName, newAssigneeName }) {
  return api.put(`/leads/${lead.id}`, {
    assignedTo: newAssigneeId,
    assignedBy: by,
    assignedAt: new Date().toISOString(),
  }).then((res) => {
    logLeadActivity({
      type: 'Assignment',
      leadId: lead.id,
      leadName: lead.name,
      subject: lead.assignedTo ? `Reassigned from ${byName || 'a salesperson'} to ${newAssigneeName}` : `Assigned to ${newAssigneeName}`,
      by,
    })
    createNotification({
      type: 'Lead Assignment',
      message: `${lead.name} (${lead.company}) was assigned to you.`,
      relatedType: 'Lead',
      relatedId: lead.id,
    })
    return res.data
  })
}

/**
 * Unqualified — the Lead was reviewed but never met the qualification criteria (never a real
 * opportunity). Reason/notes are required by the calling modal (MarkUnqualifiedModal.jsx); the
 * activity note is formatted as "Reason: X — notes" so the timeline reads exactly like the
 * spec's example ("Unqualified ↓ Reason: Budget mismatch").
 */
export function markLeadUnqualified(lead, { reason, notes, by }) {
  return changeLeadStatus(lead, 'Unqualified', {
    by,
    note: `Reason: ${reason}${notes ? ` — ${notes}` : ''}`,
    extraPatch: {
      unqualifiedReason: reason,
      unqualifiedNotes: notes || null,
      unqualifiedDate: new Date().toISOString(),
      unqualifiedBy: by,
    },
  })
}

/**
 * Lead-level Lost — the Lead WAS a genuine opportunity (Contacted or Qualified) but the
 * business stopped progressing before ever becoming a Deal. Distinct from markDealLost() in
 * src/pages/Deals/dealActions.js, which is for a Deal that already exists (created from an
 * already-Converted Lead) later falling through.
 */
export function markLeadLost(lead, { reason, notes, by }) {
  return changeLeadStatus(lead, 'Lost', {
    by,
    note: `Reason: ${reason}${notes ? ` — ${notes}` : ''}`,
    extraPatch: {
      lostReason: reason,
      lostNotes: notes || null,
      lostDate: new Date().toISOString(),
      lostBy: by,
    },
  })
}

export function saveLeadQualification(lead, qualification, { by, outcome }) {
  return api.put(`/leads/${lead.id}`, { qualification }).then((res) => {
    logLeadActivity({
      type: 'Qualification',
      leadId: lead.id,
      leadName: lead.name,
      subject: `Qualification updated — score ${qualification.qualificationScore}/100`,
      by,
    })
    if (outcome && outcome !== lead.status) {
      return changeLeadStatus({ ...res.data }, outcome, { by })
    }
    return res.data
  })
}

// Case-insensitive find-or-create so re-converting a lead for a company that already exists
// (from an earlier conversion, or seeded data) links to the SAME company record instead of
// creating a duplicate — this is the "no duplicate data entry" requirement from the spec.
function findOrCreateCompany(lead) {
  return api.get('/companies', { params: { all: true } }).then((res) => {
    const match = res.data.find((c) => c.name.toLowerCase() === lead.company.toLowerCase())
    if (match) return match
    return api.post('/companies', {
      id: genId('CMP'),
      name: lead.company,
      industry: lead.industry,
      contactPerson: lead.name,
      email: lead.email,
      phone: lead.phone,
      website: lead.website,
      city: lead.location,
      address: '',
      revenue: 0,
      status: 'Prospect',
      createdDate: new Date().toISOString().slice(0, 10),
      tags: [],
    }).then((r) => r.data)
  })
}

function findOrCreateContact(lead, company) {
  return api.get('/contacts', { params: { all: true } }).then((res) => {
    const match = res.data.find((c) => c.companyId === company.id && c.email.toLowerCase() === lead.email.toLowerCase())
    if (match) return match
    return api.post('/contacts', {
      id: genId('CT'),
      name: lead.name,
      designation: lead.designation || '',
      email: lead.email,
      phone: lead.phone,
      whatsapp: lead.phone,
      companyId: company.id,
      companyName: company.name,
      groups: ['Primary Contact'],
      createdDate: new Date().toISOString().slice(0, 10),
      initials: lead.initials,
      avatarColor: lead.avatarColor,
    }).then((r) => r.data)
  })
}

function findOrCreateCustomer(lead, company) {
  return api.get('/customers', { params: { all: true } }).then((res) => {
    const match = res.data.find((c) => c.companyId === company.id)
    if (match) return match
    return api.post('/customers', {
      id: genId('CUS'),
      companyId: company.id,
      name: company.name,
      industry: company.industry,
      contactPerson: lead.name,
      email: lead.email,
      phone: lead.phone,
      accountManager: lead.assignedTo,
      since: new Date().toISOString().slice(0, 10),
      status: 'Active',
      lifetimeValue: 0,
      tier: 'Standard',
      // Traceability back to the originating Lead (spec §21 "Customer → Original Lead / Deal")
      // — only set on first creation, so an existing customer keeps pointing at whichever Lead
      // first brought this company in, not whatever later Lead happened to re-find the match.
      leadId: lead.id,
    }).then((r) => r.data)
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
export function convertLead(lead, { by, byName }) {
  if (!canTransition(lead.status, 'Converted')) {
    return Promise.reject(new Error(`A lead must be Qualified before it can be converted to a Deal (currently "${lead.status}").`))
  }
  let company
  return findOrCreateCompany(lead)
    .then((c) => { company = c; return findOrCreateContact(lead, company) })
    .then((contact) => findOrCreateCustomer(lead, company).then((customer) => ({ contact, customer })))
    .then(({ contact, customer }) => {
      const dealId = genId('DL')
      const createdDate = new Date().toISOString().slice(0, 10)
      return api.post('/deals', {
        id: dealId,
        name: `${lead.company} — ${lead.service}`,
        companyId: company.id,
        companyName: company.name,
        contactId: contact.id,
        contactName: contact.name,
        service: lead.service,
        requirement: lead.requirement || '',
        customerNeed: '',
        budget: lead.budget || 0,
        expectedPurchaseTimeline: '',
        competitor: '',
        decisionMaker: '',
        notes: lead.notes || '',
        value: lead.budget,
        currency: 'INR',
        probability: DEAL_STAGE_PROBABILITY['Deal Created'],
        expectedClosingDate: lead.expectedPurchaseDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        salesperson: lead.assignedTo,
        stage: 'Deal Created',
        stageHistory: [{ stage: 'Deal Created', changedAt: new Date().toISOString(), changedBy: by, note: `Converted from Lead ${lead.id}.` }],
        priority: lead.priority,
        // Source traceability carried forward, not regenerated — see spec §21 "preserve the
        // original Lead Source at every downstream stage."
        source: lead.source,
        sourceDetail: lead.sourceDetail || '',
        campaign: lead.campaign || '',
        sourceEnquiryId: lead.sourceEnquiryId || null,
        createdDate,
        nextFollowUp: null,
        lastContactedDate: null,
        closedAt: null, closedBy: null,
        lostReason: null, lostNotes: null, lostDate: null, lostBy: null,
        leadId: lead.id,
        // The Customer chain is already resolved above (find-or-create, never duplicated) — a
        // Deal converted from a Lead starts life already linked, matching spec §16's "Deal
        // should maintain … customerId" without waiting for a later Closed Won.
        customerId: customer.id,
        quotationIds: [], salesOrderIds: [], invoiceIds: [], paymentIds: [],
      }).then((res) => ({ deal: res.data, contact, customer }))
    })
    .then(({ deal, contact, customer }) =>
      changeLeadStatus(lead, 'Converted', {
        by,
        note: `Converted to Deal ${deal.id} · Customer ${customer.id} · Contact ${contact.id}.`,
        extraPatch: {
          convertedAt: new Date().toISOString(),
          convertedBy: by,
          dealId: deal.id,
          customerId: customer.id,
          contactId: contact.id,
          companyId: company.id,
        },
      }).then((updatedLead) => {
        logLeadActivity({
          type: 'Conversion',
          leadId: lead.id,
          leadName: lead.name,
          subject: `Converted by ${byName || 'a salesperson'} — created Deal, Customer and Contact records`,
          by,
        })
        createNotification({
          type: 'Deal Update',
          message: `${lead.name} (${lead.company}) was converted to a deal.`,
          relatedType: 'Deal',
          relatedId: deal.id,
        })
        return { lead: updatedLead, deal, customer, contact, company }
      }),
    )
}
