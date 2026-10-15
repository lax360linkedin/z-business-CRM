// Task vocabulary, workflow, permissions and visibility rules — shared by the Tasks UI and the mock
// backend (src/api/taskApi.js), which enforces every one of them on each request.
//
// Task = what needs doing · Activity = what happened · Calendar = when. A task has ONE record;
// the Calendar reads it directly (no duplicate event rows) and completing it writes the Activity.

export const TASK_STATUS_LIST = ['To Do', 'In Progress', 'Waiting / On Hold', 'Completed', 'Cancelled', 'Reopened']
export const TASK_OPEN = ['To Do', 'In Progress', 'Waiting / On Hold', 'Reopened']
export const TASK_CLOSED = ['Completed', 'Cancelled']
export const TASK_TRANSITIONS = {
  'To Do': ['In Progress', 'Waiting / On Hold', 'Completed', 'Cancelled'],
  'In Progress': ['To Do', 'Waiting / On Hold', 'Completed', 'Cancelled'],
  'Waiting / On Hold': ['To Do', 'In Progress', 'Completed', 'Cancelled'],
  Reopened: ['In Progress', 'Waiting / On Hold', 'Completed', 'Cancelled'],
  Completed: ['Reopened'],
  Cancelled: ['Reopened'],
}
/** Older modules wrote 'Pending'; it means To Do. */
export const normalizeStatus = (s) => (s === 'Pending' ? 'To Do' : TASK_STATUS_LIST.includes(s) ? s : 'To Do')

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const PRIORITY_WEIGHT = { Urgent: 4, High: 3, Medium: 2, Low: 1 }
export const TASK_TYPES = ['General', 'Milestone', 'Call', 'Email', 'WhatsApp', 'Meeting', 'Follow-up', 'Demo', 'Proposal', 'Quotation', 'Payment Follow-up', 'Document', 'Review', 'Site Visit']
export const VISIBILITY_LEVELS = ['Private', 'Team', 'Department', 'Manager + Team', 'Organization']
export const VISIBILITY_HELP = {
  Private: 'Only the creator, assignees and followers',
  Team: 'Plus people in the assignees’ team who can view team tasks',
  Department: 'Plus everyone in the department who can view department tasks',
  'Manager + Team': 'Plus the team and the managers who oversee it',
  Organization: 'Everyone who can view tasks',
}
export const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' }, { value: '0', label: 'At the due time' }, { value: '5', label: '5 minutes before' }, { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' }, { value: '60', label: '1 hour before' }, { value: '1440', label: '1 day before' }, { value: 'custom', label: 'Custom date & time…' },
]
export const RECURRENCE_OPTIONS = [{ value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'custom', label: 'Custom (every N days)' }]
export const MANAGER_ROLES = ['Super Admin', 'Admin', 'MD', 'Sales Manager', 'Project Manager']

export const TASK_LINK_KEYS = ['enquiryId', 'leadId', 'dealId', 'contactId', 'companyId', 'customerId', 'proposalId', 'quotationId', 'salesOrderId', 'invoiceId', 'paymentId', 'expenseId', 'productId', 'campaignId', 'projectId']

// --- permissions ----------------------------------------------------------------------------------
export const TASK_PERMISSION_KEYS = [
  { key: 'view', label: 'View' }, { key: 'create', label: 'Create' }, { key: 'edit', label: 'Edit' }, { key: 'complete', label: 'Complete' },
  { key: 'reopen', label: 'Reopen' }, { key: 'assign', label: 'Assign' }, { key: 'reassign', label: 'Reassign' }, { key: 'delete', label: 'Delete' },
  { key: 'changePriority', label: 'Change priority' }, { key: 'changeDueDate', label: 'Change due date' },
  { key: 'viewTeam', label: 'View team tasks' }, { key: 'viewDepartment', label: 'View department tasks' }, { key: 'viewAll', label: 'View all tasks' },
]
const ALL = Object.fromEntries(TASK_PERMISSION_KEYS.map((p) => [p.key, true]))
const NONE = Object.fromEntries(TASK_PERMISSION_KEYS.map((p) => [p.key, false]))
const DOER = { ...NONE, view: true, create: true, edit: true, complete: true, reopen: true, changePriority: true, changeDueDate: true }
const MANAGER = { ...ALL, viewAll: false }
const OVERSIGHT = { ...NONE, view: true, viewTeam: true, viewDepartment: true, viewAll: true }

