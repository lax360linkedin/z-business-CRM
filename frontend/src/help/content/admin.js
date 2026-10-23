// Team, Settings and account pages.
export const admin = {
  administration: {
    title: 'Administration',
    purpose: 'The place for running the organisation itself: its branches, the user accounts that can sign in, and what each role may do. It is for the Super Admin; the workspace configuration and your own preferences are in Settings.',
    features: ['Cards for Branches, User Management, Roles & Permissions and the way to Departments & Teams (which live in Employees).', 'You only see the cards your role may open; anyone else is pointed to Settings.', 'The company profile, appearance, tax, module settings, security, logs, notifications, e-mail, WhatsApp and automation are in Settings, not here.'],
    actions: [['Cards', 'Each card opens that page.'], ['Settings link', 'Opens Settings for everything else.']],
    tips: ['Branches, User Management and Roles & Permissions can only be opened by the Super Admin, whatever a stored permission says.'],
    related: [['Settings', '/settings'], ['Branches', '/administration/branches'], ['User Management', '/administration/users']],
  },
  branches: {
    title: 'Branch Management',
    purpose: 'An overview of your branches (such as Salem, Mumbai and Bangalore) with their people and activity, and the place to start working inside one of them.',
    features: ['One card per branch with its headline numbers.', 'The branch selector in the top bar changes the scope of every page; a branch user is always fixed to their own branch.', 'Activate or deactivate a branch without losing its records.'],
    actions: [
      ['Open branch', 'Switches your working scope to that branch so every page shows only its records.'],
      ['Users', 'Opens User Management filtered to that branch.'],
      ['Activate / Deactivate', 'A deactivated branch is no longer offered in the selector; its records and people stay as they are.'],
    ],
    related: [['User Management', '/administration/users'], ['Employees', '/employees']],
  },

  employees: {
    title: 'Employees',
    purpose: 'The employee directory and organisation structure: everyone who works for the company, their department, team, manager and status, linked to User Management for CRM access.',
    features: [
      'Four views: Directory, Organization chart, Departments and Teams.',
      'Search and filters for department, team, team leader, status, CRM access, workload, work location and joining dates; save a view you use often.',
      'Status changes are dated, need a reason and are recorded, so nobody’s history is lost.',
    ],
    actions: [
      ['Add employee', 'Creates an employee record: name, email, designation, joining date, branch, department, team, manager and work details. Tick the option to create their CRM login straight away.'],
      ['Work location', 'Choose Office, Remote, Hybrid or Others; with Others, type the place.'],
      ['Download Excel Template', 'Downloads an .xlsx for employee import: required columns starred, dropdowns for Branch, Department, Employment Type, Status, Work Mode, Shift and more, and Instructions and Examples sheets.'],
      ['Import', 'Choose the filled Excel (.xlsx) or CSV file. Every row is checked before anything is created; rows with problems are listed and can be corrected right in the window. Employees are imported all together, so fix every problem first. The Super Admin names the Branch on each row.'],
      ['Export', 'Downloads the filtered list.'],
      ['Columns / Saved views', 'Choose which columns show and save a filter combination under a name.'],
      ['Bulk actions', 'Select several people and change their department, team, status or role together.'],
      ['Row menu (⋯)', 'View profile, Call, Email, Assign task, Edit, Change status, Grant CRM access and, for the Super Admin, Delete employee.'],
    ],
    workflows: [{ title: 'Onboarding a new employee', steps: [
      'Choose Add employee and fill in the details; pick their branch, department, team and manager.',
      'Save. They now appear in the directory.',
      'Choose Grant CRM access (or tick the option while adding) and pick their role, permissions and sign-in details.',
      'Share the temporary password; they must change it the first time they sign in.',
    ] }],
    tips: ['Deleting an employee (Super Admin only) also removes their login. Their leads, tasks and other records stay and can be handed to a colleague in the same step.', 'People who leave are better marked Resigned or Terminated with a reason, which keeps their record.'],
    related: [['User Management', '/administration/users'], ['Branches', '/administration/branches'], ['Roles & Permissions', '/administration/roles-permissions']],
  },

  teams: {
    title: 'Teams',
    purpose: 'Teams and departments live inside the Employees page. This view opens the Employees page so you can see how people are grouped and who leads each team.',
    features: ['The Teams and Departments tabs list each group with its leader and members.', 'The Organization chart shows who reports to whom.'],
    actions: [
      ['Departments / Teams tabs', 'Create, edit or deactivate a department or team, and choose its head or leader.'],
      ['Open a team or department', 'Shows its members, sub-teams and history.'],
    ],
    related: [['Employees', '/employees']],
  },

  employeeDetail: {
    title: 'Employee profile',
    purpose: 'One employee’s record: personal and employment details, where they sit in the organisation, their work and their CRM access.',
    features: ['Tabs for Overview, Employment, Organization and CRM access, plus the tasks, deals, leads and tickets they handle.', 'Workload level, reporting line and the teams they lead.', 'A timeline of changes such as status, department and access.'],
    actions: [
      ['Edit', 'Changes employment and personal details.'],
      ['Change status', 'Moves the person between Active, On Leave, Resigned, Terminated and so on, with a date and reason. Leaving statuses switch off their login.'],
      ['Assign task', 'Gives them a task.'],
      ['Call / Email', 'Contacts them.'],
      ['Grant CRM access / Open in User Management', 'Creates their login, or opens the linked account.'],
      ['Documents', 'Opens their documents tab.'],
      ['Delete', 'Super Admin only: removes the employee and their login after you confirm. You cannot delete yourself or the last active Super Admin.'],
    ],
    related: [['All employees', '/employees'], ['User Management', '/administration/users']],
  },

  departmentDetail: {
    title: 'Department',
    purpose: 'One department or service division: who heads it, which teams belong to it and who works in it.',
    features: ['The department head, its code and colour, and whether it is active.', 'The teams and employees that belong to it.', 'A back link to the Departments tab of the Employees page.'],
    actions: [
      ['Edit', 'Changes the department’s name, code, colour, head and status where your role allows.'],
      ['Add team', 'Creates a team inside this department.'],
      ['Open a team or employee', 'Click through to the team page or the person’s profile.'],
      ['Back to departments', 'Returns to the Departments tab.'],
    ],
    related: [['Employees', '/employees']],
  },

  teamDetail: {
    title: 'Team',
    purpose: 'One team: who leads it, who works in it and any sub-teams inside it.',
    features: ['The team leader and the deputy or assistant leader, with the department it belongs to.', 'Members and sub-teams.', 'Team history: a dated list of changes to the team’s leadership and members.'],
    actions: [
      ['Edit / change leader', 'Changes the team’s name, status, leader and deputy where your role allows.'],
      ['Add sub-team', 'Creates a smaller team inside this one.'],
      ['Open a member', 'Goes to their profile.'],
      ['Back to teams', 'Returns to the Teams tab.'],
    ],
    related: [['Employees', '/employees']],
  },

  userManagement: {
    title: 'User Management',
    purpose: 'Where the Super Admin creates CRM logins for Admins and Employees and controls their role, branch, module permissions and sign-in security.',
    features: [
      'Tiles for total, active, inactive, pending and locked users, with a list of every login.',
      'Filters for role, branch, department, status and last sign-in.',
      'Each person’s login is linked to their employee record, so the two stay in step.',
    ],
    actions: [
      ['Add User', 'Creates a login: name, email, username, role, branch, department and starting permissions, with a temporary password they must change.'],
      ['Search box and filters', 'Find users by name, email, phone or ID; narrow by role, branch, department, status or last sign-in.'],
      ['Row menu (⋯)', 'View, Edit, View Login Activity, Activate / Deactivate / Suspend, Unlock, Terminate Session, Reset Password, Role & permissions, Change Department and Delete User.'],
      ['Terminate Session', 'Signs the person out everywhere straight away.'],
      ['Delete User', 'Removes the login and the employee record together after you confirm. Your own account and the last active Super Admin cannot be deleted.'],
    ],
    workflows: [{ title: 'Giving someone access', steps: [
      'Choose Add User (or Grant CRM access on their employee profile).',
      'Pick the access level (Admin or Employee), job role and branch; adjust module permissions if the starting set is not right.',
      'Save and copy the temporary password shown once.',
      'Give it to the person; they set their own password at first sign-in.',
    ] }],
    tips: ['Changes to a role, branch or permission take effect on the person’s live session without them signing in again.', 'Only the Super Admin can open this page.'],
    related: [['Employees', '/employees'], ['Roles & Permissions', '/administration/roles-permissions'], ['Security settings', '/settings/security']],
  },

  userDetail: {
    title: 'User account',
    purpose: 'One person’s CRM login: their role and permissions, sign-in history and security, and the records assigned to them.',
    features: ['Tabs for Overview, Credentials, Permissions, Login Activity, Assigned Records, Tasks, Activities and Security.', 'Where and when they signed in, and any open sessions.'],
    actions: [
      ['Edit User', 'Changes name, email, phone and department.'],
      ['Activate / Deactivate', 'Allows or blocks sign-in; a deactivated user is signed out.'],
      ['Reset Password / Change Password', 'Issues a one-time temporary password, or sets a specific one.'],
      ['Lock User / Unlock User', 'Blocks or restores sign-in without deactivating the account.'],
      ['Permissions tab', 'Change the access level, branch and per-module permissions, then Save role & permissions.'],
      ['Delete User', 'Removes the login and employee record together after you confirm, with an option to hand their work to a colleague.'],
    ],
    related: [['All users', '/administration/users'], ['Roles & Permissions', '/administration/roles-permissions']],
  },

  roles: {
    title: 'Roles & Permissions',
    purpose: 'The permission templates that give new accounts their starting access for Admin, Employee and each job profile, module by module.',
    features: ['A grid of modules against actions (view, create, edit, delete, export) for the template you pick.', 'Only the Super Admin can change templates; individual accounts are fine-tuned in User Management.'],
    actions: [
      ['Template selector', 'Choose the role whose permissions you want to see or change.'],
      ['Tick or untick an action', 'Grants or removes that action for the module.'],
      ['Save Changes', 'Stores your edits.'],
      ['Reset to Defaults', 'Returns the template to its built-in permissions.'],
      ['New template', 'Creates your own job profile with its own starting permissions.'],
    ],
    tips: ['Changing a template affects accounts created from it in future; existing accounts keep their own permissions until you edit them.'],
    related: [['User Management', '/administration/users']],
  },

  profile: {
    title: 'My Profile',
    purpose: 'Your own details and sign-in security: update how you appear in the CRM and see where you are signed in.',
    features: ['Your name, email, phone and role.', 'The devices and sessions you are signed in on.'],
    actions: [
      ['Save Changes', 'Stores edits to your own details (your role and access can only be changed by an administrator).'],
      ['Logout', 'Ends this session; Logout All Devices ends every session you have.'],
    ],
    tips: ['To change your password, use the menu under your name (top right) → Change Password.'],
    related: [['Change Password', '/change-password']],
  },

  changePassword: {
    title: 'Change Password',
    purpose: 'Set a new password for your account. You are sent here the first time you sign in with a temporary password.',
    features: ['A strength meter that shows whether the new password is strong enough.', 'Your other sessions are signed out when the password changes.'],
    actions: [
      ['Current password', 'The password you are using now (or the temporary one you were given).'],
      ['New password / Confirm new password', 'Use a long, unique password; both entries must match.'],
      ['Update Password', 'Saves the new password.'],
    ],
    related: [['My Profile', '/profile']],
  },
}

