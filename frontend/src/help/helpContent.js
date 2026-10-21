// Page help: which help applies to which address. The content itself lives in ./content/*.js; this file only connects routes to it.
//
// To add help for a new page: write its entry in the matching content file, then add one line to ROUTES below. `npm run check:help` (scripts/check-help.mjs) fails if a route in App.jsx has no
// help, so a new page cannot ship without it.
import { matchPath } from 'react-router-dom'
import { crm } from './content/crm.js'
import { sales } from './content/sales.js'
import { work } from './content/work.js'
import { finance } from './content/finance.js'
import { marketing } from './content/marketing.js'
import { admin, settings, moduleSettingsHelp } from './content/admin.js'

export const ALL_HELP = { ...crm, ...sales, ...work, ...finance, ...marketing, ...admin }

// Order matters: a fixed address (/tasks/settings) must come before its look-alike with a parameter (/tasks/:id).
export const ROUTES = [
  ['/dashboard', 'dashboard'],
  ['/leads', 'leads'], ['/leads/:id', 'leadDetail'], ['/meetings/:id', 'meeting'],
  ['/enquiries', 'enquiries'], ['/enquiries/:id', 'enquiryDetail'],
  ['/contacts', 'contacts'], ['/contacts/:id', 'contactDetail'],
  ['/companies', 'companies'], ['/companies/:id', 'companyDetail'],
  ['/customers', 'customers'], ['/customers/:id', 'customerDetail'],
  ['/deals', 'deals'], ['/deals/:id', 'dealDetail'], ['/pipeline', 'pipeline'],
  ['/quotations', 'quotations'], ['/quotations/:id', 'quotationDetail'],
  ['/quotation-templates', 'quotationTemplates'], ['/quotation-templates/:id', 'quotationTemplateEditor'],
  ['/sales-orders', 'salesOrders'], ['/sales-orders/new', 'salesOrderForm'], ['/sales-orders/:id/edit', 'salesOrderForm'], ['/sales-orders/:id', 'salesOrderDetail'],
  ['/proposals', 'proposals'], ['/proposals/new', 'proposalForm'], ['/proposals/:id/edit', 'proposalForm'], ['/proposals/:id', 'proposalDetail'],
  ['/proposal-templates', 'proposalTemplates'], ['/proposal-templates/:id', 'proposalTemplateEditor'],
  ['/activities', 'activities'],
  ['/tasks', 'tasks'], ['/tasks/settings', 'taskSettings'], ['/tasks/:id', 'taskDetail'],
  ['/calendar', 'calendar'],
  ['/products', 'products'], ['/products/:id', 'productDetail'],
  ['/projects', 'projects'], ['/projects/:id', 'projectDetail'],
  ['/contracts', 'contracts'], ['/contracts/templates', 'contractTemplates'], ['/contracts/:id', 'contractDetail'],
  ['/documents', 'documents'], ['/documents/:id', 'documentDetail'],
  ['/invoices', 'invoices'], ['/invoices/:id', 'invoiceDetail'],
  ['/payments', 'payments'], ['/payments/:id', 'paymentDetail'],
  ['/expenses', 'expenses'], ['/expenses/:id', 'expenseDetail'],
  ['/campaigns', 'campaigns'], ['/campaigns/:id', 'campaignDetail'],
  ['/lead-sources', 'leadSources'], ['/lead-sources/:id', 'leadSourceDetail'],
  ['/marketing-analytics', 'marketingAnalytics'],
  ['/communication/email', 'communicationEmail'], ['/communication/whatsapp', 'communicationWhatsApp'], ['/communication/history', 'communicationHistory'],
  ['/tickets', 'tickets'], ['/tickets/:id', 'ticketDetail'],
  ['/reports/sales', 'reportSales'], ['/reports/leads', 'reportLeads'], ['/reports/marketing', 'reportMarketing'], ['/reports/finance', 'reportFinance'], ['/reports/projects', 'reportProjects'], ['/reports/team', 'reportTeam'],
  ['/ai-insights', 'aiInsights'], ['/notifications', 'notifications'],
  ['/employees', 'employees'], ['/employees/:id', 'employeeDetail'], ['/departments/:id', 'departmentDetail'], ['/teams/:id', 'teamDetail'], ['/teams', 'teams'],
  ['/administration', 'administration'], ['/administration/branches', 'branches'], ['/administration/users', 'userManagement'], ['/administration/users/:id', 'userDetail'], ['/administration/roles-permissions', 'roles'],
  ['/profile', 'profile'], ['/change-password', 'changePassword'],
]

// Shown only if an address matches nothing above (it should never happen for a real page).
const FALLBACK = {
  key: 'general',
  title: 'LAX360 Business CRM',
  purpose: 'Use the menu on the left to move between the CRM’s areas. This page has no specific help yet.',
  features: ['Search anything with Ctrl+K (⌘K on a Mac).', 'The Create button adds a lead, deal, task and more from anywhere.', 'The branch selector changes which branch’s records you see.'],
  actions: [],
}

/** The help for an address: { key, title, purpose, features, actions, workflows?, tips?, related? } - never null. */
export function getPageHelp(pathname) {
  const path = (pathname || '/').replace(/\/+$/, '') || '/'
  for (const [pattern, id] of ROUTES) {
    if (matchPath({ path: pattern, end: true }, path)) return { key: id, ...ALL_HELP[id] }
  }
  if (path.startsWith('/administration/')) { // the configuration pages: /administration/<panel> and /administration/modules/<module>
    const parts = path.split('/').filter(Boolean) // ['administration', section, key?]
    const section = parts[1]
    if (section === 'modules') {
      const help = moduleSettingsHelp(parts[2])
      if (help) return { key: `administration-modules-${parts[2]}`, ...help }
    } else if (settings[section] && section !== 'appearance') {
      return { key: `administration-${section}`, ...settings[section] }
    }
    return { key: 'administration', ...ALL_HELP.administration }
  }
  if (path === '/settings' || path.startsWith('/settings/')) return { key: 'settings-appearance', ...settings.appearance } // personal preferences
  return FALLBACK
}
