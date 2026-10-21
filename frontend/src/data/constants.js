// Dropdown values (industries, cities, enquiry types, reasons, payment terms, ticket categories ...) are NOT defined here: they are configured in Settings -> Dropdown Options and read with useOptions().

// Lead lifecycle. New → Contacted → Qualified → Converted is the primary path; Unqualified and
// Lost are the two alternative terminal outcomes off New/Contacted/Qualified — see
// src/data/leadWorkflow.js for the enforced transition graph. Unqualified and Lost are
// deliberately distinct (never merged into one "closed" bucket): Unqualified means the Lead was
// never a real sales opportunity to begin with; Lost means it genuinely was one but the
// business didn't happen. This is separate from — and does not affect — a Deal's own Won/Lost
// outcome (src/pages/Deals/dealActions.js): once a Lead is Converted it stays Converted even if
// the Deal it became is later marked Lost, because the Lead itself did succeed.
export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Lost', 'Converted']
// Lead Source configuration vocabulary (Settings → Lead Sources) — see
// src/data/leadSourceConfig.js for the persisted per-source config and
// src/pages/Leads/leadCaptureService.js for how a connected source actually produces a Lead.
export const LEAD_SOURCE_TYPES = ['Digital', 'Offline', 'Integration']
export const LEAD_CAPTURE_METHODS = ['API', 'Form', 'Webhook', 'Manual']
export const SALES_ORDER_STATUSES = ['Draft', 'Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled', 'Cancelled']
export const DECISION_MAKER_STATUSES = ['Yes', 'No', 'Partially']
// Deal-level Lost reasons — a Deal that was created from a Converted Lead later falling
// through, or moved to Closed Lost / Closed Lost – Competition. See markDealLost() in
// src/pages/Deals/dealActions.js.

// Deal pipeline — probability is stage-derived and never manually entered (see
// changeDealStage() in src/pages/Deals/dealActions.js, the single choke point that sets both
// together). Deal Created → Final Decision is the primary active path; Closed Won/Closed Lost/
// Closed Lost – Competition are the three terminal outcomes — Closed Lost and Closed Lost –
// Competition are deliberately distinct (a genuine loss to a competitor vs. any other reason)
// and both always sit at 0%, exactly like Closed Won always sits at 100%. See
// src/data/dealWorkflow.js for the enforced transition graph.
export const DEAL_STAGE_PROBABILITY = {
  'Deal Created': 10,
  'Requirement Analysis': 20,
  'Solution Discussion': 35,
  'Decision Maker Review': 50,
  'Proposal / Quotation': 70,
  'Negotiation': 85,
  'Final Decision': 95,
  'Closed Won': 100,
  'Closed Lost': 0,
  'Closed Lost – Competition': 0,
}
export const DEAL_STAGES = Object.keys(DEAL_STAGE_PROBABILITY)
export const CLOSED_DEAL_STAGES = ['Closed Won', 'Closed Lost', 'Closed Lost – Competition']
export const LOST_DEAL_STAGES = ['Closed Lost', 'Closed Lost – Competition']

// Lead-level Unqualified reasons — the Lead was reviewed but never met the qualification
// criteria in the first place (never a real opportunity). See markLeadUnqualified() in
// src/pages/Leads/leadActions.js.

// Lead-level Lost reasons — distinct from LOST_REASONS (Deal-level): this is a Lead that WAS a
// genuine opportunity (Contacted or Qualified) but the business stopped progressing before ever
// becoming a Deal. See markLeadLost() in src/pages/Leads/leadActions.js.

// Lead activity workflow — Call/Meeting logging vocabulary. See
// src/pages/Leads/leadCommunication.js for how these drive the real tel:/wa.me/mailto:
// actions and the New→Contacted auto-transition.
export const CALL_TYPES = ['Outgoing', 'Incoming']
export const CALL_OUTCOMES = ['Connected', 'Not Connected', 'Busy', 'No Answer', 'Call Back Requested', 'Wrong Number']
export const MEETING_TYPES = ['Online Meeting', 'In-person Meeting', 'Phone Meeting']
export const MEETING_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled', 'No Show']
export const FOLLOWUP_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Demo', 'Site Visit', 'Other']
export const REMINDER_OPTIONS = ['At time of event', '15 minutes before', '30 minutes before', '1 hour before', '1 day before']

