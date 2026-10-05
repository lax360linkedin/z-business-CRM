// Mock-backend endpoints for the Task module (registered from mockServer.js AFTER the generic REST
// handlers, so every /tasks route below replaces the unauthenticated generic one).
//
// What the server guarantees — the UI is only a courtesy:
//   • every read and write is authorised here: 13 role permissions + 5 visibility levels
//     (taskRules.js). A task you may not see answers 403 whatever id/URL/request you send, and list
//     endpoints only ever return the tasks you may see;
//   • creator, time and every before/after value are stamped server-side into an append-only audit
//     trail (taskEvents); nothing exposes an endpoint that edits or deletes an event;
//   • tasks link to the real record chain (enquiry → … → payment, contact, company, product,
//     campaign, project) resolved from stored data, never typed in;
//   • completing a task completes/creates its Activity, so the CRM timelines show what happened;
//     reopening withdraws it; recurring tasks spawn their next occurrence exactly once;
//   • automation and recurrence carry dedupe keys, so no rule can create the same task twice.
import { getCollection, setCollection } from './db'
import { getActiveToken } from '../utils/sessionToken'
import { validateSession } from '../utils/sessionStore'
import { getPermissionsForRole } from '../data/permissions'
import {
  TASK_TRANSITIONS, TASK_OPEN, TASK_PRIORITIES, TASK_STATUS_LIST, MANAGER_ROLES, DEFAULT_AUTOMATION, DEFAULT_TASK_PERMISSIONS, TASK_PERMISSION_KEYS,
  TASK_FILE_RULES, taskPermissionsFor, canViewTask, canActOnTask, validateTaskInput, isOpenTask, isOverdueTask, overdueLevel, overdueLabel,
  reminderAtFor, nextOccurrenceDate, nextTaskId, checkTaskFile, todayStr, normalizeStatus,
} from '../utils/taskRules'
import { resolveTaskLinks, TASK_RELATED_BY_TYPE, TASK_RELATED_BY_KEY, ownerOfRecord } from '../utils/taskLinks'
import { normalizeTask } from './taskMigration'
import { dataUrlByteLength } from '../utils/quotationAttachmentRules'
import { activityKind, activityStatus, activityWhen, activityReminderMinutes, startOf, MEETING_TYPES_CAL } from '../utils/calendarRules'

