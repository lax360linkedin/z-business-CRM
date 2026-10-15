// Proposal lifecycle rules, content model and commercial maths — shared by the UI and the mock
// backend (src/api/proposalApi.js), which re-validates every write.
//
// A Proposal presents the *solution* (requirement, approach, scope, deliverables, timeline,
// responsibilities, assumptions…) with an indicative commercial summary. A Quotation is the
// binding price offer created from it — they stay separate records linked by proposalId.
import { round2, DEFAULT_TAX_RATE } from './salesOrderCalc'

export const PROPOSAL_STATUS_LIST = ['Draft', 'Internal Review', 'Sent', 'Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired']

export const PR_TRANSITIONS = {
  Draft: ['Internal Review'],
  'Internal Review': ['Draft', 'Sent'],
  Sent: ['Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired'],
  Viewed: ['Revision Requested', 'Accepted', 'Rejected', 'Expired'],
  'Revision Requested': ['Accepted', 'Rejected', 'Expired'],
  Accepted: [],
  Rejected: [],
  Expired: [],
}

export const PR_EDITABLE = ['Draft', 'Internal Review']
export const PR_REVISABLE = ['Sent', 'Viewed', 'Revision Requested', 'Rejected', 'Expired']
export const PR_OPEN = ['Draft', 'Internal Review', 'Sent', 'Viewed', 'Revision Requested']
export const PR_SENT_STATES = ['Sent', 'Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired']
export const PR_APPROVER_ROLES = ['Super Admin', 'Admin', 'Sales Manager']

export const DEFAULT_VALIDITY_DAYS = 30

export const NARRATIVE_SECTIONS = [
  { key: 'executiveSummary', label: 'Executive Summary', hint: 'A short overview of why this solution fits the client.' },
  { key: 'requirement', label: 'Client Requirement', hint: 'What the client needs, in their words.' },
  { key: 'proposedSolution', label: 'Proposed Solution', hint: 'How we propose to solve it.' },
  { key: 'objectives', label: 'Objectives', hint: 'What success looks like.' },
  { key: 'scopeOfWork', label: 'Scope of Work', hint: 'What is included.' },
  { key: 'implementationApproach', label: 'Implementation Approach', hint: 'How the work will be carried out.' },
  { key: 'technology', label: 'Technology / Methodology', hint: 'Stack, tools or delivery method, where applicable.' },
  { key: 'assumptions', label: 'Assumptions', hint: 'What we assume to be true.' },
  { key: 'exclusions', label: 'Exclusions', hint: 'What is explicitly not included.' },
  { key: 'support', label: 'Support & Maintenance', hint: 'Post-delivery support terms.' },
  { key: 'paymentTerms', label: 'Payment Terms', hint: 'How and when payment is made.' },
  { key: 'termsConditions', label: 'Terms & Conditions', hint: 'General terms.' },
]

export const DEFAULT_PROPOSAL_TERMS = 'This proposal is valid until the expiry date shown. Commercial figures are indicative and excl. applicable taxes; the binding price offer is issued as a separate Quotation. Scope changes after acceptance are handled through a change request.'
export const DEFAULT_SUPPORT_TEXT = 'Post go-live support is provided for 30 days at no additional cost. Extended maintenance and support plans are available on request.'

export function emptyContent() {
  return {
    executiveSummary: '', requirement: '', proposedSolution: '', objectives: '', scopeOfWork: '', implementationApproach: '',
    technology: '', assumptions: '', exclusions: '', support: DEFAULT_SUPPORT_TEXT, paymentTerms: '', termsConditions: DEFAULT_PROPOSAL_TERMS,
    modules: [], deliverables: [], timeline: [],
    responsibilities: { company: '', client: '' },
    items: [],
  }
}

export function normalizeContent(c = {}) {
  const base = emptyContent()
  return {
    ...base, ...c,
    modules: (c.modules || []).map((m) => ({ name: String(m.name || '').trim(), description: String(m.description || '').trim() })).filter((m) => m.name),
    deliverables: (c.deliverables || []).map((d) => String(d || '').trim()).filter(Boolean),
    timeline: (c.timeline || []).map((t) => ({ phase: String(t.phase || '').trim(), description: String(t.description || '').trim(), duration: String(t.duration || '').trim() })).filter((t) => t.phase),
    responsibilities: { company: String(c.responsibilities?.company || ''), client: String(c.responsibilities?.client || '') },
    items: (c.items || []).map(normalizeProposalItem),
  }
}

export function normalizeProposalItem(it = {}) {
  return {
    productId: it.productId || null,
    productCode: it.productCode || null,
    category: it.category || null,
    unit: it.unit || null,
    billingCycle: it.billingCycle || null,
    listPrice: it.listPrice ?? null,
    name: String(it.name || '').trim(),
    description: String(it.description || '').trim(),
    qty: Number(it.qty) || 0,
    unitPrice: Number(it.unitPrice) || 0,
    discount: Number(it.discount) || 0,
    taxRate: it.taxRate === undefined || it.taxRate === null || it.taxRate === '' ? DEFAULT_TAX_RATE : Number(it.taxRate) || 0,
  }
}

/** Indicative commercial summary (excl. tax) — what "Proposal value" means everywhere. */
export function computeCommercial(items) {
  const lines = (items || []).map((raw) => {
    const it = normalizeProposalItem(raw)
    const gross = it.qty * it.unitPrice
    const net = gross * (1 - it.discount / 100)
    return { gross: round2(gross), net: round2(net), tax: round2(net * (it.taxRate / 100)) }
  })
  const subtotal = round2(lines.reduce((s, l) => s + l.gross, 0))
  const value = round2(lines.reduce((s, l) => s + l.net, 0))
  const estimatedTax = round2(lines.reduce((s, l) => s + l.tax, 0)) // each line at its own catalog tax rate
  return { lines, subtotal, discount: round2(subtotal - value), value, estimatedTax, estimatedTotal: round2(value + estimatedTax) }
}

