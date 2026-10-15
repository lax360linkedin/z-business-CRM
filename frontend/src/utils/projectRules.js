// Project module rules: workflow, vocabulary, who may do what, how progress and billing are calculated.
// Pure functions — the Projects pages, the data migration and the reminder hook all use the same ones, so a project
// means the same thing everywhere (list, kanban, detail, calendar, notifications).
import { round2, computeOrder } from './salesOrderCalc'
import { isOpenTask } from './taskRules'

export const PROJECT_STATUS_LIST = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled']
export const PROJECT_TRANSITIONS = {
  Planned: ['Active', 'On Hold', 'Cancelled'],
  Active: ['On Hold', 'Completed', 'Cancelled'],
  'On Hold': ['Active', 'Cancelled'],
  Completed: ['Active'], // reopen (authorised users only)
  Cancelled: ['Planned'],
}
export const PROJECT_OPEN = ['Planned', 'Active', 'On Hold']
export const PROJECT_TYPES = ['Implementation', 'Development', 'Design', 'Marketing Campaign', 'Consulting', 'Support & Maintenance', 'Infrastructure', 'Other']
export const PROJECT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const TEAM_ROLES = ['Project Manager', 'Tech Lead', 'Developer', 'Designer', 'QA Engineer', 'Business Analyst', 'Account Manager', 'Support', 'Stakeholder']
export const PROJECT_DOC_CATEGORIES = ['Project Files', 'Contracts', 'Proposals', 'Quotations', 'Invoices', 'Client Documents', 'Other']
export const LEGACY_STATUS = { 'Not Started': 'Planned', 'In Progress': 'Active', Delayed: 'Active', 'On Hold': 'On Hold', Completed: 'Completed', Planned: 'Planned', Active: 'Active', Cancelled: 'Cancelled' }
export const normalizeProjectStatus = (s) => LEGACY_STATUS[s] || 'Planned'