const rid = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`
const bad = (status, message, fields) => [status, { message, ...(fields ? { fields } : {}) }]
export const SYSTEM_ACTOR = { id: 'SYSTEM', name: 'Automation', role: null, system: true }
const CONTACT_TASK_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Follow-up', 'Demo']
const RESERVED = ['summary', 'assignees', 'me', 'suggestions', 'filters', 'settings', 'suggest-owner', 'engine']

// --- environment ---------------------------------------------------------------------------------------
const find = (col, id) => (id ? getCollection(col).find((x) => x.id === id) || null : null)
const users = () => getCollection('users')
const userById = (id) => users().find((u) => u.id === id) || null
const nameOf = (id) => (id === 'SYSTEM' ? 'Automation' : userById(id)?.name || id || '—')

export function getTaskSettings() {
  const s = getCollection('taskSettings')[0] || {}
  const automation = {}
  Object.keys(DEFAULT_AUTOMATION).forEach((k) => { automation[k] = { ...DEFAULT_AUTOMATION[k], ...(s.automation?.[k] || {}) } })
  return {
    id: 'default', permissions: s.permissions || {}, automation,
    uploadRules: { ...TASK_FILE_RULES, ...(s.uploadRules || {}) },
    managerNotifyOverdueDays: s.managerNotifyOverdueDays ?? 3, notifyManagerOnReminder: !!s.notifyManagerOnReminder, updatedAt: s.updatedAt || null, updatedBy: s.updatedBy || null,
  }
}

export function currentActor() {
  const session = validateSession(getActiveToken()).session
  const account = session ? getCollection('userAccounts').find((x) => x.id === session.accountId) : null
  const id = account?.employeeId || session?.accountId || 'unknown'
  const user = userById(id)
  return { id, name: user?.name || account?.name || 'Unknown user', role: session?.role || account?.role || user?.role || null, department: user?.department || null }
}
function permsOf(a) {
  if (a.system) return Object.fromEntries(TASK_PERMISSION_KEYS.map((k) => [k.key, true]))
  const moduleView = getPermissionsForRole(a.role)?.Tasks?.view !== false
  const p = taskPermissionsFor(a.role, getTaskSettings())
  return moduleView ? p : Object.fromEntries(Object.keys(p).map((k) => [k, false]))
}
const dirOf = (id) => userById(id)

function dataCtx() {
  const cache = {}
  const find2 = (col, id) => { if (!id) return null; if (!cache[col]) cache[col] = new Map(getCollection(col).map((r) => [r.id, r])); return cache[col].get(id) || null }
  return { find: find2, list: (c) => getCollection(c), userOf: dirOf }
}

// --- storage -------------------------------------------------------------------------------------------
/** Every task, completed to the current model (tasks written by other modules arrive without the new fields). */
function allTasks() {
  const list = getCollection('tasks')
  if (list.every((t) => t.taskV2)) return list
  const ctx = dataCtx()
  const next = list.map((t) => normalizeTask(t, ctx))
  const events = getCollection('taskEvents')
  const fresh = next.filter((t, i) => !list[i].taskV2 && !events.some((e) => e.taskId === t.id))
  if (fresh.length) setCollection('taskEvents', [...fresh.map((t) => ({ id: rid('TEV'), taskId: t.id, type: 'Created', by: t.createdBy, at: t.createdAt, message: 'Task created' })), ...events])
  setCollection('tasks', next)
  return next
}
const taskById = (id) => allTasks().find((t) => t.id === id) || null
function saveTask(id, patch) {
  const list = allTasks()
  const idx = list.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const updated = { ...list[idx], ...(typeof patch === 'function' ? patch(list[idx]) : patch), updatedAt: new Date().toISOString() }
  const next = [...list]
  next[idx] = updated
  setCollection('tasks', next)
  return updated
}
function putRecord(col, id, patch) {
  const list = getCollection(col)
  const idx = list.findIndex((x) => x.id === id)
  if (idx === -1) return null
  const next = [...list]
  next[idx] = { ...list[idx], ...patch }
  setCollection(col, next)
  return next[idx]
}

function logEvent(taskId, a, type, message, extra = {}) {
  const e = { id: rid('TEV'), taskId, type, by: a.id, byName: a.name, at: new Date().toISOString(), message, ...extra }
  setCollection('taskEvents', [e, ...getCollection('taskEvents')])
  return e
}

function notify(recipients, task, type, message, actorId) {
  const ids = [...new Set(recipients)].filter((id) => id && id !== 'SYSTEM' && id !== actorId && userById(id))
  if (!ids.length) return
  const now = new Date().toISOString()
  setCollection('notifications', [...ids.map((userId) => ({ id: rid('NTF'), type, message, userId, taskId: task.id, relatedType: 'Task', relatedId: task.id, date: now, read: false })), ...getCollection('notifications')])
}
/** Managers responsible for the assignees: same department, may view team tasks and reassign. */
function managersOf(task) {
  const depts = new Set((task.assignees || []).map((id) => dirOf(id)?.department).filter(Boolean))
  return users().filter((u) => u.status !== 'Inactive' && !(task.assignees || []).includes(u.id) && MANAGER_ROLES.includes(u.role) && depts.has(u.department) && taskPermissionsFor(u.role, getTaskSettings()).viewTeam && taskPermissionsFor(u.role, getTaskSettings()).reassign).map((u) => u.id)
}

// --- authorisation ---------------------------------------------------------------------------------------
const noAccess = () => bad(403, 'You do not have access to this task.')
/** Per-task capabilities for the current user, sent with every task so the UI never guesses. */
function capsFor(a, perms, t) {
  const acts = canActOnTask(a, perms, t, dirOf)
  const claim = perms.edit && !(t.assignees || []).length && canViewTask(a, perms, t, dirOf)
  const open = isOpenTask(t)
  return {
    edit: acts && perms.edit && open, complete: acts && perms.complete && open, reopen: acts && perms.reopen && !open,
    cancel: acts && perms.edit && open, status: acts && perms.edit && open,
    assign: acts && perms.assign && open, reassign: acts && perms.reassign && open, claim: claim && open,
    delete: acts && perms.delete, changePriority: acts && perms.changePriority && open, changeDueDate: acts && perms.changeDueDate && open,
    comment: canViewTask(a, perms, t, dirOf), attach: acts && (perms.edit || perms.create), duplicate: acts && perms.create,
  }
}
function guard(a, t, need) {
  const perms = permsOf(a)
  if (!canViewTask(a, perms, t, dirOf)) return { error: noAccess() }
  const caps = capsFor(a, perms, t)
  if (need && !caps[need]) {
    const closed = !isOpenTask(t) && ['edit', 'complete', 'cancel', 'status', 'assign', 'reassign', 'changePriority', 'changeDueDate'].includes(need)
    return { error: closed ? bad(409, `This task is ${t.status.toLowerCase()} — reopen it first.`) : bad(403, 'You do not have permission to do that on this task.') }
  }
  return { perms, caps }
}

function decorate(a, perms, t, all) {
  const subs = all.filter((x) => x.parentId === t.id)
  const { attachments = [], ...rest } = t
  return {
    ...rest,
    attachments: attachments.map(({ dataUrl, ...m }) => ({ ...m, hasData: !!dataUrl })),
    subtaskCount: subs.length, subtasksDone: subs.filter((s) => s.status === 'Completed').length,
    overdue: isOverdueTask(t), overdueLabel: overdueLabel(t), _can: capsFor(a, perms, t),
  }
}
/** Tasks the user may see, decorated like GET /tasks (used by the calendar feed). */
export function visibleTasksFor(a) { const { perms, list } = visibleTasks(a); const all = allTasks(); return list.map((t) => decorate(a, perms, t, all)) }
const visibleTasks = (a) => { const perms = permsOf(a); return { perms, list: allTasks().filter((t) => canViewTask(a, perms, t, dirOf)) } }

// --- validation helpers -----------------------------------------------------------------------------------
function activeUserIds(ids) { return (ids || []).filter((id) => { const u = userById(id); return u && u.status !== 'Inactive' }) }
function expandTeam(team) {
  if (!team?.value) return []
  return users().filter((u) => u.status !== 'Inactive' && (team.kind === 'role' ? u.role === team.value : u.department === team.value)).map((u) => u.id)
}
const sameSet = (x = [], y = []) => x.length === y.length && x.every((i) => y.includes(i))
const fmtDate = (d, tm) => (d ? `${d}${tm ? ` ${tm}` : ''}` : 'none')

function resolveRelated(input, base = {}) {
  const type = input.relatedType ?? base.relatedType
  const id = input.relatedId ?? base.relatedId
  if (!type && !id) return { relatedType: null, relatedId: null, relatedName: null, links: {} }
  const def = TASK_RELATED_BY_TYPE[type]
  if (!def) return { error: bad(422, `"${type}" can’t be linked to a task.`, { relatedType: 'Choose a CRM record type.' }) }
  const rec = find(def.collection, id)
  if (!rec) return { error: bad(404, `That ${String(type).toLowerCase()} no longer exists.`, { relatedId: 'Record not found.' }) }
  const ctx = dataCtx()
  const links = resolveTaskLinks(ctx.find, type, id, ctx.list)
  return { relatedType: type, relatedId: id, relatedName: def.label(rec), links }
}
/** Optional extra links (product / campaign / project) a user picks on the form, verified against real records. */
function withExtraLinks(links, extra = {}) {
  const out = { ...links }
  for (const key of ['productId', 'campaignId', 'projectId']) {
    if (!extra[key] || out[key]) continue
    const def = TASK_RELATED_BY_KEY[key]
    if (find(def.collection, extra[key])) out[key] = extra[key]
  }
  return out
}

// --- creating --------------------------------------------------------------------------------------------
/** Builds, validates and stores one task. Used by POST /tasks, the Activities module, automation, recurrence and duplicate. */
export function createTask(a, input, opts = {}) {
  const perms = permsOf(a)
  if (!a.system && !perms.create) return bad(403, 'You do not have permission to create tasks.')
  const data = { ...input }
  if (data.assignedTo && !data.assignees) data.assignees = [data.assignedTo]
  const errors = validateTaskInput(data)
  if (Object.keys(errors).length) return bad(422, Object.values(errors)[0], errors)

  const rel = resolveRelated(data)
  if (rel.error) return rel.error
  let parent = null
  if (data.parentId) {
    parent = taskById(data.parentId)
    if (!parent) return bad(404, 'The parent task no longer exists.', { parentId: 'Parent task not found.' })
    if (parent.parentId) return bad(422, 'Subtasks can’t have their own subtasks.', { parentId: 'Only one level of subtasks.' })
    if (!a.system) { const g = guard(a, parent, 'edit'); if (g.error) return g.error }
  }
  let assignees = data.assignees ? activeUserIds(data.assignees) : null
  if (data.assignees && assignees.length !== data.assignees.length) return bad(422, 'One of the selected users is not an active user.', { assignees: 'Pick active users only.' })
  if (data.assignedTeam?.value && (!assignees || !assignees.length)) assignees = expandTeam(data.assignedTeam)
  if (assignees === null) assignees = a.system ? [] : [a.id]
  if (!a.system && assignees.some((id) => id !== a.id) && !perms.assign) return bad(403, 'You do not have permission to assign tasks to other people.', { assignees: 'You can only assign tasks to yourself.' })
  const links = withExtraLinks(Object.keys(rel.links || {}).length || !parent ? rel.links : parent.links, data.links)
  const watchers = activeUserIds(data.watchers || []).filter((id) => !assignees.includes(id))
  const rec = data.recurrence?.frequency && data.recurrence.frequency !== 'none' ? { frequency: data.recurrence.frequency, interval: Math.min(365, Math.max(1, Number(data.recurrence.interval) || 1)) } : { frequency: 'none', interval: 1 }
  if (rec.frequency !== 'none' && !['daily', 'weekly', 'monthly', 'custom'].includes(rec.frequency)) return bad(422, 'Invalid recurrence.', { recurrence: 'Invalid recurrence.' })
  if (parent && rec.frequency !== 'none') return bad(422, 'A subtask can’t repeat on its own — repeat the parent task instead.', { recurrence: 'Not allowed on a subtask.' })

  const now = Date.now()
  const title = String(data.title).trim()
  if (!opts.automationKey && !opts.allowDuplicate) {
    const dup = getCollection('tasks').find((x) => x.createdBy === a.id && x.title === title && x.relatedId === rel.relatedId && (x.dueDate || null) === (data.dueDate || null) && sameSet(x.assignees, assignees) && now - new Date(x.createdAt || 0).getTime() < 15000)
    if (dup) return bad(409, 'This task was just created.')
  }
  if (opts.automationKey && getCollection('tasks').some((x) => x.automationKey === opts.automationKey)) return bad(409, 'Automation already created this task.')

  const all = getCollection('tasks')
  const id = nextTaskId(all, Number(getCollection('taskSettings')[0]?.counter) || 0)
  const settings = getCollection('taskSettings')
  if (settings[0]) setCollection('taskSettings', [{ ...settings[0], counter: Number(id.slice(4)) }, ...settings.slice(1)])
  const iso = new Date(now).toISOString()
  const task = {
    id, taskV2: true, title, description: String(data.description || '').trim(),
    taskType: data.taskType || 'General', priority: data.priority || 'Medium', status: 'To Do',
    startDate: data.startDate || null, dueDate: data.dueDate || null, dueTime: data.dueTime || null,
    reminderMinutes: data.reminderMinutes || '', customReminderAt: data.reminderMinutes === 'custom' ? data.customReminderAt : null,
    reminderAt: reminderAtFor(data.dueDate, data.dueTime, data.reminderMinutes, data.customReminderAt), remindedAt: null,
    assignees, assignedTo: assignees[0] || null, assignedTeam: data.assignedTeam?.value ? { kind: data.assignedTeam.kind === 'role' ? 'role' : 'department', value: data.assignedTeam.value } : null,
    department: (assignees[0] && dirOf(assignees[0])?.department) || a.department || null,
    createdBy: a.id, watchers, visibility: data.visibility || 'Team',
    relatedType: rel.relatedType, relatedId: rel.relatedId, relatedName: rel.relatedName, links,
    parentId: parent?.id || null, recurrence: rec, recurringRootId: opts.recurringRootId || null, recurrenceKey: opts.recurrenceKey || null,
    attachments: [], source: opts.source || 'manual', automationKey: opts.automationKey || null, activityId: opts.activityId || null,
    duplicateOf: opts.duplicateOf || null, createdAt: iso, updatedAt: iso, completedAt: null, completedBy: null,
  }
  // The Lead / Enquiry / Contact / Deal follow-up dialogs write a "follow-up scheduled" activity and then this task as two calls.
  // Tie them together so the pair is one connected follow-up (completing either completes both), not two loose records.
  if (!task.activityId && task.relatedId && task.dueDate && !opts.automationKey) {
    const twin = getCollection('activities').find((x) => !x.taskId && x.type === 'Follow-up' && x.relatedId === task.relatedId && x.followUpDate === task.dueDate && (a.system || x.by === a.id) && Date.now() - new Date(x.date || 0).getTime() < 120000)
    if (twin) { task.activityId = twin.id; putRecord('activities', twin.id, { taskId: id, status: 'Scheduled' }) }
  }
  setCollection('tasks', [task, ...all])
  logEvent(id, a, 'Created', opts.message || (parent ? `Subtask created under ${parent.id}` : 'Task created'), { to: title })
  if (assignees.length) logEvent(id, a, 'Assigned', `Assigned to ${assignees.map(nameOf).join(', ')}`, { to: assignees.map(nameOf).join(', ') })
  if (parent) logEvent(parent.id, a, 'Subtask Added', `Subtask added: ${title}`, { to: id })
  notify(assignees, task, 'Task Assigned', `${a.name} assigned you: ${title}`, a.id)

  // keep the CRM record's own follow-up bookkeeping in step
  const def = TASK_RELATED_BY_TYPE[rel.relatedType]
  const recd = def && find(def.collection, rel.relatedId)
  if (recd && task.dueDate && CONTACT_TASK_TYPES.includes(task.taskType) && 'nextFollowUp' in recd && (!recd.nextFollowUp || recd.nextFollowUp > task.dueDate || recd.nextFollowUp < todayStr())) putRecord(def.collection, recd.id, { nextFollowUp: task.dueDate })
  return [201, task]
}

// --- changing --------------------------------------------------------------------------------------------
/** Applies a field edit with full permission checks and before/after audit events. Returns [status, body]. */
function editTask(a, t, input) {
  const claiming = !(t.assignees || []).length && Array.isArray(input.assignees) && input.assignees.length === 1 && input.assignees[0] === a.id && Object.keys(input).every((k) => ['assignees', 'assignedTeam', 'reason'].includes(k))
  const g = guard(a, t, claiming ? 'claim' : 'edit')
  if (g.error) return g.error
  const { perms } = g
  const merged = { ...t, ...input }
  if (input.reminderMinutes === 'custom') merged.customReminderAt = input.customReminderAt
  const errors = validateTaskInput({ ...merged, recurrence: input.recurrence ?? t.recurrence })
  if (Object.keys(errors).length) return bad(422, Object.values(errors)[0], errors)
  const patch = {}
  const events = []
  const text = (field, label, type = 'Updated') => {
    if (input[field] === undefined) return
    const v = String(input[field] ?? '').trim()
    if (v === String(t[field] ?? '')) return
    patch[field] = v
    events.push([field === 'description' ? 'Description Updated' : type, `${label} changed`, { field, from: t[field] || '—', to: v || '—' }])
  }
  text('title', 'Title'); text('description', 'Description')
  if (input.taskType !== undefined && input.taskType !== t.taskType) { patch.taskType = input.taskType; events.push(['Updated', 'Task type changed', { field: 'taskType', from: t.taskType, to: input.taskType }]) }
  if (input.visibility !== undefined && input.visibility !== t.visibility) { patch.visibility = input.visibility; events.push(['Updated', 'Visibility changed', { field: 'visibility', from: t.visibility, to: input.visibility }]) }
  if (input.startDate !== undefined && (input.startDate || null) !== (t.startDate || null)) { patch.startDate = input.startDate || null; events.push(['Updated', 'Start date changed', { field: 'startDate', from: t.startDate || '—', to: input.startDate || '—' }]) }
  if (input.priority !== undefined && input.priority !== t.priority) {
    if (!perms.changePriority) return bad(403, 'You do not have permission to change the priority.')
    patch.priority = input.priority
    events.push(['Priority Changed', `Priority changed to ${input.priority}`, { field: 'priority', from: t.priority, to: input.priority }])
  }
  const dueChanged = (input.dueDate !== undefined && (input.dueDate || null) !== (t.dueDate || null)) || (input.dueTime !== undefined && (input.dueTime || null) !== (t.dueTime || null))
  if (dueChanged) {
    if (!perms.changeDueDate) return bad(403, 'You do not have permission to change the due date.')
    patch.dueDate = input.dueDate !== undefined ? input.dueDate || null : t.dueDate
    patch.dueTime = input.dueTime !== undefined ? input.dueTime || null : t.dueTime
    patch.overdueNotified = null
    events.push(['Due Date Changed', 'Due date changed', { field: 'dueDate', from: fmtDate(t.dueDate, t.dueTime), to: fmtDate(patch.dueDate, patch.dueTime) }])
  }
  const remChanged = dueChanged || input.reminderMinutes !== undefined || input.customReminderAt !== undefined
  if (remChanged) {
    const minutes = input.reminderMinutes !== undefined ? input.reminderMinutes : t.reminderMinutes
    const custom = input.customReminderAt !== undefined ? input.customReminderAt : t.customReminderAt
    const due = patch.dueDate !== undefined ? patch.dueDate : t.dueDate
    const dueTime = patch.dueTime !== undefined ? patch.dueTime : t.dueTime
    const at = reminderAtFor(due, dueTime, minutes, custom)
    if ((at || null) !== (t.reminderAt || null)) { patch.reminderAt = at; patch.remindedAt = null; if (input.reminderMinutes !== undefined && input.reminderMinutes !== t.reminderMinutes) events.push(['Updated', 'Reminder changed', { field: 'reminder', from: t.reminderMinutes || 'none', to: minutes || 'none' }]) }
    patch.reminderMinutes = minutes || ''; patch.customReminderAt = minutes === 'custom' ? custom : null
  }
  if (input.recurrence !== undefined) {
    const f = input.recurrence?.frequency || 'none'
    if (!['none', 'daily', 'weekly', 'monthly', 'custom'].includes(f)) return bad(422, 'Invalid recurrence.')
    if (f !== 'none' && t.parentId) return bad(422, 'A subtask can’t repeat on its own — repeat the parent task instead.')
    const rec = f === 'none' ? { frequency: 'none', interval: 1 } : { frequency: f, interval: Math.min(365, Math.max(1, Number(input.recurrence.interval) || 1)) }
    if (rec.frequency !== t.recurrence?.frequency || rec.interval !== t.recurrence?.interval) { patch.recurrence = rec; events.push(['Updated', 'Recurrence changed', { field: 'recurrence', from: t.recurrence?.frequency || 'none', to: rec.frequency }]) }
  }
  if (input.watchers !== undefined) {
    const w = activeUserIds(input.watchers)
    if (!sameSet(w, t.watchers || [])) { patch.watchers = w; events.push(['Updated', `Followers: ${w.map(nameOf).join(', ') || 'none'}`, { field: 'watchers', from: (t.watchers || []).map(nameOf).join(', ') || '—', to: w.map(nameOf).join(', ') || '—' }]) }
  }
  if (input.relatedType !== undefined || input.relatedId !== undefined) {
    const rel = resolveRelated(input, {})
    if (rel.error) return rel.error
    if (rel.relatedId !== t.relatedId || rel.relatedType !== t.relatedType) {
      patch.relatedType = rel.relatedType; patch.relatedId = rel.relatedId; patch.relatedName = rel.relatedName; patch.links = withExtraLinks(rel.links, input.links || {})
      events.push(['Updated', 'Related record changed', { field: 'related', from: t.relatedName || '—', to: rel.relatedName || '—' }])
    }
  } else if (input.links && Object.keys(input.links).length) {
    const links = withExtraLinks(t.links || {}, input.links)
    if (Object.keys(links).length !== Object.keys(t.links || {}).length) { patch.links = links; events.push(['Updated', 'Linked records changed', { field: 'links', from: '—', to: Object.keys(links).join(', ') }]) }
  }
  if (input.assignees !== undefined || input.assignedTeam !== undefined) {
    let next = input.assignees !== undefined ? activeUserIds(input.assignees) : []
    if (input.assignees !== undefined && next.length !== input.assignees.length) return bad(422, 'One of the selected users is not an active user.')
    if (input.assignedTeam?.value && !next.length) next = expandTeam(input.assignedTeam)
    const prev = t.assignees || []
    if (!sameSet(prev, next)) {
      const selfClaim = !prev.length && next.length === 1 && next[0] === a.id && perms.edit
      if (prev.length ? !perms.reassign : !(perms.assign || selfClaim)) return bad(403, prev.length ? 'You do not have permission to reassign tasks.' : 'You do not have permission to assign tasks.')
      patch.assignees = next; patch.assignedTo = next[0] || null
      patch.assignedTeam = input.assignedTeam?.value ? { kind: input.assignedTeam.kind === 'role' ? 'role' : 'department', value: input.assignedTeam.value } : null
      patch.department = (next[0] && dirOf(next[0])?.department) || t.department
      events.push([prev.length ? 'Reassigned' : 'Assigned', `${prev.length ? 'Reassigned' : 'Assigned'} to ${next.map(nameOf).join(', ') || 'nobody'}`, { field: 'assignees', from: prev.map(nameOf).join(', ') || 'Unassigned', to: next.map(nameOf).join(', ') || 'Unassigned', reason: input.reason ? String(input.reason).slice(0, 300) : undefined }])
    }
  }
  if (!Object.keys(patch).length) return [200, t]
  const updated = saveTask(t.id, patch)
  events.forEach(([type, message, extra]) => logEvent(t.id, a, type, message, extra))
  if (patch.assignees) notify(patch.assignees.filter((id) => !(t.assignees || []).includes(id)), updated, 'Task Assigned', `${a.name} assigned you: ${updated.title}`, a.id)
  if (patch.assignees) notify((t.assignees || []).filter((id) => !patch.assignees.includes(id)), updated, 'Task Assigned', `${a.name} reassigned “${updated.title}” to ${patch.assignees.map(nameOf).join(', ') || 'someone else'}`, a.id)
  if (patch.dueDate !== undefined && !patch.assignees) notify(updated.assignees, updated, 'Task Assigned', `${a.name} rescheduled “${updated.title}” to ${fmtDate(updated.dueDate, updated.dueTime)}`, a.id)
  if (patch.dueDate && updated.activityId) putRecord('activities', updated.activityId, { date: new Date(`${patch.dueDate}T${patch.dueTime || '09:00'}:00`).toISOString(), dueDate: patch.dueDate })
  return [200, saveTask(t.id, {})]
}

function openSubtasks(id) { return allTasks().filter((x) => x.parentId === id && isOpenTask(x)) }

/** The Activity that records a finished task on the CRM timelines (no duplicate: a task created from an activity completes that activity). */
function recordCompletionActivity(a, task) {
  const acts = getCollection('activities')
  const link = task.activityId && acts.find((x) => x.id === task.activityId)
  const nowIso = new Date().toISOString()
  if (link) {
    putRecord('activities', link.id, { status: 'Completed', completedAt: nowIso, completedBy: a.id, outcomeNotes: task.completionNote || undefined, ...(link.meetingStatus ? { meetingStatus: 'Completed' } : {}) })
    return link.id
  }
  if (!task.relatedType || !task.relatedId) return null
  const existing = task.completionActivityId && acts.find((x) => x.id === task.completionActivityId)
  const entry = {
    type: 'Task', subject: `Task completed: ${task.title}`, notes: task.completionNote || '', description: task.completionNote || '', date: nowIso, status: 'Completed',
    priority: ['Low', 'Medium', 'High'].includes(task.priority) ? task.priority : 'High', by: a.id, assignedTo: task.assignedTo || a.id, source: 'task', loggedAt: nowIso,
    completedAt: nowIso, completedBy: a.id, relatedType: task.relatedType, relatedId: task.relatedId, relatedName: task.relatedName, links: task.links || {}, taskId: task.id, dueDate: task.dueDate, taskType: task.taskType,
  }
  if (existing) { putRecord('activities', existing.id, entry); return existing.id }
  const created = { id: rid('ACT'), ...entry }
  setCollection('activities', [created, ...acts])
  return created.id
}
function withdrawCompletionActivity(task) {
  if (task.activityId && find('activities', task.activityId)) putRecord('activities', task.activityId, { status: 'Scheduled', completedAt: null, completedBy: null, ...(find('activities', task.activityId).meetingStatus ? { meetingStatus: 'Scheduled' } : {}) })
  if (task.completionActivityId) setCollection('activities', getCollection('activities').filter((x) => x.id !== task.completionActivityId))
}

function spawnNextOccurrence(a, task) {
  const rec = task.recurrence
  if (!rec || rec.frequency === 'none' || !task.dueDate) return null
  const nextDue = nextOccurrenceDate(task.dueDate, rec)
  if (!nextDue) return null
  const root = task.recurringRootId || task.id
  const key = `${root}:${nextDue}`
  if (getCollection('tasks').some((x) => x.recurrenceKey === key)) return null
  const shift = task.startDate ? Math.round((new Date(`${nextDue}T00:00:00`) - new Date(`${task.dueDate}T00:00:00`)) / 86400000) : 0
  const startDate = task.startDate ? (() => { const d = new Date(`${task.startDate}T00:00:00`); d.setDate(d.getDate() + shift); return d.toISOString().slice(0, 10) })() : null
  const res = createTask({ ...a, system: true, id: a.id, name: a.name, role: a.role, department: a.department }, {
    title: task.title, description: task.description, taskType: task.taskType, priority: task.priority, startDate, dueDate: nextDue, dueTime: task.dueTime,
    reminderMinutes: task.reminderMinutes === 'custom' ? '' : task.reminderMinutes, assignees: task.assignees, visibility: task.visibility, watchers: task.watchers,
    relatedType: task.relatedType, relatedId: task.relatedId, recurrence: rec, links: task.links,
  }, { recurringRootId: root, recurrenceKey: key, source: 'recurring', allowDuplicate: true, message: `Created automatically — ${rec.frequency} recurrence of ${task.id}` })
  if (res[0] !== 201) return null
  const next = res[1]
  const subs = allTasks().filter((x) => x.parentId === task.id)
  subs.forEach((s) => createTask({ ...a, system: true }, { title: s.title, taskType: s.taskType, priority: s.priority, assignees: s.assignees, dueDate: nextDue, parentId: next.id, visibility: next.visibility }, { allowDuplicate: true, source: 'recurring' }))
  saveTask(task.id, { nextTaskId: next.id })
  logEvent(task.id, a, 'Recurring Created', `Next ${rec.frequency} occurrence created: ${next.id} (due ${nextDue})`, { to: next.id })
  return next
}

/** Moves a task to a new status with every side effect (activity, recurrence, notifications). `viaActivity` skips writing back to the activity that triggered it. */
export function changeStatus(a, t, to, opts = {}) {
  const need = to === 'Completed' ? 'complete' : to === 'Reopened' ? 'reopen' : to === 'Cancelled' ? 'cancel' : 'status'
  const seen = a.system ? {} : guard(a, t)
  if (seen.error) return seen.error
  if (!TASK_STATUS_LIST.includes(to)) return bad(422, 'Unknown status.')
  if (to === t.status) return bad(409, `This task is already ${to}.`)
  if (!(TASK_TRANSITIONS[t.status] || []).includes(to)) return bad(409, `A ${t.status} task can’t move to ${to}.`)
  const g = a.system ? { perms: permsOf(a) } : guard(a, t, need)
  if (g.error) return g.error
  const reason = String(opts.reason || opts.note || '').trim()
  if (to === 'Cancelled' && !reason) return bad(422, 'Give a reason for cancelling.', { reason: 'Required.' })
  if (to === 'Completed' && !opts.force) {
    const open = openSubtasks(t.id)
    if (open.length) return bad(409, `${open.length} subtask${open.length > 1 ? 's are' : ' is'} still open. Finish them first, or complete anyway.`, { code: 'OPEN_SUBTASKS' })
  }
  const now = new Date().toISOString()
  const patch = { status: to }
  if (to === 'Completed') Object.assign(patch, { completedAt: now, completedBy: a.id, completionNote: reason || null, cancelReason: null })
  if (to === 'Cancelled') Object.assign(patch, { cancelledAt: now, cancelledBy: a.id, cancelReason: reason })
  if (to === 'Reopened') Object.assign(patch, { completedAt: null, completedBy: null, completionNote: null, cancelledAt: null, cancelledBy: null, cancelReason: null, reopenedAt: now, reopenedBy: a.id, remindedAt: null, overdueNotified: null })
  let updated = saveTask(t.id, patch)
  const type = to === 'Completed' ? 'Completed' : to === 'Reopened' ? 'Reopened' : to === 'Cancelled' ? 'Cancelled' : 'Status Changed'
  logEvent(t.id, a, type, `${t.status} → ${to}${reason ? ` — ${reason}` : ''}`, { field: 'status', from: t.status, to, reason: reason || undefined })

  if (to === 'Completed') {
    const actId = opts.viaActivity ? t.activityId : recordCompletionActivity(a, updated)
    if (actId && !t.activityId) updated = saveTask(t.id, { completionActivityId: actId })
    const def = TASK_RELATED_BY_TYPE[t.relatedType]
    const lead = t.links?.leadId && find('leads', t.links.leadId)
    if (lead && CONTACT_TASK_TYPES.includes(t.taskType) && 'lastContactedDate' in lead) putRecord('leads', lead.id, { lastContactedDate: now.slice(0, 10) })
    if (def && t.relatedId && CONTACT_TASK_TYPES.includes(t.taskType)) { const r = find(def.collection, t.relatedId); if (r && 'lastContactedDate' in r && def.collection !== 'leads') putRecord(def.collection, r.id, { lastContactedDate: now.slice(0, 10) }) }
    const next = spawnNextOccurrence(a, updated)
    if (next) updated = { ...updated, _nextTask: next }
    notify([t.createdBy], updated, 'Task Completed', `${a.name} completed “${t.title}”`, a.id)
    notify([...(t.watchers || [])], updated, 'Task Completed', `${a.name} completed “${t.title}”`, a.id)
  } else if (to === 'Reopened') {
    withdrawCompletionActivity(t)
    updated = saveTask(t.id, { completionActivityId: null })
    notify([...(t.assignees || []), t.createdBy], updated, 'Task Assigned', `${a.name} reopened “${t.title}”`, a.id)
  } else if (to === 'Cancelled') {
    if (t.activityId && !opts.viaActivity) putRecord('activities', t.activityId, { status: 'Cancelled', cancelledAt: now, cancelledBy: a.id, cancelReason: reason, ...(find('activities', t.activityId)?.meetingStatus ? { meetingStatus: 'Cancelled' } : {}) })
    notify([...(t.assignees || []), t.createdBy], updated, 'Task Assigned', `${a.name} cancelled “${t.title}”`, a.id)
  }
  return [200, updated]
}

/** Called by the Activities module when a linked activity is completed / cancelled / rescheduled, so the task never drifts. */
export function syncTaskFromActivity(taskId, actor, change) {
  const t = taskId && taskById(taskId)
  if (!t) return
  const a = { ...actor, system: true }
  if (change.status === 'Completed' && t.status !== 'Completed' && isOpenTask(t)) changeStatus(a, t, 'Completed', { viaActivity: true, force: true, note: change.notes })
  else if (change.status === 'Cancelled' && isOpenTask(t)) changeStatus(a, t, 'Cancelled', { viaActivity: true, reason: change.reason || 'Cancelled from the activity' })
  else if (change.dueDate && change.dueDate !== t.dueDate) {
    saveTask(t.id, { dueDate: change.dueDate, reminderAt: reminderAtFor(change.dueDate, t.dueTime, t.reminderMinutes, t.customReminderAt), remindedAt: null, overdueNotified: null })
    logEvent(t.id, actor, 'Due Date Changed', 'Due date changed', { field: 'dueDate', from: fmtDate(t.dueDate, t.dueTime), to: fmtDate(change.dueDate, t.dueTime) })
  } else if (change.title || change.priority || change.assignedTo) {
    const patch = {}
    if (change.title && change.title !== t.title) patch.title = change.title
    if (change.priority && change.priority !== t.priority && TASK_PRIORITIES.includes(change.priority)) patch.priority = change.priority
    if (change.assignedTo && !(t.assignees || []).includes(change.assignedTo)) { patch.assignees = [change.assignedTo]; patch.assignedTo = change.assignedTo }
    if (Object.keys(patch).length) { saveTask(t.id, patch); logEvent(t.id, actor, 'Updated', 'Updated from the linked activity', {}) }
  }
}
export function removeTaskForActivity(taskId) { if (taskId) setCollection('tasks', getCollection('tasks').filter((x) => x.id !== taskId && x.parentId !== taskId)) }

// --- reads -----------------------------------------------------------------------------------------------
function summarize(a) {
  const { perms, list } = visibleTasks(a)
  const today = todayStr()
  const open = list.filter(isOpenTask)
  const metrics = {
    total: list.length,
    mine: open.filter((t) => (t.assignees || []).includes(a.id)).length,
    dueToday: open.filter((t) => t.dueDate === today).length,
    upcoming: open.filter((t) => t.dueDate && t.dueDate > today).length,
    overdue: open.filter((t) => isOverdueTask(t)).length,
    highPriority: open.filter((t) => ['High', 'Urgent'].includes(t.priority)).length,
    inProgress: list.filter((t) => t.status === 'In Progress').length,
    completed: list.filter((t) => t.status === 'Completed').length,
    unassigned: open.filter((t) => !(t.assignees || []).length).length,
    cancelled: list.filter((t) => t.status === 'Cancelled').length,
  }
  const scopeUsers = users().filter((u) => u.status !== 'Inactive' && (perms.viewAll || u.id === a.id || ((perms.viewTeam || perms.viewDepartment) && u.department === a.department)))
  const team = scopeUsers.map((u) => {
    const mine = list.filter((t) => (t.assignees || []).includes(u.id))
    const mOpen = mine.filter(isOpenTask)
    return { userId: u.id, name: u.name, role: u.role, department: u.department, pending: mOpen.filter((t) => t.status !== 'In Progress').length, inProgress: mOpen.filter((t) => t.status === 'In Progress').length, overdue: mOpen.filter((t) => isOverdueTask(t)).length, dueToday: mOpen.filter((t) => t.dueDate === today).length, completed: mine.filter((t) => t.status === 'Completed').length, open: mOpen.length }
  }).filter((r) => r.open || r.completed || r.userId === a.id).sort((x, y) => y.overdue - x.overdue || y.open - x.open)
  return { metrics, team, scope: perms.viewAll ? 'organization' : (perms.viewTeam || perms.viewDepartment) ? 'team' : 'own' }
}

function assigneeDirectory(a) {
  const perms = permsOf(a)
  const tasks = allTasks()
  const rows = users().filter((u) => u.status !== 'Inactive').map((u) => {
    const mine = tasks.filter((t) => (t.assignees || []).includes(u.id) && isOpenTask(t))
    return { id: u.id, name: u.name, role: u.role, department: u.department, designation: u.designation, email: u.email, active: mine.length, overdue: mine.filter((t) => isOverdueTask(t)).length, isMe: u.id === a.id }
  })
  const groupBy = (key) => [...new Set(rows.map((r) => r[key]))].map((v) => ({ value: v, kind: key === 'role' ? 'role' : 'department', members: rows.filter((r) => r[key] === v).map((r) => r.id), active: rows.filter((r) => r[key] === v).reduce((s, r) => s + r.active, 0), overdue: rows.filter((r) => r[key] === v).reduce((s, r) => s + r.overdue, 0) }))
  return { users: rows, departments: groupBy('department'), roles: groupBy('role'), canAssignOthers: perms.assign }
}

function suggestions(a) {
  const tasks = allTasks()
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3)
  const hasOpen = (leadId) => tasks.some((t) => isOpenTask(t) && t.links?.leadId === leadId)
  return getCollection('leads')
    .filter((l) => l.assignedTo === a.id && !['Lost', 'Unqualified', 'Converted'].includes(l.status) && (l.status === 'Contacted' || (l.lastContactedDate && l.lastContactedDate >= cutoff.toISOString().slice(0, 10))) && !hasOpen(l.id))
    .slice(0, 8).map((l) => ({ relatedType: 'Lead', relatedId: l.id, relatedName: l.name, status: l.status, lastContactedDate: l.lastContactedDate, reason: 'Lead was contacted but has no follow-up scheduled' }))
}

// --- engine: reminders, overdue, automation -----------------------------------------------------------------
export function runTaskEngine(now = Date.now()) {
  const st = getTaskSettings()
  const out = { reminders: 0, overdue: 0, managerAlerts: 0, created: 0 }
  const SYS = SYSTEM_ACTOR
  // 1. reminders
  allTasks().filter((t) => isOpenTask(t) && t.reminderAt && !t.remindedAt && new Date(t.reminderAt).getTime() <= now).forEach((t) => {
    const msg = `Reminder: “${t.title}” is due ${fmtDate(t.dueDate, t.dueTime)}`
    notify([...(t.assignees || []), ...(t.watchers || [])], t, 'Task Reminder', msg, null)
    if (st.notifyManagerOnReminder) notify(managersOf(t), t, 'Task Reminder', `${msg} (${(t.assignees || []).map(nameOf).join(', ')})`, null)
    saveTask(t.id, { remindedAt: new Date(now).toISOString() })
    logEvent(t.id, SYS, 'Reminder Triggered', 'Reminder sent in-app to the assignee' + (st.notifyManagerOnReminder ? ' and manager' : ''))
    out.reminders += 1
  })
  // 1b. reminders for scheduled meetings, visits and follow-ups (the calendar shows them as 'Reminder' entries until they fire)
  getCollection('activities').forEach((act) => {
    if (!activityKind(act) || activityStatus(act) !== 'Scheduled' || act.reminderSentAt) return
    const mins = activityReminderMinutes(act)
    const start = startOf(activityWhen(act) || {})?.getTime()
    if (mins === null || !start || start - mins * 60000 > now || start < now - 3600000) return
    const who = act.assignedTo || act.by
    const meeting = MEETING_TYPES_CAL.includes(act.type) || !!act.meetingStatus
    if (who && userById(who)) {
      setCollection('notifications', [{ id: rid('NTF'), type: meeting ? 'Meeting Reminder' : 'Follow-up Reminder', message: `${meeting ? 'Starting soon' : 'Due'}: ${act.title || act.subject}${act.relatedName ? ` — ${act.relatedName}` : ''}`, userId: who, relatedType: act.relatedType, relatedId: act.relatedId, date: new Date(now).toISOString(), read: false }, ...getCollection('notifications')])
    }
    putRecord('activities', act.id, { reminderSentAt: new Date(now).toISOString() })
    out.reminders += 1
  })
  // 2. overdue
  if (st.automation.taskOverdue.enabled) {
    allTasks().filter((t) => isOpenTask(t) && isOverdueTask(t, now)).forEach((t) => {
      const level = overdueLevel(t, now)
      const done = t.overdueNotified || {}
      if (done[level]) return
      const marked = { ...done }; [0, 1, 3, 7].filter((l) => l <= level).forEach((l) => { marked[l] = new Date(now).toISOString() })
      const label = overdueLabel(t, now)
      notify(t.assignees || [], t, 'Task Overdue', `“${t.title}” — ${label}`, null)
      let managers = []
      if (st.automation.taskOverdue.notifyManager && level >= st.managerNotifyOverdueDays) { managers = managersOf(t); notify(managers, t, 'Task Overdue', `${(t.assignees || []).map(nameOf).join(', ') || 'Unassigned'}: “${t.title}” — ${label}`, null); out.managerAlerts += managers.length }
      saveTask(t.id, { overdueNotified: marked })
      logEvent(t.id, SYS, 'Overdue', `${label} — owner notified${managers.length ? ` and ${managers.length} manager${managers.length > 1 ? 's' : ''}` : ''}`)
      out.overdue += 1
    })
  }
  // 3. creation rules (each is idempotent through its automationKey)
  const within = (iso, days) => iso && now - new Date(iso).getTime() <= days * 86400000 && new Date(iso).getTime() <= now + 86400000
  const dueIn = (d) => { const x = new Date(now); x.setDate(x.getDate() + (Number(d) || 0)); return x.toISOString().slice(0, 10) }
  const make = (rule, key, rec, relatedType, input) => {
    if (!rule.enabled) return
    const owner = input.assignee
    const res = createTask(SYS, { priority: rule.priority, dueDate: dueIn(rule.dueInDays), assignees: owner ? [owner] : [], visibility: 'Team', relatedType, relatedId: rec.id, ...input.task }, { automationKey: key, source: 'automation', message: `Created by automation — ${rule.label}` })
    if (res[0] === 201) out.created += 1
  }
  const A = st.automation
  getCollection('leads').filter((l) => l.status === 'New' && within(l.capturedAt || l.createdDate, A.newLead.lookbackDays)).forEach((l) => make(A.newLead, `newLead:${l.id}`, l, 'Lead', { assignee: l.assignedTo, task: { title: `Initial follow-up: ${l.name}`, taskType: 'Call', description: `New lead from ${l.source || 'unknown source'} — make first contact and qualify.` } }))
  getCollection('deals').filter((d) => !['Won', 'Lost', 'Closed Won', 'Closed Lost'].includes(d.stage) && String(d.stage || '').indexOf('Closed') !== 0 && within(d.createdDate, A.dealCreated.lookbackDays)).forEach((d) => make(A.dealCreated, `dealCreated:${d.id}`, d, 'Deal', { assignee: d.salesperson, task: { title: `Requirement follow-up: ${d.name}`, taskType: 'Follow-up', description: 'Confirm requirements and decision makers for this new deal.' } }))
  getCollection('proposals').filter((p) => p.sentAt && ['Sent', 'Viewed'].includes(p.status) && within(p.sentAt, A.proposalSent.lookbackDays)).forEach((p) => make(A.proposalSent, `proposalSent:${p.id}`, p, 'Proposal', { assignee: ownerOfRecord('Proposal', p), task: { title: `Proposal follow-up: ${p.number}`, taskType: 'Proposal', description: 'Check that the client received the proposal and collect feedback.' } }))
  getCollection('quotations').filter((q) => q.sentAt && ['Sent', 'Viewed', 'Negotiation'].includes(q.status) && within(q.sentAt, A.quotationSent.lookbackDays)).forEach((q) => make(A.quotationSent, `quotationSent:${q.id}`, q, 'Quotation', { assignee: ownerOfRecord('Quotation', q), task: { title: `Quotation follow-up: ${q.number}`, taskType: 'Quotation', description: 'Follow up on the quotation sent to the client.' } }))
  const today = new Date(now).toISOString().slice(0, 10)
  getCollection('invoices').filter((i) => i.status !== 'Cancelled' && i.status !== 'Paid' && i.status !== 'Draft' && i.dueDate && i.dueDate < today && (i.amount || 0) - (i.paidAmount || 0) > 0 && within(`${i.dueDate}T00:00:00`, A.invoiceOverdue.lookbackDays)).forEach((i) => {
    const owner = ownerOfRecord('Invoice', find('salesOrders', i.salesOrderId)) || ownerOfRecord('Invoice', find('quotations', i.quotationId)) || ownerOfRecord('Invoice', find('deals', i.dealId)) || ownerOfRecord('Invoice', find('customers', i.customerId))
    make(A.invoiceOverdue, `invoiceOverdue:${i.id}`, i, 'Invoice', { assignee: owner, task: { title: `Payment follow-up: ${i.number}`, taskType: 'Payment Follow-up', description: `Invoice is overdue — outstanding ${(i.amount || 0) - (i.paidAmount || 0)}. Contact the client for payment.` } })
  })
  return out
}

// --- registration ---------------------------------------------------------------------------------------
export function registerTaskEndpoints(mock, withSession) {
  const body = (c) => (c.data ? JSON.parse(c.data) : {})
  const seg = (c, n = 2) => decodeURIComponent(c.url.split('?')[0].split('/')[n] || '')
  const withTask = (c, fn, need) => {
    const t = taskById(seg(c))
    if (!t) return bad(404, 'Task not found.')
    return fn(currentActor(), t, body(c))
  }

  const staticGets = {
    summary: () => [200, summarize(currentActor())],
    assignees: () => [200, assigneeDirectory(currentActor())],
    suggestions: () => [200, suggestions(currentActor())],
    filters: () => [200, getCollection('taskFilters').filter((f) => f.userId === currentActor().id)],
    settings: () => [200, getTaskSettings()],
    me: () => { const a = currentActor(); const s = getTaskSettings(); return [200, { user: a, perms: permsOf(a), settings: { automation: s.automation, uploadRules: s.uploadRules, managerNotifyOverdueDays: s.managerNotifyOverdueDays }, emailConfigured: false, whatsappConfigured: false }] },
    'suggest-owner': (c) => {
      const { relatedType, relatedId } = c.params || {}
      const rel = resolveRelated({ relatedType, relatedId })
      if (rel.error) return rel.error
      const def = TASK_RELATED_BY_TYPE[relatedType]
      const chain = [find(def.collection, relatedId), find('salesOrders', rel.links.salesOrderId), find('quotations', rel.links.quotationId), find('deals', rel.links.dealId), find('leads', rel.links.leadId), find('enquiries', rel.links.enquiryId), find('customers', rel.links.customerId), find('projects', rel.links.projectId)]
      const owner = chain.map((r) => ownerOfRecord(relatedType, r)).find((id) => id && userById(id)) || null
      return [200, { owner, ownerName: owner ? nameOf(owner) : null, relatedName: rel.relatedName, links: rel.links }]
    },
  }

  // GET /tasks + /tasks/:id (+ reserved sub-routes that the generic ":id" matcher would otherwise swallow)
  mock.onGet('/tasks').reply(withSession((config) => {
    const a = currentActor()
    const { perms, list } = visibleTasks(a)
    if (!perms.view) return bad(403, 'You do not have permission to view tasks.')
    const all = allTasks()
    const rows = list.map((t) => decorate(a, perms, t, all))
    if (config.params?.all === true || config.params?.all === 'true') return [200, rows]
    const page = Number(config.params?.page) || 1
    const pageSize = Number(config.params?.pageSize) || 10
    return [200, { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }]
  }))
  mock.onGet(new RegExp('^/tasks/[^/]+$')).reply(withSession((config) => {
    const id = seg(config)
    if (RESERVED.includes(id)) return staticGets[id](config)
    const a = currentActor()
    const t = taskById(id)
    if (!t) return bad(404, 'Task not found.')
    const g = guard(a, t)
    if (g.error) return g.error
    return [200, decorate(a, g.perms, t, allTasks())]
  }))
  mock.onGet(new RegExp('^/tasks/[^/]+/detail$')).reply(withSession((config) => {
    const a = currentActor()
    const t = taskById(seg(config))
    if (!t) return bad(404, 'Task not found.')
    const g = guard(a, t)
    if (g.error) return g.error
    const all = allTasks()
    const subtasks = all.filter((x) => x.parentId === t.id && canViewTask(a, g.perms, x, dirOf)).map((x) => decorate(a, g.perms, x, all))
    const parent = t.parentId ? all.find((x) => x.id === t.parentId) : null
    const events = getCollection('taskEvents').filter((e) => e.taskId === t.id).sort((x, y) => new Date(y.at) - new Date(x.at))
    const related = Object.entries(t.links || {}).map(([key, id]) => { const def = TASK_RELATED_BY_KEY[key]; const rec = def && find(def.collection, id); return rec ? { key, type: def.type, id, label: def.label(rec), route: def.route(id) } : null }).filter(Boolean)
    const activities = getCollection('activities').filter((x) => x.taskId === t.id || x.id === t.activityId).map((x) => ({ id: x.id, type: x.type, subject: x.subject, status: x.status, date: x.date }))
    const nextTask = t.nextTaskId ? all.find((x) => x.id === t.nextTaskId) : null
    return [200, {
      task: decorate(a, g.perms, t, all), subtasks, events, related, activities,
      parent: parent && canViewTask(a, g.perms, parent, dirOf) ? { id: parent.id, title: parent.title } : null,
      nextTask: nextTask && canViewTask(a, g.perms, nextTask, dirOf) ? { id: nextTask.id, title: nextTask.title, dueDate: nextTask.dueDate } : null,
      people: Object.fromEntries([t.createdBy, ...(t.assignees || []), ...(t.watchers || []), ...events.map((e) => e.by)].filter(Boolean).map((id) => [id, nameOf(id)])),
    }]
  }))
  mock.onGet(new RegExp('^/tasks/[^/]+/attachments/[^/]+$')).reply(withSession((config) => {
    const a = currentActor()
    const t = taskById(seg(config))
    if (!t) return bad(404, 'Task not found.')
    const g = guard(a, t)
    if (g.error) return g.error
    const att = (t.attachments || []).find((x) => x.id === seg(config, 4))
    return att ? [200, att] : bad(404, 'Attachment not found.')
  }))

  // Notifications addressed to someone (task alerts) are only ever returned to that person; unaddressed ones stay shared.
  mock.onGet('/notifications').reply(withSession((config) => {
    const me = currentActor().id
    const list = getCollection('notifications').filter((n) => !n.userId || n.userId === me)
    if (config.params?.all === true || config.params?.all === 'true') return [200, list]
    const page = Number(config.params?.page) || 1
    const pageSize = Number(config.params?.pageSize) || 10
    return [200, { data: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize }]
  }))

  // POST /tasks (create) — the generic open POST is replaced
  mock.onPost('/tasks').reply(withSession((config) => createTask(currentActor(), body(config))))
  mock.onPut(new RegExp('^/tasks/[^/]+$')).reply(withSession((config) => {
    const id = seg(config)
    if (id === 'settings') return putSettings(config)
    return withTask(config, (a, t, b) => {
      if (b.status !== undefined && normalizeStatus(b.status) !== t.status) {
        const r = changeStatus(a, t, normalizeStatus(b.status), { reason: b.reason })
        if (r[0] !== 200) return r
        const { status, reason, ...rest } = b
        return Object.keys(rest).length ? editTask(a, r[1], rest) : r
      }
      const { status, ...rest } = b
      return editTask(a, t, rest)
    })
  }))
  mock.onDelete(new RegExp('^/tasks/[^/]+$')).reply(withSession((config) => withTask(config, (a, t) => {
    const g = guard(a, t, 'delete')
    if (g.error) return g.error
    const kids = allTasks().filter((x) => x.parentId === t.id)
    setCollection('tasks', getCollection('tasks').filter((x) => x.id !== t.id && x.parentId !== t.id))
    if (t.completionActivityId) setCollection('activities', getCollection('activities').filter((x) => x.id !== t.completionActivityId))
    logEvent(t.id, a, 'Deleted', `Task deleted${kids.length ? ` with ${kids.length} subtask${kids.length > 1 ? 's' : ''}` : ''}`, { from: t.title })
    if (t.parentId) logEvent(t.parentId, a, 'Subtask Removed', `Subtask removed: ${t.title}`, { from: t.id })
    return [200, { success: true }]
  })))

  mock.onPost(new RegExp('^/tasks/[^/]+/status$')).reply(withSession((c) => withTask(c, (a, t, b) => changeStatus(a, t, normalizeStatus(b.status), { reason: b.reason, force: b.force }))))
  mock.onPost(new RegExp('^/tasks/[^/]+/complete$')).reply(withSession((c) => withTask(c, (a, t, b) => changeStatus(a, t, 'Completed', { note: b.note, force: b.force }))))
  mock.onPost(new RegExp('^/tasks/[^/]+/reopen$')).reply(withSession((c) => withTask(c, (a, t, b) => changeStatus(a, t, 'Reopened', { reason: b.reason }))))
  mock.onPost(new RegExp('^/tasks/[^/]+/cancel$')).reply(withSession((c) => withTask(c, (a, t, b) => changeStatus(a, t, 'Cancelled', { reason: b.reason }))))
  mock.onPost(new RegExp('^/tasks/[^/]+/assign$')).reply(withSession((c) => withTask(c, (a, t, b) => {
    if (!Array.isArray(b.assignees) && !b.assignedTeam) return bad(422, 'Choose who to assign this task to.')
    return editTask(a, t, { assignees: b.assignees || [], assignedTeam: b.assignedTeam, reason: b.reason })
  })))
  mock.onPost(new RegExp('^/tasks/[^/]+/reschedule$')).reply(withSession((c) => withTask(c, (a, t, b) => {
    if (!b.dueDate) return bad(422, 'Choose a new due date.', { dueDate: 'Required.' })
    return editTask(a, t, { dueDate: b.dueDate, dueTime: b.dueTime ?? t.dueTime })
  })))
  mock.onPost(new RegExp('^/tasks/[^/]+/duplicate$')).reply(withSession((c) => withTask(c, (a, t, b) => {
    const g = guard(a, t, 'duplicate')
    if (g.error) return g.error
    const res = createTask(a, {
      title: `${t.title} (copy)`, description: t.description, taskType: t.taskType, priority: t.priority, startDate: t.startDate, dueDate: t.dueDate, dueTime: t.dueTime,
      reminderMinutes: t.reminderMinutes === 'custom' ? '' : t.reminderMinutes, assignees: t.assignees, visibility: t.visibility, watchers: t.watchers, relatedType: t.relatedType, relatedId: t.relatedId,
      links: t.links, recurrence: t.recurrence, parentId: t.parentId,
    }, { duplicateOf: t.id, allowDuplicate: true, message: `Duplicated from ${t.id}` })
    if (res[0] !== 201) return res
    if (b.withSubtasks !== false) allTasks().filter((x) => x.parentId === t.id).forEach((s) => createTask(a, { title: s.title, description: s.description, taskType: s.taskType, priority: s.priority, dueDate: s.dueDate, assignees: s.assignees, visibility: s.visibility, parentId: res[1].id }, { allowDuplicate: true }))
    logEvent(t.id, a, 'Duplicated', `Duplicated as ${res[1].id}`, { to: res[1].id })
    return res
  })))

  mock.onPost(new RegExp('^/tasks/[^/]+/comments$')).reply(withSession((c) => withTask(c, (a, t, b) => {
    const g = guard(a, t, 'comment')
    if (g.error) return g.error
    const text = String(b.text || '').trim()
    if (!text) return bad(422, 'Write a comment first.', { text: 'Required.' })
    if (text.length > 2000) return bad(422, 'Comments are limited to 2000 characters.', { text: 'Too long.' })
    const mentions = activeUserIds(b.mentions || [])
    const e = logEvent(t.id, a, b.internal ? 'Internal Note' : 'Comment', b.internal ? 'Internal note added' : 'Comment added', { text, mentions, internal: !!b.internal })
    const newly = mentions.filter((id) => !(t.assignees || []).includes(id) && !(t.watchers || []).includes(id) && t.createdBy !== id)
    if (newly.length) saveTask(t.id, { watchers: [...(t.watchers || []), ...newly] })
    notify(mentions, t, 'Task Mention', `${a.name} mentioned you on “${t.title}”: ${text.slice(0, 80)}`, a.id)
    notify([...(t.assignees || []), t.createdBy].filter((id) => !mentions.includes(id)), t, 'Task Comment', `${a.name} commented on “${t.title}”`, a.id)
    return [201, e]
  })))
  mock.onPost(new RegExp('^/tasks/[^/]+/attachments$')).reply(withSession((c) => withTask(c, (a, t, b) => {
    const g = guard(a, t, 'attach')
    if (g.error) return g.error
    const rules = getTaskSettings().uploadRules
    const size = dataUrlByteLength(b.dataUrl)
    const err = checkTaskFile({ name: b.name, size }, { ...rules, maxBytes: Math.min(rules.maxBytes, TASK_FILE_RULES.maxBytes) })
    if (err) return bad(422, err, { file: err })
    if ((t.attachments || []).length >= TASK_FILE_RULES.maxPerTask) return bad(409, `A task can hold at most ${TASK_FILE_RULES.maxPerTask} attachments.`)
    const name = String(b.name).replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f<>:"|?*]+/g, '').trim()
    if ((t.attachments || []).some((x) => x.name === name && x.size === size)) return bad(409, 'This file is already attached.')
    const att = { id: rid('ATT'), name, size, type: b.mimeType || '', dataUrl: b.dataUrl, uploadedBy: a.id, uploadedAt: new Date().toISOString() }
    saveTask(t.id, { attachments: [...(t.attachments || []), att] })
    logEvent(t.id, a, 'Attachment Added', `Attached ${name}`, { to: name })
    const { dataUrl, ...meta } = att
    return [201, meta]
  })))
  mock.onDelete(new RegExp('^/tasks/[^/]+/attachments/[^/]+$')).reply(withSession((c) => withTask(c, (a, t) => {
    const g = guard(a, t, 'attach')
    if (g.error) return g.error
    const att = (t.attachments || []).find((x) => x.id === seg(c, 4))
    if (!att) return bad(404, 'Attachment not found.')
    saveTask(t.id, { attachments: t.attachments.filter((x) => x.id !== att.id) })
    logEvent(t.id, a, 'Attachment Removed', `Removed ${att.name}`, { from: att.name })
    return [200, { success: true }]
  })))

  // saved filters (own only)
  mock.onPost('/tasks/filters').reply(withSession((config) => {
    const a = currentActor()
    const b = body(config)
    const name = String(b.name || '').trim().slice(0, 40)
    if (!name) return bad(422, 'Name this filter.', { name: 'Required.' })
    const mine = getCollection('taskFilters')
    const existing = mine.find((f) => f.userId === a.id && f.name.toLowerCase() === name.toLowerCase())
    const rec = { id: existing?.id || rid('TFL'), userId: a.id, name, view: b.view || 'list', filters: b.filters || {}, createdAt: existing?.createdAt || new Date().toISOString() }
    setCollection('taskFilters', existing ? mine.map((f) => (f.id === existing.id ? rec : f)) : [rec, ...mine])
    return [existing ? 200 : 201, rec]
  }))
  mock.onDelete(new RegExp('^/tasks/filters/[^/]+$')).reply(withSession((config) => {
    const a = currentActor()
    const f = getCollection('taskFilters').find((x) => x.id === seg(config, 3))
    if (!f || f.userId !== a.id) return bad(404, 'Saved filter not found.')
    setCollection('taskFilters', getCollection('taskFilters').filter((x) => x.id !== f.id))
    return [200, { success: true }]
  }))

  mock.onPost('/tasks/engine/run').reply(withSession(() => [200, runTaskEngine()]))

  function putSettings(config) {
    const a = currentActor()
    if (!['Super Admin', 'Admin'].includes(a.role)) return bad(403, 'Only an administrator can change task settings.')
    const b = body(config)
    const cur = getTaskSettings()
    const automation = {}
    for (const [k, def] of Object.entries(DEFAULT_AUTOMATION)) {
      const v = b.automation?.[k] || {}
      const merged = { ...cur.automation[k], ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}) }
      if (v.dueInDays !== undefined) { const n = Number(v.dueInDays); if (!Number.isInteger(n) || n < 0 || n > 60) return bad(422, 'Due-in days must be between 0 and 60.'); merged.dueInDays = n }
      if (v.lookbackDays !== undefined) { const n = Number(v.lookbackDays); if (!Number.isInteger(n) || n < 1 || n > 365) return bad(422, 'Look-back must be between 1 and 365 days.'); merged.lookbackDays = n }
      if (v.priority !== undefined) { if (!TASK_PRIORITIES.includes(v.priority)) return bad(422, 'Invalid priority.'); merged.priority = v.priority }
      if (v.notifyManager !== undefined) merged.notifyManager = !!v.notifyManager
      automation[k] = { ...def, ...merged }
    }
    const permissions = {}
    const known = TASK_PERMISSION_KEYS.map((p) => p.key)
    Object.entries(b.permissions || cur.permissions || {}).forEach(([role, map]) => {
      if (!DEFAULT_TASK_PERMISSIONS[role] || role === 'Super Admin') return
      permissions[role] = Object.fromEntries(Object.entries(map || {}).filter(([k]) => known.includes(k)).map(([k, v]) => [k, !!v]))
    })
    const days = b.managerNotifyOverdueDays !== undefined ? Number(b.managerNotifyOverdueDays) : cur.managerNotifyOverdueDays
    if (![0, 1, 3, 7].includes(days)) return bad(422, 'Manager escalation must be 0, 1, 3 or 7 days.')
    const rules = { ...cur.uploadRules }
    if (b.uploadRules?.maxBytes !== undefined) { const n = Number(b.uploadRules.maxBytes); if (!(n > 0) || n > TASK_FILE_RULES.maxBytes) return bad(422, `Maximum file size can’t exceed ${TASK_FILE_RULES.maxBytes / 1048576} MB in this workspace.`); rules.maxBytes = n }
    if (b.uploadRules?.extensions) { const ext = b.uploadRules.extensions.filter((e) => TASK_FILE_RULES.extensions.includes(e)); if (!ext.length) return bad(422, 'Allow at least one file type.'); rules.extensions = ext }
    const prev = getCollection('taskSettings')[0] || {}
    const next = { ...prev, id: 'default', automation, permissions, managerNotifyOverdueDays: days, notifyManagerOnReminder: b.notifyManagerOnReminder !== undefined ? !!b.notifyManagerOnReminder : cur.notifyManagerOnReminder, uploadRules: { maxBytes: rules.maxBytes, extensions: rules.extensions }, updatedAt: new Date().toISOString(), updatedBy: a.id }
    setCollection('taskSettings', [next])
    return [200, getTaskSettings()]
  }
}
