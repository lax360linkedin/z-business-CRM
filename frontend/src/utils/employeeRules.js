// Pure rules for the Employee Directory, Organization Structure and Team Management (shared by the mock API, the migration and the screens).
// Concepts kept apart:  Employee = who the person is (employee master)  ·  Department / Team = which business group  ·  CRM user account = login access (User Management)
// ·  CRM role = function level  ·  Permissions = what the role may do. An employee exists without CRM access; access is only a link to User Management.

export const dayOf = (v) => String(v || '').slice(0, 10)
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const EMPLOYEE_STATUSES = ['Active', 'Probation', 'On Leave', 'Remote', 'Suspended', 'Resigned', 'Terminated', 'Inactive']
/** Statuses that take a person out of day-to-day assignment (they stay on record; history is never deleted). */
export const LEFT_STATUSES = ['Resigned', 'Terminated', 'Inactive', 'Suspended']
export const isWorking = (s) => !LEFT_STATUSES.includes(s)
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Consultant']
export const WORK_MODES = ['On-site', 'Hybrid', 'Remote']
export const SHIFTS = ['General (9:00–18:00)', 'Morning (6:00–15:00)', 'Evening (14:00–23:00)', 'Night (22:00–07:00)', 'Flexible']
// Work location: pick Office / Remote / Hybrid, or choose Others and type the place. What is stored is the single text (the chosen option, or what was typed).
export const WORK_LOCATIONS = ['Office', 'Remote', 'Hybrid', 'Others']
export const OTHER_LOCATION = 'Others'
/** Splits a saved work location into what the dropdown shows and the custom text: a saved value that is not one of the options (older records, e.g. "Chennai HQ") shows as Others with that text. */
export function splitLocation(value) {
  const v = String(value || '').trim()
  if (!v) return { choice: '', custom: '' }
  const hit = WORK_LOCATIONS.find((o) => o !== OTHER_LOCATION && o.toLowerCase() === v.toLowerCase())
  return hit ? { choice: hit, custom: '' } : { choice: OTHER_LOCATION, custom: v }
}
export const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say']
export const DEPT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e', '#64748b', '#84cc16']

// ---- permissions ----------------------------------------------------------------------------------------------------
export const EMPLOYEE_PERMISSIONS = [
  ['view', 'View the employee directory'], ['viewSensitive', 'View personal & HR details'], ['create', 'Add employees'], ['edit', 'Edit employees'], ['changeStatus', 'Change employee status'],
  ['manageOrg', 'Manage departments & teams'], ['bulk', 'Bulk operations'], ['import', 'Import employees'], ['export', 'Export employees'], ['assignRole', 'Assign CRM roles'], ['manageDocuments', 'Manage employee documents'],
]
const ALL = EMPLOYEE_PERMISSIONS.map(([k]) => k)
export const EMPLOYEE_ROLE_CAPS = {
  'Super Admin': ALL, Admin: ALL, HR: ALL.filter((k) => k !== 'assignRole'),
  MD: ['view', 'export'], CEO: ['view', 'export'],
  'Sales Manager': ['view'], 'Project Manager': ['view'],
}
/** Roles only a Super Admin may hand out. */
export const PRIVILEGED_ROLES = ['Super Admin', 'Admin']

// ---- reporting hierarchy --------------------------------------------------------------------------------------------
/** Would making `managerId` the manager of `employeeId` create a loop (or make someone their own manager)? */
export function wouldCreateCycle(employees, employeeId, managerId) {
  if (!managerId) return false
  if (managerId === employeeId) return true
  const by = new Map(employees.map((e) => [e.id, e]))
  const seen = new Set()
  let cur = managerId
  while (cur) {
    if (cur === employeeId) return true
    if (seen.has(cur)) return true
    seen.add(cur)
    cur = by.get(cur)?.reportsTo || null
  }
  return false
}
/** The chain above an employee, nearest manager first. */
export function managerChain(employees, id) {
  const by = new Map(employees.map((e) => [e.id, e])); const out = []; const seen = new Set()
  let cur = by.get(id)?.reportsTo
  while (cur && !seen.has(cur) && by.get(cur)) { seen.add(cur); out.push(by.get(cur)); cur = by.get(cur).reportsTo }
  return out
}

// ---- numbers & experience -------------------------------------------------------------------------------------------
export const nextEmployeeId = (list) => `EMP-${String(list.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) + 1).padStart(3, '0')}`
export const nextDeptId = (list) => `DEP-${String(list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(4)) || 0), 0) + 1).padStart(3, '0')}`
export const nextTeamId = (list) => `TEAM-${String(list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(5)) || 0), 0) + 1).padStart(3, '0')}`
export function experienceYears(joinDate, to = todayKey()) {
  if (!joinDate) return 0
  const a = new Date(`${dayOf(joinDate)}T00:00:00Z`); const b = new Date(`${to}T00:00:00Z`)
  return Math.max(0, Math.round(((b - a) / (365.25 * 86400000)) * 10) / 10)
}

// ---- workload (from the real CRM records — nothing is stored) -------------------------------------------------------
const CLOSED_TASK = ['Completed', 'Cancelled']
export function workloadOf(id, { tasks = [], projects = [], tickets = [], deals = [], leads = [] }, today = todayKey()) {
  const mine = tasks.filter((t) => (t.assignees || []).includes(id) && !CLOSED_TASK.includes(t.status))
  const done = tasks.filter((t) => (t.assignees || []).includes(id) && t.status === 'Completed')
  const w = {
    pendingTasks: mine.length, overdueTasks: mine.filter((t) => t.dueDate && dayOf(t.dueDate) < today).length, completedTasks: done.length,
    activeProjects: projects.filter((p) => (p.manager === id || (p.team || []).includes(id)) && !['Completed', 'Cancelled'].includes(p.status)).length,
    openTickets: tickets.filter((t) => t.assignedStaff === id && !['Resolved', 'Closed', 'Cancelled'].includes(t.status)).length,
    activeDeals: deals.filter((d) => d.salesperson === id && !String(d.stage).startsWith('Closed')).length,
    openLeads: leads.filter((l) => l.assignedTo === id && !['Converted', 'Lost', 'Unqualified'].includes(l.status)).length,
  }
  const score = w.pendingTasks + w.overdueTasks * 2 + w.activeProjects * 3 + w.openTickets + w.activeDeals + Math.round(w.openLeads / 2)
  w.score = score
  w.level = score === 0 ? 'None' : score <= 8 ? 'Light' : score <= 18 ? 'Moderate' : score <= 30 ? 'Heavy' : 'Overloaded'
  return w
}
export const WORKLOAD_LEVELS = ['None', 'Light', 'Moderate', 'Heavy', 'Overloaded']
