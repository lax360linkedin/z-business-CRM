import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import { AuthProvider } from './context/AuthContext'
import { SidebarProvider } from './context/SidebarContext'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { AuthLayout } from './components/layout/AuthLayout'

import Login from './pages/Auth/Login'
import ForgotPassword from './pages/Auth/ForgotPassword'
import ChangePassword from './pages/Auth/ChangePassword'
import Profile from './pages/Auth/Profile'

import Dashboard from './pages/Dashboard/Dashboard'
import Leads from './pages/Leads/Leads'
import LeadDetail from './pages/Leads/LeadDetail'
import MeetingJoin from './pages/Leads/MeetingJoin'
import Enquiries from './pages/Enquiries/Enquiries'
import EnquiryDetail from './pages/Enquiries/EnquiryDetail'
import Contacts from './pages/Contacts/Contacts'
import ContactDetail from './pages/Contacts/ContactDetail'
import Companies from './pages/Companies/Companies'
import CompanyDetail from './pages/Companies/CompanyDetail'
import Customers from './pages/Customers/Customers'
import CustomerDetail from './pages/Customers/CustomerDetail'
import Deals from './pages/Deals/Deals'
import DealDetail from './pages/Deals/DealDetail'
import Pipeline from './pages/Pipeline/Pipeline'
import Quotations from './pages/Quotations/Quotations'
import QuotationDetail from './pages/Quotations/QuotationDetail'
import QuotationTemplates from './pages/Settings/QuotationTemplates'
import QuotationTemplateEditor from './pages/Settings/QuotationTemplateEditor'
import SalesOrders from './pages/SalesOrders/SalesOrders'
import SalesOrderDetail from './pages/SalesOrders/SalesOrderDetail'
import SalesOrderForm from './pages/SalesOrders/SalesOrderForm'
import Proposals from './pages/Proposals/Proposals'
import ProposalDetail from './pages/Proposals/ProposalDetail'
import ProposalForm from './pages/Proposals/ProposalForm'
import ProposalTemplates from './pages/Proposals/ProposalTemplates'
import ProposalTemplateEditor from './pages/Proposals/ProposalTemplateEditor'
import Activities from './pages/Activities/Activities'
import Tasks from './pages/Tasks/Tasks'
import TaskDetail from './pages/Tasks/TaskDetail'
import TaskSettings from './pages/Tasks/TaskSettings'
import CalendarPage from './pages/Calendar/Calendar'
import Products from './pages/Products/Products'
import ProductDetail from './pages/Products/ProductDetail'
import Projects from './pages/Projects/Projects'
import ProjectDetail from './pages/Projects/ProjectDetail'
import Contracts from './pages/Contracts/Contracts'
import Documents from './pages/Documents/Documents'
import Invoices from './pages/Invoices/Invoices'
import InvoiceDetail from './pages/Invoices/InvoiceDetail'
import Payments from './pages/Payments/Payments'
import Expenses from './pages/Expenses/Expenses'
import Campaigns from './pages/Campaigns/Campaigns'
import LeadSources from './pages/LeadSources/LeadSources'
import MarketingAnalytics from './pages/MarketingAnalytics/MarketingAnalytics'
import CommunicationEmail from './pages/Communication/Email'
import CommunicationWhatsApp from './pages/Communication/WhatsApp'
import CommunicationHistory from './pages/Communication/History'
import Tickets from './pages/Tickets/Tickets'
import TicketDetail from './pages/Tickets/TicketDetail'
import Reports from './pages/Reports/Reports'
import AIInsights from './pages/AIInsights/AIInsights'
import Notifications from './pages/Notifications/Notifications'
import Employees from './pages/Employees/Employees'
import UserManagement from './pages/UserManagement/UserManagement'
import UserDetail from './pages/UserManagement/UserDetail'
import Teams from './pages/Teams/Teams'
import RolesPermissions from './pages/RolesPermissions/RolesPermissions'
import Settings from './pages/Settings/Settings'
import NotFound from './pages/NotFound/NotFound'

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
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
                    <Route path="/documents" element={<Documents />} />

                    <Route path="/invoices" element={<Invoices />} />
                    <Route path="/invoices/:id" element={<InvoiceDetail />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/expenses" element={<Expenses />} />

                    <Route path="/campaigns" element={<Campaigns />} />
                    <Route path="/lead-sources" element={<LeadSources />} />
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
                    <Route path="/user-management" element={<UserManagement />} />
                    <Route path="/user-management/:id" element={<UserDetail />} />
                    <Route path="/teams" element={<Teams />} />
                    <Route path="/roles-permissions" element={<RolesPermissions />} />

                    <Route path="/settings/*" element={<Settings />} />

                    <Route path="/change-password" element={<ChangePassword />} />
                    <Route path="/profile" element={<Profile />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </SidebarProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
