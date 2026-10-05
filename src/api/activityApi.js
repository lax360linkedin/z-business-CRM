// Mock-backend endpoints for the Activities module (registered from mockServer.js after the
// generic REST handlers so the DELETE override takes precedence).
//
// What the server guarantees (not only the UI):
//   • every manual activity is attached to a real record and its full link chain (enquiry, lead,
//     deal, contact, company, customer, proposal, quotation, sales order, invoice, payment) is
//     resolved here from stored data;
//   • the user, time and status are stamped server-side, and all 19 types validate their own inputs;
//   • types that describe a fact in the CRM (Proposal Sent, Quotation Sent, Quotation Accepted/
//     Rejected, Deal Stage Changed, Status Changed, Payment Follow-up) are only accepted when that
//     fact is actually true on the record — an activity can't claim something that didn't happen;
//   • Follow-up / Task / Payment Follow-up also create a real task, Scheduled ones can be completed,
//     cancelled or rescheduled, and system-recorded events can never be edited or deleted.
import { getCollection, setCollection } from './db'
import { getActiveToken } from '../utils/sessionToken'
import { validateSession } from '../utils/sessionStore'
import { getPermissionsForRole } from '../data/permissions'
import { resolveActivityLinks } from '../utils/activityLinks'
import { activityStatus } from '../utils/calendarRules'
import { createTask, syncTaskFromActivity, removeTaskForActivity } from './taskApi'
import { RELATED_BY_TYPE, ACTIVITY_DEF, SYSTEM_EVENT_TYPES, validateActivity, toIso } from '../utils/activityRules'

const rid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`
const bad = (status, message, fields) => [status, { message, ...(fields ? { fields } : {}) }]
const ADMIN_ROLES = ['Super Admin', 'Admin', 'Sales Manager']
const CONTACT_TYPES = ['Call', 'Email', 'WhatsApp', 'SMS', 'Meeting', 'Demo / Presentation', 'Site Visit', 'Customer Interaction']

function actor() {
  const session = validateSession(getActiveToken()).session
  const account = session ? getCollection('userAccounts').find((a) => a.id === session.accountId) : null
  return { id: account?.employeeId || session?.accountId || 'unknown', name: account?.name || 'Unknown user', role: session?.role || account?.role || null }
}
const can = (a, action) => !!getPermissionsForRole(a.role)?.Activities?.[action]
const find = (col, id) => (id ? getCollection(col).find((x) => x.id === id) || null : null)

function put(col, id, patch) {
  const list = getCollection(col)
  const idx = list.findIndex((x) => x.id === id)
  if (idx === -1) return null
  const updated = { ...list[idx], ...(typeof patch === 'function' ? patch(list[idx]) : patch) }
  const next = [...list]
  next[idx] = updated
  setCollection(col, next)
  return updated
}

const balanceOf = (inv) => (inv && inv.status !== 'Cancelled' ? Math.max(0, (inv.amount || 0) - (inv.paidAmount || 0)) : 0)

/** State checks for the types that assert a fact. Returns an error message or null. */
function verify(def, input, rec, links) {
  switch (def.verify) {
    case 'proposalSent':
      return ['Sent', 'Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired'].includes(rec.status) || rec.sentAt ? null : `${rec.number} has not been sent to the client yet — use Send Proposal on the proposal first.`
    case 'quotationSent':
      return rec.sentAt || ['Sent', 'Viewed', 'Negotiation', 'Accepted', 'Rejected'].includes(rec.status) ? null : `${rec.number} has not been sent yet (status: ${rec.status}).`
    case 'quotationOutcome':
      return rec.status === input.outcome ? null : `${rec.number} is ${rec.status}, not ${input.outcome}. Update the quotation first.`
    case 'dealStage':
      return rec.stage === input.toStatus || (rec.stageHistory || []).some((h) => h.stage === input.toStatus) ? null : `${rec.name} has never been in "${input.toStatus}". Change the stage on the deal first.`
    case 'status': {
      const current = rec.status ?? rec.stage
      if (current == null) return 'This record has no status to record.'
      return String(current).toLowerCase() === String(input.toStatus).trim().toLowerCase() ? null : `This record's status is "${current}", not "${input.toStatus}".`
    }
    case 'paymentDue': {
      const invoices = getCollection('invoices')
      let due = 0
      if (input.relatedType === 'Invoice') due = balanceOf(rec)
      else if (input.relatedType === 'Payment') due = balanceOf(find('invoices', rec.invoiceId))
      else if (input.relatedType === 'Sales Order') due = balanceOf(find('invoices', rec.invoiceId))
      else due = invoices.filter((i) => i.customerId === rec.id).reduce((s, i) => s + balanceOf(i), 0)
      return due > 0 ? null : 'Nothing is outstanding on this record — a payment follow-up isn’t needed.'
    }
    default:
      return null
  }
}

