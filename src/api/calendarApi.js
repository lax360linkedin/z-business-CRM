// Calendar endpoints for the mock backend.
//
// The calendar stores nothing. GET /calendar/events assembles — on the server, for the signed-in user only —
// every dated thing the CRM knows about, straight from the records that own it:
//   • tasks the user may see (task permissions + visibility apply exactly as on the Tasks page),
//   • scheduled / held meetings, demos, site visits and follow-up activities,
//   • each lead / enquiry / deal / contact's next follow-up (within the user's data scope),
//   • reminders that are still to fire (task reminders, meeting reminders),
//   • business due dates: invoices, quotation & proposal validity, delivery dates, contract end, project deadlines
//     (only for modules the role can open).
// Duplicates are collapsed: a follow-up that already has a task (or an activity that spawned one) appears once.
import { getCollection, setCollection } from './db'
import { getPermissionsForRole } from '../data/permissions'
import { getDataScope, matchesDataScope } from '../data/dataScope'
import { currentActor, visibleTasksFor } from './taskApi'
import { TASK_RELATED_BY_TYPE, TASK_RELATED_BY_KEY, TASK_LINK_ORDER } from '../utils/taskLinks'
import { resolveActivityLinks } from '../utils/activityLinks'
import { isOpenTask } from '../utils/taskRules'
import { activityKind, activityStatus, activityWhen, activityReminderMinutes, startOf, localDate, localTime, parseLocalDate } from '../utils/calendarRules'

const bad = (status, message) => [status, { message }]
const ADMIN_ROLES = ['Super Admin', 'Admin', 'Sales Manager']
const MODULE_OF = { Lead: 'Leads', Enquiry: 'Enquiries', Deal: 'Deals', Contact: 'Contacts' }
const COLLECTION_OF = { Lead: 'leads', Enquiry: 'enquiries', Deal: 'deals', Contact: 'contacts' }
const OWNER_FIELD = { Lead: 'assignedTo', Enquiry: 'assignedUser', Deal: 'salesperson', Contact: 'assignedTo' }
const CLOSED = {
  Lead: (r) => ['Converted', 'Lost', 'Unqualified'].includes(r.status),
  Enquiry: (r) => ['Converted', 'Duplicate', 'Spam', 'Not Interested', 'Closed', 'Unqualified'].includes(r.status),
  Deal: (r) => String(r.stage || '').startsWith('Closed'),
  Contact: () => false,
}
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null)
const canView = (role, moduleLabel) => !!getPermissionsForRole(role)?.[moduleLabel]?.view
const DEFS = { ...TASK_RELATED_BY_TYPE, Contract: { type: 'Contract', route: () => '/contracts', label: (r) => r.title || r.name || r.id } }

function buildFinder() {
  const cache = {}
  const find = (col, id) => { if (!id) return null; if (!cache[col]) cache[col] = new Map(getCollection(col).map((r) => [r.id, r])); return cache[col].get(id) || null }
  return find
}
function relatedChain(find, links) {
  return TASK_LINK_ORDER.filter((k) => links?.[k]).map((k) => {
    const d = TASK_RELATED_BY_KEY[k]
    const rec = find(d.collection, links[k])
    return rec ? { type: d.type, id: links[k], label: d.label(rec), route: d.route(links[k]) } : null
  }).filter(Boolean)
}

