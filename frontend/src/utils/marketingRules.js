// Pure rules + analytics for the Marketing section (Campaigns, Lead Sources, Marketing Analytics).
// There is no separate analytics dataset: every figure is computed from the real CRM records (leads, deals, customers, invoices, payments, expenses)
// through the attribution ids (campaignId / leadSourceId) that travel Lead → Deal → Customer and, from there, to the invoices and payments.
import { isIssued, paymentNet, countsAsPayment } from './invoiceRules'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const dayOf = (v) => String(v || '').slice(0, 10)

export const CAMPAIGN_STATUSES = ['Draft', 'Scheduled', 'Active', 'Paused', 'Completed', 'Cancelled']
export const CAMPAIGN_TYPES = ['Email Marketing', 'Social Media', 'Paid Advertising', 'Search Ads', 'Webinar / Event', 'Content Marketing', 'Referral Program', 'Outbound / Outreach', 'Partner / Channel', 'Offline / Print']
export const SOURCE_CATEGORIES = ['Digital', 'Paid', 'Organic', 'Referral', 'Offline', 'Partner', 'Integration', 'Internal']
export const SOURCE_ALIASES = { 'Existing Customer': 'Existing Customer Referral' }

// name, category, sourceType, captureMethod, connected
export const DEFAULT_LEAD_SOURCES = [
  ['Website', 'Organic', 'Digital', 'Form', true], ['Contact Form', 'Organic', 'Digital', 'Form', true], ['Google', 'Paid', 'Digital', 'API', false], ['Facebook', 'Paid', 'Digital', 'API', false], ['Instagram', 'Paid', 'Digital', 'API', false],
  ['LinkedIn', 'Paid', 'Digital', 'API', false], ['WhatsApp', 'Digital', 'Digital', 'Webhook', false], ['Phone', 'Offline', 'Offline', 'Manual', true], ['Email', 'Digital', 'Offline', 'Manual', true], ['Walk-in', 'Offline', 'Offline', 'Manual', true],
  ['Referral', 'Referral', 'Offline', 'Manual', true], ['Campaign', 'Digital', 'Digital', 'Webhook', false], ['Advertisement', 'Paid', 'Digital', 'API', false], ['Partner', 'Partner', 'Offline', 'Manual', true],
  ['Existing Customer Referral', 'Referral', 'Offline', 'Manual', true], ['Import', 'Internal', 'Offline', 'Manual', true], ['Manual Entry', 'Internal', 'Offline', 'Manual', true], ['API / Integration', 'Integration', 'Integration', 'API', false],
]

// ---- permissions ----------------------------------------------------------------------------------------------------
export const MARKETING_PERMISSIONS = [
  ['viewCampaigns', 'View campaigns'], ['createCampaign', 'Create campaigns'], ['editCampaign', 'Edit campaigns'], ['deleteDraft', 'Delete draft campaigns'], ['runCampaign', 'Start / pause / complete campaigns'],
  ['viewSources', 'View lead sources'], ['manageSources', 'Manage lead sources'], ['viewAnalytics', 'View marketing analytics'], ['export', 'Export marketing reports'], ['viewFinancial', 'View financial marketing data'],
]
const ALL = MARKETING_PERMISSIONS.map(([k]) => k)
export const MARKETING_ROLE_CAPS = {
  'Super Admin': ALL, Admin: ALL, Marketing: ALL,
  MD: ['viewCampaigns', 'viewSources', 'viewAnalytics', 'export', 'viewFinancial'], CEO: ['viewCampaigns', 'viewSources', 'viewAnalytics', 'export', 'viewFinancial'],
  Accounts: ['viewCampaigns', 'viewSources', 'viewAnalytics', 'export', 'viewFinancial'],
  'Sales Manager': ['viewCampaigns', 'viewSources', 'viewAnalytics'], 'Sales Executive': ['viewCampaigns', 'viewSources'],
}

