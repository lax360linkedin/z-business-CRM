// Activity vocabulary, per-type rules and record-linking maps — shared by the Activities UI and the
// mock backend (src/api/activityApi.js), which re-validates every logged activity.

/** The records an activity can be attached to, in the order they appear in the pickers. */
export const RELATED_TYPES = [
  { type: 'Enquiry', collection: 'enquiries', linkKey: 'enquiryId', route: (id) => `/enquiries/${id}`, label: (r) => `${r.id} · ${r.name || r.contactName || r.company || ''}`.trim() },
  { type: 'Lead', collection: 'leads', linkKey: 'leadId', route: (id) => `/leads/${id}`, label: (r) => `${r.name}${r.company ? ` · ${r.company}` : ''}` },
  { type: 'Deal', collection: 'deals', linkKey: 'dealId', route: (id) => `/deals/${id}`, label: (r) => `${r.id} · ${r.name}` },
  { type: 'Contact', collection: 'contacts', linkKey: 'contactId', route: (id) => `/contacts/${id}`, label: (r) => `${r.name}${r.companyName ? ` · ${r.companyName}` : ''}` },
  { type: 'Company', collection: 'companies', linkKey: 'companyId', route: (id) => `/companies/${id}`, label: (r) => r.name },
  { type: 'Customer', collection: 'customers', linkKey: 'customerId', route: (id) => `/customers/${id}`, label: (r) => r.name },
  { type: 'Proposal', collection: 'proposals', linkKey: 'proposalId', route: (id) => `/proposals/${id}`, label: (r) => `${r.number} · ${r.title}` },
  { type: 'Quotation', collection: 'quotations', linkKey: 'quotationId', route: (id) => `/quotations/${id}`, label: (r) => `${r.number} · ${r.customerName}` },
  { type: 'Sales Order', collection: 'salesOrders', linkKey: 'salesOrderId', route: (id) => `/sales-orders/${id}`, label: (r) => `${r.number} · ${r.customerName}` },
  { type: 'Invoice', collection: 'invoices', linkKey: 'invoiceId', route: (id) => `/invoices/${id}`, label: (r) => `${r.number} · ${r.customerName}` },
  { type: 'Payment', collection: 'payments', linkKey: 'paymentId', route: (id) => `/payments/${id}`, label: (r) => `${r.number || r.reference} · ${r.customerName}` },
  { type: 'Campaign', collection: 'campaigns', linkKey: 'campaignId', route: (id) => `/campaigns/${id}`, label: (r) => `${r.number || r.id} · ${r.name}` },
  { type: 'Expense', collection: 'expenses', linkKey: 'expenseId', route: (id) => `/expenses/${id}`, label: (r) => `${r.number} · ${r.description}` },
]
export const RELATED_BY_TYPE = Object.fromEntries(RELATED_TYPES.map((r) => [r.type, r]))
export const LINK_KEYS = RELATED_TYPES.map((r) => r.linkKey)
// Legacy relations written by older modules (kept so they still open correctly).
const LEGACY_ROUTES = { Document: (id) => `/documents/${id}`, Project: (id) => `/projects/${id}`, Contract: (id) => `/contracts/${id}`, Ticket: () => '/tickets' }

export function relatedHref(type, id) {
  if (!id) return null
  if (RELATED_BY_TYPE[type]) return RELATED_BY_TYPE[type].route(id)
  return LEGACY_ROUTES[type]?.(id) || null
}

