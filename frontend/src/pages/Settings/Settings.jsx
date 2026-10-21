import { Routes, Route, Navigate, NavLink, useLocation, useParams } from 'react-router-dom'
import { Palette, UserRound, KeyRound, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { useAuth } from '../../context/AuthContext'
import { AppearancePanel } from './AppearancePanel'

// Settings is the person's OWN preferences (theme and accent colour live in this browser; the profile and password have their own pages). Everything that configures the
// system - company profile, tax, branches, users, roles, security, module settings, communication, automation, logs - is in Administration (/administration).

// Where the pages that used to live under /settings/... are now. Old bookmarks, links in e-mails and saved notifications keep working through this table.
const ADMIN_PANELS = ['company-profile', 'tax-settings', 'security', 'login-history', 'audit-logs', 'notification-settings', 'email-settings', 'whatsapp-settings', 'automation']
const RENAMED = {
  'lead-statuses': '/administration/modules/leads', 'deal-stages': '/administration/modules/deals', services: '/administration/modules/products', options: '/administration/modules/leads',
  contracts: '/administration/modules/contracts', documents: '/administration/modules/documents', 'invoice-settings': '/administration/modules/invoices',
  overview: '/administration/company-profile', users: '/administration/users', departments: '/employees?view=departments',
}

/** /settings/<anything that moved> -> its new address in Administration (anything unknown lands on Appearance). */
function MovedToAdministration() {
  const rest = (useParams()['*'] || '').replace(/\/+$/, '')
  const { search } = useLocation()
  const [first, second] = rest.split('/')
  let to = '/settings/appearance'
  if (RENAMED[rest]) to = RENAMED[rest]
  else if (first === 'modules' && second) to = `/administration/modules/${second}`
  else if (ADMIN_PANELS.includes(first)) to = `/administration/${first}`
  return <Navigate to={to.includes('?') ? to : `${to}${search}`} replace />
}

const link = ({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800'}`

export default function Settings() {
  const { hasPermission } = useAuth()
  return (
    <div>
      <PageHeader title="Settings" breadcrumb={<Breadcrumbs items={[{ label: 'Settings' }, { label: 'Appearance' }]} />}
        description="Your personal preferences. System configuration (company, users, branches, security, modules, automation) is under Administration." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Settings" className="scrollbar-thin space-y-0.5 overflow-x-auto rounded-2xl border border-ink-100 bg-white p-2 dark:border-ink-800 dark:bg-ink-900 lg:sticky lg:top-20 lg:h-fit">
          <p className="mb-1 mt-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">Preferences</p>
          <NavLink to="/settings/appearance" className={link}><Palette size={16} /> Appearance</NavLink>
          <p className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">My account</p>
          <NavLink to="/profile" className={link}><UserRound size={16} /> My profile</NavLink>
          <NavLink to="/change-password" className={link}><KeyRound size={16} /> Change password</NavLink>
          {hasPermission('Settings', 'view') && (
            <>
              <p className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">System</p>
              <NavLink to="/administration" className={link}><ShieldCheck size={16} /> Administration</NavLink>
            </>
          )}
        </nav>

        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="/settings/appearance" replace />} />
            <Route path="appearance" element={<AppearancePanel />} />
            <Route path="*" element={<MovedToAdministration />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