// Enquiry — the initial customer/prospect interest captured BEFORE it becomes a qualified
// Lead. See src/data/enquiryWorkflow.js for the enforced status transition graph, and
// src/pages/Enquiries/enquiryActions.js for duplicate/existing-customer detection and the
// Enquiry → Lead conversion chain. Deliberately kept separate from LEAD_SOURCES/LEAD_STATUSES
// even where they overlap in spirit — Enquiry and Lead have distinct field/status vocabularies
// per the "keep Enquiry and Lead responsibilities clearly separated" requirement.
export const ENQUIRY_STATUSES = [
  'New', 'Assigned', 'Contacted', 'Under Review', 'Qualified', 'Converted',
  'Unqualified', 'Duplicate', 'Spam', 'Not Interested', 'Closed',
]
export const ENQUIRY_PRIORITIES = ['Critical', 'High', 'Medium', 'Low']
export const ENQUIRY_CLOSE_REASONS = ['Unqualified', 'Duplicate', 'Spam', 'Not Interested', 'Closed']
export const QUOTATION_STATUSES = ['Draft', 'Pending Approval', 'Sent', 'Viewed', 'Negotiation', 'Accepted', 'Rejected', 'Expired']
export const QUOTATION_SOURCE_TYPES = ['Deal', 'Lead', 'Company']
export const DEFAULT_QUOTATION_TERMS = 'Payment due as per the agreed Payment Terms above. Prices are exclusive of applicable taxes unless noted otherwise. This quotation is valid only until the date specified above.'

// The full set of CRM fields a quotation letterhead/template can be mapped to, in the Template
// Editor — single source of truth shared by the field-mapping UI (src/pages/Settings/
// QuotationTemplateEditor.jsx) and the PDF generator (src/pages/Quotations/quotationPdf.js).
// `isRegion: true` fields are drag-to-resize rectangles (the table and totals block occupy real
// space rather than a single text anchor); everything else is a single positioned text anchor.
export const QUOTATION_TEMPLATE_FIELDS = [
  { key: 'quotationNumber', label: 'Quotation Number', sample: 'QUO-2026-4231' },
  { key: 'quotationDate', label: 'Quotation Date', sample: '01 Oct 2026' },
  { key: 'validUntil', label: 'Valid Until', sample: '16 Oct 2026' },
  { key: 'clientName', label: 'Client / Company Name', sample: 'Acme Technologies Pvt Ltd' },
  { key: 'contactPerson', label: 'Contact Person Name', sample: 'Rohan Iyer' },
  { key: 'phone', label: 'Phone Number', sample: '+91 98765 43210' },
  { key: 'email', label: 'Email Address', sample: 'rohan@acmetech.com' },
  { key: 'billingAddress', label: 'Billing Address', sample: '4th Floor, Tech Park Avenue, Bengaluru' },
  { key: 'shippingAddress', label: 'Shipping Address', sample: 'Same as billing address' },
  { key: 'gstin', label: 'GSTIN', sample: '29AACCL1234A1Z5' },
  { key: 'dealId', label: 'Linked Deal ID', sample: 'DL-2003' },
  { key: 'quotationOwner', label: 'Quotation Owner', sample: 'Karthik Subramaniam' },
  { key: 'itemsTable', label: 'Products / Services Table', sample: '(line items)', isRegion: true },
  { key: 'totals', label: 'Subtotal / Tax / Grand Total', sample: '(totals block)', isRegion: true },
  { key: 'paymentTerms', label: 'Payment Terms', sample: '50% advance, 50% on delivery' },
  { key: 'terms', label: 'Terms & Conditions', sample: '(terms & conditions text)' },
]
export const REQUIRED_TEMPLATE_FIELD_KEYS = ['clientName', 'itemsTable', 'totals']
export const PROPOSAL_STATUSES = ['Draft', 'Internal Review', 'Sent', 'Viewed', 'Revision Requested', 'Accepted', 'Rejected', 'Expired']
export const TASK_STATUSES = ['To Do', 'In Progress', 'Waiting / On Hold', 'Completed', 'Cancelled', 'Reopened'] // workflow lives in src/utils/taskRules.js
export const CONTRACT_STATUSES = ['Draft', 'Internal Review', 'Pending Approval', 'Approved', 'Sent', 'Signed', 'Active', 'Expiring Soon', 'Expired', 'Renewed', 'Terminated', 'Cancelled'] // lifecycle rules live in src/utils/contractRules.js
export const INVOICE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled', 'Void']
export const TICKET_STATUSES = ['New', 'Open', 'Assigned', 'In Progress', 'Waiting for Customer', 'Resolved', 'Closed', 'Reopened', 'Cancelled']
export const PROJECT_STATUSES = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled'] // workflow rules live in src/utils/projectRules.js
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
// The activity vocabulary lives in src/utils/activityRules.js (ACTIVITY_TYPE_DEFS); this is the plain name list.
export const ACTIVITY_TYPES = ['Call', 'Email', 'WhatsApp', 'SMS', 'Meeting', 'Follow-up', 'Task', 'Demo / Presentation', 'Site Visit', 'Note', 'Proposal Sent', 'Quotation Sent', 'Quotation Accepted / Rejected', 'Deal Stage Changed', 'Status Changed', 'Document Uploaded', 'Payment Follow-up', 'Customer Interaction', 'Other / Custom Activity']
export const CAMPAIGN_STATUSES = ['Planned', 'Active', 'Paused', 'Completed']
// The ONLY roles that can sign in: Super Admin, Admin and Employee. Everything finer than that is a per-account permission set
// (see data/permissions.js). The other names below are permission TEMPLATES / job profiles an account starts from - never a login role.
export const LOGIN_ROLES = ['Super Admin', 'Admin', 'Employee']
export const ROLES = [
  'Super Admin', 'Admin', 'Employee', 'MD', 'CEO', 'HR', 'Sales Manager', 'Sales Executive',
  'Marketing', 'Project Manager', 'Project Staff', 'Accounts', 'Support',
]
export const USER_ACCOUNT_STATUSES = ['Active', 'Inactive', 'Pending', 'Locked', 'Suspended']
export const DATA_SCOPES = ['Own', 'Team', 'Department', 'Branch', 'Organization']

