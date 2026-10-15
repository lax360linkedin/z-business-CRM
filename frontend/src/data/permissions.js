import { getEffectiveRoles, LOGIN_ROLES } from './constants'
import { NAV_SECTIONS } from '../routes/navConfig'

export const PERMISSIONS_STORAGE_KEY = 'business_crm_permissions_v3'

// Action permissions. Data SCOPE (Own/Team/Department/Branch/Organization — which records
// a role can see within a module it has access to) is a separate, orthogonal axis — see
// src/data/dataScope.js. This file only answers "can this role View/Create/Edit/Delete/
// Export this module at all," matching the RBAC principle: role → permission → data scope.
export const ACTIONS = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'export', label: 'Export' },
]

/** Modules only a Super Admin may open or change - branches, user accounts, credentials, roles and permissions. No stored permission set can grant them. */
export const SUPER_ADMIN_ONLY_MODULES = ['Roles & Permissions', 'User Management', 'Branches']

export const FULL = { view: true, create: true, edit: true, delete: true, export: true }
export const VIEW_ONLY = { view: true, create: false, edit: false, delete: false, export: false }
export const CRUD_NO_DELETE = { view: true, create: true, edit: true, delete: false, export: true }
export const NONE = { view: false, create: false, edit: false, delete: false, export: false }

