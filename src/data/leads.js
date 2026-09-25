import {
  resetSeed, pick, randInt, randFloat, personName, companyEmail, phoneNumber,
  companyName, daysFromNow, initials, avatarColor, INDUSTRIES, CITIES,
} from '../utils/generators'
import { LEAD_SOURCES, SERVICES, LEAD_STATUSES, PRIORITIES, LEAD_QUALIFICATION_TIMELINES, COMPANY_SIZES, DECISION_MAKER_STATUSES, BUSINESS_NEED_OPTIONS, LEAD_CAPTURE_METHODS, UNQUALIFIED_REASONS, LEAD_LOST_REASONS } from './constants'
import { salesUsers } from './users'
import { CAMPAIGN_NAMES } from './campaignNames'
import { computeQualificationScore } from './leadWorkflow'

resetSeed(303)
const reps = salesUsers()
const DESIGNATIONS = ['CEO', 'CTO', 'CFO', 'VP Sales', 'Procurement Head', 'Operations Manager', 'HR Manager', 'Marketing Head', 'IT Manager', 'Founder']

// What a Lead Source actually looked like when it arrived — shown on the Lead's "Lead Source"
// panel alongside `source` (see src/pages/Leads/LeadDetail.jsx). Deliberately a plain
// per-source lookup (not every source needs sub-detail) rather than free text, so it stays
// consistent across every lead captured from the same channel.
export const SOURCE_DETAILS = {
  Website: ['Contact Form', 'Chat Widget', 'Pricing Page Form'],
  'Contact Form': ['Homepage Form', 'Product Page Form'],
  Google: ['Google Ads', 'Organic Search'],
  Facebook: ['Lead Ad', 'Page Message', 'Comment Reply'],
  Instagram: ['Lead Ad', 'DM', 'Story Reply'],
  LinkedIn: ['InMail', 'Company Page', 'Sponsored Content'],
  WhatsApp: ['Business Chat', 'Click-to-WhatsApp Ad'],
  Referral: ['Existing Customer', 'Partner Referral'],
  Phone: ['Inbound Call'],
  Email: ['Inbound Email'],
  'Walk-in': ['Office Visit'],
  Campaign: ['Email Campaign', 'SMS Campaign'],
  'Manual Entry': ['Entered by Sales Team'],
  Import: ['CSV Import'],
}
function sourceDetailFor(source) {
  const options = SOURCE_DETAILS[source]
  return options ? pick(options) : ''
}
function captureMethodFor(source) {
  if (source === 'Manual Entry') return 'Manual'
  if (source === 'Import') return 'Manual'
  if (['Website', 'Contact Form'].includes(source)) return 'Form'
  if (['Facebook', 'Instagram', 'LinkedIn', 'Google'].includes(source)) return 'API'
  return pick(LEAD_CAPTURE_METHODS)
}

function seedQualification() {
  const decisionMakerIdentified = pick(DECISION_MAKER_STATUSES)
  const hasDecisionMakerInfo = decisionMakerIdentified !== 'No'
  const businessNeed = pick(BUSINESS_NEED_OPTIONS)
  const q = {
    requirement: 'Looking for a reliable partner to deliver this within budget and on schedule.',
    budget: true,
    decisionMakerIdentified,
    decisionMakerName: hasDecisionMakerInfo ? personName() : '',
    decisionMakerDesignation: hasDecisionMakerInfo ? pick(DESIGNATIONS) : '',
    timeline: pick(LEAD_QUALIFICATION_TIMELINES),
    productInterest: pick(SERVICES),
    companySize: pick(COMPANY_SIZES),
    businessNeed,
    businessNeedOther: businessNeed === 'Other' ? 'Needs a customized CRM workflow tailored to their sales process.' : '',
    purchaseProbability: pick([25, 50, 60, 75, 90]),
  }
  return { ...q, qualificationScore: computeQualificationScore(q), qualifiedAt: daysFromNow(-randInt(1, 60)), qualifiedBy: pick(reps).id }
}

const TERMINAL_STATUSES = ['Converted', 'Unqualified', 'Lost']

