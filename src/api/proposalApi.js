// Mock-backend endpoints for the Proposal lifecycle (registered from mockServer.js AFTER the
// generic REST handlers so they override identical generic matchers).
//
// Rules enforced here (not only in the UI):
//   • A proposal is created from a Deal — client/company/contact/customer links come from the Deal's
//     stored records. A Customer is only ever REUSED (never created) and the Deal's stage is never
//     changed by proposal activity.
//   • The client block is a snapshot taken from the master Company/Contact. Master edits don't leak
//     into sent versions; an editable version can be refreshed explicitly.
//   • Status moves follow the lifecycle; "Sent" only happens through Send (which stores the exact
//     PDF that was sent); acceptance never implies payment, an order or a stage change.
//   • Changes after sending go through Create Revision: the current version is frozen into the
//     version history (with its sent document) and a new editable version starts.
//   • Create Quotation turns the commercial summary into a real Quotation carrying proposalId.
//   • Every step writes a timeline event (user + time) on the proposal, mirrored to the Deal.
import { getCollection, setCollection } from './db'
import { getActiveToken } from '../utils/sessionToken'
import { validateSession } from '../utils/sessionStore'
import { getPermissionsForRole } from '../data/permissions'
import { DEFAULT_QUOTATION_TERMS } from '../data/constants'
import {
  PR_TRANSITIONS, PR_EDITABLE, PR_REVISABLE, PR_OPEN, PR_APPROVER_ROLES, DEFAULT_VALIDITY_DAYS,
  normalizeContent, normalizeProposalItem, emptyContent, computeCommercial, validateProposalInput, buildClientSnapshot, diffClient, proposalLabel,
} from '../utils/proposalCalc'
import { lineTotals } from '../utils/salesOrderCalc'
import { lineFromProduct } from '../utils/productRules'
import { checkSignature, dataUrlToBytes, dataUrlByteLength, sanitizeFileName, MAX_ATTACHMENT_BYTES } from '../utils/quotationAttachmentRules'
import { documentError } from './salesOrderApi'
import { createTask } from './taskApi'

const rid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (n, from = new Date()) => new Date(new Date(from).getTime() + n * 86400000).toISOString().slice(0, 10)
const bad = (status, message, fields) => [status, { message, ...(fields ? { fields } : {}) }]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function actor() {
  const session = validateSession(getActiveToken()).session
  const account = session ? getCollection('userAccounts').find((a) => a.id === session.accountId) : null
  return { id: account?.employeeId || session?.accountId || 'unknown', name: account?.name || 'Unknown user', role: session?.role || account?.role || null }
}
const can = (a, module, action) => !!getPermissionsForRole(a.role)?.[module]?.[action]
const find = (name, id) => (id ? getCollection(name).find((x) => x.id === id) || null : null)

function put(name, id, patch) {
  const list = getCollection(name)
  const idx = list.findIndex((x) => x.id === id)
  if (idx === -1) return null
  const updated = { ...list[idx], ...(typeof patch === 'function' ? patch(list[idx]) : patch) }
  const next = [...list]
  next[idx] = updated
  setCollection(name, next)
  return updated
}

function addActivity(p, a, fields) {
  const mirror = fields.mirrorToDeal
  const { mirrorToDeal, ...rest } = fields
  const entry = { id: rid('ACT'), relatedType: 'Proposal', relatedId: p.id, relatedName: p.number, date: new Date().toISOString(), status: 'Completed', by: a.id, ...rest }
  const extra = []
  if (mirror && p.dealId) {
    const dealName = find('deals', p.dealId)?.name || p.dealId
    extra.push({ ...entry, id: rid('ACT'), mirrorOf: entry.id, relatedType: 'Deal', relatedId: p.dealId, relatedName: dealName, subject: rest.subject.includes(p.number) ? rest.subject : `${rest.subject} (${p.number})` })
  }
  setCollection('activities', [entry, ...extra, ...getCollection('activities')])
  return entry
}

function notify(message, type, relatedId) {
  setCollection('notifications', [{ id: rid('NTF'), type, message, relatedType: 'Proposal', relatedId, date: new Date().toISOString(), read: false }, ...getCollection('notifications')])
}

