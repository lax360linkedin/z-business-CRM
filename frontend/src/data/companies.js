import { live } from '../api/store'

// The companies the signed-in person may see, from the server (see api/store.js). The array is refreshed in place; a screen calls useCollections('companies') to load it and re-render when it changes.
export const COMPANIES = live('companies')
export const getCompanyById = (id) => COMPANIES.find((c) => c.id === id)
