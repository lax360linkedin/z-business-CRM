import { live } from '../api/store'

// Project lookups for pages that only need to name or count projects. They read the projects the server returned for this person (see api/store.js; a screen calls
// useCollections('projects') first), so a project created, renamed or cancelled shows up everywhere on the next render.
export const allProjects = () => live('projects')
export const getProjectById = (id) => (id ? allProjects().find((p) => p.id === id) || null : null)
export const projectsByCustomer = (customerId) => allProjects().filter((p) => p.customerId === customerId)
