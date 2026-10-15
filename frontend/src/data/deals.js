import { live } from '../api/store'

// The deals the signed-in person may see, from the server (see api/store.js). The array is refreshed in place; a screen calls useCollections('deals') to load it and re-render when it changes.
export const DEALS = live('deals')
export const getDealById = (id) => DEALS.find((d) => d.id === id)
export const dealsByCompany = (companyId) => DEALS.filter((d) => d.companyId === companyId)