function nextNumber() {
  const year = new Date().getFullYear()
  const re = new RegExp(`^PROP-${year}-(\\d+)$`)
  const max = getCollection('proposals').reduce((m, x) => { const h = re.exec(x.number || ''); return h ? Math.max(m, Number(h[1])) : m }, 0)
  return `PROP-${year}-${String(max + 1).padStart(4, '0')}`
}

/** Master record lookups for a deal/proposal — customer is only ever found, never created. */
function resolveLinks({ dealId, companyId, contactId, customerId }) {
  const deal = find('deals', dealId)
  const company = find('companies', companyId || deal?.companyId)
  const contact = (contactId && find('contacts', contactId)) || (deal?.contactId && find('contacts', deal.contactId)) || null
  const customer = (customerId && find('customers', customerId)) || (deal?.customerId && find('customers', deal.customerId)) || (company && getCollection('customers').find((c) => c.companyId === company.id)) || null
  return { deal, company, contact, customer }
}

function buildDraft(deal) {
  const { company, contact, customer } = resolveLinks({ dealId: deal.id })
  const requirement = deal.requirement || deal.customerNeed || ''
  // the deal's catalog item supplies code, unit, tax and description; the agreed deal value is the price
  const prod = deal.productId ? find('products', deal.productId) : null
  const items = deal.service && deal.value
    ? [prod ? { ...lineFromProduct(prod, { qty: 1 }), description: requirement || prod.description || '', unitPrice: deal.value, discount: 0 } : { productId: null, name: deal.service, description: requirement, qty: 1, unitPrice: deal.value, discount: 0 }]
    : []
  const content = normalizeContent({
    ...emptyContent(),
    executiveSummary: `${company?.name || deal.companyName} is looking for ${deal.service || 'a solution'}${requirement ? ` — ${requirement}` : ''}. This proposal sets out our recommended approach, scope and commercial summary.`,
    requirement,
    scopeOfWork: requirement,
    paymentTerms: '50% advance, 50% on delivery',
    items,
  })
  return {
    dealId: deal.id, dealName: deal.name, dealStage: deal.stage, dealValue: deal.value, budget: deal.budget || 0, expectedCloseDate: deal.expectedClosingDate || null,
    enquiryId: deal.sourceEnquiryId || null, leadId: deal.leadId || null,
    companyId: company?.id || deal.companyId, contactId: contact?.id || null, customerId: customer?.id || deal.customerId || null,
    clientSnapshot: buildClientSnapshot(company, contact, customer),
    title: `${deal.service || 'Solution'} Proposal — ${company?.name || deal.companyName}`,
    service: deal.service || '',
    ownerId: deal.salesperson, source: deal.source || null, sourceDetail: deal.sourceDetail || '',
    createdDate: today(), validUntil: addDays(DEFAULT_VALIDITY_DAYS), notes: deal.notes || '',
    content,
  }
}

const openProposalOf = (dealId) => getCollection('proposals').find((p) => p.dealId === dealId && PR_OPEN.includes(p.status))
const versionSnapshot = (p, a, reason) => ({
  version: p.version, status: p.status, title: p.title, validUntil: p.validUntil, value: p.value, content: p.content, clientSnapshot: p.clientSnapshot,
  sentAt: p.sentAt || null, sentDocument: p.sentDocument || null, createdAt: p.versionCreatedAt || p.createdAt, closedAt: new Date().toISOString(),
  revisedBy: a.id, revisedByName: a.name, reason: reason || null, quotationIds: p.quotationIds || [],
})

