import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useSidebar } from '../../context/SidebarContext'
import { useAuth } from '../../context/AuthContext'
import { getModuleForPath } from '../../routes/moduleAccess'
import { logAuditEvent } from '../../utils/auditLog'
import { useFollowUpReminders } from '../../hooks/useFollowUpReminders'
import { useTaskEngine } from '../../hooks/useTaskEngine'
import AccessDenied from '../../pages/AccessDenied/AccessDenied'

export function AppLayout() {
  const { collapsed } = useSidebar()
  const location = useLocation()
  const { hasPermission, user, isAuthenticated } = useAuth()

  const module = getModuleForPath(location.pathname)
  const allowed = hasPermission(module, 'view')

  // Runs once per app load (not per navigation) — see the hook for why this is the honest
  // frontend-only substitute for a real due-follow-up cron job.
  useFollowUpReminders(isAuthenticated)
  useTaskEngine(isAuthenticated)

  // Permission Validation: even direct URL entry into a module the role can't view is
  // blocked here and logged, matching the spec's "Sales Executive typing the URL directly"
  // example — the route-level gate is the real enforcement, this is just the audit trail.
  const lastLoggedPath = useRef(null)
  useEffect(() => {
    if (!allowed && lastLoggedPath.current !== location.pathname) {
      lastLoggedPath.current = location.pathname
      logAuditEvent({ user, action: 'Permission Denied', module: module || 'Unknown', success: false, detail: `Blocked access to ${location.pathname}.` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, location.pathname])

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950">
      <Sidebar />
      <div className={clsx('flex min-h-screen flex-col transition-[margin] duration-200', collapsed ? 'lg:ml-[76px]' : 'lg:ml-[260px]')}>
        <Header />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {allowed ? <Outlet /> : <AccessDenied module={module} />}
          </motion.div>
        </main>
      </div>
    </div>
  )
}
