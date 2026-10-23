import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { ThemeProvider, useBindThemeUser } from './context/ThemeContext'
import { useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider } from './context/AuthContext'
import { SidebarProvider } from './context/SidebarContext'
import { BranchProvider } from './context/BranchContext'
const Branches = lazyPage(() => import('./pages/Branches/Branches'))
import { ProtectedRoute } from './routes/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { AuthLayout } from './components/layout/AuthLayout'
import { lazyPage, registerPreloads, registerPaths } from './routes/lazyPage'

import Login from './pages/Auth/Login'
import ForgotPassword from './pages/Auth/ForgotPassword'
const ChangePassword = lazyPage(() => import('./pages/Auth/ChangePassword'))
const Profile = lazyPage(() => import('./pages/Auth/Profile'))

const Dashboard = lazyPage(() => import('./pages/Dashboard/Dashboard'))
const Leads = lazyPage(() => import('./pages/Leads/Leads'))
const LeadDetail = lazyPage(() => import('./pages/Leads/LeadDetail'))
const MeetingJoin = lazyPage(() => import('./pages/Leads/MeetingJoin'))
const Enquiries = lazyPage(() => import('./pages/Enquiries/Enquiries'))
const EnquiryDetail = lazyPage(() => import('./pages/Enquiries/EnquiryDetail'))
const Contacts = lazyPage(() => import('./pages/Contacts/Contacts'))
const ContactDetail = lazyPage(() => import('./pages/Contacts/ContactDetail'))
const Companies = lazyPage(() => import('./pages/Companies/Companies'))
const CompanyDetail = lazyPage(() => import('./pages/Companies/CompanyDetail'))
const Customers = lazyPage(() => import('./pages/Customers/Customers'))
const CustomerDetail = lazyPage(() => import('./pages/Customers/CustomerDetail'))
const Deals = lazyPage(() => import('./pages/Deals/Deals'))
const DealDetail = lazyPage(() => import('./pages/Deals/DealDetail'))
const Pipeline = lazyPage(() => import('./pages/Pipeline/Pipeline'))
const Quotations = lazyPage(() => import('./pages/Quotations/Quotations'))
const QuotationDetail = lazyPage(() => import('./pages/Quotations/QuotationDetail'))
const QuotationTemplates = lazyPage(() => import('./pages/Settings/QuotationTemplates'))
const QuotationTemplateEditor = lazyPage(() => import('./pages/Settings/QuotationTemplateEditor'))
const SalesOrders = lazyPage(() => import('./pages/SalesOrders/SalesOrders'))
const SalesOrderDetail = lazyPage(() => import('./pages/SalesOrders/SalesOrderDetail'))
const SalesOrderForm = lazyPage(() => import('./pages/SalesOrders/SalesOrderForm'))
const Proposals = lazyPage(() => import('./pages/Proposals/Proposals'))
const ProposalDetail = lazyPage(() => import('./pages/Proposals/ProposalDetail'))
const ProposalForm = lazyPage(() => import('./pages/Proposals/ProposalForm'))
const ProposalTemplates = lazyPage(() => import('./pages/Proposals/ProposalTemplates'))
const ProposalTemplateEditor = lazyPage(() => import('./pages/Proposals/ProposalTemplateEditor'))
const Activities = lazyPage(() => import('./pages/Activities/Activities'))
const Tasks = lazyPage(() => import('./pages/Tasks/Tasks'))
const TaskDetail = lazyPage(() => import('./pages/Tasks/TaskDetail'))
const TaskSettings = lazyPage(() => import('./pages/Tasks/TaskSettings'))
const CalendarPage = lazyPage(() => import('./pages/Calendar/Calendar'))
const Products = lazyPage(() => import('./pages/Products/Products'))
const ProductDetail = lazyPage(() => import('./pages/Products/ProductDetail'))
const Projects = lazyPage(() => import('./pages/Projects/Projects'))
const ProjectDetail = lazyPage(() => import('./pages/Projects/ProjectDetail'))
const Contracts = lazyPage(() => import('./pages/Contracts/Contracts'))
const ContractDetail = lazyPage(() => import('./pages/Contracts/ContractDetail'))
const ContractTemplatesPage = lazyPage(() => import('./pages/Contracts/ContractTemplatesPage'))
const Documents = lazyPage(() => import('./pages/Documents/Documents'))
const PaymentDetail = lazyPage(() => import('./pages/Payments/PaymentDetail'))
const DocumentDetail = lazyPage(() => import('./pages/Documents/DocumentDetail'))
const Invoices = lazyPage(() => import('./pages/Invoices/Invoices'))
const InvoiceDetail = lazyPage(() => import('./pages/Invoices/InvoiceDetail'))
const Payments = lazyPage(() => import('./pages/Payments/Payments'))
const Expenses = lazyPage(() => import('./pages/Expenses/Expenses'))
const ExpenseDetail = lazyPage(() => import('./pages/Expenses/ExpenseDetail'))
const Campaigns = lazyPage(() => import('./pages/Campaigns/Campaigns'))
const CampaignDetail = lazyPage(() => import('./pages/Campaigns/CampaignDetail'))
const LeadSourceDetail = lazyPage(() => import('./pages/LeadSources/LeadSourceDetail'))
const LeadSources = lazyPage(() => import('./pages/LeadSources/LeadSources'))
const MarketingAnalytics = lazyPage(() => import('./pages/MarketingAnalytics/MarketingAnalytics'))
const CommunicationEmail = lazyPage(() => import('./pages/Communication/Email'))
const CommunicationWhatsApp = lazyPage(() => import('./pages/Communication/WhatsApp'))
const CommunicationHistory = lazyPage(() => import('./pages/Communication/History'))
const Tickets = lazyPage(() => import('./pages/Tickets/Tickets'))
const TicketDetail = lazyPage(() => import('./pages/Tickets/TicketDetail'))
const Reports = lazyPage(() => import('./pages/Reports/Reports'))
const AIInsights = lazyPage(() => import('./pages/AIInsights/AIInsights'))
const Notifications = lazyPage(() => import('./pages/Notifications/Notifications'))
const Employees = lazyPage(() => import('./pages/Employees/Employees'))
const UserManagement = lazyPage(() => import('./pages/UserManagement/UserManagement'))
const UserDetail = lazyPage(() => import('./pages/UserManagement/UserDetail'))
const EmployeeDetail = lazyPage(() => import('./pages/Employees/EmployeeDetail'))
const DepartmentDetail = lazyPage(() => import('./pages/Employees/OrgDetails').then((m) => ({ default: m.DepartmentDetail })))
const TeamDetail = lazyPage(() => import('./pages/Employees/OrgDetails').then((m) => ({ default: m.TeamDetail })))
const RolesPermissions = lazyPage(() => import('./pages/RolesPermissions/RolesPermissions'))
const Settings = lazyPage(() => import('./pages/Settings/Settings'))
const Administration = lazyPage(() => import('./pages/Administration/Administration'))
import NotFound from './pages/NotFound/NotFound'