/** The nine fields every proposed type may use. `needs` are required inputs; `only` restricts the record it can attach to. */
export const ACTIVITY_TYPE_DEFS = [
  { type: 'Call', group: 'Communication', needs: ['outcome'], schedulable: false, help: 'A phone call with the client.' },
  { type: 'Email', group: 'Communication', needs: ['subject'], schedulable: false, help: 'An email sent to or received from the client.' },
  { type: 'WhatsApp', group: 'Communication', needs: ['description'], schedulable: false, help: 'A WhatsApp conversation.' },
  { type: 'SMS', group: 'Communication', needs: ['description'], schedulable: false, help: 'A text message.' },
  { type: 'Meeting', group: 'Planned', needs: ['subject', 'time'], schedulable: true, help: 'A scheduled or completed meeting.' },
  { type: 'Follow-up', group: 'Planned', needs: ['subject', 'due'], schedulable: true, task: true, help: 'A reminder to follow up. Also creates a task.' },
  { type: 'Task', group: 'Planned', needs: ['subject', 'due'], schedulable: true, task: true, help: 'A to-do assigned to a user.' },
  { type: 'Demo / Presentation', group: 'Planned', needs: ['subject', 'time'], schedulable: true, help: 'A product demo or solution presentation.' },
  { type: 'Site Visit', group: 'Planned', needs: ['subject', 'time', 'location'], schedulable: true, help: 'A visit to the client or site.' },
  { type: 'Note', group: 'Record', needs: ['description'], schedulable: false, help: 'An internal note.' },
  { type: 'Proposal Sent', group: 'Sales documents', needs: [], only: ['Proposal'], schedulable: false, verify: 'proposalSent', help: 'Records that a proposal went to the client. Only possible once the proposal has actually been sent.' },
  { type: 'Quotation Sent', group: 'Sales documents', needs: [], only: ['Quotation'], schedulable: false, verify: 'quotationSent', help: 'Records that a quotation went to the client. Only possible once it has actually been sent.' },
  { type: 'Quotation Accepted / Rejected', group: 'Sales documents', needs: ['outcome'], only: ['Quotation'], schedulable: false, verify: 'quotationOutcome', help: 'Records the client’s decision. It must match the quotation’s current status.' },
  { type: 'Deal Stage Changed', group: 'Record changes', needs: ['toStatus'], only: ['Deal'], schedulable: false, verify: 'dealStage', help: 'Records a stage move that really happened on the deal (change stages on the deal itself).' },
  { type: 'Status Changed', group: 'Record changes', needs: ['toStatus'], schedulable: false, verify: 'status', help: 'Records a status change that really happened on the record.' },
  { type: 'Document Uploaded', group: 'Record changes', needs: ['documentName'], schedulable: false, help: 'Records a document received from or shared with the client.' },
  { type: 'Payment Follow-up', group: 'Finance', needs: ['due'], only: ['Invoice', 'Payment', 'Sales Order', 'Customer'], schedulable: true, task: true, verify: 'paymentDue', help: 'A follow-up to collect an outstanding payment. Also creates a task.' },
  { type: 'Customer Interaction', group: 'Customer', needs: ['channel', 'description'], only: ['Customer', 'Contact', 'Company'], schedulable: false, help: 'Any other touchpoint with a customer.' },
  { type: 'Other / Custom Activity', group: 'Other', needs: ['customType', 'description'], schedulable: false, help: 'Anything that does not fit above.' },
]
export const ACTIVITY_TYPE_NAMES = ACTIVITY_TYPE_DEFS.map((d) => d.type)
export const ACTIVITY_DEF = Object.fromEntries(ACTIVITY_TYPE_DEFS.map((d) => [d.type, d]))

// Auto-recorded by the CRM itself when something happens (creation, edits, conversions…). Shown in
// the feed and timelines, filterable as "System events", but never logged by hand.
export const SYSTEM_EVENT_TYPES = ['Created', 'Updated', 'Revision', 'Conversion', 'Assignment', 'Qualification', 'MeetingShared', 'Invoice', 'Payment', 'Expense', 'Campaign', 'Quotation', 'StatusChange', 'Attachment']

export const ACTIVITY_STATUSES = ['Scheduled', 'Completed', 'Cancelled']
export const ACTIVITY_PRIORITIES = ['Low', 'Medium', 'High']
export const INTERACTION_CHANNELS = ['Phone', 'Email', 'In person', 'Chat', 'Support desk', 'Event']
export const CALL_OUTCOME_LIST = ['Connected', 'Not Connected', 'Busy', 'No Answer', 'Call Back Requested', 'Wrong Number']

