import { live } from '../api/store'

// The contacts the signed-in person may see, from the server (see api/store.js). The array is refreshed in place; a screen calls useCollections('contacts') to load it and re-render when it changes.
export const CONTACTS = live('contacts')
export const getContactById = (id) => CONTACTS.find((c) => c.id === id)
export const contactsByCompany = (companyId) => CONTACTS.filter((c) => c.companyId === companyId)
