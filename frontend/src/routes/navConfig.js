import {
  LayoutDashboard, Users, Inbox, Contact, Building2, UserSquare2, Handshake, Kanban,
  FileText, FileSignature, Activity, ListChecks, CalendarDays, Package, FolderKanban,
  FileCheck, ClipboardCheck, FolderOpen, Receipt, CreditCard, Wallet, Megaphone, Target, LineChart,
  Mail, MessageCircle, History, LifeBuoy, BarChart3, Sparkles, Bell, UserCog, UsersRound,
  ShieldCheck, Settings, Fingerprint, MapPin, Network,
} from 'lucide-react'

export const NAV_SECTIONS = [
  {
    items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'CRM',
    items: [
      { label: 'Leads', to: '/leads', icon: Users },
      { label: 'Enquiries', to: '/enquiries', icon: Inbox },
      { label: 'Contacts', to: '/contacts', icon: Contact },
      { label: 'Companies', to: '/companies', icon: Building2 },
      { label: 'Customers', to: '/customers', icon: UserSquare2 },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'Deals', to: '/deals', icon: Handshake },
      { label: 'Sales Pipeline', to: '/pipeline', icon: Kanban },
      { label: 'Quotations', to: '/quotations', icon: FileText },
      { label: 'Sales Orders', to: '/sales-orders', icon: ClipboardCheck },
      { label: 'Proposals', to: '/proposals', icon: FileSignature },
    ],
  },
  {
    title: 'Activities',
    items: [
      { label: 'Activities', to: '/activities', icon: Activity },
      { label: 'Tasks', to: '/tasks', icon: ListChecks },
      { label: 'Calendar', to: '/calendar', icon: CalendarDays },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Products & Services', to: '/products', icon: Package },
      { label: 'Projects', to: '/projects', icon: FolderKanban },
      { label: 'Contracts', to: '/contracts', icon: FileCheck },
      { label: 'Documents', to: '/documents', icon: FolderOpen },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Invoices', to: '/invoices', icon: Receipt },
      { label: 'Payments', to: '/payments', icon: CreditCard },
      { label: 'Expenses', to: '/expenses', icon: Wallet },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Campaigns', to: '/campaigns', icon: Megaphone },
      { label: 'Lead Sources', to: '/lead-sources', icon: Target },
      { label: 'Marketing Analytics', to: '/marketing-analytics', icon: LineChart },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Email', to: '/communication/email', icon: Mail },
      { label: 'WhatsApp', to: '/communication/whatsapp', icon: MessageCircle },
      { label: 'Communication History', to: '/communication/history', icon: History },
    ],
  },
  {
    title: 'Support',
    items: [{ label: 'Helpdesk / Tickets', to: '/tickets', icon: LifeBuoy }],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Sales Reports', to: '/reports/sales', icon: BarChart3 },
      { label: 'Lead Reports', to: '/reports/leads', icon: BarChart3 },
      { label: 'Marketing Reports', to: '/reports/marketing', icon: BarChart3 },
      { label: 'Finance Reports', to: '/reports/finance', icon: BarChart3 },
      { label: 'Project Reports', to: '/reports/projects', icon: BarChart3 },
      { label: 'Team Performance', to: '/reports/team', icon: BarChart3 },
    ],
  },
  {
    items: [
      { label: 'AI Insights', to: '/ai-insights', icon: Sparkles },
      { label: 'Notifications', to: '/notifications', icon: Bell },
    ],
  },
  {
    title: 'Team',
    items: [
      { label: 'Employees', to: '/employees', icon: UserCog },
      { label: 'Teams', to: '/teams', icon: UsersRound },
    ],
  },
  // Administration: running the organisation itself - branches, who may sign in and what each role may do. These three modules are the Super Admin's alone (no stored permission can grant them).
  {
    title: 'Administration',
    items: [
      { label: 'Branches', to: '/administration/branches', icon: MapPin },
      { label: 'User Management', to: '/administration/users', icon: Fingerprint },
      { label: 'Roles & Permissions', to: '/administration/roles-permissions', icon: ShieldCheck },
    ],
  },
  // Settings: workspace configuration and personal preferences (company profile, personalization, tax, module settings, security and logs, notifications, e-mail, WhatsApp, automation).
  {
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
]

/**
 * The Administration overview (/administration): what is run from there. `module` is the permission module that must be viewable for an entry to appear. An entry with `external`
 * opens a page of another module (so nothing is duplicated here).
 */
export const ADMIN_CATEGORIES = [
  {
    key: 'organization', title: 'Organization', description: 'Your branches and the people and teams in them.',
    items: [
      { key: 'branches', label: 'Branches', to: '/administration/branches', icon: MapPin, module: 'Branches', description: 'Branch offices, their administrators and a side-by-side comparison.' },
      { key: 'departments', label: 'Departments & Teams', to: '/employees?view=departments', icon: Network, module: 'Employees', external: true, description: 'Managed in Employees, so they stay linked to the people in them.' },
    ],
  },
  {
    key: 'access', title: 'Users & Access', description: 'Who can sign in and what they may do.',
    items: [
      { key: 'users', label: 'User Management', to: '/administration/users', icon: Fingerprint, module: 'User Management', description: 'Create logins, set roles, reset passwords and manage account status.' },
      { key: 'roles-permissions', label: 'Roles & Permissions', to: '/administration/roles-permissions', icon: ShieldCheck, module: 'Roles & Permissions', description: 'What each role may view, create, edit, delete and export.' },
    ],
  },
]

export const QUICK_CREATE_ITEMS = [
  { label: 'New Lead', to: '/leads?create=1', module: 'Leads' },
  { label: 'New Enquiry', to: '/enquiries?create=1', module: 'Enquiries' },
  { label: 'New Contact', to: '/contacts?create=1', module: 'Contacts' },
  { label: 'New Company', to: '/companies?create=1', module: 'Companies' },
  { label: 'New Deal', to: '/deals?create=1', module: 'Deals' },
  { label: 'New Task', to: '/tasks?create=1', module: 'Tasks' },
  { label: 'New Meeting', to: '/calendar?create=1', module: 'Calendar' },
  { label: 'New Quotation', to: '/quotations?create=1', module: 'Quotations' },
  { label: 'New Project', to: '/projects?create=1', module: 'Projects' },
  { label: 'New Invoice', to: '/invoices?create=1', module: 'Invoices' },
  { label: 'New Ticket', to: '/tickets?create=1', module: 'Tickets' },
  { label: 'New User', to: '/administration/users?create=1', module: 'User Management' },
]
