// Help for Activities, Tasks, Calendar and the Operations section (products, projects, contracts, documents).
export const work = {
  activities: {
    title: 'Activities',
    purpose: 'The CRM’s activity log: every call, email, meeting, note, task and system event, each tied to the lead, deal, customer or other record it concerns.',
    features: [
      'Summary tiles for total activities, today, upcoming, overdue, completed in the last 7 days and your own open items.',
      'Two views: a Table and a Timeline (grouped by day).',
      'Filter by type, status, user, related record, source and date; search by subject, record or notes.',
    ],
    actions: [
      ['Log Activity', 'Records something that happened (a call, email, WhatsApp, meeting, note and so on) against a record. Planned types such as Follow-up, Task and Meeting also appear on the Calendar and in Tasks.'],
      ['Table / Timeline', 'Switches how the log is laid out.'],
      ['Filters and search', 'Narrow to one type, user or record, or search the notes.'],
      ['Mark complete', 'On a planned activity, closes it once it has been done.'],
      ['Export', 'Downloads the activities currently listed.'],
      ['Load more', 'Shows older entries.'],
    ],
    tips: ['Status changes, conversions and stage moves are logged automatically by the CRM; they cannot be created by hand.'],
    related: [['Tasks', '/tasks'], ['Calendar', '/calendar'], ['Leads', '/leads']],
  },

  tasks: {
    title: 'Tasks',
    purpose: 'Your central to-do list: tasks you create, tasks assigned to you and follow-ups raised from leads, deals and invoices all land here.',
    features: [
      'A List and a Kanban board with the columns To Do, In Progress, Waiting / On Hold and Completed (reopened tasks return to To Do); drag a card to change its status.',
      'Metric tiles for your open and overdue tasks, with a refresh button.',
      'Filters for status, priority, assigned user, team, department, related record, type and dates, plus saved filters that are private to you.',
      'Automatic tasks (for example follow-up and overdue reminders) created by the CRM’s task rules.',
    ],
    actions: [
      ['New task', 'Creates a task: title, due date, priority, assignee and, optionally, the lead, deal or other record it relates to.'],
      ['List / Kanban', 'Switches the layout. On the board, drag a task into another column to update it.'],
      ['Filters and search', 'Search by ID, title or related record; open the filters to narrow by status, person and dates; Clear resets them.'],
      ['Save filter', 'Stores the current view, search and filters under a name so you can return to it in one click.'],
      ['Refresh', 'Reloads the task list.'],
      ['Task settings', 'Administrators only: automation rules, permissions and attachment rules.'],
    ],
    workflows: [{ title: 'Working a task', steps: [
      'Open a task from the list or board.',
      'Choose Assign to me if it is unassigned, or edit it to set the assignee and due date.',
      'Move it to In Progress while you work on it (drag it on the board, or change the status on the task).',
      'Choose Complete when done. Reopen brings it back if more work is needed.',
    ] }],
    related: [['Calendar', '/calendar'], ['Activities', '/activities'], ['Task settings', '/tasks/settings']],
  },

  taskDetail: {
    title: 'Task details',
    purpose: 'One task with its description, due date, assignee, related record, comments and history.',
    features: ['Status, priority and due date, with a reminder if one is set.', 'A link to the lead, deal, invoice or other record the task belongs to.', 'Attachments, comments and an audit trail of changes.'],
    actions: [
      ['Assign to me', 'Takes the task for yourself.'],
      ['Complete', 'Marks the task done and records who completed it and when.'],
      ['Reopen', 'Puts a completed or cancelled task back into the work list.'],
      ['Edit', 'Changes the title, dates, priority, assignees and other details.'],
      ['Subtasks → Add with details', 'Breaks the task into smaller subtasks, each with its own details and progress shown on the parent.'],
    ],
    related: [['All tasks', '/tasks'], ['Calendar', '/calendar']],
  },

  taskSettings: {
    title: 'Task settings',
    purpose: 'Administrators decide here how tasks behave for everyone: which tasks the CRM creates by itself, what each role may do with tasks and what can be attached.',
    features: ['Automation rules (for example follow-up tasks and overdue alerts), with on / off switches and their timings.', 'Role permissions for creating, assigning and completing tasks.', 'Upload rules for task attachments.'],
    actions: [
      ['Automation switches', 'Turn each automatic task on or off and set its timing, priority and who is told.'],
      ['Permissions', 'Choose what each role may do with tasks.'],
      ['Save', 'Applies the settings; the server enforces them for everybody straight away.'],
    ],
    tips: ['Only Administrators can open this page.'],
    related: [['Tasks', '/tasks'], ['Automation', '/administration/automation']],
  },

  calendar: {
    title: 'Calendar',
    purpose: 'One calendar for tasks, meetings, follow-ups, reminders and due dates. Each item belongs to a CRM record; the calendar simply shows them by date.',
    features: [
      'Month, Week, Day and Agenda views.',
      'Switch between My calendar and Everyone I can see, and show or hide event types.',
      'Items are colour-coded by type and state (done, overdue, cancelled).',
    ],
    actions: [
      ['New Event / Add to this day', 'Creates a meeting, task, follow-up or reminder on the chosen date.'],
      ['Month / Week / Day / Agenda', 'Changes how much of the calendar you see.'],
      ['Previous / Next / Today', 'Moves through time or jumps back to today.'],
      ['Event types and Whose events', 'Filter what is shown by type or by person.'],
      ['Click an event', 'Opens its details, with actions such as marking it done or opening the related record.'],
      ['Drag an event', 'Moves it to another day, where your role allows rescheduling.'],
      ['Refresh', 'Reloads the calendar.'],
    ],
    related: [['Tasks', '/tasks'], ['Activities', '/activities']],
  },

  products: {
    title: 'Products & Services',
    purpose: 'Your catalogue of what you sell: each product or service with its code, category, price, tax rate and billing cycle. Quotations, orders and invoices pick from here.',
    features: [
      'Card and Table views, with a catalogue summary.',
      'Search by name, code or category; filter by category, price range and sort order.',
      'Service categories you can add, rename and remove.',
    ],
    actions: [
      ['Add Product', 'Creates a catalogue item: name, code, category, type, price, unit and tax rate.'],
      ['Categories', 'Opens category management: add a category, rename one (items follow the new name) or delete one that nothing uses.'],
      ['Card view / Table view', 'Changes the layout.'],
      ['Filters (category, min / max price, sort)', 'Narrow the catalogue; Clear resets them.'],
      ['Export', 'Downloads the catalogue as a file.'],
      ['Open an item', 'Shows its price history and where it is used; Edit, Duplicate or Delete from there.'],
    ],
    tips: ['Changing a price affects new quotations only: existing ones keep the price they were created with.'],
    related: [['Quotations', '/quotations'], ['Product settings', '/administration/modules/products']],
  },

  productDetail: {
    title: 'Product details',
    purpose: 'One catalogue item with its price, tax, category and history of changes.',
    features: ['Pricing, unit and billing cycle.', 'Price history, so you can see what was charged before.'],
    actions: [
      ['Edit', 'Changes the item’s details and price.'],
      ['Duplicate', 'Creates a copy to adjust, handy for similar services.'],
      ['Delete', 'Removes the item if no document depends on it.'],
    ],
    related: [['All products', '/products']],
  },

  projects: {
    title: 'Projects',
    purpose: 'Delivery tracking: each project has an owner, dates, budget and status, and links back to the deal, order and invoices it came from.',
    features: [
      'Four views: List, Kanban (by status), Timeline and Calendar.',
      'Statuses: Planned, Active, On Hold, Completed and Cancelled; drag cards between Kanban columns to change status.',
      'Metric tiles for project counts, value, spend and billing.',
    ],
    actions: [
      ['New project', 'Creates a project: name, customer, manager, dates, budget and value.'],
      ['List / Kanban / Timeline / Calendar', 'Choose how projects are laid out; Timeline and Calendar need start and end dates.'],
      ['Search box and filters', 'Find projects by name, ID, customer or company; Clear resets the filters.'],
      ['Open a project', 'Shows progress, its tasks, and the linked sales order and invoices.'],
    ],
    related: [['Contracts', '/contracts'], ['Sales Orders', '/sales-orders'], ['Project reports', '/reports/projects']],
  },

  projectDetail: {
    title: 'Project details',
    purpose: 'One project: its plan, progress, team, linked deal and order, and the work and money around it.',
    features: ['Dates, status, budget and progress (you can update the progress yourself, or let it follow the project’s tasks).', 'Linked customer, deal, proposal, quotation and sales order.', 'Tasks, meetings, communications and activities for the project.'],
    actions: [
      ['Edit', 'Changes the project’s details and status.'],
      ['Client meeting / Join', 'Schedules a meeting with the client and joins it when it starts.'],
      ['Log activity / Log communication', 'Records a call, email or note against the project.'],
      ['Create invoice on the order', 'Bills the customer from the project’s sales order.'],
      ['Open in Calendar', 'Shows the project’s dates on the calendar.'],
    ],
    related: [['All projects', '/projects'], ['Invoices', '/invoices']],
  },

  contracts: {
    title: 'Contracts',
    purpose: 'Agreements from draft to signature, renewal and billing, each linked to the deal, order and project it came from.',
    features: [
      'Statuses across the whole life of a contract: Draft, Internal Review, Pending Approval, Approved, Sent, Signed, Active, Expiring Soon, Expired, Renewed, Terminated and Cancelled.',
      'List, Kanban and Calendar views; metric tiles for active, expiring and total value.',
      'Expiry reminders and a renewal follow-up task created automatically.',
    ],
    actions: [
      ['New contract', 'Creates a contract: customer, type, value, start and end dates, billing and renewal terms.'],
      ['Templates', 'Opens reusable contract wording with fields that fill in from the CRM.'],
      ['List / Kanban / Calendar', 'Changes the view; on the board, drag a contract to change its status.'],
      ['Search box and filters', 'Find contracts by number, title, customer or company.'],
    ],
    related: [['Contract templates', '/contracts/templates'], ['Documents', '/documents'], ['Contract settings', '/administration/modules/contracts']],
  },

  contractTemplates: {
    title: 'Contract templates',
    purpose: 'Reusable contract wording. Fields written as {{field}} fill in from the CRM when you generate a contract.',
    features: ['A list of templates by contract type.', 'An editor with the available fields.'],
    actions: [
      ['New template', 'Starts a template; write the wording and insert fields.'],
      ['Edit / Delete', 'Changes or removes a template.'],
      ['Back to Contracts', 'Returns to the contract list.'],
    ],
    related: [['Contracts', '/contracts']],
  },

  contractDetail: {
    title: 'Contract details',
    purpose: 'One contract with its terms, dates, value, linked records and what has happened to it.',
    features: ['Status and key dates, including end date and renewal date.', 'Linked customer, deal, project, sales order and invoices.', 'Documents, notes and a history of activity.'],
    actions: [
      ['Edit contract', 'Changes terms, dates and value while the contract allows it.'],
      ['Generate', 'Produces the contract document from a template.'],
      ['Signature / review meeting', 'Schedules a meeting for review or signing and joins it.'],
      ['Renew contract', 'Creates the renewal from this contract; Mark as not renewing records that it will end.'],
      ['Create renewal task', 'Adds a task so the renewal is not missed.'],
      ['Log activity / Log client communication / Add note', 'Records what has been said or done.'],
    ],
    related: [['All contracts', '/contracts'], ['Documents', '/documents']],
  },

  documents: {
    title: 'Documents',
    purpose: 'The central, access-controlled library for every file in the CRM. Each document is linked to the customer, deal, contract or project it belongs to.',
    features: [
      'Three views: List, Grid and Folders; quick groups such as Recent, My documents, Shared, Confidential, Favourites, Needs review, Archived and the Bin.',
      'Search by name, ID, customer, company, deal or contract; sort and save filters.',
      'Versions, sharing with expiry, access levels and an audit trail for every file.',
    ],
    actions: [
      ['Upload', 'Adds a file; choose its category and link it to a record. Allowed types and size are set in Document settings.'],
      ['New folder', 'Creates a folder to organise files.'],
      ['List / Grid / Folders', 'Changes the layout.'],
      ['Quick groups', 'Show only recent, yours, shared, confidential, favourite, review-due or archived documents, or the Bin.'],
      ['Save filter', 'Stores the current search and filters under a name.'],
      ['Settings', 'Administrators: categories, allowed file types, size limits and retention.'],
    ],
    tips: ['You only see documents you own, were given access to, or your role may open.', 'Deleted documents wait in the Bin until the retention period ends.'],
    related: [['Document settings', '/administration/modules/documents']],
  },

  documentDetail: {
    title: 'Document details',
    purpose: 'One file with its preview, versions, sharing and a full record of who did what to it.',
    features: ['Preview and download.', 'Version history and who can access it.', 'The records it is linked to, and its audit trail.'],
    actions: [
      ['Preview / Download', 'Opens the file or saves a copy.'],
      ['New version', 'Uploads a replacement and keeps the old versions in the history.'],
      ['Share / Manage', 'Gives access to people or teams (optionally until a date) and changes it later.'],
      ['Edit', 'Changes the name, category, links and visibility.'],
      ['Archive / Make active / Restore', 'Takes the file out of everyday use, brings it back, or recovers it from the Bin.'],
      ['Review deadline / Create task', 'Sets a date to review the file, or adds a task about it.'],
      ['Delete permanently', 'Removes a file in the Bin for good. This cannot be undone.'],
    ],
    related: [['All documents', '/documents']],
  },
}