// Settings pages (matched by the part after /settings/)
export const settings = {
  'company-profile': {
    title: 'Settings · Company Profile',
    purpose: 'Your organisation’s basic details and logo. They appear on quotations, invoices and the sign-in screens.',
    features: ['Company name, industry, phone, email, website, GST number and address.', 'The company logo, shown in the sidebar, on the sign-in screens, in quotation previews and PDFs and as the browser tab icon.'],
    actions: [
      ['Upload logo / Change logo', 'Super Admin only. Choose a PNG, JPG or SVG up to 1 MB; you see it on light and dark backgrounds before saving.'],
      ['Save logo / Cancel', 'Applies the new logo everywhere, or discards your choice.'],
      ['Remove logo', 'Goes back to the default LAX360 logo.'],
      ['Save Changes', 'Stores the company details. Only administrators can edit; everyone else sees them read-only.'],
    ],
    related: [['Quotation templates', '/quotation-templates']],
  },
  personalization: {
    title: 'Settings · Personalization',
    purpose: 'Make the CRM look and feel the way you work best: light, dark or system mode, an accent colour, an interface style, contrast, surfaces, text size and spacing. It only changes how the CRM looks for you, never what you can see or do.',
    features: [
      'Mode: Light, Dark, or System (follows your device), each with a small preview.',
      'Accent colour: 20 ready-made palettes or any colour you type as HEX. Every palette gets matching light and dark shades, and text on it is kept readable.',
      'Interface style: Classic, Modern (the standard look), Glass, Minimal or High Contrast, each with a preview card.',
      'Contrast & accessibility: Standard, Increased, High, or Automatic (follows your device when it reports a more-contrast setting).',
      'Background and surfaces: background type, card surface, border strength, shadow strength, corner radius, and the blur used by the Glass style.',
      'Text size (Small / Medium / Large), density (Compact / Comfortable / Spacious) and readability (Standard / Enhanced).',
      'A live preview panel; the whole CRM also shows your changes while you are on this page.',
    ],
    actions: [
      ['Choosing an option', 'Shows it straight away everywhere. Nothing is saved until you press Apply Changes.'],
      ['Apply Changes', 'Saves the look for your account on this device and keeps it as you move around the CRM and after you sign in again.'],
      ['Discard', 'Throws away the changes you have not applied. Leaving the page does the same.'],
      ['Reset to Default', 'Previews the standard look (Modern, purple, system mode); press Apply Changes to keep it.'],
      ['Custom colour', 'Type a HEX colour such as #0f766e or use the colour picker. If it is too light for readable text it is darkened slightly and you are told.'],
    ],
    related: [['My profile', '/profile'], ['Company Profile', '/settings/company-profile']],
  },
  'tax-settings': {
    title: 'Settings · Tax Settings',
    purpose: 'The tax defaults applied to new quotations and invoices.',
    features: ['GST number, default tax rate and whether prices include tax.'],
    actions: [['Prices are tax-inclusive', 'Switch on if the listed price already includes tax; off adds tax on top.'], ['Save Changes', 'Stores the defaults (administrators only).']],
    related: [['Invoice settings', '/settings/modules/invoices']],
  },
  users: {
    title: 'Settings · Users',
    purpose: 'A pointer to where user accounts are managed.',
    features: ['Accounts are managed in Employees and, for the Super Admin, in Administration → User Management, so the same people are not kept in two places.'],
    actions: [['Go to Employees', 'Opens the employee directory.'], ['Open User Management', 'Opens the logins and roles page (Super Admin only).']],
    related: [['User Management', '/administration/users'], ['Employees', '/employees']],
  },
  departments: {
    title: 'Settings · Departments',
    purpose: 'A pointer to where departments and teams are managed.',
    features: ['Departments and teams are part of the Employees page.'],
    actions: [['Open Employees', 'Go to the Departments and Teams tabs to create or edit them.']],
    related: [['Employees', '/employees']],
  },
  security: {
    title: 'Settings · Security',
    purpose: 'Sign-in security for the whole workspace, including how long the CRM can sit unused before it signs people out.',
    features: ['How sign-in and sessions are protected; every rule shown is enforced by the server.', 'The inactivity timeout, with its current value and whether it is the default.', 'Only administrators can see the security configuration.'],
    actions: [['Inactivity timeout', 'Super Admin only: choose how many minutes of no activity sign a person out (5 to 480). People get a warning before it happens.'], ['Save', 'Applies it to everyone on their next activity.']],
    related: [['Login History', '/settings/login-history'], ['User Management', '/administration/users']],
  },
  'login-history': {
    title: 'Settings · Login History',
    purpose: 'Every sign-in attempt across your workspace: who, when, from where (IP address) and whether it succeeded.',
    features: ['User, event, IP address, status and date and time for each attempt.'],
    actions: [['Search and filters', 'Find a person or a kind of event.'], ['Status column', 'Failed or denied attempts help you spot someone trying to get into an account.']],
    related: [['Audit Logs', '/settings/audit-logs']],
  },
  'audit-logs': {
    title: 'Settings · Audit Logs',
    purpose: 'A read-only record of sign-ins, refusals and changes across your workspace. Entries are only ever added; they cannot be edited or deleted.',
    features: ['Each entry shows the action, module, user, result and time.'],
    actions: [['Search box (action, user, record…)', 'Find entries by action, person or record.']],
    tips: ['Deleting an employee, changing the logo, changing permissions and automation changes all appear here.'],
    related: [['Login History', '/settings/login-history']],
  },
  'notification-settings': {
    title: 'Settings · Notification Settings',
    purpose: 'Choose which events create an in-app notification for your team.',
    features: ['Notifications appear in the bell at the top of the CRM. Email, SMS and push delivery are not connected to this workspace.'],
    actions: [['Toggles', 'Turn a notification type on or off.'], ['Save Changes', 'Stores your choices (administrators only).']],
    related: [['Notifications', '/notifications']],
  },
  'email-settings': {
    title: 'Settings · Email Settings',
    purpose: 'Shows whether email sending is connected for this CRM.',
    features: ['The connection status and what is needed to connect it.'],
    actions: [['Status panel', 'Administrators can see whether email is connected; nothing is sent until the server is configured.']],
    tips: ['Until email is connected, “sent” in the CRM only records that you handled it yourself.'],
    related: [['Email log', '/communication/email']],
  },
  'whatsapp-settings': {
    title: 'Settings · WhatsApp Settings',
    purpose: 'Shows whether WhatsApp messaging is connected for this CRM.',
    features: ['The connection status and what is needed to connect it.'],
    actions: [['Status panel', 'Administrators can see whether WhatsApp is connected; nothing is sent until the server is configured.']],
    related: [['WhatsApp log', '/communication/whatsapp']],
  },
  automation: {
    title: 'Settings · Automation',
    purpose: 'Connect n8n so CRM events (a new lead, a deal won, an overdue-follow-up insight) can start your business workflows, and see exactly what happened to each one.',
    features: [
      'The n8n connection (address and a shared secret), then a list of workflows, each listening to one CRM event.',
      'A run history with Success, Failed, Running and Queued, the reason for any failure and automatic retries.',
      'The CRM’s own built-in background rules are described at the bottom.',
    ],
    actions: [
      ['Send events to n8n', 'Master switch for the connection.'],
      ['n8n address / Shared secret / Header name', 'Where n8n lives and the key the CRM sends so n8n can trust the message. The secret is stored encrypted and never shown again.'],
      ['Test connection', 'Checks that n8n answers.'],
      ['Add workflow', 'Choose the CRM event, paste the webhook address of the n8n Webhook node, and optionally limit it to one new status or stage.'],
      ['Send test', 'Sends a marked test message to a workflow.'],
      ['Run history filters / Retry', 'Filter by status or workflow; Retry sends a failed run again.'],
    ],
    workflows: [{ title: 'Connecting your first workflow', steps: [
      'In n8n, add a Webhook node (POST, Header Auth) and activate the workflow; copy its Production URL.',
      'Here, enter the n8n address and a shared secret (the same one used by the node), switch on Send events to n8n, and Save.',
      'Choose Test connection to confirm n8n is reachable.',
      'Choose Add workflow, select the event and paste the Production URL. Save.',
      'Choose Send test and check the run history; then try the real event.',
    ] }],
    tips: ['Only the Super Admin can change the connection and workflows; Admins can see runs for their branch and retry failed ones.'],
    related: [['AI Insights', '/ai-insights'], ['Task settings', '/tasks/settings']],
  },
}