/** The job profiles an account can start from. Custom roles are created on the server (Roles & Permissions); nothing is kept in the browser. */
export function getEffectiveRoles() {
  return [...ROLES]
}
export const NOTIFICATION_TYPES = [
  'New Lead', 'Lead Assignment', 'Follow-up Reminder', 'Task Reminder', 'Deal Update',
  'Quotation Accepted', 'Payment Received', 'Payment Overdue', 'Project Update', 'Contract Update', 'Document Update', 'Support Ticket',
  'New Enquiry', 'Enquiry Assignment', 'Enquiry Qualified', 'Enquiry Converted', 'Enquiry Closed',
  'High Priority Enquiry', 'Lead Qualified', 'Opportunity Created', 'Quotation Created',
  'Sales Order Created', 'Deal Won', 'Deal Lost', 'First Contact', 'Follow-up Due', 'Follow-up Overdue',
  'Meeting Scheduled', 'Meeting Rescheduled', 'Meeting Cancelled',
  'Meeting Reminder', 'Task Assigned', 'Task Updated', 'Task Overdue', 'Task Mention', 'Task Completed', 'Task Comment',
]

export const STATUS_TONES = {
  // green
  Won: 'success', Converted: 'success', Paid: 'success', Accepted: 'success', Resolved: 'success',
  Completed: 'success', Active: 'success', Qualified: 'success', 'Payment Received': 'success',
  'Closed Won': 'success',
  // blue
  New: 'info', Sent: 'info', Assigned: 'info', 'In Progress': 'info', Viewed: 'info', Draft: 'neutral',
  'Deal Created': 'info', 'Requirement Analysis': 'info',
  // amber
  Negotiation: 'warning', 'Proposal Sent': 'warning', Proposal: 'warning', Waiting: 'warning',
  'Partially Paid': 'warning', 'Expiring Soon': 'warning', Contacted: 'warning', Pending: 'warning', Approved: 'success', Signed: 'success', Terminated: 'danger', Renewed: 'info', 'To Do': 'neutral', 'Waiting / On Hold': 'warning', Reopened: 'info',
  'On Hold': 'warning', Planned: 'neutral', Delayed: 'warning', 'Pending Approval': 'warning',
  'Under Review': 'warning', 'Internal Review': 'warning', 'Revision Requested': 'warning', 'Solution Discussion': 'warning', 'Decision Maker Review': 'warning',
  'Proposal / Quotation': 'warning', 'Final Decision': 'warning',
  // red
  Lost: 'danger', Overdue: 'danger', Rejected: 'danger', Expired: 'danger', Cancelled: 'danger', Void: 'neutral', Reversed: 'neutral', Unpaid: 'warning', 'Not issued': 'neutral', 'Not applicable': 'neutral',
  Closed: 'neutral', Open: 'info', Locked: 'danger', Suspended: 'danger', Success: 'success', Failed: 'danger',
  Duplicate: 'neutral', Spam: 'danger', 'Not Interested': 'danger', Unqualified: 'neutral',
  'Closed Lost': 'danger', 'Closed Lost – Competition': 'danger',
  // Sales Order
  Confirmed: 'info', Processing: 'warning', 'Partially Fulfilled': 'warning', Fulfilled: 'success', 'In Fulfillment': 'warning', Delivered: 'success', Invoiced: 'success',
  // Meeting lifecycle
  Submitted: 'info', Reimbursed: 'success', 'Not payable': 'neutral', 'Not approved yet': 'neutral', 'Reimbursement pending': 'warning', 'Partly reimbursed': 'warning',
  Scheduled: 'info', Rescheduled: 'warning', 'No Show': 'danger',
}

export const PRIORITY_TONES = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Urgent: 'danger',
  Critical: 'danger',
}
