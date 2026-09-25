import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { TICKET_STATUSES, TICKET_CATEGORIES, PRIORITIES } from './constants'
import { supportUsers, USERS } from './users'

resetSeed(1717)
const support = supportUsers()

const SUBJECTS = [
  'Unable to access dashboard', 'Invoice amount discrepancy', 'Feature request: bulk export',
  'Login OTP not received', 'Project timeline clarification needed', 'API integration error',
  'Request for additional user seats', 'Report data mismatch', 'Payment not reflecting',
  'Need training session for new module',
]

export const TICKETS = Array.from({ length: 20 }).map((_, i) => {
  const customer = pick(CUSTOMERS)
  const status = i < 3 ? 'Open' : pick(TICKET_STATUSES)
  const createdDate = daysFromNow(-randInt(0, 90))
  return {
    id: `TK-${String(14000 + i)}`,
    customerId: customer.id,
    customerName: customer.name,
    subject: pick(SUBJECTS),
    category: pick(TICKET_CATEGORIES),
    priority: pick(PRIORITIES),
    assignedStaff: pick(support).id,
    createdDate,
    status,
    messages: [
      { by: customer.contactPerson, from: 'customer', text: 'Could you please look into this at the earliest? It is impacting our workflow.', date: createdDate },
      { by: pick(USERS).name, from: 'staff', text: 'Thanks for reaching out — we are looking into this now and will update you shortly.', date: daysFromNow(-randInt(0, 5)) },
    ],
  }
})

export function getTicketById(id) {
  return TICKETS.find((t) => t.id === id)
}