export const DEFAULT_TASK_PERMISSIONS = {
  'Super Admin': { ...ALL },
  Admin: { ...ALL },
  MD: { ...OVERSIGHT },
  CEO: { ...OVERSIGHT },
  'Sales Manager': { ...MANAGER },
  'Project Manager': { ...MANAGER },
  HR: { ...DOER, assign: true, viewDepartment: true },
  'Sales Executive': { ...DOER },
  'Project Staff': { ...DOER },
  Marketing: { ...DOER },
  Accounts: { ...DOER },
  Support: { ...DOER },
}

export function taskPermissionsFor(role, settings) {
  return { ...NONE, ...(DEFAULT_TASK_PERMISSIONS[role] || {}), ...(settings?.permissions?.[role] || {}) }
}

// --- automation defaults ---------------------------------------------------------------------------
export const DEFAULT_AUTOMATION = {
  newLead: { enabled: true, label: 'New lead → initial follow-up task', dueInDays: 1, priority: 'High', lookbackDays: 14 },
  dealCreated: { enabled: true, label: 'Deal created → requirement follow-up', dueInDays: 2, priority: 'Medium', lookbackDays: 14 },
  proposalSent: { enabled: true, label: 'Proposal sent → proposal follow-up', dueInDays: 3, priority: 'High', lookbackDays: 14 },
  quotationSent: { enabled: true, label: 'Quotation sent → quotation follow-up', dueInDays: 3, priority: 'High', lookbackDays: 14 },
  invoiceOverdue: { enabled: true, label: 'Invoice overdue → payment follow-up', dueInDays: 0, priority: 'Urgent', lookbackDays: 60 },
  leadContacted: { enabled: true, label: 'Lead contacted → suggest next follow-up', suggestOnly: true },
  taskOverdue: { enabled: true, label: 'Task overdue → notify owner and manager', notifyManager: true },
}

// --- dates -----------------------------------------------------------------------------------------------
export const todayStr = () => new Date().toISOString().slice(0, 10)
export const dueDateTime = (t) => (t.dueDate ? new Date(`${t.dueDate}T${t.dueTime || '23:59'}:00`) : null)
export function isOpenTask(t) { return TASK_OPEN.includes(t.status) }
export function isOverdueTask(t, now = Date.now()) {
  const d = dueDateTime(t)
  return !!d && isOpenTask(t) && d.getTime() < now
}
/** Whole calendar days between the due date and today (a task due yesterday is 1 day overdue at any hour). */
const daysLate = (t, now) => { const nd = new Date(now); nd.setHours(0, 0, 0, 0); return Math.round((nd - new Date(`${t.dueDate}T00:00:00`)) / 86400000) }
/** 1 = overdue by 1+ day, 3 = 3+ days, 7 = 7+ days, 0 = overdue today (less than a day) or not overdue. */
export function overdueLevel(t, now = Date.now()) {
  const d = dueDateTime(t)
  if (!d || !isOverdueTask(t, now)) return -1
  const days = daysLate(t, now)
  return days >= 7 ? 7 : days >= 3 ? 3 : days >= 1 ? 1 : 0
}
export function overdueLabel(t, now = Date.now()) {
  const d = dueDateTime(t)
  if (!d || !isOverdueTask(t, now)) return null
  const days = daysLate(t, now)
  return days >= 7 ? 'Overdue 7+ days' : days >= 3 ? 'Overdue 3+ days' : days >= 1 ? `Overdue ${days} day${days > 1 ? 's' : ''}` : 'Overdue today'
}
export function reminderAtFor(dueDate, dueTime, reminderMinutes, customAt) {
  if (reminderMinutes === 'custom') return customAt ? new Date(customAt).toISOString() : null
  if (!dueDate || !reminderMinutes) return null
  const d = new Date(`${dueDate}T${dueTime || '09:00'}:00`)
  return new Date(d.getTime() - Number(reminderMinutes) * 60000).toISOString()
}
export function nextOccurrenceDate(dueDate, rec) {
  const d = new Date(`${dueDate}T00:00:00`)
  const n = Math.max(1, Number(rec?.interval) || 1)
  if (rec?.frequency === 'daily') d.setDate(d.getDate() + n)
  else if (rec?.frequency === 'weekly') d.setDate(d.getDate() + 7 * n)
  else if (rec?.frequency === 'monthly') d.setMonth(d.getMonth() + n)
  else if (rec?.frequency === 'custom') d.setDate(d.getDate() + n)
  else return null
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// --- visibility ------------------------------------------------------------------------------------------
/**
 * Can `viewer` (a user record {id, role, department} with computed permissions) see `task`?
 * `dirOf(id)` returns a user record. A task is always visible to its creator, assignees and
 * followers; wider visibility only applies to people who hold the matching "view … tasks" permission.
 */
export function canViewTask(viewer, perms, task, dirOf) {
  if (!perms.view) return false
  const participant = task.createdBy === viewer.id || (task.assignees || []).includes(viewer.id) || (task.watchers || []).includes(viewer.id)
  if (participant || perms.viewAll) return true
  const memberDepts = new Set([...(task.assignees || []), task.createdBy].map((id) => dirOf(id)?.department).filter(Boolean))
  const sameTeam = memberDepts.has(viewer.department)
  switch (task.visibility) {
    case 'Organization': return true
    case 'Department': return perms.viewDepartment && (task.department ? task.department === viewer.department : sameTeam)
    case 'Team': return perms.viewTeam && sameTeam
    case 'Manager + Team': return (perms.viewTeam && sameTeam) || (MANAGER_ROLES.includes(viewer.role) && perms.viewDepartment && sameTeam)
    default: return false // Private
  }
}

/** May the viewer change this task at all? Participants, or someone whose team/department scope covers it (never plain Organization visibility). */
export function canActOnTask(viewer, perms, task, dirOf) {
  if (task.createdBy === viewer.id || (task.assignees || []).includes(viewer.id)) return true
  if (perms.viewAll) return true
  const memberDepts = new Set([...(task.assignees || []), task.createdBy].map((id) => dirOf(id)?.department).filter(Boolean))
  return (perms.viewTeam || perms.viewDepartment) && memberDepts.has(viewer.department) && (perms.edit || perms.complete)
}

export function validateTaskInput(t) {
  const e = {}
  if (!String(t.title || '').trim()) e.title = 'Give the task a title.'
  else if (t.title.length > 160) e.title = 'Title is too long (max 160).'
  if (t.description && t.description.length > 4000) e.description = 'Description is limited to 4000 characters.'
  if (t.priority && !TASK_PRIORITIES.includes(t.priority)) e.priority = 'Invalid priority.'
  if (t.taskType && !TASK_TYPES.includes(t.taskType)) e.taskType = 'Invalid task type.'
  if (t.visibility && !VISIBILITY_LEVELS.includes(t.visibility)) e.visibility = 'Invalid visibility.'
  if (t.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)) e.dueDate = 'Enter a valid due date.'
  if (t.startDate && t.dueDate && t.startDate > t.dueDate) e.dueDate = 'Due date cannot be before the start date.'
  if (t.dueTime && !/^\d{2}:\d{2}$/.test(t.dueTime)) e.dueTime = 'Enter a valid time.'
  if (t.reminderMinutes && t.reminderMinutes !== 'custom' && !t.dueDate) e.reminderMinutes = 'A reminder needs a due date.'
  if (t.reminderMinutes === 'custom' && !t.customReminderAt) e.customReminderAt = 'Pick the reminder date and time.'
  if (t.recurrence && t.recurrence.frequency && t.recurrence.frequency !== 'none' && !t.dueDate) e.recurrence = 'A repeating task needs a due date.'
  return e
}

