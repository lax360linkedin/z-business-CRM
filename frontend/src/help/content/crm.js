// Help for the Dashboard and the CRM section. Each entry: purpose (one or two plain sentences), features (what you can see / do), actions ([label, how]) for the buttons, filters and forms,
// workflows (numbered steps), tips, related pages ([label, route]).
export const crm = {
  dashboard: {
    title: 'Dashboard',
    purpose: 'Your business at a glance: new leads, enquiries, deals, revenue and team performance for the branch you are working in.',
    features: [
      'Headline figures for leads, enquiries, deals and revenue, with charts for each pipeline and for revenue over time.',
      'Leads and enquiries grouped by source, status and score, so you can see which channels bring the best prospects.',
      'Team performance by salesperson and, for the Super Admin, a branch comparison.',
      'Everything follows the branch selector in the top bar: choose one branch or All branches.',
    ],
    actions: [
      ['Add Lead', 'Opens the new-lead form so you can capture a prospect without leaving the dashboard.'],
      ['Lead / enquiry / deal tiles and charts', 'Click a tile or a chart bar (for example a lead source) to open the matching list, already filtered.'],
      ['View Full Reports', 'Opens the detailed reports for sales, leads, marketing, finance, projects and team performance.'],
      ['Branch selector (top bar)', 'Switches which branch the figures describe. Branch users are fixed to their own branch.'],
    ],
    tips: ['Figures are calculated live from your records, so they change as soon as someone updates a lead, deal or payment.', 'You only see the cards for modules your role can open.'],
    related: [['Leads', '/leads'], ['Sales Pipeline', '/pipeline'], ['Sales reports', '/reports/sales'], ['AI Insights', '/ai-insights']],
  },

  leads: {
    title: 'Leads',
    purpose: 'Lead Management is where you track every prospect from first contact to a deal: who they are, where they came from, how promising they are and what to do next.',
    features: [
      'A searchable list of leads with status, source, owner, score and next follow-up date.',
      'Each lead has a score from 0 to 100 that the system calculates from how complete and promising the lead is, so you can contact the best ones first.',
      'Statuses: New, Contacted, Qualified, Converted, with Unqualified and Lost as the two ways a lead ends without a deal.',
      'Filters for status, source, owner, score range, follow-up dates, created dates and expected purchase dates; import and export for bulk work.',
    ],
    actions: [
      ['Add Lead', 'Opens the form for a new lead. Name is required; source, service, budget, owner and next follow-up make the lead far more useful.'],
      ['Search box', 'Finds leads by lead ID, name, company, phone or email as you type.'],
      ['Filters', 'Open the filter panel to narrow by status, source, owner, score and dates. “Clear advanced filters” resets the date and score filters.'],
      ['Download Excel Template', 'Downloads an .xlsx made for lead import: the right columns (required ones starred), dropdowns for Source and Priority, and an Instructions and an Examples sheet. Fill in the first sheet and save.'],
      ['Import', 'Choose the filled Excel (.xlsx) or CSV file. Every row is checked first and you see what would be imported and why any row would not (missing name, bad email or date, unknown source or owner, duplicate email or phone). Only valid rows are saved; you get a summary and a file of the rows to fix.'],
      ['Export', 'Downloads what the list currently shows.'],
      ['Row menu (⋯)', 'View Details, Edit, Assign / Reassign, Qualify, Convert to Deal, Mark Unqualified, Mark Lost or Delete. Only the steps that are valid for the lead’s current status are shown; closed leads can no longer be edited.'],
      ['Assign / Reassign', 'Gives a lead to a salesperson (or hands it to someone else); the new owner is notified.'],
    ],
    workflows: [{ title: 'From new lead to deal', steps: [
      'Click Add Lead and fill in the contact, source and requirement, then save. The lead starts as New.',
      'Open the lead and use Call, Email, WhatsApp or Meeting, then log the result. After a successful contact is logged the lead moves to Contacted by itself.',
      'Qualify only appears once the lead is Contacted. Choose it (row menu or lead page) and capture the qualification details.',
      'Convert to Deal only appears once the lead is Qualified. It creates a deal from the lead’s details and the lead becomes Converted.',
      'If it goes nowhere, use Mark Unqualified (not a fit) or Mark Lost (a fit that chose someone else) and give the reason.',
    ] }],
    tips: ['Set a next follow-up date on every open lead: overdue follow-ups are highlighted here and on the dashboard.', 'Unqualified and Lost are final: they ask for a reason so you can learn from them.'],
    related: [['Enquiries', '/enquiries'], ['Deals', '/deals'], ['Lead Sources', '/lead-sources'], ['Lead reports', '/reports/leads']],
  },

  leadDetail: {
    title: 'Lead details',
    purpose: 'Everything about one lead in one place: contact details, requirement, score, linked company and contact, and the full history of what has been done.',
    features: [
      'Contact and requirement details, source and campaign, owner, budget and expected purchase date.',
      'A timeline of every call, email, WhatsApp, meeting, note and status change, with who did it and when.',
      'Links to the company, contact, customer or deal this lead became.',
    ],
    actions: [
      ['Call / Email / WhatsApp', 'Contacts the lead using their saved number or address. Log the result: a successful contact moves a New lead to Contacted automatically.'],
      ['Follow-up', 'Schedules the next follow-up (a task is created for it) so the lead is not forgotten.'],
      ['Meeting / Schedule Meeting', 'Books a meeting that also appears in the Calendar; after it, record the outcome.'],
      ['Add Note', 'Saves an internal note on the timeline.'],
      ['Qualify Lead', 'Available once the lead is Contacted: capture the qualification details and the lead becomes Qualified.'],
      ['Convert to Deal', 'Available once the lead is Qualified: creates a deal from this lead and marks the lead Converted. The deal takes over from there.'],
      ['More Actions', 'Mark Unqualified or Mark Lost, each asking for a reason.'],
      ['Edit', 'Changes the lead’s details.'],
    ],
    tips: ['Log every touchpoint: the timeline is how your colleagues know what has already been said to the lead.'],
    related: [['All leads', '/leads'], ['Tasks', '/tasks'], ['Calendar', '/calendar']],
  },

  meeting: {
    title: 'Meeting',
    purpose: 'The page for a scheduled meeting: join it when the time comes and record what came out of it.',
    features: ['Shows who the meeting is with and when.', 'Lets you join the meeting, then store the outcome against the lead, enquiry or deal it belongs to.'],
    actions: [
      ['Join Meeting', 'Opens the meeting link.'],
      ['Update Meeting Outcome', 'After the meeting, record what was agreed so it appears on the record’s timeline.'],
      ['Back to Leads', 'Returns to the lead list.'],
    ],
    related: [['Calendar', '/calendar'], ['Leads', '/leads']],
  },

  enquiries: {
    title: 'Enquiries',
    purpose: 'Enquiry Management is the inbox for first contacts: every website form, call, walk-in or message that has not yet been qualified as a lead.',
    features: [
      'Each enquiry records its source, campaign, interest, priority and assigned person, and a next follow-up date.',
      'Statuses: New, Assigned, Contacted, Under Review, Qualified, Converted, and the ways to close one without a lead (Duplicate, Spam, Not Interested, Closed, Unqualified).',
      'Filters and search by ID, name, company, phone or email; import and export for bulk work.',
    ],
    actions: [
      ['Add Enquiry', 'Records a new enquiry. It starts as New.'],
      ['Row menu (⋯)', 'View Details, Edit, Qualify, Convert to Lead, Mark Duplicate, Mark Spam, Not Interested, Close or Delete.'],
      ['Filters', 'Narrow by status, source, campaign, priority, assignee and follow-up or created dates.'],
      ['Download Excel Template', 'Downloads an .xlsx made for enquiry import: required columns starred, dropdowns for Source, Enquiry Type, Priority and more, plus Instructions and Examples sheets.'],
      ['Import', 'Choose the filled Excel (.xlsx) or CSV file. Every row is checked first (nothing is saved yet) and problems are listed per row; only valid rows are imported, then you see a summary with reasons for any that were not.'],
      ['Export', 'Downloads the current list.'],
    ],
    workflows: [{ title: 'Working an enquiry', steps: [
      'Open a New enquiry and assign it to someone (Assigned).',
      'The assignee uses Call, Email, WhatsApp or Meeting on the enquiry page and logs the result; after a successful contact the enquiry moves to Contacted by itself. Start Review (Under Review) is optional.',
      'Capture the qualification details to mark it Qualified (or Unqualified). Only a Qualified enquiry can be converted: Convert to Lead creates a new lead starting at New, and the enquiry becomes Converted.',
      'If not, mark it Duplicate, Spam, Not Interested or Close it, with a reason where asked.',
    ] }],
    tips: ['Duplicates are flagged against existing enquiries and customers so the same person is not worked twice.'],
    related: [['Leads', '/leads'], ['Lead Sources', '/lead-sources'], ['Campaigns', '/campaigns']],
  },

  enquiryDetail: {
    title: 'Enquiry details',
    purpose: 'One enquiry with its contact details, source, requirement and complete history, and the buttons to move it forward.',
    features: ['Contact, interest and budget details.', 'A timeline of calls, emails, meetings, notes and status changes.', 'Links to the company or customer it matched and, once converted, the lead it created.'],
    actions: [
      ['Call / Email / WhatsApp', 'Contacts the enquirer. Log the result: a successful contact moves the enquiry to Contacted automatically.'],
      ['Follow-up / Add Note / Meeting', 'Schedules the next step or records what happened.'],
      ['Start Review', 'Optional: moves a Contacted enquiry into Under Review while someone evaluates it.'],
      ['Qualify Enquiry', 'Available once the enquiry is Contacted or Under Review: capture the qualification details to decide Qualified or Unqualified.'],
      ['Convert to Lead', 'Only for a Qualified enquiry: creates a lead (starting at New), marks the enquiry Converted and links the two. An enquiry can be converted only once.'],
      ['More Actions', 'Mark as Duplicate, Mark as Spam, Mark Not Interested or Close Enquiry.'],
    ],
    related: [['All enquiries', '/enquiries'], ['Leads', '/leads']],
  },

  contacts: {
    title: 'Contacts',
    purpose: 'The address book of people you deal with: each contact belongs to a company and keeps their calls, emails and meetings together.',
    features: ['A searchable list of people with company, designation, phone and email.', 'Each contact’s follow-ups, notes and linked deals, leads and quotations.'],
    actions: [
      ['Add Contact', 'Creates a person; choose their company so everything links up.'],
      ['Search box', 'Finds contacts by name, company or email.'],
      ['Row actions', 'Open a contact to see its history, edit it, or delete it if nothing depends on it.'],
    ],
    related: [['Companies', '/companies'], ['Customers', '/customers'], ['Leads', '/leads']],
  },

  contactDetail: {
    title: 'Contact details',
    purpose: 'One person’s details and everything you have done with them.',
    features: ['Phone, email, WhatsApp and company.', 'Follow-ups, meetings and notes in date order.', 'Quick buttons to reach them or raise a quotation.'],
    actions: [
      ['Call / Email / WhatsApp', 'Contacts the person and offers to log it.'],
      ['Add Follow-up / Add Note / Schedule Meeting', 'Records the next step or what was said.'],
      ['Create Quotation', 'Starts a quotation for this contact’s company.'],
      ['Edit', 'Changes the contact’s details.'],
    ],
    related: [['All contacts', '/contacts'], ['Quotations', '/quotations']],
  },

  companies: {
    title: 'Companies',
    purpose: 'The organisations you sell to. A company groups its contacts, deals, quotations and invoices so you see the whole relationship.',
    features: ['A searchable list with industry, city, contact person and status.', 'Each company’s contacts, deals and documents on its own page.'],
    actions: [
      ['Add Company', 'Creates an organisation with its address, GSTIN and billing details.'],
      ['Search box', 'Finds companies by name, industry or contact.'],
      ['Open a company', 'Shows its contacts, deals, quotations and history; Edit or Delete from there.'],
    ],
    tips: ['A company that is linked to deals, quotations or contacts cannot be deleted until those are moved or removed.'],
    related: [['Contacts', '/contacts'], ['Customers', '/customers'], ['Deals', '/deals']],
  },

  companyDetail: {
    title: 'Company details',
    purpose: 'One organisation’s profile with its people, deals and paperwork.',
    features: ['Address, billing and tax details.', 'Linked contacts, deals, quotations and documents.'],
    actions: [
      ['Edit', 'Updates the company’s details.'],
      ['Create Quotation', 'Starts a quotation addressed to this company.'],
      ['Delete', 'Removes the company if nothing else depends on it.'],
    ],
    related: [['All companies', '/companies'], ['Quotations', '/quotations']],
  },

  customers: {
    title: 'Customers',
    purpose: 'Companies and people who have bought from you, with their account manager, tier and lifetime value.',
    features: ['A searchable list with tier, status, account manager and lifetime value.', 'Where each customer originally came from (lead source and campaign).'],
    actions: [
      ['Add Customer', 'Creates a customer record directly (customers are also created when a deal is won).'],
      ['Search box', 'Finds customers by name, industry or contact.'],
      ['Open a customer', 'Shows invoices, deals and history, with Edit and Delete.'],
    ],
    related: [['Companies', '/companies'], ['Invoices', '/invoices'], ['Deals', '/deals']],
  },

  customerDetail: {
    title: 'Customer details',
    purpose: 'One customer’s account: profile, billing details and everything sold to them.',
    features: ['Account manager, tier and lifetime value.', 'Linked deals, quotations, invoices and support tickets.', 'A link back to the lead that became this customer.'],
    actions: [
      ['Edit', 'Updates the customer’s details.'],
      ['Create Quotation', 'Starts a quotation for this customer.'],
      ['View Original Lead', 'Opens the lead this customer came from.'],
      ['Delete', 'Removes the customer if nothing depends on it.'],
    ],
    related: [['All customers', '/customers'], ['Invoices', '/invoices'], ['Support tickets', '/tickets']],
  },
}
