import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { LEADS } from './leads'
import { DEALS } from './deals'
import { CUSTOMERS } from './customers'
import { USERS, salesUsers } from './users'

resetSeed(1818)
const reps = salesUsers()

const NOTES_BY_TYPE = {
  Call: ['Discussed requirements and budget expectations.', 'Follow-up call to confirm next steps.', 'Left voicemail, will retry tomorrow.'],
  Email: ['Sent detailed service brochure and pricing.', 'Shared case studies relevant to their industry.', 'Sent follow-up on pending quotation.'],
  WhatsApp: ['Shared quick pricing estimate over WhatsApp.', 'Sent meeting confirmation link.', 'Shared product demo video.'],
  Meeting: ['Discovery call to understand business needs.', 'Product walkthrough with stakeholders.', 'Contract review meeting.'],
  Demo: ['Live product demo covering key modules.', 'Technical demo for IT stakeholders.'],
  'Follow-up': ['Checking in on decision timeline.', 'Following up after proposal was sent.'],
  Note: ['Client prefers email communication over calls.', 'Budget approval expected next month.'],
  Task: ['Prepare customized proposal document.', 'Coordinate internal resource allocation.'],
}

function relatedEntity(i) {
  const pool = [
    ...LEADS.slice(0, 30).map((l) => ({ type: 'Lead', id: l.id, name: l.name })),
    ...DEALS.slice(0, 20).map((d) => ({ type: 'Deal', id: d.id, name: d.name })),
    ...CUSTOMERS.slice(0, 12).map((c) => ({ type: 'Customer', id: c.id, name: c.name })),
  ]
  return pool[i % pool.length]
}

// Seed activities are limited to the types that have sample note text.
const SEED_TYPES = Object.keys(NOTES_BY_TYPE)

export const ACTIVITIES = Array.from({ length: 60 }).map((_, i) => {
  const type = pick(SEED_TYPES)
  const related = relatedEntity(i)
  return {
    id: `ACT-${String(15000 + i)}`,
    type,
    relatedType: related.type,
    relatedId: related.id,
    relatedName: related.name,
    subject: `${type} with ${related.name}`,
    notes: pick(NOTES_BY_TYPE[type]),
    date: daysFromNow(-randInt(0, 90)),
    by: pick(reps).id,
    status: pick(['Completed', 'Completed', 'Scheduled']),
  }
})

export function activitiesFor(relatedId) {
  return ACTIVITIES.filter((a) => a.relatedId === relatedId).sort((a, b) => new Date(b.date) - new Date(a.date))
}