export function registerProposalEndpoints(mock, withSession) {
  const idOf = (c, i = 2) => c.url.split('/')[i]
  const body = (c) => (c.data ? JSON.parse(c.data) : {})
  const mustEdit = (a) => (can(a, 'Proposals', 'edit') ? null : bad(403, 'You do not have permission to edit proposals.'))

  // ---- Draft + create from deal --------------------------------------------------------------
  mock.onGet(/^\/deals\/[^/]+\/proposal-draft$/).reply(withSession((config) => {
    const deal = find('deals', idOf(config))
    if (!deal) return bad(404, 'Deal not found.')
    if (['Closed Won', 'Closed Lost', 'Closed Lost – Competition'].includes(deal.stage)) return bad(409, `This deal is ${deal.stage} — proposals can't be started for a closed deal.`)
    const open = openProposalOf(deal.id)
    if (open) return bad(409, `${proposalLabel(open)} is still open for this deal. Continue with it, or create a revision.`, { existingId: open.id })
    return [200, buildDraft(deal)]
  }))

  mock.onPost('/proposals').reply(withSession(() => bad(400, 'Proposals are created from a Deal — open the deal and choose Create Proposal.')))

  mock.onPost('/proposals/from-deal').reply(withSession((config) => {
    const a = actor()
    if (!can(a, 'Proposals', 'create')) return bad(403, 'You do not have permission to create proposals.')
    const req = body(config)
    const deal = find('deals', req.dealId)
    if (!deal) return bad(404, 'Deal not found.')
    if (['Closed Won', 'Closed Lost', 'Closed Lost – Competition'].includes(deal.stage)) return bad(409, `This deal is ${deal.stage}.`)
    const open = openProposalOf(deal.id)
    if (open) return bad(409, `${proposalLabel(open)} is still open for this deal.`, { existingId: open.id })
    const draft = buildDraft(deal)
    const input = req.proposal || {}
    const merged = {
      ...draft,
      title: input.title ?? draft.title, validUntil: input.validUntil ?? draft.validUntil, ownerId: input.ownerId ?? draft.ownerId,
      notes: input.notes ?? draft.notes, templateId: input.templateId || null,
      content: normalizeContent({ ...draft.content, ...(input.content || {}) }),
    }
    if (input.contactId && input.contactId !== draft.contactId) {
      const c = find('contacts', input.contactId)
      if (!c || c.companyId !== draft.companyId) return bad(422, "The chosen contact doesn't belong to this deal's company.")
      const { company, customer } = resolveLinks({ dealId: deal.id })
      merged.contactId = c.id
      merged.clientSnapshot = buildClientSnapshot(company, c, customer)
    }
    const errors = validateProposalInput(merged)
    if (Object.keys(errors).length) return bad(422, 'Please fix the highlighted fields.', errors)
    const now = new Date().toISOString()
    const p = {
      id: rid('PRP'), number: nextNumber(), version: 1, status: 'Draft',
      title: merged.title.trim(), dealId: deal.id, dealName: deal.name, enquiryId: draft.enquiryId, leadId: draft.leadId,
      companyId: draft.companyId, contactId: merged.contactId, customerId: draft.customerId,
      clientSnapshot: merged.clientSnapshot, customerName: merged.clientSnapshot.companyName, service: draft.service,
      content: merged.content, value: computeCommercial(merged.content.items).value,
      ownerId: merged.ownerId, assignedTo: merged.ownerId, source: draft.source, sourceDetail: draft.sourceDetail,
      budget: draft.budget, expectedCloseDate: draft.expectedCloseDate,
      createdDate: today(), validUntil: merged.validUntil, notes: merged.notes, templateId: merged.templateId,
      sentAt: null, sentDocument: null, sends: [], versions: [], documents: [], quotationIds: [], nextFollowUp: null,
      createdBy: a.id, createdAt: now, updatedAt: now, versionCreatedAt: now,
    }
    setCollection('proposals', [p, ...getCollection('proposals')])
    put('deals', deal.id, (d) => ({ proposalIds: [...new Set([...(d.proposalIds || []), p.id])] }))
    addActivity(p, a, { type: 'Created', subject: `Proposal ${proposalLabel(p)} created from deal ${deal.name}`, mirrorToDeal: true })
    notify(`Proposal ${p.number} was created for ${p.customerName}.`, 'Proposal Created', p.id)
    return [201, p]
  }))

  // ---- Edit (draft versions only) -------------------------------------------------------------
  mock.onPut(/^\/proposals\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    const req = body(config)
    // follow-up date is bookkeeping, allowed on any status
    if (Object.keys(req).every((k) => ['nextFollowUp', 'lastContactedDate'].includes(k))) return [200, put('proposals', p.id, req)]
    if (!PR_EDITABLE.includes(p.status)) return bad(409, `A ${p.status.toLowerCase()} proposal can't be edited. Use Create Revision to make changes — the sent version is preserved.`)
    const patch = {}
    ;['title', 'validUntil', 'ownerId', 'notes', 'templateId'].forEach((k) => { if (req[k] !== undefined) patch[k] = req[k] })
    if (req.content) patch.content = normalizeContent({ ...p.content, ...req.content })
    if (req.contactId && req.contactId !== p.contactId) {
      const c = find('contacts', req.contactId)
      if (!c || c.companyId !== p.companyId) return bad(422, "The chosen contact doesn't belong to this proposal's company.")
      const { company, customer } = resolveLinks({ companyId: p.companyId, customerId: p.customerId })
      patch.contactId = c.id
      patch.clientSnapshot = buildClientSnapshot(company, c, customer)
    }
    const merged = { ...p, ...patch }
    const errors = validateProposalInput(merged)
    if (Object.keys(errors).length) return bad(422, 'Please fix the highlighted fields.', errors)
    if (patch.title) patch.title = patch.title.trim()
    if (patch.ownerId) patch.assignedTo = patch.ownerId
    patch.value = computeCommercial(merged.content.items).value
    const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(p[k]) && !['value', 'assignedTo', 'clientSnapshot'].includes(k))
    const sectionsChanged = patch.content ? Object.keys(patch.content).filter((k) => JSON.stringify(patch.content[k]) !== JSON.stringify(p.content[k])) : []
    const labels = [...changed.filter((k) => k !== 'content'), ...sectionsChanged]
    if (!labels.length) return [200, p]
    const updated = put('proposals', p.id, { ...patch, updatedAt: new Date().toISOString() })
    addActivity(p, a, { type: 'Updated', subject: `Proposal updated (${labels.join(', ')})`, updatedFields: labels, mirrorToDeal: false })
    return [200, updated]
  }))

  // ---- Status ----------------------------------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/status$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    const { status, reason } = body(config)
    if (!(PR_TRANSITIONS[p.status] || []).includes(status)) return bad(409, `A proposal can't move from ${p.status} to ${status}.`)
    if (status === 'Sent') return bad(409, 'Use Send Proposal — it records exactly which document was sent to the client.')
    if (status === 'Internal Review') {
      const errors = validateProposalInput(p)
      if (Object.keys(errors).length) return bad(422, 'Complete the proposal before submitting it for review.', errors)
    }
    if (['Rejected', 'Revision Requested'].includes(status) && !String(reason || '').trim()) return bad(422, status === 'Rejected' ? 'Record why the client rejected the proposal.' : 'Record what changes the client asked for.')
    const now = new Date().toISOString()
    const patch = { status, updatedAt: now }
    if (status === 'Viewed') patch.viewedAt = now
    if (status === 'Accepted') Object.assign(patch, { acceptedAt: now, acceptedBy: a.id })
    if (status === 'Rejected') Object.assign(patch, { rejectedAt: now, rejectReason: String(reason).trim() })
    if (status === 'Revision Requested') Object.assign(patch, { revisionRequestedAt: now, revisionRequest: String(reason).trim() })
    if (status === 'Expired') patch.expiredAt = now
    const updated = put('proposals', p.id, patch)
    const labels = {
      'Internal Review': 'Submitted for internal review', Draft: 'Returned to draft', Viewed: 'Marked as viewed by the client (recorded manually — no open-tracking)',
      'Revision Requested': `Client requested revisions — ${String(reason || '').trim()}`, Accepted: 'Proposal accepted by the client', Rejected: `Proposal rejected — ${String(reason || '').trim()}`, Expired: 'Proposal marked expired',
    }
    addActivity(p, a, { type: 'StatusChange', subject: labels[status] || `Status changed to ${status}`, fromStatus: p.status, toStatus: status, mirrorToDeal: true })
    notify(`${p.number} is now ${status}.`, 'Proposal Update', p.id)
    return [200, updated]
  }))

  // ---- Send (stores the exact document sent) ---------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/send$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    if (p.status !== 'Internal Review') return bad(409, p.status === 'Draft' ? 'Submit the proposal for internal review first.' : `A ${p.status.toLowerCase()} proposal can't be sent again — create a revision to send an updated version.`)
    if (!PR_APPROVER_ROLES.includes(a.role)) return bad(403, 'Only a Sales Manager or Admin can approve and send a proposal after internal review.')
    const to = p.clientSnapshot?.email
    if (!to || !EMAIL_RE.test(to)) return bad(422, "This proposal's contact has no valid email address.")
    const req = body(config)
    const subject = String(req.subject || '').trim().slice(0, 200)
    if (!subject) return bad(422, 'Add an email subject.')
    const doc = req.document || {}
    if (!doc.dataUrl) return bad(422, 'The proposal PDF is missing.')
    const size = dataUrlByteLength(doc.dataUrl)
    if (size <= 0 || size > MAX_ATTACHMENT_BYTES) return bad(422, `The proposal PDF must be under ${MAX_ATTACHMENT_BYTES / 1048576} MB.`)
    let sig; try { sig = checkSignature(dataUrlToBytes(doc.dataUrl, 1024), 'pdf') } catch { sig = 'corrupt' }
    if (sig) return bad(422, 'The proposal document is not a valid PDF.')
    const now = new Date().toISOString()
    const sentDocument = { fileName: sanitizeFileName(doc.fileName) || `${p.number}-v${p.version}.pdf`, size, dataUrl: doc.dataUrl, sentAt: now, version: p.version, templateId: req.templateId || p.templateId || null }
    const send = { id: rid('SND'), at: now, byId: a.id, byName: a.name, to, subject, message: String(req.message || '').slice(0, 4000), version: p.version, attachments: (req.attachmentIds || []).slice(0, 10) }
    const updated = put('proposals', p.id, { status: 'Sent', sentAt: now, sentDocument, sends: [send, ...(p.sends || [])], updatedAt: now })
    addActivity(p, a, { type: 'Email', subject: `${proposalLabel(p)} sent to ${to}`, emailTo: to, emailSubject: subject, emailStatus: 'Sent (demo mailer)', attachmentName: sentDocument.fileName, mirrorToDeal: true })
    addActivity(p, a, { type: 'StatusChange', subject: 'Proposal sent', fromStatus: 'Internal Review', toStatus: 'Sent' })
    put('proposals', p.id, { lastContactedDate: now })
    notify(`${proposalLabel(p)} was sent to ${p.customerName}.`, 'Proposal Sent', p.id)
    return [200, { proposal: updated, send }]
  }))

  // ---- Revisions -----------------------------------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/revise$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    if (!PR_REVISABLE.includes(p.status)) return bad(409, p.status === 'Accepted' ? 'An accepted proposal is final — create a new proposal from the deal if the scope changes.' : `A ${p.status.toLowerCase()} proposal is still editable — no revision is needed.`)
    const reason = String(body(config).reason || '').trim()
    if (!reason) return bad(422, 'Record why a new version is needed.')
    const now = new Date().toISOString()
    const snapshot = versionSnapshot(p, a, reason)
    const updated = put('proposals', p.id, {
      version: p.version + 1, status: 'Draft', versions: [snapshot, ...(p.versions || [])],
      sentAt: null, sentDocument: null, viewedAt: null, acceptedAt: null, rejectedAt: null, expiredAt: null, revisionRequest: null,
      validUntil: p.validUntil < today() ? addDays(DEFAULT_VALIDITY_DAYS) : p.validUntil, versionCreatedAt: now, updatedAt: now, quotationIds: p.quotationIds || [],
    })
    addActivity(p, a, { type: 'Revision', subject: `${p.number} – Version ${updated.version} created — ${reason}`, revision: updated.version, mirrorToDeal: true })
    return [200, updated]
  }))

  // ---- Client details: diff + explicit refresh -----------------------------------------------------------
  mock.onGet(/^\/proposals\/[^/]+\/client-diff$/).reply(withSession((config) => {
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const { company, contact, customer } = resolveLinks({ companyId: p.companyId, contactId: p.contactId, customerId: p.customerId })
    return [200, { changes: diffClient(p.clientSnapshot, buildClientSnapshot(company, contact, customer)), editable: PR_EDITABLE.includes(p.status) }]
  }))

  mock.onPost(/^\/proposals\/[^/]+\/refresh-client$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    if (!PR_EDITABLE.includes(p.status)) return bad(409, 'Only a draft version can pick up master-record changes. Create a revision — the sent version keeps its original client details.')
    const { company, contact, customer } = resolveLinks({ companyId: p.companyId, contactId: p.contactId, customerId: p.customerId })
    const next = buildClientSnapshot(company, contact, customer)
    const changes = diffClient(p.clientSnapshot, next)
    if (!changes.length) return [200, p]
    const updated = put('proposals', p.id, { clientSnapshot: next, customerName: next.companyName, updatedAt: new Date().toISOString() })
    addActivity(p, a, { type: 'Updated', subject: `Client details refreshed from the master record (${changes.map((c) => c.label).join(', ')})`, updatedFields: changes.map((c) => c.key) })
    return [200, updated]
  }))

  // ---- Communication & notes ------------------------------------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/activities$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    const { type, data = {} } = body(config)
    const now = new Date().toISOString()
    const client = p.clientSnapshot || {}
    const text = (v, max = 2000) => String(v || '').trim().slice(0, max)
    let fields
    if (type === 'Note') {
      if (!text(data.content)) return bad(422, 'Write a note first.')
      fields = { type: 'Note', subject: text(data.title, 120) || 'Note added', notes: text(data.content) }
    } else if (type === 'Call') {
      if (!text(data.outcome) || !text(data.notes)) return bad(422, 'Choose an outcome and add call notes.')
      fields = { type: 'Call', subject: `Call with ${client.contactName}`, notes: text(data.notes), callType: data.callType || 'Outgoing', callOutcome: text(data.outcome, 80), duration: data.duration || null, nextFollowUp: data.nextFollowUp || null }
    } else if (type === 'Email') {
      if (!text(data.subject) || !text(data.message)) return bad(422, 'Add a subject and a message.')
      fields = { type: 'Email', subject: `Email: ${text(data.subject, 160)}`, notes: text(data.message, 4000), emailTo: client.email, emailSubject: text(data.subject, 160), emailStatus: 'Sent (via mail app)' }
    } else if (type === 'WhatsApp') {
      if (!text(data.message)) return bad(422, 'Write the message.')
      fields = { type: 'WhatsApp', subject: `WhatsApp message to ${client.contactName}`, notes: text(data.message, 2000), waTo: client.phone, waStatus: 'Sent (via WhatsApp)' }
    } else if (type === 'Meeting') {
      if (!text(data.title) || !data.date || !data.startTime) return bad(422, 'A meeting needs a title, date and start time.')
      if (data.date < today()) return bad(422, 'The meeting date cannot be in the past.')
      const id = rid('MTG')
      const online = data.meetingType === 'Online Meeting'
      fields = {
        id, type: 'Meeting', subject: `Meeting scheduled: ${text(data.title, 160)}`, notes: text(data.notes), title: text(data.title, 160),
        meetingDate: data.date, meetingStartTime: data.startTime, meetingEndTime: data.endTime || null, meetingType: data.meetingType || 'Online Meeting',
        participants: text(data.participants, 300) || `${a.name}, ${client.contactName} (${client.companyName})`, meetingLink: online ? `/meetings/${id}` : null, meetingStatus: 'Scheduled',
        contactName: client.contactName, contactEmail: client.email, contactPhone: client.phone, scheduledBy: a.id, scheduledAt: now, sharedVia: [],
      }
    } else if (type === 'Follow-up') {
      if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return bad(422, 'Choose a follow-up date.')
      if (data.date < today()) return bad(422, 'The follow-up date cannot be in the past.')
      fields = { type: 'Follow-up', subject: `${data.followUpType || 'Call'} follow-up scheduled for ${data.date}`, notes: text(data.notes, 1000) || undefined, followUpType: data.followUpType || 'Call', followUpDate: data.date, followUpTime: data.time || null, assignedTo: data.assignedTo || p.ownerId }
    } else return bad(422, 'Unknown activity type.')
    const { id: forcedId, ...rest } = fields
    const entry = addActivity(p, a, { ...rest, mirrorToDeal: true })
    if (forcedId) { // meetings keep a stable id so /meetings/:id resolves
      setCollection('activities', getCollection('activities').map((x) => (x.id === entry.id ? { ...x, id: forcedId } : x)))
    }
    const patch = {}
    if (['Call', 'Email', 'WhatsApp'].includes(type)) patch.lastContactedDate = now
    if (type === 'Call' && data.nextFollowUp) patch.nextFollowUp = data.nextFollowUp
    if (type === 'Follow-up') patch.nextFollowUp = data.date
    if (Object.keys(patch).length) put('proposals', p.id, patch)
    if (type === 'Follow-up') {
      // a real task (numbered, on the calendar, reminded, audited) tied to the activity that recorded it
      const ft = data.followUpType || 'Call'
      const made = createTask({ ...a, system: true }, {
        title: `${ft} follow-up — ${p.number}`, taskType: ['Call', 'Email', 'WhatsApp', 'Meeting', 'Demo'].includes(ft) ? ft : 'Follow-up', relatedType: 'Proposal', relatedId: p.id,
        assignees: [data.assignedTo || p.ownerId], priority: 'Medium', dueDate: data.date, dueTime: data.time || null, description: text(data.notes, 1000), visibility: 'Team',
      }, { activityId: entry.id, source: 'activity', allowDuplicate: true, message: 'Created from the proposal follow-up' })
      if (made[0] === 201) put('activities', entry.id, { taskId: made[1].id })
    }
    return [200, { activity: { ...entry, id: forcedId || entry.id } }]
  }))

  // ---- Attachments -------------------------------------------------------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/documents$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    const req = body(config)
    const error = documentError(req)
    if (error) return bad(422, error)
    if ((p.documents || []).length >= 20) return bad(422, 'A proposal can hold at most 20 attachments.')
    if ((p.documents || []).some((d) => d.hash && d.hash === req.hash)) return bad(409, 'This exact file is already attached.')
    const doc = {
      id: rid('DOC'), fileName: sanitizeFileName(req.fileName), mimeType: req.mimeType || '', size: dataUrlByteLength(req.dataUrl), hash: req.hash || null,
      category: ['Supporting Document', 'Case Study', 'Technical Spec', 'Other'].includes(req.category) ? req.category : 'Other',
      dataUrl: req.dataUrl, uploadedAt: new Date().toISOString(), uploadedBy: a.id, uploadedByName: a.name, proposalId: p.id, version: p.version,
    }
    const updated = put('proposals', p.id, { documents: [doc, ...(p.documents || [])] })
    addActivity(p, a, { type: 'Attachment', subject: `Document attached: "${doc.fileName}"`, attachmentName: doc.fileName, attachmentAction: 'Attached' })
    return [200, updated]
  }))

  mock.onDelete(/^\/proposals\/[^/]+\/documents\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const parts = config.url.split('/')
    const p = find('proposals', parts[2])
    if (!p) return bad(404, 'Proposal not found.')
    const denied = mustEdit(a); if (denied) return denied
    const doc = (p.documents || []).find((d) => d.id === parts[4])
    if (!doc) return bad(404, 'Attachment not found on this proposal.')
    const updated = put('proposals', p.id, { documents: p.documents.filter((d) => d.id !== doc.id) })
    addActivity(p, a, { type: 'Attachment', subject: `Document removed: "${doc.fileName}"`, attachmentName: doc.fileName, attachmentAction: 'Removed' })
    return [200, updated]
  }))

  // ---- Create Quotation from proposal ----------------------------------------------------------------------------------------------
  mock.onPost(/^\/proposals\/[^/]+\/create-quotation$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    if (!can(a, 'Quotations', 'create')) return bad(403, 'You do not have permission to create quotations.')
    if (['Rejected', 'Expired'].includes(p.status)) return bad(409, `A ${p.status.toLowerCase()} proposal can't be quoted — create a revision first.`)
    const existing = getCollection('quotations').filter((q) => p.quotationIds?.includes(q.id) && !['Rejected', 'Expired'].includes(q.status))
    if (existing.length && !body(config).allowAnother) return bad(409, `Quotation ${existing[0].number} is already open for this proposal.`, { existingId: existing[0].id })
    const items = (p.content.items || []).filter((i) => i.name)
    if (!items.length) return bad(422, 'Add products / services to the proposal before creating a quotation.')
    const client = p.clientSnapshot || {}
    const { deal, customer } = resolveLinks({ dealId: p.dealId, companyId: p.companyId, contactId: p.contactId, customerId: p.customerId })
    // lines keep their catalog snapshot and own tax rate; totals are computed per line, not at a flat 18%
    const qItems = items.map((i) => { const n = normalizeProposalItem(i); return { productId: n.productId, productCode: n.productCode, listPrice: n.listPrice, category: n.category, unit: n.unit, billingCycle: n.billingCycle, name: n.name, description: n.description, qty: n.qty, unitPrice: n.unitPrice, discount: n.discount, taxRate: n.taxRate } })
    const totals = lineTotals(qItems)
    const subtotal = totals.subtotal
    const tax = totals.tax
    const qtId = rid('QT')
    const template = getCollection('quotationTemplates').find((t) => t.isDefault && t.isActive) || null
    const q = {
      id: qtId, number: `QUO-${new Date().getFullYear()}-${qtId.split('-').pop()}`,
      createdDate: today(), validUntil: addDays(15), status: 'Draft', terms: DEFAULT_QUOTATION_TERMS, paymentTerms: p.content.paymentTerms || '50% advance, 50% on delivery',
      templateId: template?.id ?? null, salesOrderId: null,
      companyId: p.companyId, contactId: p.contactId, customerId: customer?.id || null,
      customerName: customer?.name || client.companyName, contactName: client.contactName, contactPhone: client.phone, contactEmail: client.email,
      billingAddress: client.billingAddress, shippingAddress: client.shippingAddress, gstin: client.gstin,
      dealId: p.dealId, leadId: p.leadId, sourceEnquiryId: p.enquiryId, source: p.source, sourceDetail: p.sourceDetail,
      requirement: p.content.requirement, scopeOfWork: p.content.scopeOfWork, assignedTo: p.ownerId,
      items: qItems,
      subtotal, tax, amount: totals.total,
      proposalId: p.id, proposalNumber: p.number, proposalVersion: p.version,
    }
    setCollection('quotations', [q, ...getCollection('quotations')])
    put('proposals', p.id, (x) => ({ quotationIds: [...(x.quotationIds || []), q.id] }))
    if (deal) put('deals', deal.id, (d) => ({ quotationIds: [...new Set([...(d.quotationIds || []), q.id])] }))
    addActivity(p, a, { type: 'Quotation', subject: `Quotation ${q.number} created from ${proposalLabel(p)}`, quotationId: q.id, mirrorToDeal: true })
    setCollection('activities', [{ id: rid('ACT'), relatedType: 'Quotation', relatedId: q.id, relatedName: q.number, date: new Date().toISOString(), status: 'Completed', by: a.id, type: 'Created', subject: `Quotation ${q.number} created from proposal ${proposalLabel(p)} for ${q.customerName}` }, ...getCollection('activities')])
    notify(`Quotation ${q.number} was created from ${p.number}.`, 'Quotation Created', p.id)
    return [201, { quotation: q, proposal: find('proposals', p.id) }]
  }))

  // ---- Expiry sweep (called when proposal screens load) -----------------------------------------------------------------------------------
  mock.onPost('/proposals/expire-sweep').reply(withSession(() => {
    const a = actor()
    const due = getCollection('proposals').filter((p) => ['Sent', 'Viewed', 'Revision Requested'].includes(p.status) && p.validUntil < today())
    due.forEach((p) => {
      put('proposals', p.id, { status: 'Expired', expiredAt: new Date().toISOString() })
      addActivity(p, { ...a, id: null }, { type: 'StatusChange', subject: `Proposal expired — validity ended ${p.validUntil}`, fromStatus: p.status, toStatus: 'Expired', mirrorToDeal: true, by: null })
    })
    return [200, { expired: due.map((p) => p.id) }]
  }))

  // ---- Delete (drafts that never left the building) -------------------------------------------------------------------------------------------
  mock.onDelete(/^\/proposals\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const p = find('proposals', idOf(config))
    if (!p) return bad(404, 'Proposal not found.')
    if (!can(a, 'Proposals', 'delete')) return bad(403, 'You do not have permission to delete proposals.')
    if (p.status !== 'Draft' || p.version > 1 || (p.quotationIds || []).length || p.sentAt) return bad(409, 'Only a first-version draft that was never sent and has no quotation can be deleted.')
    setCollection('proposals', getCollection('proposals').filter((x) => x.id !== p.id))
    setCollection('activities', getCollection('activities').filter((x) => !(x.relatedType === 'Proposal' && x.relatedId === p.id)))
    if (p.dealId) put('deals', p.dealId, (d) => ({ proposalIds: (d.proposalIds || []).filter((id) => id !== p.id) }))
    return [200, { success: true }]
  }))
}