export function nextCampaignNumber(list, date = new Date()) {
  const year = date.getFullYear()
  const re = new RegExp(`^CMP-${year}-([0-9]+)$`)
  const max = (list || []).reduce((m, x) => { const h = re.exec(x.number || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `CMP-${year}-${String(max + 1).padStart(5, '0')}`
}

/** What the lifecycle allows at this status (before permissions). A campaign is never started or completed automatically. */
export function campaignActions(c) {
  const s = c.status
  return {
    editAll: s === 'Draft', edit: !['Completed', 'Cancelled'].includes(s), schedule: s === 'Draft', start: s === 'Draft' || s === 'Scheduled', pause: s === 'Active', resume: s === 'Paused',
    complete: s === 'Active' || s === 'Paused', cancel: ['Draft', 'Scheduled', 'Active', 'Paused'].includes(s), deleteDraft: s === 'Draft', recordSpend: ['Active', 'Paused', 'Completed'].includes(s),
  }
}

// ---- attribution ----------------------------------------------------------------------------------------------------
const norm = (s) => String(s || '').trim().toLowerCase()
export const ATTR = ['campaignId', 'leadSourceId']

/**
 * Repairs / propagates attribution across the chain. Ids are authoritative; names are looked up only when an id is missing; an existing id is NEVER overwritten
 * (historical attribution stays). Lead → Deal → Customer inherit what the lead carried. Pure: returns new arrays and whether anything changed.
 */
export function repairAttribution({ leads = [], enquiries = [], deals = [], customers = [], campaigns = [], leadSources = [] }) {
  const srcByName = new Map(leadSources.map((s) => [norm(s.name), s]))
  const srcById = new Map(leadSources.map((s) => [s.id, s]))
  const cmpByName = new Map(campaigns.map((c) => [norm(c.name), c]))
  const cmpById = new Map(campaigns.map((c) => [c.id, c]))
  let changed = false
  const fix = (r) => {
    const p = {}
    const srcName = SOURCE_ALIASES[r.source] || r.source
    let src = r.leadSourceId ? srcById.get(r.leadSourceId) : null
    if (!src && srcName) src = srcByName.get(norm(srcName)) || null
    let cmp = r.campaignId ? cmpById.get(r.campaignId) : null
    if (!cmp && r.campaign) cmp = cmpByName.get(norm(r.campaign)) || null
    if (!src && cmp?.leadSourceId) src = srcById.get(cmp.leadSourceId) || null
    if (src && r.leadSourceId !== src.id) p.leadSourceId = src.id
    if (src && r.source !== src.name) p.source = src.name
    if (cmp && r.campaignId !== cmp.id) p.campaignId = cmp.id
    if (cmp && r.campaign !== cmp.name) p.campaign = cmp.name
    if (Object.keys(p).length) { changed = true; return { ...r, ...p } }
    return r
  }
  const L = leads.map(fix); const E = enquiries.map(fix)
  const leadById = new Map(L.map((l) => [l.id, l]))
  const custByCompany = new Map(customers.map((c) => [c.companyId, c]))
  const D = deals.map((d0) => {
    let d = fix(d0)
    const lead = d.leadId ? leadById.get(d.leadId) : null
    const patch = {}
    if (lead) ATTR.forEach((k) => { if (!d[k] && lead[k]) patch[k] = lead[k] })
    if (!d.customerId && d.stage === 'Closed Won') { const c = custByCompany.get(d.companyId); if (c) patch.customerId = c.id }
    if (Object.keys(patch).length) { changed = true; d = fix({ ...d, ...patch }) }
    return d
  })
  const dealsByCustomer = new Map()
  D.forEach((d) => { if (d.customerId) { const l = dealsByCustomer.get(d.customerId) || []; l.push(d); dealsByCustomer.set(d.customerId, l) } })
  const C = customers.map((c0) => {
    let c = fix(c0)
    if (c.campaignId || c.leadSourceId) return c
    // first touch = the customer's earliest attributed deal; a customer that has no deal linked by id falls back to deals of the same company
    const linked = dealsByCustomer.get(c.id) || D.filter((d) => d.companyId && d.companyId === c.companyId)
    const first = linked.filter((d) => d.leadSourceId || d.campaignId).sort((a, b) => dayOf(a.createdDate).localeCompare(dayOf(b.createdDate)))[0]
    if (!first) return c
    changed = true
    c = { ...c, leadSourceId: first.leadSourceId || null, campaignId: first.campaignId || null, source: first.source || '', campaign: first.campaign || '', attributedDealId: first.id, attributedLeadId: first.leadId || null }
    return c
  })
  return { leads: L, enquiries: E, deals: D, customers: C, changed }
}

// ---- analytics ------------------------------------------------------------------------------------------------------
const QUALIFIED = ['Qualified', 'Converted']
const blank = () => ({ enquiries: 0, leads: 0, newLeads: 0, contactedLeads: 0, qualifiedLeads: 0, unqualifiedLeads: 0, lostLeads: 0, convertedLeads: 0, deals: 0, openDeals: 0, wonDeals: 0, lostDeals: 0, dealValue: 0, wonValue: 0, customers: 0, invoiced: 0, collected: 0, outstanding: 0, refunded: 0 })
export const spendOfCampaign = (c, expenses = []) => round2((c.costs || []).reduce((s, x) => s + (Number(x.amount) || 0), 0) + expenses.filter((e) => e.campaignId === c.id && ['Approved', 'Paid', 'Reimbursed'].includes(e.status)).reduce((s, e) => s + (Number(e.cost ?? e.total) || 0), 0))
export const withRates = (m, spend = null) => {
  const out = { ...m }
  out.conversionRate = m.leads ? round2(m.customers / m.leads * 100) : 0
  out.qualificationRate = m.leads ? round2(m.qualifiedLeads / m.leads * 100) : 0
  out.leadToDealRate = m.leads ? round2(m.deals / m.leads * 100) : 0
  out.winRate = m.deals ? round2(m.wonDeals / m.deals * 100) : 0
  out.spend = spend
  out.costPerLead = spend && m.leads ? round2(spend / m.leads) : null
  out.costPerCustomer = spend && m.customers ? round2(spend / m.customers) : null
  out.roi = spend && spend > 0 ? round2((m.collected - spend) / spend * 100) : null
  return out
}
const inRange = (d, f) => { const k = dayOf(d); return !(f.from && k < f.from) && !(f.to && k > f.to) }
const monthOf = (d) => dayOf(d).slice(0, 7)

/**
 * data = { campaigns, leadSources, leads, enquiries, deals, customers, invoices, payments, expenses, users, products }
 * filters = { from, to, campaignId, leadSourceId, channel, campaignStatus, leadStatus, dealStage, owner, team, product, customerId, companyId }
 */
export function computeMarketing(data, f = {}) {
  const { campaigns = [], leadSources = [], leads = [], enquiries = [], deals = [], customers = [], invoices = [], payments = [], expenses = [], users = [], products = [] } = data
  const cmpById = new Map(campaigns.map((c) => [c.id, c])); const userById = new Map(users.map((u) => [u.id, u]))
  const prodName = new Map(products.map((p) => [p.id, p.name]))
  const custById = new Map(customers.map((c) => [c.id, c])); const dealById = new Map(deals.map((d) => [d.id, d])); const invById = new Map(invoices.map((i) => [i.id, i]))
  const teamOf = (id) => userById.get(id)?.department || ''
  const campaignOk = (r) => {
    if (f.campaignId && r.campaignId !== f.campaignId) return false
    if (f.leadSourceId && r.leadSourceId !== f.leadSourceId) return false
    const c = r.campaignId ? cmpById.get(r.campaignId) : null
    if (f.channel && c?.channel !== f.channel) return false
    if (f.campaignStatus && c?.status !== f.campaignStatus) return false
    return true
  }
  const prodOk = (r) => !f.product || r.productId === f.product || (r.service && r.service === prodName.get(f.product)) || (r.productIds || []).includes(f.product)
  const ownerOk = (id) => (!f.owner || id === f.owner) && (!f.team || teamOf(id) === f.team)
  const leadsF = leads.filter((l) => campaignOk(l) && inRange(l.createdDate, f) && (!f.leadStatus || l.status === f.leadStatus) && ownerOk(l.assignedTo) && prodOk(l) && (!f.customerId || l.customerId === f.customerId) && (!f.companyId || l.companyId === f.companyId))
  const enqF = enquiries.filter((e) => campaignOk(e) && inRange(e.date, f) && ownerOk(e.assignedUser) && (!f.leadStatus || false))
  const dealsF = deals.filter((d) => campaignOk(d) && inRange(d.createdDate, f) && (!f.dealStage || d.stage === f.dealStage) && ownerOk(d.salesperson) && prodOk(d) && (!f.customerId || d.customerId === f.customerId) && (!f.companyId || d.companyId === f.companyId))
  const custF = customers.filter((c) => campaignOk(c) && (c.campaignId || c.leadSourceId) && inRange(c.since, f) && (!f.customerId || c.id === f.customerId) && (!f.companyId || c.companyId === f.companyId) && ownerOk(c.accountManager))
  // an invoice carries the attribution of its deal, else of its customer's first touch — never of an unrelated record
  const attrOfInvoice = (inv) => { const d = inv.dealId ? dealById.get(inv.dealId) : null; if (d && (d.campaignId || d.leadSourceId)) return d; const c = custById.get(inv.customerId); return c && (c.campaignId || c.leadSourceId) ? c : null }
  const invF = invoices.filter((i) => isIssued(i)).map((i) => ({ i, a: attrOfInvoice(i) })).filter(({ i, a }) => a && campaignOk(a) && (!f.customerId || i.customerId === f.customerId) && (!f.companyId || i.companyId === f.companyId) && inRange(i.issueDate, f) && (!f.product || (i.items || []).some((x) => x.productId === f.product)))
  const invIds = new Set(invF.map(({ i }) => i.id))
  const payF = payments.filter((p) => invIds.has(p.invoiceId) && countsAsPayment(p) && inRange(p.date, f))

  const groups = { c: {}, s: {}, all: blank() }
  const at = (kind, id) => (groups[kind][id] ||= blank())
  const bump = (rec, fn) => { fn(groups.all); if (rec.campaignId) fn(at('c', rec.campaignId)); if (rec.leadSourceId) fn(at('s', rec.leadSourceId)) }
  enqF.forEach((e) => bump(e, (m) => { m.enquiries += 1 }))
  leadsF.forEach((l) => bump(l, (m) => { m.leads += 1; if (l.status === 'New') m.newLeads += 1; if (l.status === 'Contacted') m.contactedLeads += 1; if (QUALIFIED.includes(l.status)) m.qualifiedLeads += 1; if (l.status === 'Unqualified') m.unqualifiedLeads += 1; if (l.status === 'Lost') m.lostLeads += 1; if (l.status === 'Converted') m.convertedLeads += 1 }))
  dealsF.forEach((d) => bump(d, (m) => { m.deals += 1; m.dealValue += d.value || 0; if (d.stage === 'Closed Won') { m.wonDeals += 1; m.wonValue += d.value || 0 } else if (String(d.stage).startsWith('Closed Lost')) m.lostDeals += 1; else m.openDeals += 1 }))
  custF.forEach((c) => bump(c, (m) => { m.customers += 1 }))
  const paidBy = new Map(); payF.forEach((p) => paidBy.set(p.invoiceId, round2((paidBy.get(p.invoiceId) || 0) + paymentNet(p))))
  invF.forEach(({ i, a }) => { const paid = paidBy.get(i.id) || 0; bump(a, (m) => { m.invoiced += i.amount || 0; m.collected += paid; m.outstanding += Math.max(0, (i.amount || 0) - (i.paidAmount || 0)) }) })
  payF.forEach((p) => { if (p.refundedAmount) { const a = invF.find(({ i }) => i.id === p.invoiceId)?.a; if (a) bump(a, (m) => { m.refunded += p.refundedAmount }) } })
  const clean = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]))

  const campaignRows = campaigns.filter((c) => (!f.campaignId || c.id === f.campaignId) && (!f.leadSourceId || c.leadSourceId === f.leadSourceId) && (!f.channel || c.channel === f.channel) && (!f.campaignStatus || c.status === f.campaignStatus) && (!f.owner || c.ownerId === f.owner) && (!f.team || teamOf(c.ownerId) === f.team) && (!f.product || (c.productIds || []).includes(f.product)))
    .map((c) => { const spend = spendOfCampaign(c, expenses); return { id: c.id, number: c.number, name: c.name, status: c.status, channel: c.channel, type: c.type, ownerId: c.ownerId, leadSourceId: c.leadSourceId, budget: c.budget || 0, targetLeads: c.targetLeads || 0, startDate: c.startDate, endDate: c.endDate, ...withRates(clean(groups.c[c.id] || blank()), spend) } })
  const spendBySource = {}; const costedLeads = {}
  campaignRows.forEach((c) => { if (c.leadSourceId) { spendBySource[c.leadSourceId] = round2((spendBySource[c.leadSourceId] || 0) + c.spend); costedLeads[c.leadSourceId] = (costedLeads[c.leadSourceId] || 0) + c.leads } })
  const sourceRows = leadSources.filter((s) => !f.leadSourceId || s.id === f.leadSourceId).map((s) => {
    const m = withRates(clean(groups.s[s.id] || blank()), spendBySource[s.id] || null)
    const spend = spendBySource[s.id] || null
    return { id: s.id, name: s.name, category: s.category, active: s.active, ...m, costPerLead: spend && costedLeads[s.id] ? round2(spend / costedLeads[s.id]) : null }
  })
  const totalSpend = round2(campaignRows.reduce((s, c) => s + c.spend, 0))
  const totalBudget = round2(campaignRows.reduce((s, c) => s + c.budget, 0))
  const totals = { ...withRates(clean(groups.all), totalSpend || null), budget: totalBudget, spend: totalSpend, totalCampaigns: campaignRows.length, activeCampaigns: campaignRows.filter((c) => c.status === 'Active').length, completedCampaigns: campaignRows.filter((c) => c.status === 'Completed').length }

  // monthly trends (last 12 months, or the filtered range)
  const months = []
  const endKey = f.to ? monthOf(f.to) : todayKey().slice(0, 7)
  let [y, m] = endKey.split('-').map(Number)
  const startKey = f.from ? monthOf(f.from) : null
  for (let i = 0; i < 12; i += 1) { const key = `${y}-${String(m).padStart(2, '0')}`; if (startKey && key < startKey) break; months.unshift(key); m -= 1; if (m === 0) { m = 12; y -= 1 } }
  const trend = months.map((key) => {
    const ls = leadsF.filter((l) => monthOf(l.createdDate) === key); const cs = custF.filter((c) => monthOf(c.since) === key)
    const rev = payF.filter((p) => monthOf(p.date) === key).reduce((s, p) => s + paymentNet(p), 0)
    return { key, label: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' }), leads: ls.length, qualified: ls.filter((l) => QUALIFIED.includes(l.status)).length, customers: cs.length, revenue: round2(rev), conversionRate: ls.length ? round2(cs.length / ls.length * 100) : 0 }
  })
  const funnel = [['Enquiries', totals.enquiries], ['Leads', totals.leads], ['Qualified', totals.qualifiedLeads], ['Deals', totals.deals], ['Won deals', totals.wonDeals], ['Customers', totals.customers], ['Invoiced (₹)', totals.invoiced], ['Collected (₹)', totals.collected]].map(([name, value]) => ({ name, value }))
  return { totals, campaigns: campaignRows, sources: sourceRows, trend, funnel, unattributedLeads: leads.filter((l) => !l.campaignId && !l.leadSourceId).length }
}
