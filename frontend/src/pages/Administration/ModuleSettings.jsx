import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  Users, Inbox, Building2, Handshake, FileText, Package, Receipt, FileSignature, FolderOpen, LifeBuoy, Megaphone, Wallet, ListChecks, Target, ArrowRight, Tag, Lock,
} from 'lucide-react'
import { OptionLists } from './OptionListsPanel'
import { InvoiceSettingsPanel } from '../Invoices/InvoiceSettingsPanel'
import { ContractSettingsPanel } from '../Contracts/ContractSettingsPanel'
import { DocumentSettingsPanel } from '../Documents/DocumentSettingsPanel'
import { ProductCategoriesDialog } from '../Products/ProductCategoriesDialog'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { useAuth } from '../../context/AuthContext'
import { useProducts, useProductCategories } from '../../hooks/useProducts'
import {
  LEAD_STATUSES, ENQUIRY_STATUSES, DEAL_STAGES, DEAL_STAGE_PROBABILITY, QUOTATION_STATUSES, TICKET_STATUSES, CAMPAIGN_STATUSES,
} from '../../data/constants'

const box = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'

// What each module's settings page holds. `lists` are dropdown / filter lists (Administration -> Module Configuration shows each module its own); `fixed` is a workflow the server enforces (shown, not edited);
// `links` point at configuration that lives on the module's own screen; `panel` embeds the module's existing settings form.
export const MODULES = {
  leads: {
    label: 'Leads', icon: Users, text: 'The values offered on lead forms, filters and the qualification, unqualified and lost dialogs.',
    lists: ['industries', 'cities', 'company_sizes', 'business_needs', 'qualification_timelines', 'lead_unqualified_reasons', 'lead_lost_reasons'],
    fixed: { title: 'Lead statuses', items: LEAD_STATUSES, note: 'A lead only moves along the allowed steps, enforced by the server, so these cannot be added to or removed.' },
    links: [{ to: '/lead-sources', icon: Target, title: 'Lead Sources', text: 'Sources, categories, branch scope and integration mappings.', module: 'Lead Sources' }],
  },
  enquiries: {
    label: 'Enquiries', icon: Inbox, text: 'The values offered on enquiry forms, filters, assignment and qualification.',
    lists: ['enquiry_types', 'requirement_types', 'contact_methods', 'assigned_teams', 'purchase_intents', 'business_needs', 'qualification_timelines', 'industries', 'cities'],
    fixed: { title: 'Enquiry statuses', items: ENQUIRY_STATUSES, note: 'The enquiry workflow (new → assigned → contacted → qualified → converted) is enforced by the server.' },
    links: [{ to: '/lead-sources', icon: Target, title: 'Lead Sources', text: 'Where enquiries come from.', module: 'Lead Sources' }],
  },
  companies: { label: 'Companies & Customers', icon: Building2, text: 'The values offered on company and customer forms and filters.', lists: ['industries', 'cities'] },
  deals: {
    label: 'Deals', icon: Handshake, text: 'The values offered when a deal is lost or qualified, and the pipeline it moves through.',
    lists: ['deal_lost_reasons', 'qualification_timelines'],
    fixed: { title: 'Deal stages', items: DEAL_STAGES, note: 'Each stage sets a fixed win probability and drives automations, so the pipeline is not editable.', badge: (s) => `${DEAL_STAGE_PROBABILITY[s]}%` },
  },
  quotations: {
    label: 'Quotations & Sales Orders', icon: FileText, text: 'Payment terms offered on quotations and sales orders, and the quotation templates.',
    lists: ['payment_terms'],
    fixed: { title: 'Quotation statuses', items: QUOTATION_STATUSES, note: 'Approval and acceptance rules depend on these statuses.' },
    links: [{ to: '/quotation-templates', icon: FileText, title: 'Quotation Templates', text: 'Letterhead, field mapping and the quotation layout.', module: 'Quotations' }],
  },
  products: {
    label: 'Products & Services', icon: Package, text: 'The categories, types, units of sale and billing cycles used by the catalogue.',
    lists: ['product_types', 'product_units', 'billing_cycles'], categories: true,
    links: [{ to: '/products', icon: Package, title: 'Products & Services', text: 'The catalogue itself: items, prices and tax.', module: 'Products & Services' }],
  },
  invoices: { label: 'Invoices & Payments', icon: Receipt, text: 'Numbering, terms, tax lines, payment methods and receiving accounts.', panel: InvoiceSettingsPanel },
  contracts: { label: 'Contracts', icon: FileSignature, text: 'Contract types, the approval step, renewal reminders and the expiring-soon window.', panel: ContractSettingsPanel },
  documents: { label: 'Documents', icon: FolderOpen, text: 'Document categories, allowed file types, limits and retention.', panel: DocumentSettingsPanel },
  tickets: {
    label: 'Support Tickets', icon: LifeBuoy, text: 'The categories and sources offered on tickets and in the ticket filters.',
    lists: ['ticket_categories', 'ticket_sources'],
    fixed: { title: 'Ticket statuses', items: TICKET_STATUSES, note: 'SLA timers and the ticket workflow depend on these statuses.' },
  },
  campaigns: {
    label: 'Campaigns', icon: Megaphone, text: 'The channels a campaign can run on.', lists: ['campaign_channels'],
    fixed: { title: 'Campaign statuses', items: CAMPAIGN_STATUSES, note: 'Campaign status changes happen through their own actions.' },
    links: [{ to: '/lead-sources', icon: Target, title: 'Lead Sources', text: 'The sources campaigns are attributed to.', module: 'Lead Sources' }],
  },
  expenses: {
    label: 'Expenses', icon: Wallet, text: 'Expense categories and vendors are managed on the Expenses screen, next to the records that use them.',
    links: [{ to: '/expenses', icon: Wallet, title: 'Expense categories and vendors', text: 'Add, rename and deactivate categories and vendors.', module: 'Expenses' }],
  },
  tasks: {
    label: 'Tasks', icon: ListChecks, text: 'Task automation rules, permissions and attachment limits.',
    links: [{ to: '/tasks/settings', icon: ListChecks, title: 'Task settings', text: 'Automation rules, who can do what, and file rules.', module: 'Tasks' }],
  },
}