export const todayKey = () => new Date().toISOString().slice(0, 10)
export const isOpenProject = (p) => PROJECT_OPEN.includes(p.status)
export const isOverdueProject = (p, today = todayKey()) => isOpenProject(p) && !!p.deadline && p.deadline < today
export const daysUntil = (date, today = todayKey()) => (date ? Math.round((new Date(`${date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null)

// ---- permissions -------------------------------------------------------------------------------------------
// Module-level view/create/edit/delete come from the role matrix (Roles & Permissions); data scope (own / team / organisation)
// from dataScope.js. These helpers add the project-specific rules on top. NOTE: this build has no real backend, so
// enforcement lives in the client — the routes, lists and actions all go through these helpers.
const ADMIN_ROLES = ['Super Admin', 'Admin']
const FINANCE_ROLES = ['Super Admin', 'Admin', 'MD', 'CEO', 'Accounts', 'Sales Manager', 'Project Manager']
const MANUAL_CREATE_ROLES = ['Super Admin', 'Admin', 'Project Manager']
const CREATE_ROLES = ['Super Admin', 'Admin', 'Project Manager', 'Sales Manager']

export function isProjectMember(user, p) { return !!user && (p.manager === user.id || (p.team || []).includes(user.id)) }

/** May this user open the project at all? Uses the role's data scope: own = manager/team, team = same department as the manager, organisation = everyone with module access. */
export function canViewProject(user, p, { hasPermission, scope, usersById }) {
  if (!user || !hasPermission('Projects', 'view')) return false
  if (scope === 'Organization') return true
  if (isProjectMember(user, p) || p.createdBy === user.id) return true
  if (scope === 'Team' || scope === 'Department' || scope === 'Branch') return usersById?.get(p.manager)?.department === user.department
  return false
}

export function projectPermissions(user, p, { hasPermission, scope, usersById }) {
  const view = p ? canViewProject(user, p, { hasPermission, scope, usersById }) : hasPermission('Projects', 'view')
  const admin = ADMIN_ROLES.includes(user?.role)
  const manager = !!p && p.manager === user?.id
  const member = !!p && isProjectMember(user, p)
  const editRole = hasPermission('Projects', 'edit')
  const lead = admin || manager || (user?.role === 'Project Manager' && view)
  const closed = !!p && !isOpenProject(p)
  return {
    view,
    create: hasPermission('Projects', 'create') && CREATE_ROLES.includes(user?.role),
    createManual: hasPermission('Projects', 'create') && MANUAL_CREATE_ROLES.includes(user?.role),
    edit: view && editRole && (lead || member) && !(closed && !lead),
    delete: view && hasPermission('Projects', 'delete') && (admin || manager),
    assign: view && editRole && (admin || user?.role === 'Project Manager'),
    manageTeam: view && editRole && lead,
    createTasks: view && editRole && (lead || member),
    updateMilestones: view && editRole && (lead || member),
    uploadDocuments: view && editRole && (lead || member),
    viewFinancial: view && (FINANCE_ROLES.includes(user?.role) || manager),
    changeStatus: view && editRole && lead,
    complete: view && editRole && lead,
    reopen: view && editRole && (admin || manager),
  }
}

// ---- progress ----------------------------------------------------------------------------------------------
/** Tasks & milestones linked to a project, excluding subtasks (they roll up into their parent). */
export const topLevelTasks = (tasks) => tasks.filter((t) => !t.parentId && t.status !== 'Cancelled')

/** Share of the project's work actually done: a completed task counts 1, an open task with subtasks counts its finished share, anything else 0. */
export function taskProgress(tasks) {
  const top = topLevelTasks(tasks)
  if (!top.length) return null
  const sum = top.reduce((s, t) => s + (t.status === 'Completed' ? 1 : t.subtaskCount ? t.subtasksDone / t.subtaskCount : 0), 0)
  return Math.round((sum / top.length) * 100)
}
export function effectiveProgress(project, tasks) {
  if (project.status === 'Completed') return 100
  if (project.progressMode === 'manual') return Number(project.progress) || 0
  const t = taskProgress(tasks)
  return t === null ? Number(project.progress) || 0 : t
}
export function taskStats(tasks) {
  const top = topLevelTasks(tasks)
  return {
    total: top.length, done: top.filter((t) => t.status === 'Completed').length, open: top.filter(isOpenTask).length,
    overdue: top.filter((t) => t.overdue).length, milestones: top.filter((t) => t.taskType === 'Milestone').length,
    milestonesDone: top.filter((t) => t.taskType === 'Milestone' && t.status === 'Completed').length,
  }
}

// ---- billing -----------------------------------------------------------------------------------------------
/** Invoices that belong to a project: stamped with its ID, or raised from its sales order. */
export const invoicesOfProject = (p, invoices) => invoices.filter((i) => i.projectId === p.id || (p.salesOrderId && i.salesOrderId === p.salesOrderId))

/**
 * Project billing from real records. Invoiced = issued (non-draft, non-cancelled) invoices; Paid = payments actually recorded
 * against those invoices — creating an invoice never marks anything paid.
 */
export function projectBilling(p, invoices, payments) {
  const all = invoicesOfProject(p, invoices)
  const issued = all.filter((i) => !['Draft', 'Cancelled', 'Void'].includes(i.status))
  const ids = new Set(all.map((i) => i.id))
  const pays = payments.filter((x) => ids.has(x.invoiceId) && (x.status === undefined || x.status === 'Completed' || x.status === 'Partially Refunded'))
  const invoiced = round2(issued.reduce((s, i) => s + (i.amount || 0), 0))
  const paid = round2(pays.reduce((s, x) => s + (x.amount || 0) - (x.refundedAmount || 0), 0))
  const value = Number(p.value) || 0
  const outstanding = round2(Math.max(0, invoiced - paid))
  let paymentStatus = 'Not invoiced'
  if (invoiced > 0) paymentStatus = paid <= 0 ? 'Unpaid' : paid >= invoiced - 0.005 ? (invoiced >= value - 0.005 || !value ? 'Paid' : 'Partially invoiced · paid') : 'Partially paid'
  return { invoices: all, issued, payments: pays, value, invoiced, paid, outstanding, unbilled: round2(Math.max(0, value - invoiced)), paymentStatus }
}

/** Taxable project value from a sales order (what the customer pays before tax). */
export const orderValue = (so) => (so ? round2(so.taxableAmount ?? computeOrder(so.items || [], so.taxType || 'intra').taxableAmount) : 0)

export function validateProjectInput(f) {
  const e = {}
  if (!String(f.name || '').trim()) e.name = 'Give the project a name.'
  else if (f.name.length > 160) e.name = 'Name is too long (max 160 characters).'
  if (!f.customerId) e.customerId = 'Choose the customer.'
  if (!f.manager) e.manager = 'Choose the project manager.'
  if (!PROJECT_TYPES.includes(f.projectType)) e.projectType = 'Choose a project type.'
  if (!PROJECT_PRIORITIES.includes(f.priority)) e.priority = 'Choose a priority.'
  if (!f.startDate) e.startDate = 'Set the start date.'
  if (!f.deadline) e.deadline = 'Set the expected end date.'
  else if (f.startDate && f.deadline < f.startDate) e.deadline = 'End date cannot be before the start date.'
  if (f.value !== '' && f.value !== undefined && (Number(f.value) < 0 || Number.isNaN(Number(f.value)))) e.value = 'Project value cannot be negative.'
  if (String(f.description || '').length > 4000) e.description = 'Description is limited to 4000 characters.'
  return e
}

export function nextProjectId(projects) {
  const top = projects.reduce((m, p) => { const h = /^PRJ-(\d+)$/.exec(p.id); return h ? Math.max(m, Number(h[1])) : m }, 5999)
  return `PRJ-${top + 1}`
}

// ---- documents ---------------------------------------------------------------------------------------------
export const PROJECT_FILE_RULES = { maxBytes: 1024 * 1024, extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'ppt', 'pptx'] }
export const PROJECT_ACCEPT = PROJECT_FILE_RULES.extensions.map((e) => `.${e}`).join(',')
const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ps1|sh|jar|app|dll|lnk|hta|html?|svg|php)(\.|$)/i
export function checkProjectFile(file) {
  const name = String(file?.name || '').replace(/[\\/]+/g, '_').trim()
  if (!name) return 'The file has no name.'
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase()
  if (BLOCKED.test(name) || !ext) return 'This file type is not allowed.'
  if (!PROJECT_FILE_RULES.extensions.includes(ext)) return `".${ext}" files are not allowed. Allowed: ${PROJECT_FILE_RULES.extensions.join(', ')}.`
  if (!file.size) return 'The file is empty.'
  if (file.size > PROJECT_FILE_RULES.maxBytes) return `The file is too large (${(file.size / 1048576).toFixed(1)} MB). The maximum is 1 MB.`
  return null
}
