import { useMemo } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { EmptyState } from '../../components/common/EmptyState'
import { useAuth } from '../../context/AuthContext'
import { ADMIN_CATEGORIES } from '../../routes/navConfig'

// Administration is for running the organisation: Branches, User Management and Roles & Permissions (the Super Admin's alone), plus the way to Departments & Teams in Employees.
// Workspace configuration (company profile, personalization, tax, module settings, security and logs, notifications, e-mail, WhatsApp, automation) is in Settings.

/** An old /administration/<settings page> address (they were Settings pages all along): forwarded to the same page under /settings. */
function MovedToSettings() {
  const rest = (useParams()['*'] || '').replace(/\/+$/, '')
  const { search } = useLocation()
  return <Navigate to={`/settings/${rest}${search}`} replace />
}

function Overview() {
  const { hasPermission } = useAuth()
  const administers = ['Branches', 'User Management', 'Roles & Permissions'].some((m) => hasPermission(m, 'view')) // Departments & Teams alone (an Employees right) is not a reason to be here
  const menu = useMemo(() => (administers ? ADMIN_CATEGORIES : []).map((c) => ({ ...c, items: c.items.filter((i) => hasPermission(i.module, 'view')) })).filter((c) => c.items.length), [hasPermission, administers])
  if (!menu.length) return <EmptyState icon={ShieldAlert} title="Administrators only" description="Branches, users and roles are managed by the Super Admin. Your own preferences and the workspace configuration are in Settings." action={<Link to="/settings" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">Open Settings</Link>} />
  return (
    <div className="space-y-6">
      {menu.map((category) => (
        <section key={category.key} aria-labelledby={`admin-${category.key}`}>
          <h2 id={`admin-${category.key}`} className="text-sm font-bold text-ink-900 dark:text-ink-50">{category.title}</h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{category.description}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {category.items.map((item) => (
              <Link key={item.key} to={item.to} className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-ink-800 dark:bg-ink-900">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><item.icon size={17} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-400">{item.description}</span>
                  {item.external && <span className="mt-1 block text-[11px] font-medium text-brand-600 dark:text-brand-300">Opens in Employees</span>}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-ink-500 dark:text-ink-400">Looking for the company profile, personalization, tax, module settings, security, logs, notifications, e-mail, WhatsApp or automation? Those are in <Link to="/settings" className="font-medium text-brand-600 hover:underline dark:text-brand-300">Settings</Link>.</p>
    </div>
  )
}

export default function Administration() {
  return (
    <div>
      <PageHeader title="Administration" breadcrumb={<Breadcrumbs items={[{ label: 'Administration' }]} />}
        description="Run the organisation: branches, user accounts and what each role may do. For the Super Admin." />
      <Routes>
        <Route index element={<Overview />} />
        <Route path="*" element={<MovedToSettings />} />
      </Routes>
    </div>
  )
}
