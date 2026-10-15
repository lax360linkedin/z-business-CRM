import { live } from '../api/store'

// The customers the signed-in person may see, from the server (see api/store.js). The array is refreshed in place; a screen calls useCollections('customers') to load it and re-render when it changes.
export const CUSTOMERS = live('customers')
export const getCustomerById = (id) => CUSTOMERS.find((c) => c.id === id)
export const getCustomerByCompanyId = (companyId) => CUSTOMERS.find((c) => c.companyId === companyId)
