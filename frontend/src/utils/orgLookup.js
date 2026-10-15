let live = []

/** Called after sign-in with the organisation's departments (GET /departments); until then - or if the list cannot be read - the built-in names are used. */
export function setDepartments(rows) {
  live = (rows || []).filter((d) => d.status === 'Active').map((d) => d.name)
}

/** Department names from the live organisation structure (Employees → Departments). Empty until they have loaded: there is no built-in list. */
export const departmentNames = () => live
