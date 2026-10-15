import { ALL_BRANCHES, BRANCH_NAMES, SCOPE_KEY } from '../data/branches'

/** The Super Admin's chosen scope: 'all' or one branch name. Kept in this browser and sent with every request (X-Branch-Scope); the server only honours it for an account
 *  that holds explicit all-branch access - for everybody else the header is ignored. */
export function readSelectedScope() {
  try {
    const v = localStorage.getItem(SCOPE_KEY)
    return v === ALL_BRANCHES || BRANCH_NAMES.includes(v) ? v : ALL_BRANCHES
  } catch {
    return ALL_BRANCHES
  }
}
export function writeSelectedScope(value) {
  try { localStorage.setItem(SCOPE_KEY, value) } catch { /* storage unavailable */ }
}