export const LEADS = Array.from({ length: 46 }).map((_, i) => {
  const company = companyName()
  const name = personName()
  const status = i < 6 ? 'New' : pick(LEAD_STATUSES)
  const createdDate = daysFromNow(-randInt(1, 240))
  const isOpen = !TERMINAL_STATUSES.includes(status)
  const assignedTo = pick(reps).id
  const isQualifiedTier = ['Qualified', 'Converted'].includes(status)
  const source = pick(LEAD_SOURCES)

  return {
    id: `LD-${String(1000 + i)}`,
    name,
    company,
    designation: pick(DESIGNATIONS),
    email: companyEmail(company, name),
    phone: phoneNumber(),
    website: `www.${company.toLowerCase().replace(/\s+/g, '')}.com`,
    industry: pick(INDUSTRIES),
    location: pick(CITIES),
    source,
    // Where exactly within that source this lead came from, and how the CRM captured it —
    // see src/pages/Leads/LeadDetail.jsx's "Lead Source" panel. `capturedAt` is the
    // precise capture timestamp (distinct from `createdDate`, which is date-only) — for
    // manually-entered leads it's the same moment as creation; for source-captured leads it
    // represents when the external submission was received.
    sourceDetail: sourceDetailFor(source),
    captureMethod: captureMethodFor(source),
    capturedAt: `${createdDate}T${String(randInt(8, 19)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:00.000Z`,
    service: pick(SERVICES),
    requirement: `Looking for ${pick(SERVICES).toLowerCase()} support — evaluating vendors this quarter.`,
    budget: randFloat(50000, 2500000, 0),
    expectedPurchaseDate: isOpen ? daysFromNow(randInt(7, 120)) : null,
    campaign: pick(CAMPAIGN_NAMES),
    assignedTo,
    assignedBy: reps[0]?.id || assignedTo,
    assignedAt: createdDate,
    status,
    priority: pick(PRIORITIES),
    score: randInt(20, 98),
    qualification: isQualifiedTier ? seedQualification() : null,
    nextFollowUp: isOpen ? daysFromNow(randInt(-3, 14)) : null,
    lastContactedDate: status !== 'New' ? daysFromNow(-randInt(0, 20)) : null,
    notes: '',
    createdDate,
    createdBy: reps[0]?.id || assignedTo,
    // Conversion linkage — left null for seed data since these were never actually run
    // through the live convert flow (no matching Company/Contact/Customer/Deal records
    // exist for them); leads converted through the app from here on will have these set.
    convertedAt: null,
    convertedBy: null,
    dealId: null,
    customerId: null,
    contactId: null,
    companyId: null,
    // Back-link to the Enquiry this Lead was converted from, if any — set by
    // convertEnquiryToLead() in src/pages/Enquiries/enquiryActions.js. Null for leads created
    // directly (not every lead originates from an enquiry).
    sourceEnquiryId: null,
    // Distinct alternative-outcome fields — Unqualified (never a real opportunity) and Lost
    // (was a real opportunity, business didn't happen) are deliberately separate, per the "do
    // not treat Unqualified and Lost as the same status" requirement.
    unqualifiedReason: status === 'Unqualified' ? pick(UNQUALIFIED_REASONS) : null,
    unqualifiedNotes: status === 'Unqualified' ? 'Reviewed and confirmed this does not fit our qualification criteria.' : null,
    unqualifiedDate: status === 'Unqualified' ? daysFromNow(-randInt(1, 60)) : null,
    unqualifiedBy: status === 'Unqualified' ? assignedTo : null,
    lostReason: status === 'Lost' ? pick(LEAD_LOST_REASONS) : null,
    lostNotes: status === 'Lost' ? 'Followed up multiple times; prospect is no longer proceeding.' : null,
    lostDate: status === 'Lost' ? daysFromNow(-randInt(1, 60)) : null,
    lostBy: status === 'Lost' ? assignedTo : null,
    initials: initials(name),
    avatarColor: avatarColor(name),
  }
})

export function getLeadById(id) {
  return LEADS.find((l) => l.id === id)
}
