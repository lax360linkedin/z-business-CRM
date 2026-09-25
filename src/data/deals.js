import { resetSeed, pick, randInt, randFloat, daysFromNow, LEAD_SOURCES } from '../utils/generators'
import { COMPANIES } from './companies'
import { contactsByCompany } from './contacts'
import { SERVICES, DEAL_STAGES, DEAL_STAGE_PROBABILITY, CLOSED_DEAL_STAGES, PRIORITIES, LOST_REASONS, LEAD_QUALIFICATION_TIMELINES } from './constants'
import { salesUsers } from './users'

resetSeed(606)
const reps = salesUsers()

export const DEALS = Array.from({ length: 38 }).map((_, i) => {
  const company = pick(COMPANIES)
  const contacts = contactsByCompany(company.id)
  const contact = contacts.length ? pick(contacts) : null
  const stage = i < 5 ? 'Deal Created' : pick(DEAL_STAGES)
  const isClosed = CLOSED_DEAL_STAGES.includes(stage)
  const isLost = stage === 'Closed Lost' || stage === 'Closed Lost – Competition'
  const service = pick(SERVICES)
  const createdDate = daysFromNow(-randInt(5, 200))
  const closedAt = isClosed ? daysFromNow(-randInt(1, 30)) : null
  return {
    id: `DL-${String(2000 + i)}`,
    name: `${company.name} — ${service}`,
    companyId: company.id,
    companyName: company.name,
    contactId: contact?.id ?? null,
    contactName: contact?.name ?? company.contactPerson,
    service,
    requirement: '',
    customerNeed: '',
    budget: 0,
    expectedPurchaseTimeline: pick(LEAD_QUALIFICATION_TIMELINES),
    competitor: '',
    decisionMaker: '',
    notes: '',
    value: randFloat(75000, 3200000, 0),
    currency: 'INR',
    probability: DEAL_STAGE_PROBABILITY[stage],
    expectedClosingDate: daysFromNow(randInt(-10, 75)),
    salesperson: pick(reps).id,
    stage,
    priority: pick(PRIORITIES),
    createdDate,
    // Stage history — seed data gets a single "created at" entry rather than a fabricated full
    // trail, since these deals never actually moved through the live changeDealStage() choke
    // point; real stage moves from here on append a real entry each time (see dealActions.js).
    stageHistory: [{ stage: 'Deal Created', changedAt: createdDate, changedBy: null, note: null }],
    nextFollowUp: !isClosed ? daysFromNow(randInt(-3, 14)) : null,
    lastContactedDate: daysFromNow(-randInt(0, 15)),
    // Closed-stage bookkeeping (spec §1 "record the date/time and user who performed the
    // action") — left with a null `by` for seed data since these predate the live flow.
    closedAt,
    closedBy: isClosed ? pick(reps).id : null,
    // Deal-level Lost tracking (spec §11) — only the two Closed Lost variants carry a reason.
    lostReason: isLost ? pick(LOST_REASONS) : null,
    lostNotes: isLost ? 'Prospect went with a different vendor after final review.' : null,
    lostDate: isLost ? closedAt : null,
    lostBy: isLost ? pick(reps).id : null,
    // Traces this deal back to the lead/enquiry it was converted from — null for seed data
    // (these predate the live convert flow), set automatically by convertLead() for real
    // conversions, and backfilled onto sourceEnquiryId when that Lead itself came from an
    // Enquiry.
    leadId: null,
    sourceEnquiryId: null,
    // Customer linkage — set automatically the moment a deal reaches Closed Won (or immediately
    // at Lead conversion, since convertLead() already finds-or-creates the Customer) — see
    // convertDealToCustomer() in src/pages/Deals/dealActions.js. Never duplicated.
    customerId: null,
    // Downstream document traceability (spec §16 "Deal should maintain quotationIds/
    // salesOrderIds/invoiceIds/paymentIds") — arrays so a deal can accumulate more than one of
    // each over its life without ever needing a schema change.
    quotationIds: [],
    salesOrderIds: [],
    invoiceIds: [],
    paymentIds: [],
    // Source traceability (spec §21 "preserve the original Lead Source at every downstream
    // stage") — seed deals get a plausible source directly since they have no real originating
    // Lead; real conversions carry the actual Lead's source/sourceDetail/campaign forward
    // instead of regenerating one (see convertLead() in src/pages/Leads/leadActions.js).
    source: pick(LEAD_SOURCES),
    sourceDetail: '',
    campaign: '',
  }
})

export function getDealById(id) {
  return DEALS.find((d) => d.id === id)
}
export function dealsByCompany(companyId) {
  return DEALS.filter((d) => d.companyId === companyId)
}
