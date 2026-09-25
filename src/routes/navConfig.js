import {
  LayoutDashboard, Users, Inbox, Contact, Building2, UserSquare2, Handshake, Kanban,
  FileText, FileSignature, Activity, ListChecks, CalendarDays, Package, FolderKanban,
  FileCheck, ClipboardCheck, FolderOpen, Receipt, CreditCard, Wallet, Megaphone, Target, LineChart,
  Mail, MessageCircle, History, LifeBuoy, BarChart3, Sparkles, Bell, UserCog, UsersRound,
  ShieldCheck, Settings, Fingerprint,
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
      { label: 'User Management', to: '/user-management', icon: Fingerprint },
      { label: 'Teams', to: '/teams', icon: UsersRound },
      { label: 'Roles & Permissions', to: '/roles-permissions', icon: ShieldCheck },
    ],
  },
  {
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
]

export const QUICK_CREATE_ITEMS = [
  { label: 'New Lead', to: '/leads?create=1' },
  { label: 'New Enquiry', to: '/enquiries?create=1' },
  { label: 'New Contact', to: '/contacts?create=1' },
  { label: 'New Company', to: '/companies?create=1' },
  { label: 'New Deal', to: '/deals?create=1' },
  { label: 'New Task', to: '/tasks?create=1' },
  { label: 'New Meeting', to: '/calendar?create=1' },
  { label: 'New Quotation', to: '/quotations?create=1' },
  { label: 'New Project', to: '/projects?create=1' },
  { label: 'New Invoice', to: '/invoices?create=1' },
  { label: 'New Ticket', to: '/tickets?create=1' },
  { label: 'New User', to: '/user-management?create=1' },
]
