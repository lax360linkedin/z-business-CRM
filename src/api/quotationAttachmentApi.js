// Mock-backend endpoints for quotation attachments and sending. Registered from mockServer.js.
//
// Dedicated endpoints (not generic PUTs) because they enforce rules a plain update can't: the file
// must be a structurally valid PDF/Word document, it is always stamped with THIS quotation's id and
// client ids taken from the stored record (never from the request), and a send can only go to the
// client already on the quotation, carrying an attachment that's linked to that same quotation.
import { getCollection, setCollection } from './db'
import { getActiveToken } from '../utils/sessionToken'
import { validateSession } from '../utils/sessionStore'
import {
  MAX_ATTACHMENT_VERSIONS, LOCKED_STATUSES, checkFileMeta, checkSignature, dataUrlToBytes, dataUrlByteLength, kindFromExtension, sanitizeFileName,
} from '../utils/quotationAttachmentRules'

const APPROVER_ROLES = ['Super Admin', 'Admin', 'MD', 'Sales Manager']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const rid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`

function currentActor() {
  const session = validateSession(getActiveToken()).session
  const account = session ? getCollection('userAccounts').find((a) => a.id === session.accountId) : null
  return { id: account?.employeeId || session?.accountId || 'unknown', name: account?.name || 'Unknown user', role: account?.role || null }
}

function findQuotation(id) {
  return getCollection('quotations').find((q) => q.id === id)
}

function putQuotation(id, patch) {
  const list = getCollection('quotations')
  const idx = list.findIndex((q) => q.id === id)
  const updated = { ...list[idx], ...patch }
  const next = [...list]
  next[idx] = updated
  setCollection('quotations', next)
  return updated
}

function pushActivity(q, fields) {
  setCollection('activities', [{
    id: rid('ACT'), relatedType: 'Quotation', relatedId: q.id, relatedName: q.number,
    date: new Date().toISOString(), status: 'Completed', ...fields,
  }, ...getCollection('activities')])
}

function pushNotification(message, q) {
  setCollection('notifications', [{
    id: rid('NTF'), type: 'Quotation Updated', message, relatedType: 'Quotation', relatedId: q.id,
    date: new Date().toISOString(), read: false,
  }, ...getCollection('notifications')])
}

/** Drops the stored bytes of a superseded/removed version unless it was already sent to the client — a sent document stays retrievable as the record of what the client received. */
function archive(att, patch) {
  const next = { ...att, ...patch }
  if (!next.sentAt) next.dataUrl = null
  return next
}

const lockedMessage = (q) => `A ${q.status.toLowerCase()} quotation's documents can't be changed.`

export function registerQuotationAttachmentEndpoints(mock, withSession) {
  // ATTACH or REPLACE
  mock.onPost(/^\/quotations\/[^/]+\/attachments$/).reply(withSession((config) => {
    const id = config.url.split('/')[2]
    const q = findQuotation(id)
    if (!q) return [404, { message: 'Quotation not found.' }]
    if (LOCKED_STATUSES.includes(q.status)) return [409, { message: lockedMessage(q) }]
    const body = JSON.parse(config.data)
    const fileName = sanitizeFileName(body.fileName)
    const size = dataUrlByteLength(body.dataUrl)
    const metaError = checkFileMeta({ name: fileName, mimeType: body.mimeType, size })
    if (metaError) return [422, { message: metaError }]
    const kind = kindFromExtension(fileName)
    let sigError
    try { sigError = checkSignature(dataUrlToBytes(body.dataUrl, 1024), kind) } catch { sigError = 'The uploaded file data is corrupt.' }
    if (sigError) return [422, { message: sigError }]
    if (!/^[0-9a-f]{64}$/.test(body.hash || '')) return [422, { message: 'Missing file fingerprint.' }]

    const attachments = q.attachments || []
    const active = attachments.find((a) => a.status === 'Active')
    if (active && !body.replace) return [409, { message: 'This quotation already has an attached document. Use Replace to swap it.' }]
    if (active && active.hash === body.hash) return [409, { message: 'This exact file is already attached to this quotation.' }]
    if (attachments.length >= MAX_ATTACHMENT_VERSIONS) return [422, { message: `This quotation has reached the limit of ${MAX_ATTACHMENT_VERSIONS} attachment versions.` }]

    const actor = currentActor()
    const now = new Date().toISOString()
    const attachment = {
      id: rid('ATT'),
      // Link fields come from the stored quotation, never from the request body.
      quotationId: q.id, quotationNumber: q.number, companyId: q.companyId ?? null, customerId: q.customerId ?? null, contactId: q.contactId ?? null, customerName: q.customerName,
      fileName, mimeType: body.mimeType || '', kind, size, hash: body.hash, dataUrl: body.dataUrl,
      version: attachments.length + 1, status: 'Active',
      uploadedAt: now, uploadedBy: actor.id, uploadedByName: actor.name,
      sentAt: null, sentTo: null,
    }
    const history = attachments.map((a) => (a.status === 'Active' ? archive(a, { status: 'Replaced', replacedAt: now, replacedByName: actor.name }) : a))
    const updated = putQuotation(q.id, { attachments: [attachment, ...history], attachmentId: attachment.id })
    pushActivity(q, {
      type: 'Attachment', by: actor.id,
      subject: active ? `Replaced attached document "${active.fileName}" with "${fileName}"` : `Attached document "${fileName}"`,
      attachmentAction: active ? 'Replaced' : 'Attached', attachmentName: fileName, attachmentSize: size, attachmentVersion: attachment.version,
    })
    return [200, { quotation: updated, attachment }]
  }))

  // REMOVE the current attachment (kept in history)
  mock.onDelete(/^\/quotations\/[^/]+\/attachments\/[^/]+$/).reply(withSession((config) => {
    const parts = config.url.split('/')
    const id = parts[2]
    const attId = parts[4]
    const q = findQuotation(id)
    if (!q) return [404, { message: 'Quotation not found.' }]
    if (LOCKED_STATUSES.includes(q.status)) return [409, { message: lockedMessage(q) }]
    const att = (q.attachments || []).find((a) => a.id === attId)
    if (!att) return [404, { message: 'Attachment not found on this quotation.' }]
    if (att.status !== 'Active') return [409, { message: 'Only the current attachment can be removed.' }]
    const actor = currentActor()
    const now = new Date().toISOString()
    const updated = putQuotation(q.id, {
      attachments: q.attachments.map((a) => (a.id === attId ? archive(a, { status: 'Removed', removedAt: now, removedByName: actor.name }) : a)),
      attachmentId: null,
    })
    pushActivity(q, { type: 'Attachment', by: actor.id, subject: `Removed attached document "${att.fileName}"`, attachmentAction: 'Removed', attachmentName: att.fileName, attachmentSize: att.size, attachmentVersion: att.version })
    return [200, { quotation: updated }]
  }))

  // SEND to the client on the quotation
  mock.onPost(/^\/quotations\/[^/]+\/send$/).reply(withSession((config) => {
    const id = config.url.split('/')[2]
    const q = findQuotation(id)
    if (!q) return [404, { message: 'Quotation not found.' }]
    if (['Rejected', 'Expired'].includes(q.status)) return [409, { message: `A ${q.status.toLowerCase()} quotation can't be sent.` }]
    const actor = currentActor()
    if (['Draft', 'Pending Approval'].includes(q.status) && !APPROVER_ROLES.includes(actor.role)) {
      return [403, { message: 'This quotation is not approved yet. Submit it for approval — a manager can then approve and send it.' }]
    }
    // The recipient is always the client on the quotation — never taken from the request.
    const to = q.contactEmail
    if (!to || !EMAIL_RE.test(to)) return [422, { message: "This quotation's client has no valid email address on file." }]
    const body = JSON.parse(config.data)
    const subject = String(body.subject || '').trim().slice(0, 200)
    const message = String(body.message || '').trim().slice(0, 4000)
    if (!subject) return [422, { message: 'Add an email subject.' }]
    const attachment = (q.attachments || []).find((a) => a.status === 'Active') || null
    if (attachment) {
      const linked = attachment.quotationId === q.id && (attachment.companyId ?? null) === (q.companyId ?? null) && (attachment.customerId ?? null) === (q.customerId ?? null)
      if (!linked || !attachment.dataUrl) return [409, { message: 'The attached document is not linked to this quotation/client. Re-attach it before sending.' }]
    }
    const includeGenerated = !!body.includeGeneratedPdf
    if (!attachment && !includeGenerated) return [422, { message: 'Nothing to send — attach a document or include the generated quotation PDF.' }]

    const now = new Date().toISOString()
    const send = {
      id: rid('SND'), at: now, byId: actor.id, byName: actor.name, to, subject, message,
      attachmentId: attachment?.id ?? null, attachmentName: attachment?.fileName ?? null, attachmentSize: attachment?.size ?? null,
      generatedPdfIncluded: includeGenerated,
    }
    const attachments = (q.attachments || []).map((a) => (a.id === attachment?.id ? { ...a, sentAt: now, sentTo: to } : a))
    const nextStatus = ['Draft', 'Pending Approval'].includes(q.status) ? 'Sent' : q.status
    const updated = putQuotation(q.id, { attachments, sends: [send, ...(q.sends || [])], sentAt: now, status: nextStatus })
    pushActivity(q, {
      type: 'Email', by: actor.id, subject: `Quotation emailed to ${to}${attachment ? ` with "${attachment.fileName}" attached` : ''}`,
      emailTo: to, emailSubject: subject, emailStatus: 'Sent (demo mailer)', attachmentName: attachment?.fileName ?? null,
    })
    if (nextStatus !== q.status) pushActivity(q, { type: 'StatusChange', by: actor.id, subject: `Status changed from ${q.status} to ${nextStatus}`, fromStatus: q.status, toStatus: nextStatus })
    pushNotification(`Quotation ${q.number} was sent to ${q.customerName}.`, q)
    return [200, { quotation: updated, send }]
  }))
}