export function buildCalendarEvents(a, { from, to } = {}) {
  const find = buildFinder()
  const users = getCollection('users')
  const role = a.role
  const events = []
  const covered = new Set() // `${recordId}|${date}` already represented by a task or an activity
  const taskCovered = new Set() // …by an open task specifically (older follow-up log lines duplicate it)
  const inRange = (date) => (!from || date >= from) && (!to || date <= to)
  const push = (ev) => { if (ev.date && inRange(ev.date)) events.push(ev) }
  const todayKey = localDate(new Date())
  const nowMs = Date.now()

  // ---- tasks ---------------------------------------------------------------------------------------------
  const tasks = canView(role, 'Tasks') ? visibleTasksFor(a) : []
  tasks.forEach((t) => {
    if (t.relatedId && t.dueDate && isOpenTask(t)) { covered.add(`${t.relatedId}|${t.dueDate}`); taskCovered.add(`${t.relatedId}|${t.dueDate}`) }
    if (t.links?.leadId && t.dueDate && isOpenTask(t)) covered.add(`${t.links.leadId}|${t.dueDate}`)
    if (t.dueDate) {
      const state = t.status === 'Completed' ? 'done' : t.status === 'Cancelled' ? 'cancelled' : t.overdue ? 'overdue' : 'open'
      push({
        id: `task:${t.id}`, kind: 'task', type: t.taskType, title: t.title, date: t.dueDate, time: t.dueTime || null, endTime: null, state, status: t.status, priority: t.priority,
        assignees: t.assignees || [], createdBy: t.createdBy, relatedType: t.relatedType, relatedId: t.relatedId, relatedName: t.relatedName, related: relatedChain(find, t.links),
        href: `/tasks/${t.id}`, hrefLabel: 'Open task', source: { type: 'task', id: t.id, status: t.status },
        can: { reschedule: !!t._can?.changeDueDate, complete: !!t._can?.complete, cancel: !!t._can?.cancel }, description: t.description || '', recurring: t.recurrence?.frequency !== 'none',
      })
    }
    if (t.reminderAt && !t.remindedAt && isOpenTask(t)) {
      const r = new Date(t.reminderAt)
      push({ id: `reminder:task:${t.id}`, kind: 'reminder', type: 'Reminder', title: `Reminder: ${t.title}`, date: localDate(r), time: localTime(r), state: r.getTime() < nowMs ? 'overdue' : 'open', status: 'Reminder due', priority: t.priority, assignees: t.assignees || [], relatedType: t.relatedType, relatedId: t.relatedId, relatedName: t.relatedName, related: relatedChain(find, t.links), href: `/tasks/${t.id}`, hrefLabel: 'Open task', source: { type: 'task', id: t.id }, can: {}, description: `Due ${t.dueDate || ''} ${t.dueTime || ''}`.trim() })
    }
  })

  // ---- activities: meetings, demos, visits, scheduled follow-ups ---------------------------------------------------
  {
    const seeAll = canView(role, 'Activities')
    getCollection('activities').forEach((act) => {
      const kind = activityKind(act)
      if (!kind || act.mirrorOf) return
      if (kind === 'followup' && taskCovered.has(`${act.relatedId}|${(activityWhen(act) || {}).date}`)) return
      if (!seeAll && act.by !== a.id && (act.assignedTo || act.by) !== a.id) return
      const when = activityWhen(act)
      if (!when) return
      const status = activityStatus(act)
      const startMs = startOf(when)?.getTime()
      const open = status === 'Scheduled'
      const state = open ? (startMs && startMs < nowMs ? 'overdue' : 'open') : status === 'Cancelled' ? 'cancelled' : status === 'No Show' ? 'cancelled' : 'done'
      if (act.relatedId && open) covered.add(`${act.relatedId}|${when.date}`)
      const links = act.links || resolveActivityLinks(find, act.relatedType, act.relatedId)
      const assignee = act.assignedTo || act.by
      const mine = act.by === a.id || assignee === a.id
      const manual = (act.source || 'manual') === 'manual'
      const mayChange = manual && open && (mine || ADMIN_ROLES.includes(role)) && !!getPermissionsForRole(role)?.Activities?.edit
      const rel = TASK_RELATED_BY_TYPE[act.relatedType]
      push({
        id: `activity:${act.id}`, kind, type: act.type === 'Meeting' && act.meetingType ? act.meetingType : act.type, title: act.title || act.subject || act.type, date: when.date, time: when.time, endTime: when.endTime, state, status,
        priority: act.priority || null, assignees: assignee ? [assignee] : [], createdBy: act.by, relatedType: act.relatedType, relatedId: act.relatedId, relatedName: act.relatedName, related: relatedChain(find, links),
        href: rel && act.relatedId ? rel.route(act.relatedId) : null, hrefLabel: rel ? `Open ${rel.type.toLowerCase()}` : null, meetingLink: act.meetingLink || null, location: act.location || null,
        source: { type: 'activity', id: act.id, status }, can: { reschedule: mayChange, complete: mayChange, cancel: mayChange }, description: act.description || act.notes || '', unlinked: !act.relatedId,
      })
      // reminder that is still to fire for this scheduled item
      const mins = open ? activityReminderMinutes(act) : null
      if (mins !== null && !act.reminderSentAt && startMs) {
        const at = new Date(startMs - mins * 60000)
        if (at.getTime() > nowMs - 86400000) push({ id: `reminder:activity:${act.id}`, kind: 'reminder', type: 'Reminder', title: `Reminder: ${act.title || act.subject}`, date: localDate(at), time: localTime(at), state: at.getTime() < nowMs ? 'overdue' : 'open', status: 'Reminder due', assignees: assignee ? [assignee] : [], relatedType: act.relatedType, relatedId: act.relatedId, relatedName: act.relatedName, related: [], href: rel && act.relatedId ? rel.route(act.relatedId) : null, hrefLabel: rel ? `Open ${rel.type.toLowerCase()}` : null, source: { type: 'activity', id: act.id }, can: {}, description: `${mins ? `${mins} min before` : 'At'} ${when.date} ${when.time || ''}`.trim() })
      }
    })
  }

  // meetings/follow-ups copied onto a deal by older code (no mirrorOf marker) are the same entry: keep the original on its own record
  {
    const sig = (e) => `${e.kind}|${e.title}|${e.date}|${e.time || ''}|${(e.assignees || [])[0] || ''}|${e.meetingLink || ''}`
    const groups = new Map()
    events.filter((e) => e.source.type === 'activity' && (e.kind === 'meeting' || e.kind === 'followup')).forEach((e) => { const k = sig(e); groups.set(k, [...(groups.get(k) || []), e]) })
    const drop = new Set()
    groups.forEach((list) => {
      if (list.length < 2) return
      const keep = list.find((e) => String(e.source.id).startsWith('MTG-')) || list.find((e) => e.relatedType !== 'Deal') || list[0]
      list.filter((e) => e !== keep).forEach((e) => { drop.add(e.id); drop.add(`reminder:${e.id}`) })
    })
    for (let i = events.length - 1; i >= 0; i -= 1) if (drop.has(events[i].id)) events.splice(i, 1)
  }

  // ---- each record's own "next follow-up" -----------------------------------------------------------------------------
  Object.keys(COLLECTION_OF).forEach((type) => {
    if (!canView(role, MODULE_OF[type])) return
    const scope = getDataScope(role, MODULE_OF[type])
    const route = TASK_RELATED_BY_TYPE[type]
    getCollection(COLLECTION_OF[type]).forEach((rec) => {
      const date = dateOnly(rec.nextFollowUp)
      if (!date || CLOSED[type](rec)) return
      if (covered.has(`${rec.id}|${date}`)) return
      if (!matchesDataScope(rec, scope, a, OWNER_FIELD[type], users)) return
      const owner = rec[OWNER_FIELD[type]]
      const links = resolveActivityLinks(find, type, rec.id)
      const mayChange = !!getPermissionsForRole(role)?.[MODULE_OF[type]]?.edit
      const state = date < todayKey ? 'overdue' : 'open'
      push({
        id: `followup:${type}:${rec.id}`, kind: 'followup', type: 'Follow-up', title: `Follow up: ${route.label(rec)}`, date, time: null, endTime: null, state, status: 'Scheduled', priority: rec.priority || null,
        assignees: owner ? [owner] : [], relatedType: type, relatedId: rec.id, relatedName: route.label(rec), related: relatedChain(find, links), href: route.route(rec.id), hrefLabel: `Open ${type.toLowerCase()}`,
        source: { type: 'record', recordType: type, id: rec.id }, can: { reschedule: mayChange && (owner === a.id || scope !== 'Own' || ADMIN_ROLES.includes(role)) }, description: `Next follow-up date on the ${type.toLowerCase()}.`,
      })
    })
  })

  // ---- business dates (read-only) -------------------------------------------------------------------------------------
  const deadline = (module, collection, type, dateField, skip, title, ownerField) => {
    if (!canView(role, module)) return
    const scope = ownerField ? getDataScope(role, module) : 'Organization'
    const def = DEFS[type]
    getCollection(collection).forEach((r) => {
      const date = dateOnly(r[dateField])
      if (!date || skip(r)) return
      if (ownerField && !matchesDataScope(r, scope, a, ownerField, users)) return
      push({
        id: `deadline:${type}:${r.id}`, kind: 'deadline', type: title, title: `${title}: ${def.label(r)}`, date, time: null, endTime: null, state: date < todayKey ? 'overdue' : 'open', status: title, priority: null,
        assignees: ownerField && r[ownerField] ? [r[ownerField]] : [], relatedType: type, relatedId: r.id, relatedName: def.label(r), related: relatedChain(find, resolveActivityLinks(find, type, r.id)),
        href: def.route(r.id), hrefLabel: `Open ${type.toLowerCase()}`, source: { type: 'deadline', recordType: type, id: r.id }, can: {}, description: `${title} date on the ${type.toLowerCase()} record.`,
      })
    })
  }
  deadline('Invoices', 'invoices', 'Invoice', 'dueDate', (i) => ['Paid', 'Cancelled', 'Draft'].includes(i.status) || (i.amount || 0) - (i.paidAmount || 0) <= 0, 'Invoice due')
  deadline('Quotations', 'quotations', 'Quotation', 'validUntil', (q) => ['Accepted', 'Rejected', 'Expired', 'Cancelled'].includes(q.status), 'Quotation valid until', 'assignedTo')
  deadline('Proposals', 'proposals', 'Proposal', 'validUntil', (p) => ['Accepted', 'Rejected', 'Expired', 'Draft'].includes(p.status), 'Proposal valid until', 'assignedTo')
  deadline('Sales Orders', 'salesOrders', 'Sales Order', 'expectedDeliveryDate', (s) => ['Fulfilled', 'Cancelled', 'Delivered', 'Invoiced'].includes(s.status), 'Delivery due', 'salesperson')
  deadline('Contracts', 'contracts', 'Contract', 'endDate', (c) => !['Active', 'Expiring Soon'].includes(c.status), 'Contract ends')
  deadline('Projects', 'projects', 'Project', 'deadline', (p) => p.status === 'Completed', 'Project deadline', 'manager')

  const stamp = (e) => `${e.date}T${e.time || '00:00'}`
  events.sort((x, y) => stamp(x).localeCompare(stamp(y)))
  return events
}

