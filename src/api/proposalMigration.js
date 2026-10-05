// One-time, idempotent upgrade of Proposal data to the corporate proposal model (linked Deal /
// Company / Contact, structured solution content, client snapshot, versions, persisted timeline).
// Runs on freshly seeded data and on browsers that already hold the older, isolated proposals.
import { buildClientSnapshot, emptyContent, normalizeContent, computeCommercial, DEFAULT_PROPOSAL_TERMS } from '../utils/proposalCalc'

const pad4 = (n) => String(n).padStart(4, '0')
const iso = (d, h = 9) => `${String(d || new Date().toISOString()).slice(0, 10)}T${String(h).padStart(2, '0')}:00:00.000Z`
const addDays = (d, n) => new Date(new Date(String(d).slice(0, 10)).getTime() + n * 86400000).toISOString().slice(0, 10)
const SENT = ['Sent', 'Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired']

export function migrateProposals(db) {
  db.__migrations = db.__migrations || {}
  if (db.__migrations.proposalV2) return db
  const customers = db.customers || []
  const companies = db.companies || []
  const contacts = db.contacts || []
  const deals = db.deals || []
  const newActivities = []
  const seqByYear = {}
  const dealLinks = {}

  const sorted = [...(db.proposals || [])].sort((a, b) => String(a.createdDate).localeCompare(String(b.createdDate)) || a.id.localeCompare(b.id))
  const migrated = sorted.map((p) => {
    if (p.version && p.clientSnapshot) return p
    const customer = customers.find((c) => c.id === p.customerId) || null
    const companyId = customer?.companyId || p.companyId || null
    const company = companies.find((c) => c.id === companyId) || null
    const companyDeals = deals.filter((d) => d.companyId === companyId)
    const deal = companyDeals.find((d) => d.service === p.service) || companyDeals.find((d) => !String(d.stage).startsWith('Closed')) || companyDeals[0] || null
    const contact = (deal?.contactId && contacts.find((c) => c.id === deal.contactId)) || contacts.find((c) => c.companyId === companyId) || null
    const year = String(p.createdDate || new Date().toISOString()).slice(0, 4)
    seqByYear[year] = (seqByYear[year] || 0) + 1
    const sec = (h) => (p.sections || []).find((s) => s.heading === h)?.body || ''
    const status = SENT.includes(p.status) || p.status === 'Draft' ? p.status : 'Draft'
    const content = normalizeContent({
      ...emptyContent(),
      executiveSummary: sec('Executive Summary'),
      requirement: deal?.requirement || `${p.service} for ${company?.name || p.customerName}.`,
      proposedSolution: sec('Executive Summary'),
      scopeOfWork: sec('Scope of Work'),
      timeline: sec('Timeline') ? [{ phase: 'Delivery', description: sec('Timeline'), duration: '' }] : [],
      paymentTerms: '50% advance, 50% on delivery',
      termsConditions: DEFAULT_PROPOSAL_TERMS,
      items: [{ name: p.service, description: '', qty: 1, unitPrice: p.value, discount: 0 }],
    })
    const sentAt = SENT.includes(status) ? iso(addDays(p.createdDate, 1)) : null
    const out = {
      id: p.id,
      number: `PROP-${year}-${pad4(seqByYear[year])}`,
      version: 1,
      title: p.title,
      status,
      dealId: deal?.id || null, dealName: deal?.name || null,
      enquiryId: deal?.sourceEnquiryId || null, leadId: deal?.leadId || null,
      companyId, contactId: contact?.id || null, customerId: customer?.id || deal?.customerId || null,
      clientSnapshot: buildClientSnapshot(company, contact, customer),
      customerName: customer?.name || company?.name || p.customerName,
      service: p.service,
      content,
      ...{ value: computeCommercial(content.items).value },
      ownerId: p.assignedTo,
      assignedTo: p.assignedTo,
      source: deal?.source || null, sourceDetail: deal?.sourceDetail || '',
      createdDate: String(p.createdDate).slice(0, 10),
      validUntil: String(p.validUntil).slice(0, 10),
      sentAt, sends: [], versions: [], documents: [],
      quotationIds: [], notes: '', nextFollowUp: null,
      createdBy: p.assignedTo, createdAt: iso(p.createdDate), updatedAt: iso(p.createdDate),
    }
    const base = { relatedType: 'Proposal', relatedId: p.id, relatedName: out.number, status: 'Completed', by: out.createdBy }
    let n = 0
    const add = (type, subject, date, extra = {}) => newActivities.push({ id: `ACT-PR-${p.id}-${++n}`, ...base, type, subject, date: iso(date), ...extra })
    add('Created', `Proposal ${out.number} created`, out.createdDate)
    if (status !== 'Draft') add('StatusChange', 'Proposal sent', addDays(out.createdDate, 1), { fromStatus: 'Draft', toStatus: 'Sent' })
    if (['Viewed', 'Accepted', 'Rejected', 'Expired'].includes(status) || status === 'Revision Requested') add('StatusChange', `Status changed to ${status}`, addDays(out.createdDate, 3), { fromStatus: 'Sent', toStatus: status })
    if (deal) (dealLinks[deal.id] = dealLinks[deal.id] || []).push(p.id)
    return out
  })

  db.deals = deals.map((d) => (dealLinks[d.id] ? { ...d, proposalIds: [...new Set([...(d.proposalIds || []), ...dealLinks[d.id]])] } : d))
  db.proposals = migrated
  db.activities = [...newActivities, ...(db.activities || [])]
  db.__migrations.proposalV2 = true
  return db
}