// every page is its own chunk, fetched when first opened (and fetched ahead of time: see routes/lazyPage.js) - the app shell no longer carries all 60+ screens
registerPreloads({ Branches, ChangePassword, Profile, Dashboard, Leads, LeadDetail, MeetingJoin, Enquiries, EnquiryDetail, Contacts, ContactDetail, Companies, CompanyDetail, Customers, CustomerDetail, Deals, DealDetail, Pipeline, Quotations, QuotationDetail, QuotationTemplates, QuotationTemplateEditor, SalesOrders, SalesOrderDetail, SalesOrderForm, Proposals, ProposalDetail, ProposalForm, ProposalTemplates, ProposalTemplateEditor, Activities, Tasks, TaskDetail, TaskSettings, CalendarPage, Products, ProductDetail, Projects, ProjectDetail, Contracts, ContractDetail, ContractTemplatesPage, Documents, PaymentDetail, DocumentDetail, Invoices, InvoiceDetail, Payments, Expenses, ExpenseDetail, Campaigns, CampaignDetail, LeadSourceDetail, LeadSources, MarketingAnalytics, CommunicationEmail, CommunicationWhatsApp, CommunicationHistory, Tickets, TicketDetail, Reports, AIInsights, Notifications, Employees, UserManagement, UserDetail, EmployeeDetail, DepartmentDetail, TeamDetail, RolesPermissions, Settings, Administration })
registerPaths({ '/login': Login, '/forgot-password': ForgotPassword, '/dashboard': Dashboard, '/leads': Leads, '/enquiries': Enquiries, '/contacts': Contacts, '/companies': Companies, '/customers': Customers, '/deals': Deals, '/pipeline': Pipeline, '/quotations': Quotations, '/quotation-templates': QuotationTemplates, '/sales-orders': SalesOrders, '/sales-orders/new': SalesOrderForm, '/proposals': Proposals, '/proposals/new': ProposalForm, '/proposal-templates': ProposalTemplates, '/activities': Activities, '/tasks': Tasks, '/tasks/settings': TaskSettings, '/calendar': CalendarPage, '/products': Products, '/projects': Projects, '/contracts': Contracts, '/contracts/templates': ContractTemplatesPage, '/documents': Documents, '/invoices': Invoices, '/payments': Payments, '/expenses': Expenses, '/campaigns': Campaigns, '/lead-sources': LeadSources, '/marketing-analytics': MarketingAnalytics, '/communication/email': CommunicationEmail, '/communication/whatsapp': CommunicationWhatsApp, '/communication/history': CommunicationHistory, '/tickets': Tickets, '/ai-insights': AIInsights, '/notifications': Notifications, '/employees': Employees, '/administration': Administration, '/administration/branches': Branches, '/administration/users': UserManagement, '/teams': Employees, '/administration/roles-permissions': RolesPermissions, '/change-password': ChangePassword, '/profile': Profile })