// --- ids & attachments -----------------------------------------------------------------------------
/** Sequential Task ID: TSK-16000, TSK-16001 … (never reuses a number, even after a delete, because the max is taken over live ids + the counter). */
export function nextTaskId(existing, counter = 0) {
  const top = existing.reduce((m, t) => { const n = /^TSK-(\d+)$/.exec(t.id); return n ? Math.max(m, Number(n[1])) : m }, 15999)
  return `TSK-${Math.max(top, counter) + 1}`
}

export const TASK_FILE_RULES = {
  maxBytes: 1024 * 1024, // kept in the browser-backed mock DB
  extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg'],
  maxPerTask: 10,
}
export const TASK_ACCEPT_ATTR = TASK_FILE_RULES.extensions.map((e) => `.${e}`).join(',')
const BAD_NAME = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ps1|sh|jar|app|dll|lnk|hta|html?|svg|php)(\.|$)/i

export function checkTaskFile({ name, size }, rules = TASK_FILE_RULES) {
  const clean = String(name || '').replace(/[\/]+/g, '_').replace(/[\u0000-\u001f<>:"|?*]+/g, '').trim()
  if (!clean) return 'The file has no name.'
  if (clean.length > 150) return 'The file name is too long (maximum 150 characters).'
  const ext = (/\.([a-z0-9]+)$/i.exec(clean)?.[1] || '').toLowerCase()
  if (BAD_NAME.test(clean) || !ext) return 'This file type is not allowed.'
  if (!rules.extensions.includes(ext)) return `".${ext}" files are not allowed. Allowed: ${rules.extensions.join(', ')}.`
  if (!size || size <= 0) return 'The file is empty.'
  if (size > rules.maxBytes) return `The file is too large (${(size / 1048576).toFixed(1)} MB). The maximum is ${(rules.maxBytes / 1048576).toFixed(0)} MB.`
  return null
}