function FixedWorkflow({ fixed }) {
  return (
    <section className={box} aria-label={fixed.title}>
      <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{fixed.title} <Badge tone="neutral"><Lock size={11} className="mr-1" />Fixed</Badge></h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {fixed.items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">{item}{fixed.badge && <span className="text-ink-400">{fixed.badge(item)}</span>}</span>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-400">{fixed.note}</p>
    </section>
  )
}

function CategoriesCard() {
  const { hasPermission } = useAuth()
  const { products } = useProducts()
  const { categories } = useProductCategories()
  const [open, setOpen] = useState(false)
  return (
    <section className={box} aria-label="Service categories">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">Service categories <span className="ml-1 text-xs font-medium text-ink-400">{categories.length}</span></h3>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">Every category products and services are filed under. Add, rename or delete them here; the catalogue and every picker follow.</p>
        </div>
        <Button variant="secondary" icon={Tag} onClick={() => setOpen(true)}>Manage categories</Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {categories.map((c) => <Badge key={c} tone="info">{c}<span className="ml-1.5 opacity-70">{products.filter((p) => p.category === c).length}</span></Badge>)}
        {!categories.length && <p className="text-sm text-ink-400">No categories yet.</p>}
      </div>
      <ProductCategoriesDialog open={open} onClose={() => setOpen(false)} categories={categories} products={products}
        can={{ create: hasPermission('Products & Services', 'create'), edit: hasPermission('Products & Services', 'edit'), delete: hasPermission('Products & Services', 'delete') }} />
    </section>
  )
}

function LinkCards({ links }) {
  const { hasPermission, user } = useAuth()
  return (
    <section aria-label="Configured on the module's own screen" className="grid gap-3 sm:grid-cols-2">
      {links.map((c) => {
        const allowed = user?.accessLevel === 'Super Admin' || hasPermission(c.module, 'view')
        const inner = (
          <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><c.icon size={17} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink-900 dark:text-ink-50">{c.title}</span><span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">{c.text}</span></span>
            {allowed ? <ArrowRight size={15} className="mt-1 shrink-0 text-ink-400" /> : <Lock size={14} className="mt-1 shrink-0 text-ink-300" aria-label="No access" />}
          </>
        )
        return allowed
          ? <Link key={c.title} to={c.to} className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-800 dark:bg-ink-900">{inner}</Link>
          : <div key={c.title} className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-white p-4 opacity-60 dark:border-ink-800 dark:bg-ink-900" title="Your role has no access to this module">{inner}</div>
      })}
    </section>
  )
}

const SHARED = {
  industries: 'Shared with Leads, Enquiries, Companies and Customers: it is the same list everywhere.',
  cities: 'Shared with Leads, Enquiries and Companies: it is the same list everywhere.',
  business_needs: 'Shared with Leads and Enquiries.',
  qualification_timelines: 'Shared with Leads, Enquiries and Deals.',
  payment_terms: 'Shared by Quotations and Sales Orders.',
}

/** Administration -> Module Configuration -> <module>: only that module's own configuration - its dropdown values, its workflow (read-only), and the settings that live on its own screen. */
export default function ModuleSettings() {
  const { key } = useParams()
  const m = MODULES[key]
  if (!m) return <Navigate to="/administration/company-profile" replace />
  const Panel = m.panel
  return (
    <div className="space-y-4" key={key}>
      <div className={box}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><m.icon size={19} /></span>
          <div>
            <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{m.label} settings</h2>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{m.text}</p>
          </div>
        </div>
      </div>
      {Panel && <Panel />}
      {m.categories && <CategoriesCard />}
      {m.lists && <OptionLists keys={m.lists} sharedNote={SHARED} />}
      {m.fixed && <FixedWorkflow fixed={m.fixed} />}
      {m.links && <LinkCards links={m.links} />}
    </div>
  )
}