// pages that moved into Administration: old address -> new address (`:id` is carried over, and so is the query string)
const MOVED = [['/branches', '/administration/branches'], ['/user-management', '/administration/users'], ['/user-management/:id', '/administration/users/:id'], ['/roles-permissions', '/administration/roles-permissions']]
function MovedTo({ to }) {
  const { id } = useParams()
  const { search } = useLocation()
  return <Navigate to={`${id ? to.replace(':id', encodeURIComponent(id)) : to}${search}`} replace />
}

/** Each signed-in person keeps their own Personalization (in this browser): tells the theme who is signed in. */
function ThemeUserSync() {
  const { user } = useAuth()
  useBindThemeUser(user?.id)
  return null
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <ThemeUserSync />
          <BranchProvider>
          <SidebarProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AuthLayout />}>
                  <Route path="/login" element={<Login />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                </Route>

                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />

                    <Route path="/leads" element={<Leads />} />
                    <Route path="/leads/:id" element={<LeadDetail />} />
                    <Route path="/meetings/:id" element={<MeetingJoin />} />
                    <Route path="/enquiries" element={<Enquiries />} />
                    <Route path="/enquiries/:id" element={<EnquiryDetail />} />
                    <Route path="/contacts" element={<Contacts />} />
                    <Route path="/contacts/:id" element={<ContactDetail />} />
                    <Route path="/companies" element={<Companies />} />
                    <Route path="/companies/:id" element={<CompanyDetail />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/customers/:id" element={<CustomerDetail />} />

                    <Route path="/deals" element={<Deals />} />
                    <Route path="/deals/:id" element={<DealDetail />} />
                    <Route path="/pipeline" element={<Pipeline />} />
                    <Route path="/quotations" element={<Quotations />} />
                    <Route path="/quotations/:id" element={<QuotationDetail />} />
                    <Route path="/quotation-templates" element={<QuotationTemplates />} />
                    <Route path="/quotation-templates/:id" element={<QuotationTemplateEditor />} />
                    <Route path="/sales-orders" element={<SalesOrders />} />
                    <Route path="/sales-orders/new" element={<SalesOrderForm />} />
                    <Route path="/sales-orders/:id/edit" element={<SalesOrderForm />} />
                    <Route path="/sales-orders/:id" element={<SalesOrderDetail />} />
                    <Route path="/proposals" element={<Proposals />} />
                    <Route path="/proposals/new" element={<ProposalForm />} />
                    <Route path="/proposals/:id/edit" element={<ProposalForm />} />
                    <Route path="/proposals/:id" element={<ProposalDetail />} />
                    <Route path="/proposal-templates" element={<ProposalTemplates />} />
                    <Route path="/proposal-templates/:id" element={<ProposalTemplateEditor />} />

                    <Route path="/activities" element={<Activities />} />
                    <Route path="/tasks" element={<Tasks />} />
                    <Route path="/tasks/settings" element={<TaskSettings />} />
                    <Route path="/tasks/:id" element={<TaskDetail />} />
                    <Route path="/calendar" element={<CalendarPage />} />

                    <Route path="/products" element={<Products />} />
                    <Route path="/products/:id" element={<ProductDetail />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/projects/:id" element={<ProjectDetail />} />
                    <Route path="/contracts" element={<Contracts />} />
                    <Route path="/contracts/templates" element={<ContractTemplatesPage />} />
                    <Route path="/contracts/:id" element={<ContractDetail />} />
                    <Route path="/documents" element={<Documents />} />
                    <Route path="/documents/:id" element={<DocumentDetail />} />

                    <Route path="/invoices" element={<Invoices />} />
                    <Route path="/invoices/:id" element={<InvoiceDetail />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/payments/:id" element={<PaymentDetail />} />
                    <Route path="/expenses" element={<Expenses />} />
                    <Route path="/expenses/:id" element={<ExpenseDetail />} />

                    <Route path="/campaigns" element={<Campaigns />} />
                    <Route path="/campaigns/:id" element={<CampaignDetail />} />
                    <Route path="/lead-sources" element={<LeadSources />} />
                    <Route path="/lead-sources/:id" element={<LeadSourceDetail />} />
                    <Route path="/marketing-analytics" element={<MarketingAnalytics />} />

                    <Route path="/communication/email" element={<CommunicationEmail />} />
                    <Route path="/communication/whatsapp" element={<CommunicationWhatsApp />} />
                    <Route path="/communication/history" element={<CommunicationHistory />} />

                    <Route path="/tickets" element={<Tickets />} />
                    <Route path="/tickets/:id" element={<TicketDetail />} />

                    <Route path="/reports/:type" element={<Reports />} />

                    <Route path="/ai-insights" element={<AIInsights />} />
                    <Route path="/notifications" element={<Notifications />} />

                    <Route path="/employees" element={<Employees />} />
                    <Route path="/employees/:id" element={<EmployeeDetail />} />
                    <Route path="/departments/:id" element={<DepartmentDetail />} />
                    <Route path="/teams/:id" element={<TeamDetail />} />
                    <Route path="/teams" element={<Employees />} />

                    {/* Administration: system configuration, users and access, branches. The specific pages come first; every other /administration/... address is a configuration page. */}
                    <Route path="/administration/branches" element={<Branches />} />
                    <Route path="/administration/users" element={<UserManagement />} />
                    <Route path="/administration/users/:id" element={<UserDetail />} />
                    <Route path="/administration/roles-permissions" element={<RolesPermissions />} />
                    <Route path="/administration/*" element={<Administration />} />
                    {/* the old addresses (bookmarks, links, saved notifications) lead to the same pages */}
                    {MOVED.map(([from, to]) => <Route key={from} path={from} element={<MovedTo to={to} />} />)}

                    {/* Settings: the person's own preferences (the old /settings/<configuration page> addresses are forwarded to Administration inside it) */}
                    <Route path="/settings/*" element={<Settings />} />

                    <Route path="/change-password" element={<ChangePassword />} />
                    <Route path="/profile" element={<Profile />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </SidebarProvider>
          </BranchProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
