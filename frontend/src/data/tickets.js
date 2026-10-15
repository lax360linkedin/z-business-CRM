import { live } from '../api/store'

// The tickets the signed-in person may see, from the server (see api/store.js). The array is refreshed in place; a screen calls useCollections('tickets') to load it and re-render when it changes.
export const TICKETS = live('tickets')
export const getTicketById = (id) => TICKETS.find((t) => t.id === id)
export const ticketsByCustomer = (customerId) => TICKETS.filter((t) => t.customerId === customerId)
export const ticketsByCompany = (companyId) => TICKETS.filter((t) => t.companyId === companyId)
export const ticketsByContact = (contactId) => TICKETS.filter((t) => t.contactId === contactId)