// Section-tier heuristics per role — approximate, meant to look realistic rather than be a
// perfect ACL. Where the spec's permission matrix marks a cell "Limited"/"Permission" (a
// partial grant finer than this 5-boolean model supports), it's treated as allowed=true —
// the actual restriction in those cases is enforced via data scope (Own/Team), not by
// denying the action outright.
export const ROLE_RULES = {
  'Super Admin': () => FULL,
  // Accounts, roles and permissions belong to the Super Admin alone (also enforced in hasPermission, whatever a stored matrix says).
  Admin: (section, label) => (SUPER_ADMIN_ONLY_MODULES.includes(label) ? NONE : FULL),
  // A plain Employee starts with the basics only (dashboard + the everyday lists added in defaultPermissionsForRole); the Super Admin grants the rest module by module.
  Employee: (section, label) => (label === 'Dashboard' ? VIEW_ONLY : NONE),
  MD: (section, label) => {
    // Executive oversight — broad visibility, but not day-to-day data entry.
    if (label === 'Dashboard' || label === 'AI Insights' || label === 'Notifications') return VIEW_ONLY
    if (['CRM', 'Sales', 'Operations', 'Finance', 'Marketing', 'Reports'].includes(section)) return VIEW_ONLY
    if (section === 'Team') return VIEW_ONLY
    return NONE
  },
  CEO: (section, label) => {
    // Pure read-only executive access — spec explicitly forbids create/edit/delete/assign
    // for this role, so every allowed cell here is VIEW_ONLY, never higher.
    if (label === 'Dashboard' || label === 'AI Insights' || label === 'Notifications') return VIEW_ONLY
    if (['CRM', 'Sales', 'Operations', 'Finance', 'Marketing', 'Reports'].includes(section)) return VIEW_ONLY
    if (['Employees', 'Teams'].includes(label)) return VIEW_ONLY
    return NONE
  },
  HR: (section, label) => {
    if (label === 'Dashboard' || label === 'Notifications') return VIEW_ONLY
    if (['Employees', 'User Management', 'Teams'].includes(label)) return FULL
    if (label === 'Roles & Permissions') return NONE
    if (['Activities', 'Tasks'].includes(label)) return CRUD_NO_DELETE
    if (label === 'Team Performance') return VIEW_ONLY
    // HR must never automatically inherit Sales/Finance/Marketing/RBAC access.
    return NONE
  },
  'Sales Manager': (section, label) => {
    if (['CRM', 'Sales', 'Activities', 'Marketing'].includes(section)) return FULL
    if (['Reports', 'Team', 'Communication', 'Finance', 'Operations'].includes(section)) return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
  'Sales Executive': (section, label) => {
    if (['CRM', 'Sales', 'Activities'].includes(section)) return CRUD_NO_DELETE
    if (section === 'Communication') return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
  Marketing: (section, label) => {
    if (section === 'Marketing') return FULL
    if (label === 'Leads') return CRUD_NO_DELETE // lead generation / import, per spec
    if (['Customers', 'Deals', 'Opportunities'].includes(label)) return VIEW_ONLY
    if (label === 'Dashboard' || section === 'Reports') return VIEW_ONLY
    return NONE
  },
  'Project Manager': (section, label) => {
    if (['Operations', 'Activities'].includes(section)) return FULL
    if (['CRM', 'Reports', 'Communication'].includes(section)) return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
  'Project Staff': (section, label) => {
    if (label === 'Projects' || label === 'Tasks') return CRUD_NO_DELETE
    if (['Activities', 'Documents'].includes(label)) return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
  Accounts: (section, label) => {
    if (section === 'Finance') return FULL
    if (label === 'Quotations') return CRUD_NO_DELETE // Accounts/Finance manages quotations per spec §6
    if (['CRM', 'Operations', 'Reports'].includes(section)) return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
  Support: (section, label) => {
    if (section === 'Support') return FULL
    if (['CRM', 'Communication'].includes(section)) return VIEW_ONLY
    if (label === 'Dashboard') return VIEW_ONLY
    return NONE
  },
}

function sectionOf(section) {
  return section.title || 'General'
}

export function defaultPermissionsForRole(role) {
  const rule = ROLE_RULES[role] || (() => NONE)
  const perms = {}
  NAV_SECTIONS.forEach((section) => {
    section.items.forEach((item) => {
      perms[item.label] = { ...rule(sectionOf(section), item.label) }
    })
  })
  // Tasks are everyone's daily work list — every role opens the module. What each role may then do,
  // and whose tasks it sees, is the finer 13-permission matrix in taskRules.js (enforced by the API).
  if (perms.Tasks && !perms.Tasks.view) perms.Tasks = { ...VIEW_ONLY }
  // …and the calendar is where that work is scheduled; what each role sees on it is decided server-side per source module.
  if (perms.Calendar && !perms.Calendar.view) perms.Calendar = { ...VIEW_ONLY }
  // Contracts: sales roles raise them from deals and orders. The finer 14-permission matrix (approve, send, renew, terminate…) is in contractRules.js.
  if (role === 'Sales Manager' || role === 'Sales Executive') perms.Contracts = { ...CRUD_NO_DELETE }
  // Expenses: every employee raises their own claims; what each role may then do (approve, pay, manage categories…) is the finer matrix in expenseRules.js.
  if (!['Super Admin', 'Admin', 'Accounts'].includes(role)) perms.Expenses = role === 'CEO' ? { view: true, create: false, edit: false, delete: false, export: true } : role === 'MD' ? { view: true, create: false, edit: true, delete: false, export: true } : { view: true, create: true, edit: true, delete: true, export: false }
  return perms
}

export function buildDefaultPermissions() {
  const all = {}
  getEffectiveRoles().forEach((role) => { all[role] = defaultPermissionsForRole(role) })
  return all
}

export function loadPermissions() {
  try {
    const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore corrupt storage
  }
  return null
}

export function savePermissions(permissions) {
  try {
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(permissions))
  } catch {
    // storage may be unavailable — fail silently
  }
}

export function getPermissionsForRole(role) {
  const stored = loadPermissions()
  return stored?.[role] || defaultPermissionsForRole(role)
}

/** The login role of an account: Super Admin, Admin or Employee. Accounts created before this model existed fall back to their old job role. */
export function accessLevelOf(account) {
  if (!account) return null
  if (LOGIN_ROLES.includes(account.accessLevel)) return account.accessLevel
  if (account.role === 'Super Admin' || account.role === 'Admin') return account.role
  return 'Employee'
}

/** All-branch access is an explicit authorisation held only by a Super Admin account (`branchAccess: 'all'`) - never implied by a role name, and never available to Admin / Employee. */
export const hasAllBranchAccess = (account) => accessLevelOf(account) === 'Super Admin' && account?.branchAccess === 'all'

const nobody = () => Object.fromEntries(NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.label, { ...NONE }]))

/**
 * What ONE account may do, module by module. The server computes it (the permission set the Super Admin configured for the account, else its job profile's defaults, with the
 * hard locks applied) and sends it as `permissionsEffective` (account lists / details) or `permissions` (the signed-in user); this only reads that answer. When neither is present
 * (an account being drafted in a form) the profile defaults are shown as a starting point.
 */
export function getPermissionsForAccount(account) {
  const level = accessLevelOf(account)
  if (!level) return nobody()
  if (account.permissionsEffective) return account.permissionsEffective
  if (level === 'Super Admin') return Object.fromEntries(NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.label, { ...FULL }]))
  const all = { ...nobody(), ...(account.permissions || getPermissionsForRole(account.role || level)) }
  SUPER_ADMIN_ONLY_MODULES.forEach((m) => { all[m] = { ...NONE } })
  if (all.Employees) all.Employees = { ...all.Employees, create: false }
  return all
}

// Credential visibility (Username/Email/Current Password in User Management) is a fixed,
// elevated capability — deliberately NOT part of the editable action-permission matrix above,
// the same way quotation-approval eligibility is a hardcoded role list rather than a matrix
// cell. This keeps it from being silently granted/revoked by someone editing Roles &
// Permissions. Matches the four roles the spec named explicitly; every other role (including
// CEO, which has no 'User Management' access at all) never sees another user's password.
export const CREDENTIAL_VIEW_ROLES = ['Super Admin']

export function canViewCredentials(role) {
  return CREDENTIAL_VIEW_ROLES.includes(role)
}
