import {
  resetSeed, pick, randInt, personName, companyEmail, phoneNumber, companyName,
  daysFromNow, initials, avatarColor, INDUSTRIES, CITIES,
} from '../utils/generators'
import {
  ENQUIRY_SOURCES, ENQUIRY_STATUSES, ENQUIRY_PRIORITIES, ENQUIRY_TYPES, REQUIREMENT_TYPES,
  PREFERRED_CONTACT_METHODS, ASSIGNED_TEAMS, PURCHASE_INTENT_LEVELS, SERVICES, BUSINESS_NEED_OPTIONS,
  LEAD_QUALIFICATION_TIMELINES,
} from './constants'
import { salesUsers } from './users'

resetSeed(404)
const reps = salesUsers()
const AREAS = ['Central Business District', 'Tech Park', 'Old Town', 'Industrial Area', 'Suburbs', 'Downtown']

function seedQualification() {
  return {
    businessNeed: pick(BUSINESS_NEED_OPTIONS),
    budget: `₹${pick([50000, 100000, 250000, 500000, 1000000]).toLocaleString('en-IN')}`,
    timeline: pick(LEAD_QUALIFICATION_TIMELINES),
    decisionMaker: personName(),
    purchaseIntent: pick(PURCHASE_INTENT_LEVELS),
    productInterest: pick(SERVICES),
    quantity: randInt(1, 50),
    competitor: pick(['', '', 'Evaluating a local vendor as well', 'Currently using an in-house tool']),
    requirementDetailed: 'Needs a detailed proposal covering pricing, timelines and implementation support.',
    qualificationNotes: '',
    qualifiedAt: daysFromNow(-randInt(1, 30)),
  }
}

export const ENQUIRIES = Array.from({ length: 32 }).map((_, i) => {
  const company = companyName()
  const name = personName()
  const status = i < 5 ? 'New' : pick(ENQUIRY_STATUSES)
  const createdDate = daysFromNow(-randInt(0, 90))
  const isAssigned = !['New'].includes(status)
  const isQualifiedTier = ['Qualified', 'Converted', 'Unqualified'].includes(status)
  const isClosedStatus = ['Converted', 'Duplicate', 'Spam', 'Not Interested', 'Closed', 'Unqualified'].includes(status)
  const assignedUser = isAssigned ? pick(reps).id : null

  return {
    id: `ENQ-2026-${String(i + 1).padStart(6, '0')}`,
    status,
    // Enquiry Information
    date: createdDate,
    source: pick(ENQUIRY_SOURCES),
    campaign: pick(['', '', 'August CRM Campaign', 'Festive Season Push', 'LinkedIn Outreach Q3']),
    enquiryType: pick(ENQUIRY_TYPES),
    priority: pick(ENQUIRY_PRIORITIES),
    assignedTeam: isAssigned ? pick(ASSIGNED_TEAMS) : null,
    assignedUser,
    assignedBy: isAssigned ? reps[0]?.id : null,
    assignedAt: isAssigned ? createdDate : null,
    // Contact Information
    name,
    company,
    email: companyEmail(company, name),
    phone: phoneNumber(),
    alternatePhone: '',
    whatsapp: '',
    designation: pick(['CEO', 'Procurement Head', 'Operations Manager', 'IT Manager', 'Founder', '']),
    // Location
    country: 'India',
    state: '',
    city: pick(CITIES),
    area: pick(AREAS),
    address: '',
    pincode: '',
    // Requirement
    interestedProduct: pick(SERVICES),
    interestedService: pick(SERVICES),
    category: pick(INDUSTRIES),
    requirementType: pick(REQUIREMENT_TYPES),
    requirementDescription: `Enquiring about ${pick(SERVICES).toLowerCase()} — needs a proposal with pricing and timelines.`,
    quantity: randInt(1, 20),
    budgetRange: pick(['Under ₹1L', '₹1L - ₹5L', '₹5L - ₹10L', '₹10L - ₹25L', '₹25L+']),
    expectedPurchaseDate: !isClosedStatus ? daysFromNow(randInt(7, 90)) : null,
    preferredContactMethod: pick(PREFERRED_CONTACT_METHODS),
    // Additional
    tags: [],
    notes: '',
    attachments: [],
    // Qualification (separate from initial capture — see enquiryWorkflow.isQualificationComplete)
    qualification: isQualifiedTier ? seedQualification() : null,
    // Follow-up
    nextFollowUp: !isClosedStatus ? daysFromNow(randInt(-3, 14)) : null,
    lastContactedDate: !['New', 'Assigned'].includes(status) ? daysFromNow(-randInt(0, 15)) : null,
    // Duplicate detection
    duplicateOfId: status === 'Duplicate' ? null : null,
    // Existing customer linkage
    existingCustomerId: null,
    // Company linkage — left null for seed data, same reasoning as convertedLeadId below: these
    // were never run through the live create/convert flow that now find-or-creates a Company
    // record. Enquiries created (or converted) through the app from here on will have this set.
    companyId: null,
    // Disposition (Unqualified / Duplicate / Spam / Not Interested / Closed)
    closeReason: isClosedStatus && !['Converted'].includes(status) ? 'Evaluated and closed out.' : null,
    closedAt: isClosedStatus && status !== 'Converted' ? daysFromNow(-randInt(0, 20)) : null,
    closedBy: isClosedStatus && status !== 'Converted' ? assignedUser : null,
    // Conversion linkage — left null for seed data since these were never actually run through
    // the live convert flow; enquiries converted through the app from here on will have these set.
    convertedLeadId: null,
    convertedAt: null,
    convertedBy: null,
    createdDate,
    createdBy: reps[0]?.id || assignedUser,
    initials: initials(name),
    avatarColor: avatarColor(name),
  }
})

export function getEnquiryById(id) {
  return ENQUIRIES.find((e) => e.id === id)
}
