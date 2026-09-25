export { LEAD_SOURCES, SERVICES, INDUSTRIES, CITIES } from '../utils/generators'

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
export const SALES_ORDER_STATUSES = ['Pending', 'Confirmed', 'In Fulfillment', 'Delivered', 'Invoiced', 'Cancelled']
export const LEAD_QUALIFICATION_TIMELINES = ['Immediate (0-1 month)', 'Short-term (1-3 months)', 'Mid-term (3-6 months)', 'Long-term (6+ months)']
export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+']
export const DECISION_MAKER_STATUSES = ['Yes', 'No', 'Partially']
export const BUSINESS_NEED_OPTIONS = [
  'Sales Management', 'Customer Management', 'Lead Management', 'Marketing Automation',
  'Billing & Invoicing', 'Inventory Management', 'Reporting & Analytics',
  'Communication Management', 'Process Automation', 'Other',
]
// Deal-level Lost reasons — a Deal that was created from a Converted Lead later falling
// through, or moved to Closed Lost / Closed Lost – Competition. See markDealLost() in
// src/pages/Deals/dealActions.js.
export const LOST_REASONS = ['Budget Issue', 'Timing Issue', 'No Response', 'Requirement Changed', 'Internal Decision', 'Competitor Selected', 'Price Issue', 'Other']

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
export const UNQUALIFIED_REASONS = [
  'Not a Target Customer', 'No Relevant Requirement', 'Invalid Requirement',
  'Budget Mismatch', 'Service Not Applicable', 'Duplicate/Irrelevant Lead', 'Other',
]

// Lead-level Lost reasons — distinct from LOST_REASONS (Deal-level): this is a Lead that WAS a
// genuine opportunity (Contacted or Qualified) but the business stopped progressing before ever
// becoming a Deal. See markLeadLost() in src/pages/Leads/leadActions.js.
export const LEAD_LOST_REASONS = [
  'Customer Chose Competitor', 'Customer Cancelled Requirement', 'Budget Unavailable',
  'Price Objection', 'Customer Postponed Decision', 'No Response After Follow-ups',
  'Requirement No Longer Exists', 'Other',
]

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
export const ENQUIRY_SOURCES = [
  'Website', 'Contact Form', 'Google', 'Facebook', 'Instagram', 'LinkedIn', 'WhatsApp', 'Phone',
  'Email', 'Walk-in', 'Referral', 'Campaign', 'Advertisement', 'Partner', 'Existing Customer',
  'Manual Entry', 'Import', 'API / Integration',
]
export const ENQUIRY_STATUSES = [
  'New', 'Assigned', 'Contacted', 'Under Review', 'Qualified', 'Converted',
  'Unqualified', 'Duplicate', 'Spam', 'Not Interested', 'Closed',
]
export const ENQUIRY_PRIORITIES = ['Critical', 'High', 'Medium', 'Low']
export const ENQUIRY_TYPES = ['Product Enquiry', 'Service Enquiry', 'Pricing Enquiry', 'Support Enquiry', 'Partnership Enquiry', 'General Enquiry']
export const REQUIREMENT_TYPES = ['New Requirement', 'Upgrade', 'Replacement', 'Renewal', 'Add-on', 'Other']
export const PREFERRED_CONTACT_METHODS = ['Phone', 'Email', 'WhatsApp', 'Any']
export const ASSIGNED_TEAMS = ['Sales', 'Marketing', 'Support']
export const PURCHASE_INTENT_LEVELS = ['Low', 'Medium', 'High', 'Very High']
export const ENQUIRY_CLOSE_REASONS = ['Unqualified', 'Duplicate', 'Spam', 'Not Interested', 'Closed']
export const QUOTATION_STATUSES = ['Draft', 'Pending Approval', 'Sent', 'Viewed', 'Negotiation', 'Accepted', 'Rejected', 'Expired']
export const PROPOSAL_STATUSES = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired']
export const TASK_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled']
export const CONTRACT_STATUSES = ['Draft', 'Active', 'Expiring Soon', 'Expired', 'Cancelled']
export const INVOICE_STATUSES = ['Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled']
export const TICKET_STATUSES = ['Open', 'Assigned', 'In Progress', 'Waiting', 'Resolved', 'Closed']
export const PROJECT_STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Delayed', 'Completed']
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const ACTIVITY_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Demo', 'Follow-up', 'Note', 'Task']
export const CAMPAIGN_CHANNELS = ['Google Ads', 'Instagram', 'Facebook', 'LinkedIn', 'Email', 'WhatsApp', 'Website', 'YouTube', 'Other']
export const CAMPAIGN_STATUSES = ['Planned', 'Active', 'Paused', 'Completed']
export const DEPARTMENTS = ['Sales', 'Marketing', 'Projects', 'Finance', 'Support', 'Management', 'HR']
export const ROLES = [
  'Super Admin', 'Admin', 'MD', 'CEO', 'HR', 'Sales Manager', 'Sales Executive',
  'Marketing', 'Project Manager', 'Project Staff', 'Accounts', 'Support',
]
export const USER_ACCOUNT_STATUSES = ['Active', 'Inactive', 'Pending', 'Locked', 'Suspended']
export const DATA_SCOPES = ['Own', 'Team', 'Department', 'Branch', 'Organization']

