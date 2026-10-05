import { getEffectiveRoles } from './constants'
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
  Admin: (section, label) => (label === 'Roles & Permissions' ? CRUD_NO_DELETE : FULL),
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

// Credential visibility (Username/Email/Current Password in User Management) is a fixed,
// elevated capability — deliberately NOT part of the editable action-permission matrix above,
// the same way quotation-approval eligibility is a hardcoded role list rather than a matrix
// cell. This keeps it from being silently granted/revoked by someone editing Roles &
// Permissions. Matches the four roles the spec named explicitly; every other role (including
// CEO, which has no 'User Management' access at all) never sees another user's password.
export const CREDENTIAL_VIEW_ROLES = ['Super Admin', 'Admin', 'MD', 'HR']

export function canViewCredentials(role) {
  return CREDENTIAL_VIEW_ROLES.includes(role)
}
