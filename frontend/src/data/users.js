// The people directory: everyone the signed-in person can see by name (owner pickers, assignee names, "created by"). It is loaded from the server (GET /directory/people)
// right after sign-in and kept current by AuthContext; the exports below keep their original shape so every screen that resolves a name keeps working. The array is
// replaced in place, so a component that reads USERS during render sees the live list.
export const USERS = []

const SALES_ROLES = ['Sales Manager', 'Sales Executive']

/** Replaces the directory contents (called by AuthContext after sign-in and on a timer). */
export function setDirectory(rows) {
  const next = (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone || '',
    department: r.department || '',
    designation: r.designation || '',
    role: r.role,
    accessLevel: r.accessLevel,
    status: r.status === 'Active' || r.status === 'Probation' || r.status === 'On Leave' || r.status === 'Remote' ? (r.accountStatus && r.accountStatus !== 'Active' ? 'Inactive' : 'Active') : 'Inactive',
    employeeStatus: r.status,
    branch: r.branch || null,
    hasAccount: !!r.hasAccount,
    initials: r.initials || '',
    avatarColor: r.avatarColor || '',
    reportsTo: r.reportsTo || null,
    departmentId: r.departmentId || null,
    teamId: r.teamId || null,
  }))
  USERS.splice(0, USERS.length, ...next)
}

export const clearDirectory = () => USERS.splice(0, USERS.length)

export function getUserById(id) {
  return USERS.find((u) => u.id === id)
}

export function salesUsers() {
  return USERS.filter((u) => u.department === 'Sales' || SALES_ROLES.includes(u.role))
}
export function projectManagers() {
  return USERS.filter((u) => u.role === 'Project Manager')
}
export function supportUsers() {
  return USERS.filter((u) => u.department === 'Support')
}
