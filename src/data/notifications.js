import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { NOTIFICATION_TYPES } from './constants'
import { LEADS } from './leads'
import { CUSTOMERS } from './customers'
import { ENQUIRIES } from './enquiries'

resetSeed(2020)

const ICON_BY_TYPE = {
  'New Lead': 'UserPlus',
  'Lead Assignment': 'UserCheck',
  'Follow-up Reminder': 'Clock',
  'Task Reminder': 'ListChecks',
  'Deal Update': 'Handshake',
  'Quotation Accepted': 'FileCheck2',
  'Payment Received': 'IndianRupee',
  'Payment Overdue': 'AlertTriangle',
  'Project Update': 'FolderKanban',
  'Support Ticket': 'LifeBuoy',
  'New Enquiry': 'UserPlus',
  'Enquiry Assignment': 'UserCheck',
  'Enquiry Qualified': 'ListChecks',
  'Enquiry Converted': 'Handshake',
  'Enquiry Closed': 'FolderKanban',
  'High Priority Enquiry': 'AlertTriangle',
}

function messageFor(type) {
  const lead = pick(LEADS)
  const customer = pick(CUSTOMERS)
  const enquiry = pick(ENQUIRIES)
  switch (type) {
    case 'New Lead': return `New lead "${lead.name}" was captured from ${lead.source}.`
    case 'Lead Assignment': return `Lead "${lead.name}" was assigned to you.`
    case 'Follow-up Reminder': return `Follow-up due for "${lead.name}" today.`
    case 'Task Reminder': return `You have a task due soon.`
    case 'Deal Update': return `A deal for ${customer.name} moved stage.`
    case 'Quotation Accepted': return `${customer.name} accepted your quotation.`
    case 'Payment Received': return `Payment received from ${customer.name}.`
    case 'Payment Overdue': return `Invoice for ${customer.name} is overdue.`
    case 'Project Update': return `Project milestone updated for ${customer.name}.`
    case 'Support Ticket': return `New support ticket raised by ${customer.name}.`
    case 'New Enquiry': return `New enquiry "${enquiry.name}" was received from ${enquiry.source}.`
    case 'Enquiry Assignment': return `Enquiry "${enquiry.name}" was assigned to you.`
    case 'Enquiry Qualified': return `Enquiry "${enquiry.name}" was qualified.`
    case 'Enquiry Converted': return `Enquiry "${enquiry.name}" was converted to a lead.`
    case 'Enquiry Closed': return `Enquiry "${enquiry.name}" was closed.`
    case 'High Priority Enquiry': return `Critical enquiry "${enquiry.name}" needs immediate attention.`
    default: return 'You have a new notification.'
  }
}

export const NOTIFICATIONS = Array.from({ length: 22 }).map((_, i) => {
  const type = pick(NOTIFICATION_TYPES)
  return {
    id: `NTF-${String(17000 + i)}`,
    type,
    icon: ICON_BY_TYPE[type],
    message: messageFor(type),
    date: daysFromNow(-randInt(0, 20)),
    read: i > 6,
  }
})