export function registerCalendarEndpoints(mock, withSession) {
  mock.onGet('/calendar/events').reply(withSession((config) => {
    const a = currentActor()
    if (!canView(a.role, 'Calendar')) return bad(403, 'You do not have access to the calendar.')
    const { from, to } = config.params || {}
    const events = buildCalendarEvents(a, { from, to })
    return [200, { events, me: a.id, generatedAt: new Date().toISOString() }]
  }))

  // moving a record's own next-follow-up date (drag on the calendar) — same rules as editing that record
  mock.onPost('/calendar/followup/reschedule').reply(withSession((config) => {
    const a = currentActor()
    const { recordType, id, date } = JSON.parse(config.data || '{}')
    const col = COLLECTION_OF[recordType]
    if (!col) return bad(422, 'That record type has no follow-up date.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return bad(422, 'Choose a valid date.')
    const perms = getPermissionsForRole(a.role)?.[MODULE_OF[recordType]]
    if (!perms?.edit) return bad(403, `You do not have permission to edit ${MODULE_OF[recordType].toLowerCase()}.`)
    const list = getCollection(col)
    const idx = list.findIndex((r) => r.id === id)
    if (idx === -1) return bad(404, 'Record not found.')
    const rec = list[idx]
    if (!matchesDataScope(rec, getDataScope(a.role, MODULE_OF[recordType]), a, OWNER_FIELD[recordType], getCollection('users'))) return bad(403, 'This record is outside your data scope.')
    const next = [...list]
    next[idx] = { ...rec, nextFollowUp: date }
    setCollection(col, next)
    return [200, { id, nextFollowUp: date }]
  }))
}