/** Maps whatever type string a module stored onto the vocabulary above (legacy names included). */
export function canonicalType(a) {
  const t = a.type
  if (ACTIVITY_DEF[t]) return t
  if (t === 'Demo') return 'Demo / Presentation'
  if (t === 'StatusChange') return a.relatedType === 'Deal' ? 'Deal Stage Changed' : 'Status Changed'
  if (t === 'Attachment') return 'Document Uploaded'
  return 'System event'
}
export const isSystemEvent = (a) => a.source === 'system' || (a.source !== 'manual' && !ACTIVITY_DEF[a.type] && a.type !== 'Demo')

/** Scheduled activities whose time has passed are overdue — derived, so it can never go stale. */
export function effectiveStatus(a, now = Date.now()) {
  // meetings booked by the Lead / Enquiry / Contact / Deal dialogs track their lifecycle in meetingStatus (their `status` is just "logged")
  const s = a.meetingStatus ? (a.meetingStatus === 'Rescheduled' ? 'Scheduled' : a.meetingStatus === 'No Show' ? 'Cancelled' : a.meetingStatus) : (a.followUpDate && (a.status || 'Completed') === 'Completed' && !a.completedAt && !a.completedBy ? 'Scheduled' : (a.status || 'Completed'))
  if (s === 'Scheduled' && (a.meetingDate ? new Date(`${a.meetingDate}T${a.meetingStartTime || '23:59'}:00`) : a.followUpDate ? new Date(`${a.followUpDate}T${a.followUpTime || '23:59'}:00`) : new Date(a.date)).getTime() < now) return 'Overdue'
  return s
}

export const todayStr = () => new Date().toISOString().slice(0, 10)
export function toIso(date, time) {
  if (!date) return null
  const d = new Date(`${date}T${time || '09:00'}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Field-level validation for a manual activity (the server repeats this and adds state checks). */
export function validateActivity(input) {
  const e = {}
  const def = ACTIVITY_DEF[input.type]
  if (!def) { e.type = 'Choose an activity type.'; return e }
  if (!input.relatedType || !input.relatedId) e.relatedId = 'Pick the record this activity belongs to.'
  else if (def.only && !def.only.includes(input.relatedType)) e.relatedType = `${input.type} can only be logged on: ${def.only.join(', ')}.`
  const need = (k) => def.needs.includes(k)
  if (need('subject') && !String(input.subject || '').trim()) e.subject = 'Add a title.'
  if (need('description') && !String(input.description || '').trim()) e.description = 'Add the details.'
  if (need('outcome') && !input.outcome) e.outcome = input.type === 'Call' ? 'Choose the call outcome.' : 'Choose Accepted or Rejected.'
  if (need('time') && (!input.date || !input.time)) e.date = 'Set the date and start time.'
  if (need('due') && !input.date) e.date = 'Set a due date.'
  if (need('location') && !String(input.location || '').trim()) e.location = 'Where is the visit?'
  if (need('toStatus') && !String(input.toStatus || '').trim()) e.toStatus = input.type === 'Deal Stage Changed' ? 'Choose the new stage.' : 'Enter the new status.'
  if (need('documentName') && !String(input.documentName || '').trim()) e.documentName = 'Name the document.'
  if (need('channel') && !input.channel) e.channel = 'Choose the channel.'
  if (need('customType') && !String(input.customType || '').trim()) e.customType = 'Name this activity type.'
  if (input.subject && input.subject.length > 160) e.subject = 'Title is too long (max 160).'
  if (input.description && input.description.length > 2000) e.description = 'Details are limited to 2000 characters.'
  if (input.date) {
    const iso = toIso(input.date, input.time)
    if (!iso) e.date = 'Enter a valid date.'
    else {
      const days = (new Date(iso).getTime() - Date.now()) / 86400000
      if (days > 366) e.date = 'That is more than a year ahead.'
      if (days < -366) e.date = 'That is more than a year ago.'
      if (!def.schedulable && days > 1) e.date = `${input.type} records something that has happened — it can't be in the future.`
    }
  }
  return e
}