const CUSTOM_ROLES_KEY = 'business_crm_custom_roles_v1'

export function getCustomRoles() {
  try {
    const raw = localStorage.getItem(CUSTOM_ROLES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** Built-in roles + any Super-Admin-defined custom roles — the list every role dropdown (Login, Add User, Roles & Permissions) should read from. */
export function getEffectiveRoles() {
  return [...ROLES, ...getCustomRoles()]
}

export function addCustomRole(name) {
  const trimmed = name.trim()
  if (!trimmed) return getCustomRoles()
  const existing = getCustomRoles()
  if (getEffectiveRoles().some((r) => r.toLowerCase() === trimmed.toLowerCase())) return existing
  const next = [...existing, trimmed]
  localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(next))
  return next
}

export function removeCustomRole(name) {
  const next = getCustomRoles().filter((r) => r !== name)
  localStorage.setItem(CUSTOM_ROLES_KEY, JSON.stringify(next))
  return next
}
export const EXPENSE_CATEGORIES = ['Travel', 'Software & Tools', 'Office Supplies', 'Marketing', 'Utilities', 'Client Entertainment', 'Training', 'Other']
export const PAYMENT_METHODS = ['Bank Transfer', 'UPI', 'Credit Card', 'Debit Card', 'Cheque', 'Cash']
export const DOCUMENT_CATEGORIES = ['Contracts', 'Proposals', 'Quotations', 'Invoices', 'Project Files', 'Client Documents', 'Other']
export const TICKET_CATEGORIES = ['Technical Issue', 'Billing', 'Feature Request', 'Account', 'General Query', 'Bug Report']
export const NOTIFICATION_TYPES = [
  'New Lead', 'Lead Assignment', 'Follow-up Reminder', 'Task Reminder', 'Deal Update',
  'Quotation Accepted', 'Payment Received', 'Payment Overdue', 'Project Update', 'Support Ticket',
  'New Enquiry', 'Enquiry Assignment', 'Enquiry Qualified', 'Enquiry Converted', 'Enquiry Closed',
  'High Priority Enquiry', 'Lead Qualified', 'Opportunity Created', 'Quotation Created',
  'Sales Order Created', 'Deal Won', 'Deal Lost', 'First Contact', 'Follow-up Due', 'Follow-up Overdue',
  'Meeting Scheduled', 'Meeting Rescheduled', 'Meeting Cancelled',
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
  'Partially Paid': 'warning', 'Expiring Soon': 'warning', Contacted: 'warning', Pending: 'warning',
  'On Hold': 'warning', Planned: 'neutral', Delayed: 'warning', 'Pending Approval': 'warning',
  'Under Review': 'warning', 'Solution Discussion': 'warning', 'Decision Maker Review': 'warning',
  'Proposal / Quotation': 'warning', 'Final Decision': 'warning',
  // red
  Lost: 'danger', Overdue: 'danger', Rejected: 'danger', Expired: 'danger', Cancelled: 'danger',
  Closed: 'neutral', Open: 'info', Locked: 'danger', Suspended: 'danger', Success: 'success', Failed: 'danger',
  Duplicate: 'neutral', Spam: 'danger', 'Not Interested': 'danger', Unqualified: 'neutral',
  'Closed Lost': 'danger', 'Closed Lost – Competition': 'danger',
  // Sales Order
  Confirmed: 'info', 'In Fulfillment': 'warning', Delivered: 'success', Invoiced: 'success',
  // Meeting lifecycle
  Scheduled: 'info', Rescheduled: 'warning', 'No Show': 'danger',
}

export const PRIORITY_TONES = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Urgent: 'danger',
  Critical: 'danger',
}