export function validateProposalInput(p) {
  const e = {}
  if (!String(p.title || '').trim()) e.title = 'Give the proposal a title.'
  else if (p.title.length > 160) e.title = 'Title is too long (max 160 characters).'
  if (!p.validUntil) e.validUntil = 'Set an expiry date.'
  else if (p.createdDate && p.validUntil < p.createdDate) e.validUntil = 'Expiry cannot be before the created date.'
  if (!p.ownerId) e.ownerId = 'Choose an owner.'
  const c = p.content || {}
  if (!String(c.requirement || '').trim()) e.requirement = 'Describe the client requirement.'
  if (!String(c.scopeOfWork || '').trim()) e.scopeOfWork = 'Describe the scope of work.'
  const items = c.items || []
  if (!items.length) e.items = 'Add at least one product or service to the commercial summary.'
  items.forEach((raw, i) => {
    const it = normalizeProposalItem(raw)
    if (!it.name) e[`item-${i}-name`] = 'Name required'
    if (!(it.qty > 0)) e[`item-${i}-qty`] = 'Qty > 0'
    if (it.unitPrice < 0) e[`item-${i}-unitPrice`] = 'Invalid'
    if (it.discount < 0 || it.discount > 100) e[`item-${i}-discount`] = '0–100'
  })
  return e
}

export function proposalLabel(p) {
  return `${p.number} – Version ${p.version}`
}

/** The master Company/Contact fields a proposal snapshots as its "client" block. */
export function buildClientSnapshot(company, contact, customer) {
  return {
    companyName: company?.name || '',
    contactName: contact?.name || company?.contactPerson || '',
    designation: contact?.designation || '',
    phone: contact?.phone || company?.phone || '',
    email: contact?.email || company?.email || '',
    billingAddress: company?.billingAddress || company?.address || '',
    shippingAddress: company?.shippingAddress || company?.address || '',
    gstin: company?.gstin || customer?.gstin || '',
    website: company?.website || '',
    industry: company?.industry || '',
  }
}

export const CLIENT_FIELD_LABELS = {
  companyName: 'Company', contactName: 'Contact person', designation: 'Designation', phone: 'Phone', email: 'Email',
  billingAddress: 'Billing address', shippingAddress: 'Shipping / service address', gstin: 'GSTIN', website: 'Website', industry: 'Industry',
}

export function diffClient(snapshot = {}, master = {}) {
  return Object.keys(CLIENT_FIELD_LABELS)
    .filter((k) => String(snapshot[k] || '') !== String(master[k] || ''))
    .map((k) => ({ key: k, label: CLIENT_FIELD_LABELS[k], from: snapshot[k] || '', to: master[k] || '' }))
}

/** Template vocabulary for proposal letterheads / Word templates (see templateFieldTokens.js). */
export const PROPOSAL_INLINE_FIELDS = [
  { key: 'proposalNumber', label: 'Proposal Number', sample: 'PROP-2026-0001' },
  { key: 'proposalTitle', label: 'Proposal Title', sample: 'Website Development Proposal' },
  { key: 'proposalVersion', label: 'Version', sample: '1' },
  { key: 'clientName', label: 'Client / Company Name', sample: 'Acme Technologies Pvt Ltd' },
  { key: 'contactPerson', label: 'Contact Person', sample: 'Rohan Iyer' },
  { key: 'designation', label: 'Designation', sample: 'Head of IT' },
  { key: 'phone', label: 'Phone Number', sample: '+91 98765 43210' },
  { key: 'email', label: 'Email Address', sample: 'rohan@acmetech.com' },
  { key: 'billingAddress', label: 'Billing Address', sample: '4th Floor, Tech Park Avenue, Bengaluru' },
  { key: 'shippingAddress', label: 'Shipping / Service Address', sample: '4th Floor, Tech Park Avenue, Bengaluru' },
  { key: 'gstin', label: 'GSTIN', sample: '29AACCL1234A1Z5' },
  { key: 'website', label: 'Website', sample: 'www.acmetech.com' },
  { key: 'dealName', label: 'Linked Deal', sample: 'Acme — Website Development' },
  { key: 'createdDate', label: 'Created Date', sample: '03 Oct 2026' },
  { key: 'validUntil', label: 'Valid Until', sample: '02 Nov 2026' },
  { key: 'proposalValue', label: 'Proposal Value', sample: 'Rs. 4,50,000' },
  { key: 'owner', label: 'Proposal Owner', sample: 'Sneha Kapoor' },
  { key: 'ownerEmail', label: 'Owner Email', sample: 'sneha@lax360.com' },
]
export const PROPOSAL_BLOCK_FIELDS = [
  { key: 'allSections', label: 'All Proposal Sections', isRegion: true },
  ...NARRATIVE_SECTIONS.map((s) => ({ key: s.key, label: s.label, isRegion: true })),
  { key: 'modules', label: 'Modules / Features', isRegion: true },
  { key: 'deliverables', label: 'Deliverables', isRegion: true },
  { key: 'timeline', label: 'Project Timeline', isRegion: true },
  { key: 'responsibilities', label: 'Responsibilities', isRegion: true },
  { key: 'commercialSummary', label: 'Commercial Summary', isRegion: true },
]
export const PROPOSAL_TEMPLATE_FIELDS = [...PROPOSAL_INLINE_FIELDS, ...PROPOSAL_BLOCK_FIELDS]