/**
 * Every other module writes its own timeline entries (deal calls, proposal sends, order events…).
 * Those arrive without link chains, so reads complete them once — resolving links from the stored
 * records and tagging the source — and persist the result. After that every activity, whoever wrote
 * it, can be filtered and shown by company, customer, deal, quotation and so on.
 */
function enrichedActivities() {
  const list = getCollection('activities')
  if (!list.some((a) => !a.links)) return list
  const next = list.map((a) => (a.links ? a : {
    ...a,
    source: a.source || (SYSTEM_EVENT_TYPES.includes(a.type) ? 'system' : 'manual'),
    links: resolveActivityLinks(find, a.relatedType, a.relatedId),
    assignedTo: a.assignedTo || a.by || null,
    status: a.status || 'Completed',
  }))
  setCollection('activities', next)
  return next
}

export function registerActivityEndpoints(mock, withSession) {
  const body = (c) => (c.data ? JSON.parse(c.data) : {})
  const idOf = (c) => c.url.split('/')[2]
  const mutable = (a, act) => (act.source !== 'manual' ? bad(409, 'System-recorded events are part of the audit trail and cannot be changed.') : (act.by !== a.id && !ADMIN_ROLES.includes(a.role) ? bad(403, 'Only the person who logged this activity (or a manager) can change it.') : null))

  mock.onGet('/activities').reply(withSession((config) => {
    const list = enrichedActivities()
    const all = config.params?.all === true || config.params?.all === 'true'
    if (all) return [200, list]
    const page = Number(config.params?.page) || 1
    const pageSize = Number(config.params?.pageSize) || 10
    return [200, { data: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize }]
  }))
  mock.onGet(/^\/activities\/[^/]+$/).reply(withSession((config) => {
    const item = enrichedActivities().find((x) => x.id === config.url.split('/')[2])
    return item ? [200, item] : [404, { message: 'Not found' }]
  }))

  mock.onPost('/activities/log').reply(withSession((config) => {
    const a = actor()
    if (!can(a, 'create')) return bad(403, 'You do not have permission to log activities.')
    const input = body(config)
    const errors = validateActivity(input)
    if (Object.keys(errors).length) return bad(422, Object.values(errors)[0], errors)
    const def = ACTIVITY_DEF[input.type]
    const rel = RELATED_BY_TYPE[input.relatedType]
    const rec = rel && find(rel.collection, input.relatedId)
    if (!rec) return bad(404, `That ${input.relatedType.toLowerCase()} no longer exists.`, { relatedId: 'Record not found.' })
    const links = resolveActivityLinks(find, input.relatedType, input.relatedId)
    const truth = verify(def, input, rec, links)
    if (truth) return bad(409, truth)

    const now = Date.now()
    const iso = toIso(input.date, input.time) || new Date(now).toISOString()
    const future = new Date(iso).getTime() > now + 60000
    let status = 'Completed'
    if (def.schedulable) status = future ? 'Scheduled' : (input.status === 'Scheduled' ? 'Scheduled' : 'Completed')
    const relatedName = rel.label(rec)
    const subject = String(input.subject || '').trim() || `${input.type === 'Other / Custom Activity' ? input.customType : input.type} — ${relatedName}`
    const dup = getCollection('activities').find((x) => x.source === 'manual' && x.by === a.id && x.type === input.type && x.relatedId === input.relatedId && x.subject === subject && now - new Date(x.loggedAt || 0).getTime() < 15000)
    if (dup) return bad(409, 'This activity was just logged.')

    const contact = links.contactId ? find('contacts', links.contactId) : null
    const entry = {
      id: input.type === 'Meeting' ? rid('MTG') : rid('ACT'),
      type: input.type, subject, notes: String(input.description || '').trim(), description: String(input.description || '').trim(),
      date: iso, status, priority: ['Low', 'Medium', 'High'].includes(input.priority) ? input.priority : 'Medium',
      by: a.id, assignedTo: input.assignedTo || a.id, source: 'manual', loggedAt: new Date(now).toISOString(),
      relatedType: input.relatedType, relatedId: input.relatedId, relatedName, links,
    }
    if (status === 'Completed') { entry.completedAt = new Date(now).toISOString(); entry.completedBy = a.id }
    if (input.type === 'Call') Object.assign(entry, { callOutcome: input.outcome, callType: input.callType || 'Outgoing', duration: input.duration || null })
    if (input.type === 'Email') Object.assign(entry, { emailSubject: input.subject, emailTo: contact?.email || null, emailStatus: 'Logged' })
    if (['WhatsApp', 'SMS'].includes(input.type)) Object.assign(entry, { waTo: contact?.phone || null, waStatus: 'Logged', channel: input.type })
    if (['Meeting', 'Demo / Presentation', 'Site Visit'].includes(input.type)) {
      const joinable = input.type === 'Meeting' && ['Lead', 'Enquiry', 'Contact', 'Deal', 'Proposal'].includes(input.relatedType) && input.meetingType === 'Online Meeting'
      Object.assign(entry, { title: subject, meetingDate: input.date, meetingStartTime: input.time || null, meetingEndTime: input.endTime || null, meetingType: input.meetingType || input.type, meetingStatus: status === 'Scheduled' ? 'Scheduled' : 'Completed', meetingLink: joinable ? `/meetings/${entry.id}` : null, location: input.location || null })
    }
    if (input.type === 'Follow-up' || input.type === 'Payment Follow-up') Object.assign(entry, { followUpType: input.followUpType || 'Call', followUpDate: input.date })
    if (input.type === 'Task') entry.dueDate = input.date
    if (input.type === 'Payment Follow-up') entry.dueDate = input.date
    if (input.reminderMinutes !== undefined && input.reminderMinutes !== '' && [0, 5, 15, 30, 60, 1440].includes(Number(input.reminderMinutes))) entry.reminderMinutes = Number(input.reminderMinutes)
    if (input.type === 'Quotation Accepted / Rejected') entry.outcome = input.outcome
    if (input.type === 'Deal Stage Changed' || input.type === 'Status Changed') Object.assign(entry, { toStatus: input.toStatus, fromStatus: input.fromStatus || null })
    if (input.type === 'Document Uploaded') Object.assign(entry, { attachmentName: input.documentName, attachmentAction: 'Received / shared' })
    if (input.type === 'Customer Interaction') entry.channel = input.channel
    if (input.type === 'Other / Custom Activity') entry.customType = input.customType

    if (def.task) {
      // the real task: numbered, linked to the whole record chain, on the Calendar, reminded and audited like any other
      const followType = { Call: 'Call', Email: 'Email', WhatsApp: 'WhatsApp', Meeting: 'Meeting' }[input.followUpType] || 'Follow-up'
      const made = createTask({ ...a, system: true }, {
        title: subject, relatedType: input.relatedType, relatedId: input.relatedId, assignees: [entry.assignedTo], priority: entry.priority, dueDate: input.date, dueTime: input.time || null,
        taskType: input.type === 'Payment Follow-up' ? 'Payment Follow-up' : input.type === 'Follow-up' ? followType : 'General', description: entry.description, visibility: 'Team',
      }, { activityId: entry.id, source: 'activity', allowDuplicate: true, message: `Created from the logged ${input.type} activity` })
      if (made[0] === 201) entry.taskId = made[1].id
    }
    setCollection('activities', [entry, ...getCollection('activities')])

    // keep the record's own bookkeeping in step
    const patch = {}
    if (CONTACT_TYPES.includes(input.type) && status === 'Completed' && 'lastContactedDate' in rec) patch.lastContactedDate = entry.date
    if ((input.type === 'Follow-up' || input.type === 'Payment Follow-up') && 'nextFollowUp' in rec) patch.nextFollowUp = input.date
    if (Object.keys(patch).length) put(rel.collection, rec.id, patch)
    if (entry.assignedTo !== a.id) {
      setCollection('notifications', [{ id: rid('NTF'), type: 'Activity Assigned', message: `${a.name} assigned you: ${subject}`, relatedType: input.relatedType, relatedId: input.relatedId, date: new Date().toISOString(), read: false }, ...getCollection('notifications')])
    }
    return [201, entry]
  }))

  const closeTask = (act, status, extra = {}) => syncTaskFromActivity(act.taskId, actor(), { status, ...extra })

  mock.onPost(/^\/activities\/[^/]+\/complete$/).reply(withSession((config) => {
    const a = actor()
    const act = find('activities', idOf(config))
    if (!act) return bad(404, 'Activity not found.')
    if (!can(a, 'edit')) return bad(403, 'You do not have permission to update activities.')
    if (act.source !== 'manual') return bad(409, 'Only logged activities can be completed here.')
    if (activityStatus(act) !== 'Scheduled') return bad(409, `This activity is already ${String(activityStatus(act)).toLowerCase()}.`)
    const req = body(config)
    const updated = put('activities', act.id, { status: 'Completed', completedAt: new Date().toISOString(), completedBy: a.id, outcomeNotes: String(req.notes || '').trim().slice(0, 1000) || undefined, ...(act.meetingStatus ? { meetingStatus: 'Completed' } : {}) })
    closeTask(act, 'Completed', { notes: String(req.notes || '').trim() })
    return [200, updated]
  }))

  mock.onPost(/^\/activities\/[^/]+\/cancel$/).reply(withSession((config) => {
    const a = actor()
    const act = find('activities', idOf(config))
    if (!act) return bad(404, 'Activity not found.')
    const denied = mutable(a, act); if (denied) return denied
    if (activityStatus(act) !== 'Scheduled') return bad(409, `Only a scheduled activity can be cancelled (this one is ${String(activityStatus(act)).toLowerCase()}).`)
    const reason = String(body(config).reason || '').trim()
    if (!reason) return bad(422, 'Give a reason for cancelling.')
    const updated = put('activities', act.id, { status: 'Cancelled', cancelledAt: new Date().toISOString(), cancelledBy: a.id, cancelReason: reason.slice(0, 500), ...(act.meetingStatus ? { meetingStatus: 'Cancelled' } : {}) })
    closeTask(act, 'Cancelled', { reason })
    return [200, updated]
  }))

  mock.onPost(/^\/activities\/[^/]+\/reschedule$/).reply(withSession((config) => {
    const a = actor()
    const act = find('activities', idOf(config))
    if (!act) return bad(404, 'Activity not found.')
    const denied = mutable(a, act); if (denied) return denied
    if (activityStatus(act) !== 'Scheduled') return bad(409, 'Only a scheduled activity can be rescheduled.')
    const { date, time, endTime } = body(config)
    const iso = toIso(date, time)
    if (!iso || new Date(iso).getTime() < Date.now() - 60000) return bad(422, 'Choose a date and time in the future.')
    const mins = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null }
    const dur = mins(act.meetingEndTime) !== null && mins(act.meetingStartTime) !== null ? mins(act.meetingEndTime) - mins(act.meetingStartTime) : null
    const newStart = time || act.meetingStartTime
    const newEnd = endTime || (dur > 0 && mins(newStart) !== null ? `${String(Math.floor((mins(newStart) + dur) / 60) % 24).padStart(2, '0')}:${String((mins(newStart) + dur) % 60).padStart(2, '0')}` : null)
    const updated = put('activities', act.id, {
      date: iso, status: 'Scheduled', reminderSentAt: null, rescheduledCount: (act.rescheduledCount || 0) + 1, rescheduledFrom: [...(act.rescheduledFrom || []), { date: act.meetingDate || String(act.date).slice(0, 10), time: act.meetingStartTime || null, at: new Date().toISOString(), by: a.id }],
      ...(act.meetingDate ? { meetingDate: date, meetingStartTime: newStart, meetingEndTime: newEnd, meetingStatus: 'Scheduled' } : {}), ...(act.dueDate ? { dueDate: date } : {}), ...(act.followUpDate ? { followUpDate: date, followUpTime: time || act.followUpTime || null } : {}),
    })
    syncTaskFromActivity(act.taskId, a, { dueDate: date })
    return [200, updated]
  }))

  mock.onPost(/^\/activities\/[^/]+\/edit$/).reply(withSession((config) => {
    const a = actor()
    const act = find('activities', idOf(config))
    if (!act) return bad(404, 'Activity not found.')
    const denied = mutable(a, act); if (denied) return denied
    const req = body(config)
    const patch = {}
    if (req.subject !== undefined) { if (!String(req.subject).trim()) return bad(422, 'Title can’t be empty.'); patch.subject = String(req.subject).trim().slice(0, 160) }
    if (req.description !== undefined) { patch.description = String(req.description).trim().slice(0, 2000); patch.notes = patch.description }
    if (['Low', 'Medium', 'High'].includes(req.priority)) patch.priority = req.priority
    if (req.assignedTo) patch.assignedTo = req.assignedTo
    const updated = put('activities', act.id, { ...patch, editedAt: new Date().toISOString(), editedBy: a.id })
    syncTaskFromActivity(act.taskId, a, { title: patch.subject, priority: patch.priority, assignedTo: patch.assignedTo })
    return [200, updated]
  }))

  mock.onDelete(/^\/activities\/[^/]+$/).reply(withSession((config) => {
    const a = actor()
    const act = find('activities', idOf(config))
    if (!act) return bad(404, 'Activity not found.')
    if (!can(a, 'delete') && act.by !== a.id) return bad(403, 'You do not have permission to delete activities.')
    const denied = mutable(a, act); if (denied) return denied
    setCollection('activities', getCollection('activities').filter((x) => x.id !== act.id))
    removeTaskForActivity(act.taskId)
    return [200, { success: true }]
  }))
}