// Settings → module option pages (matched by /settings/modules/:key)
const MODULE_SETTINGS = {
  leads: ['Leads', 'the statuses’ reasons, sources, priorities and other choices offered on lead forms, filters and the qualify, unqualified and lost dialogs'],
  enquiries: ['Enquiries', 'the choices offered on enquiry forms, filters, assignment and qualification'],
  companies: ['Companies & Customers', 'industries, cities and the other choices offered on company and customer forms and filters'],
  deals: ['Deals', 'the reasons offered when a deal is lost and the other choices used by the pipeline'],
  quotations: ['Quotations & Sales Orders', 'payment terms offered on quotations and orders, and the quotation templates'],
  products: ['Products & Services', 'categories, types, units of sale and billing cycles used by the catalogue'],
  invoices: ['Invoices & Payments', 'numbering, terms, tax lines, payment methods and receiving accounts'],
  contracts: ['Contracts', 'contract types, the approval step, renewal reminders and the expiring-soon window'],
  documents: ['Documents', 'document categories, allowed file types, size limits and how long deleted files are kept'],
  tickets: ['Support Tickets', 'the categories and sources offered on tickets and in ticket filters'],
  campaigns: ['Campaigns', 'the channels a campaign can run on'],
  expenses: ['Expenses', 'where expense categories and vendors are managed (on the Expenses page itself)'],
  tasks: ['Tasks', 'task automation rules, permissions and attachment limits'],
}

export function moduleSettingsHelp(key) {
  const m = MODULE_SETTINGS[key]
  if (!m) return null
  const [label, what] = m
  return {
    title: `Settings · ${label}`,
    purpose: `Control ${what}. These settings change what people can choose in the ${label.toLowerCase()} part of the CRM, without changing any code.`,
    features: ['Each list shows its current choices, in the order people see them.', 'Everyone can see the settings; only the Super Admin can change them.'],
    actions: [
      ['Add', 'Adds a new choice to the list.'],
      ['Rename', 'Changes a choice’s wording; records that already use it follow the new wording.'],
      ['Turn off / on', 'Hides a choice from new forms while keeping it on old records.'],
      ['Reorder', 'Changes the order the choices appear in.'],
      ['Delete', 'Removes a choice that no record uses (the page shows how many records use each one).'],
      ['Reset to defaults', 'Restores the built-in list.'],
    ],
    tips: ['Turning a choice off is safer than deleting it when it is already in use.'],
    related: [['Settings overview', '/settings/company-profile']],
  }
}
