// Upgrades every stored task to the central task model (idempotent, stamped `taskV2`), and exports
// `normalizeTask`, which the task API also runs on read so tasks written by other modules (the
// follow-up dialogs, the Activities module) are completed the same way.
import { resolveTaskLinks, TASK_RELATED_BY_TYPE } from '../utils/taskLinks'
import { normalizeStatus, DEFAULT_AUTOMATION, TASK_FILE_RULES } from '../utils/taskRules'

const TYPE_HINTS = [[/email/i, 'Email'], [/whatsapp/i, 'WhatsApp'], [/call|phone/i, 'Call'], [/demo/i, 'Demo'], [/meeting|kickoff|discussion/i, 'Meeting'], [/quotation/i, 'Quotation'], [/proposal/i, 'Proposal'], [/invoice|payment/i, 'Payment Follow-up'], [/follow/i, 'Follow-up'], [/document|contract|report/i, 'Document'], [/review/i, 'Review']]
export const guessTaskType = (title = '') => (TYPE_HINTS.find(([re]) => re.test(title)) || [null, 'General'])[1]

const isoDay = (d, shift = 0) => {
  const x = new Date(`${d}T09:00:00`)
  x.setDate(x.getDate() + shift)
  return x.toISOString()
}

/** Completes a task record so it has every field of the model. Already-complete tasks come back unchanged. */
export function normalizeTask(t, { find, list, userOf }) {
  if (t.taskV2) return t
  const assignees = Array.isArray(t.assignees) ? t.assignees : (t.assignedTo ? [t.assignedTo] : [])
  const primary = assignees[0] || null
  const status = normalizeStatus(t.status)
  const relatedKnown = TASK_RELATED_BY_TYPE[t.relatedType] && t.relatedId && find(TASK_RELATED_BY_TYPE[t.relatedType].collection, t.relatedId)
  const creator = t.createdBy || primary || null
  const created = t.createdAt || (t.dueDate ? isoDay(t.dueDate, -7) : new Date().toISOString())
  return {
    ...t,
    taskV2: true,
    status,
    taskType: t.taskType || guessTaskType(t.title),
    priority: t.priority || 'Medium',
    description: t.description || '',
    startDate: t.startDate || null,
    dueDate: t.dueDate || null,
    dueTime: t.dueTime || null,
    reminderMinutes: t.reminderMinutes || '',
    reminderAt: t.reminderAt || null,
    assignees,
    assignedTo: primary,
    assignedTeam: t.assignedTeam || null,
    department: t.department || (primary ? userOf(primary)?.department : null) || null,
    createdBy: creator,
    watchers: t.watchers || [],
    visibility: t.visibility || 'Team',
    links: t.links || (relatedKnown ? resolveTaskLinks(find, t.relatedType, t.relatedId, list) : {}),
    relatedType: relatedKnown ? t.relatedType : (t.relatedType || null),
    relatedId: relatedKnown ? t.relatedId : (t.relatedId || null),
    parentId: t.parentId || null,
    recurrence: t.recurrence || { frequency: 'none', interval: 1 },
    attachments: t.attachments || [],
    source: t.source || (t.activityId ? 'activity' : 'manual'),
    createdAt: created,
    updatedAt: t.updatedAt || created,
    completedAt: status === 'Completed' ? (t.completedAt || (t.dueDate ? isoDay(t.dueDate, 0) : created)) : (t.completedAt || null),
    completedBy: status === 'Completed' ? (t.completedBy || primary) : (t.completedBy || null),
  }
}

export function migrateTasks(db) {
  db.__migrations = db.__migrations || {}
  if (db.__migrations.taskV2) return db
  const idx = {}
  const find = (col, id) => {
    if (!id) return null
    if (!idx[col]) idx[col] = new Map((db[col] || []).map((r) => [r.id, r]))
    return idx[col].get(id) || null
  }
  const users = new Map((db.users || []).map((u) => [u.id, u]))
  const ctx = { find, list: (c) => db[c] || [], userOf: (id) => users.get(id) }
  db.tasks = (db.tasks || []).map((t) => normalizeTask(t, ctx))
  db.taskEvents = db.taskEvents || []
  db.tasks.forEach((t) => {
    if (db.taskEvents.some((e) => e.taskId === t.id)) return
    db.taskEvents.push({ id: `TEV-${t.id}-C`, taskId: t.id, type: 'Created', by: t.createdBy, at: t.createdAt, message: 'Task created' })
    if (t.status === 'Completed') db.taskEvents.push({ id: `TEV-${t.id}-D`, taskId: t.id, type: 'Completed', by: t.completedBy, at: t.completedAt, message: 'Task completed', from: 'To Do', to: 'Completed' })
    if (t.status === 'Cancelled') db.taskEvents.push({ id: `TEV-${t.id}-X`, taskId: t.id, type: 'Cancelled', by: t.createdBy, at: t.createdAt, message: 'Task cancelled', from: 'To Do', to: 'Cancelled' })
  })
  db.taskFilters = db.taskFilters || []
  db.taskSettings = db.taskSettings && db.taskSettings.length ? db.taskSettings : [{ id: 'default', automation: DEFAULT_AUTOMATION, permissions: {}, uploadRules: { maxBytes: TASK_FILE_RULES.maxBytes, extensions: TASK_FILE_RULES.extensions }, managerNotifyOverdueDays: 3, notifyManagerOnReminder: false, updatedAt: null }]
  db.__migrations.taskV2 = true
  return db
}
