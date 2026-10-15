import { DATA_SCOPES } from './constants'

// Record-level RBAC: which records a role can see WITHIN a module it already has view
// access to (see permissions.js for the "can they see the module at all" question).
// This is the "Own/Team/Department/Branch/Organization" axis from the RBAC spec.
//
// Approximation note: this CRM's mock data has no formal "team" or "branch" entity — team
// membership is approximated by shared `department`, and branch access behaves the same as
// department access (no branch field exists on records/companies yet). Documented here so
// it's obvious this is a deliberate simplification, not an oversight.
const SCOPED_MODULES = ['Leads', 'Enquiries', 'Contacts', 'Companies', 'Customers', 'Deals', 'Quotations', 'Proposals', 'Tasks', 'Tickets']

const SCOPE_RULES = {
  'Super Admin': () => 'Organization',
  Admin: () => 'Organization',
  MD: () => 'Organization',
  CEO: () => 'Organization',
  HR: (module) => (['Employees', 'User Management', 'Teams'].includes(module) ? 'Organization' : 'Own'),
  'Sales Manager': (module) => (SCOPED_MODULES.includes(module) ? 'Team' : 'Organization'),
  'Sales Executive': (module) => (SCOPED_MODULES.includes(module) ? 'Own' : 'Organization'),
  Marketing: (module) => (module === 'Leads' ? 'Team' : 'Organization'),
  'Project Manager': (module) => (module === 'Projects' || module === 'Tasks' ? 'Team' : 'Organization'),
  'Project Staff': (module) => (module === 'Projects' || module === 'Tasks' ? 'Own' : 'Organization'),
  Accounts: () => 'Organization',
  Support: (module) => (module === 'Tickets' ? 'Team' : 'Organization'),
}

/** Returns one of DATA_SCOPES for a role+module combination. Defaults to 'Organization' (no extra restriction) for anything unspecified — the module-level permission check in permissions.js is still the primary gate. */
export function getDataScope(role, moduleLabel) {
  const rule = SCOPE_RULES[role]
  const scope = rule ? rule(moduleLabel) : 'Organization'
  return DATA_SCOPES.includes(scope) ? scope : 'Organization'
}

/**
 * Per-record predicate: does `record` fall within `user`'s data scope for the given
 * `ownerField` (the field on the record holding the owning user's employee id, e.g.
 * 'assignedTo' or 'salesperson')? `allUsers` is the full USERS list, needed to resolve
 * "Team" (same-department) membership. Designed to plug straight into `useCrud`'s
 * `filterFn` option.
 */
export function matchesDataScope(record, scope, user, ownerField, allUsers = []) {
  if (!user || scope === 'Organization') return true
  if (scope === 'Own') return record[ownerField] === user.id
  if (scope === 'Team' || scope === 'Department' || scope === 'Branch') {
    return allUsers.some((u) => u.department === user.department && u.id === record[ownerField])
  }
  return true
}

/** Array form of matchesDataScope, for one-off filtering outside a useCrud filterFn. */
export function applyDataScope(records, scope, user, ownerField, allUsers = []) {
  return records.filter((r) => matchesDataScope(r, scope, user, ownerField, allUsers))
}
