// Marketing, Communication, Support, Reports and AI Insights.
export const marketing = {
  campaigns: {
    title: 'Campaigns',
    purpose: 'Plan, run and measure marketing campaigns. Every result on the page is calculated from the leads, deals, customers, invoices and payments attributed to the campaign.',
    features: ['A list of campaigns with channel, dates, spend, leads and revenue.', 'Search by campaign, ID, channel or source; filters and export.', 'Return on investment from recorded spend against the revenue that campaign produced.'],
    actions: [
      ['New campaign', 'Creates a campaign: name, channel, dates and budget.'],
      ['Search box and filters', 'Find campaigns by name, ID, channel or source; Clear resets them.'],
      ['Export', 'Downloads the campaigns currently listed.'],
      ['Open a campaign', 'Shows its results and the actions to run it.'],
    ],
    related: [['Marketing Analytics', '/marketing-analytics'], ['Lead Sources', '/lead-sources'], ['Marketing reports', '/reports/marketing']],
  },

  campaignDetail: {
    title: 'Campaign details',
    purpose: 'One campaign: its status, spend, the leads and revenue attributed to it, and its tasks and documents.',
    features: ['Results computed from the attributed leads, deals and payments.', 'Spend entries and a timeline.', 'Tasks, meetings and documents for the campaign.'],
    actions: [
      ['Start campaign / Pause / Resume / Complete', 'Moves the campaign through its life; you can only do the steps that apply to its current state.'],
      ['Record spend', 'Adds an amount spent so return on investment stays accurate.'],
      ['Attribute lead / Attribute existing lead', 'Links a lead to this campaign so its results are counted here.'],
      ['Create task / Schedule meeting / Add note', 'Records the work around the campaign.'],
      ['Upload document', 'Attaches a brief or creative.'],
      ['Edit', 'Changes the campaign’s details.'],
    ],
    related: [['All campaigns', '/campaigns']],
  },

  leadSources: {
    title: 'Lead Sources',
    purpose: 'Where enquiries come from. Every enquiry, lead, deal and customer points to one of these sources, so you can see which channels pay off. A source never decides which branch a record belongs to.',
    features: ['Sources grouped by category, either shared across branches or belonging to one branch.', 'Counts of enquiries, leads and conversions per source.', 'Integration status for sources fed by an outside system.'],
    actions: [
      ['Add source', 'Creates a source: name, category, type, how enquiries arrive and, optionally, a branch.'],
      ['Search, Filters and More Filters', 'Search by name, category or branch. Filters opens the dropdowns (category, scope, branch, status, integration) with a Clear link; More Filters sets the Enquiries From / To dates, which count enquiries received in that period. The buttons show how many are set.'],
      ['Edit / Delete', 'Changes a source, or removes one that nothing uses.'],
      ['Add a new category', 'Inside the source form, creates a category of your own.'],
      ['Export', 'Downloads the sources currently listed.'],
    ],
    tips: ['Sources that are in use can be switched off instead of deleted, so history stays intact.'],
    related: [['Enquiries', '/enquiries'], ['Marketing Analytics', '/marketing-analytics'], ['Lead settings', '/settings/modules/leads']],
  },

  leadSourceDetail: {
    title: 'Lead source details',
    purpose: 'One lead source with the enquiries, leads and conversions it produced, and its connection details.',
    features: ['Performance for this source.', 'Mappings that describe how an outside account or form feeds this source.'],
    actions: [
      ['Edit', 'Changes the source’s details.'],
      ['Add mapping / Save mapping', 'Records which outside account, page or form feeds the source and which branch it maps to. This documents the link; it does not connect anything by itself.'],
    ],
    related: [['All lead sources', '/lead-sources']],
  },

  marketingAnalytics: {
    title: 'Marketing Analytics',
    purpose: 'One analytics view over campaigns, lead sources, leads, deals, customers, invoices and payments. Every figure is computed live from those records.',
    features: ['Conversion funnel, monthly lead and conversion trends, and revenue by campaign and source.', 'Campaign-wise and source-wise performance tables, ROI comparison and marketing spend against revenue.', 'Filters for date range, campaign, lead source, channel, owner, team, deal stage and more.'],
    actions: [
      ['Filters and More Filters', 'Filters opens the dropdowns for campaign, lead source, channel, campaign status, lead status, deal stage, owner and team; More Filters adds the From / To dates and the product, customer and company. Every chart and table follows, and each button shows how many are set with a Clear link.'],
      ['Export campaigns / Export sources', 'Downloads the campaign or source table as a file.'],
    ],
    related: [['Campaigns', '/campaigns'], ['Lead Sources', '/lead-sources'], ['Marketing reports', '/reports/marketing']],
  },

  communicationEmail: {
    title: 'Email log',
    purpose: 'The record of emails logged against your customers, leads and deals. Email sending and receiving is not connected to this CRM yet, so this log shows what people recorded themselves.',
    features: ['Emails logged with “Log email” on a lead, deal or other record.', 'Search by record, subject or notes, and filters.'],
    actions: [
      ['Search box and filters', 'Find a logged email by record, subject or notes.'],
      ['Open an entry', 'Goes to the record the email was logged against.'],
    ],
    tips: ['Nothing is sent from this page.'],
    related: [['Communication History', '/communication/history'], ['Email settings', '/settings/email-settings']],
  },

  communicationWhatsApp: {
    title: 'WhatsApp log',
    purpose: 'The record of WhatsApp conversations logged against your customers, leads and deals. WhatsApp sending and receiving is not connected to this CRM yet, so this log shows what people recorded themselves.',
    features: ['WhatsApp conversations logged on a lead, deal or other record.', 'Search by record, subject or notes, and filters.'],
    actions: [
      ['Search box and filters', 'Find a logged conversation.'],
      ['Open an entry', 'Goes to the record it was logged against.'],
    ],
    tips: ['Nothing is sent from this page.'],
    related: [['Communication History', '/communication/history'], ['WhatsApp settings', '/settings/whatsapp-settings']],
  },

  communicationHistory: {
    title: 'Communication History',
    purpose: 'A single, date-ordered view of every call, email, WhatsApp message and meeting logged across your customers, leads and deals.',
    features: ['All channels in one list, newest first.', 'Search by record, subject or notes and filter by channel, user and date.'],
    actions: [
      ['Search box', 'Finds a communication by the record, subject or notes.'],
      ['Filters', 'Narrow by channel, user or date; Clear resets them.'],
      ['Open an entry', 'Goes to the record the communication belongs to.'],
    ],
    related: [['Activities', '/activities'], ['Email log', '/communication/email']],
  },

  tickets: {
    title: 'Helpdesk / Tickets',
    purpose: 'Customer support requests. Each ticket has a priority and a service deadline (SLA) so problems are answered in time.',
    features: ['Tickets with customer, category, priority, assigned staff, status and SLA state (On Track, Warning, Breached).', 'Search by ID, subject, customer or company, with filters.', 'Statuses from New and Assigned through In Progress and Waiting for Customer to Resolved, Closed or Reopened.'],
    actions: [
      ['New Ticket', 'Raises a ticket: subject, customer, contact, category, priority, source, assigned staff and a description.'],
      ['Search box and filters', 'Find tickets by ID, subject, customer or company; narrow by status, priority, category or staff.'],
      ['Open a ticket', 'Shows the conversation, reply box and actions.'],
    ],
    workflows: [{ title: 'Handling a ticket', steps: [
      'Raise the ticket (or open a new one) and assign it to a staff member.',
      'The assignee opens it and replies to the customer with Send Reply; internal comments go in Save Note.',
      'Keep the status up to date while working on it or waiting for the customer.',
      'When solved, close it with Close Ticket. Reopen Ticket brings it back if the problem returns.',
    ] }],
    related: [['Customers', '/customers'], ['Ticket settings', '/settings/modules/tickets']],
  },

  ticketDetail: {
    title: 'Ticket details',
    purpose: 'One support ticket with its conversation, deadline and customer details.',
    features: ['The subject, description, priority and SLA deadline.', 'The conversation between your team and the customer, plus internal notes.', 'Customer and company links and contact buttons.'],
    actions: [
      ['Send Reply', 'Adds a reply to the conversation for the customer.'],
      ['Save Note', 'Adds an internal note that the customer does not see.'],
      ['Call / Email / WhatsApp', 'Contacts the customer using their saved details.'],
      ['Close Ticket / Reopen Ticket', 'Closes a solved ticket, or reopens it if needed.'],
    ],
    related: [['All tickets', '/tickets']],
  },

  reportSales: {
    title: 'Sales Reports',
    purpose: 'Pipeline health, win rates and rep performance for the period and branch you are looking at.',
    features: ['Deals by stage, the win / loss ratio and why deals were lost.', 'Revenue won and deals handled by each sales executive, and the top performers.', 'A breakdown of closed deals.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.'], ['Try again', 'Reloads the report if it could not be loaded.']],
    related: [['Sales Pipeline', '/pipeline'], ['Deals', '/deals']],
  },
  reportLeads: {
    title: 'Lead Reports',
    purpose: 'Lead volume, sources and conversion trends: how many leads arrive, where from, and how many become deals.',
    features: ['Leads by source, by service and by assigned staff.', 'The funnel across the active pipeline, and why leads were Unqualified or Lost, including per salesperson.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.']],
    related: [['Leads', '/leads'], ['Lead Sources', '/lead-sources']],
  },
  reportMarketing: {
    title: 'Marketing Reports',
    purpose: 'Campaign performance across every channel: spend, leads and revenue.',
    features: ['Campaign performance and channel performance (leads generated by channel).', 'Revenue generated and return on investment per campaign.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.']],
    related: [['Campaigns', '/campaigns'], ['Marketing Analytics', '/marketing-analytics']],
  },
  reportFinance: {
    title: 'Finance Reports',
    purpose: 'Revenue, collections and expense breakdowns: what was billed, what was collected and what was spent.',
    features: ['Monthly revenue collected (net of refunds) and payments received against what is still outstanding.', 'Overdue invoices, invoiced against expenses over the last 12 months, and spend by category. Revenue and expenses are kept as separate columns, never merged.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.']],
    related: [['Invoices', '/invoices'], ['Payments', '/payments'], ['Expenses', '/expenses']],
  },
  reportProjects: {
    title: 'Project Reports',
    purpose: 'Delivery status and value across your projects: how many are on track, how much they are worth and which ones are running late.',
    features: ['Project status breakdown and project value by status.', 'Delayed projects.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.']],
    related: [['Projects', '/projects']],
  },
  reportTeam: {
    title: 'Team Performance',
    purpose: 'How individuals are doing across sales, delivery and support.',
    features: ['Workload distribution across reps and individual results across sales, delivery and support.'],
    actions: [['Charts and tables', 'Hover over a chart for exact figures. The branch selector in the top bar changes the scope.']],
    related: [['Employees', '/employees']],
  },

  aiInsights: {
    title: 'AI Insights',
    purpose: 'Prioritised findings from your live CRM data: what needs attention now, what is going well and where the money is. The findings come from business rules applied to your own records, not from an outside AI service.',
    features: [
      'Headline figures (open leads, pipeline, weighted forecast, win rate, overdue invoices, open tickets), then findings ranked from critical to good news.',
      'Each finding lists the records behind it, with links, and a button to open the right page.',
      'Charts for the pipeline by stage, revenue against target, lead sources and lead scores.',
      'Everything is limited to your branch, your record scope and the modules your role can open.',
    ],
    actions: [
      ['Category tabs', 'Show only Sales, Marketing, Finance, Support or Operations findings.'],
      ['Refresh', 'Recalculates now (the page also refreshes itself every few minutes).'],
      ['Review follow-ups, Open pipeline and similar buttons', 'Open the page where you can act on that finding.'],
      ['Send to n8n', 'Administrators only: hands the finding to an n8n workflow (set up in Settings → Automation) so it can notify or act, for example by emailing owners about overdue follow-ups.'],
      ['Workflow activity', 'Administrators see the latest workflow runs and whether they succeeded.'],
    ],
    related: [['Settings → Automation', '/settings/automation'], ['Leads', '/leads'], ['Deals', '/deals']],
  },

  notifications: {
    title: 'Notifications',
    purpose: 'Alerts addressed to you: leads and enquiries assigned to you, follow-ups and tasks that are due or overdue, meetings, payments, deals won or lost and similar events.',
    features: ['Unread and read notifications in date order.', 'A filter for All, Unread or Read.', 'The bell in the top bar shows the latest ones.'],
    actions: [
      ['All / Unread / Read', 'Filters the list.'],
      ['Click a notification', 'Opens the record it is about and marks it read.'],
      ['Mark all as read', 'Clears the unread count in one click.'],
    ],
    related: [['Tasks', '/tasks'], ['Notification settings', '/settings/notification-settings']],
  },
}
