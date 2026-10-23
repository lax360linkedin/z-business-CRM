import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
import { useProjectReminders } from '../../hooks/useProjectReminders'
import { useContractReminders } from '../../hooks/useContractReminders'
import { useInvoiceEngine } from '../../hooks/useInvoiceEngine'
import AccessDenied from '../../pages/AccessDenied/AccessDenied'
import { useBranch } from '../../context/BranchContext'
import { RecordBranchBar } from './RecordBranchBar'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { PageFallback } from '../common/PageFallback'
import { preloadAllPages } from '../../routes/lazyPage'
import { HelpProvider } from '../../help/HelpContext'
import { PageGuide } from '../help/PageGuide'
import { RefreshProvider, useRefresh } from '../../context/RefreshContext'
import { RefreshButton } from '../common/RefreshButton'

// Screens where a refresh could throw work away (forms and editors) or means nothing (a video meeting) have no Refresh button.
const NOT_REFRESHABLE = /(\/new|\/edit)$|^\/meetings\/|^\/change-password|(^|\/)(quotation|proposal)-templates\/[^/]+$/
// A record's page (/leads/LD-0001, /invoices/INV-3 ...): re-opened in place on refresh, since there is no filter or search worth keeping there.
const DETAIL = /^\/(leads|enquiries|contacts|companies|customers|deals|quotations|sales-orders|proposals|tasks|products|projects|contracts|documents|invoices|payments|expenses|campaigns|lead-sources|tickets|employees|administration\/users|departments|teams)\/[^/]+$/

/** Pages that have no PageHeader of their own (record pages, Settings) get the same button in a slim row above their content. */
function RefreshRow() {
  const ctx = useRefresh()
  const [show, setShow] = useState(false)
  const bare = !!ctx && ctx.refreshable && !ctx.hasHeader
  useEffect(() => { // a page header that is only swapped for a moment (loading -> loaded) must not make the row flash
    const t = setTimeout(() => setShow(bare), bare ? 350 : 0)
    return () => clearTimeout(t)
  }, [bare])
  if (!show || !bare) return null
  return <div className="mb-3 flex justify-end"><RefreshButton /></div>
}

export function AppLayout() {
  const { collapsed } = useSidebar()
  const location = useLocation()
  const { hasPermission, user, isAuthenticated } = useAuth()
  const { scopeKey, unassigned } = useBranch()
  const [nonce, setNonce] = useState(0)
  const reopen = useCallback(() => setNonce((n) => n + 1), [])

  const module = getModuleForPath(location.pathname)
  // a document opened from a record or shared with someone is authorised by the document API itself (it answers 404 to anyone without access)
  const allowed = hasPermission(module, 'view') || (location.pathname.startsWith('/documents/') && location.pathname.split('/').filter(Boolean).length === 2)

  // once the person has landed and the browser is idle, fetch the other screens' code in the background so every later click opens at once
  useEffect(() => { if (isAuthenticated) preloadAllPages() }, [isAuthenticated])

  // Runs once per app load (not per navigation) — see the hook for why this is the honest
  // frontend-only substitute for a real due-follow-up cron job.
  useFollowUpReminders(isAuthenticated)
  useTaskEngine(isAuthenticated)
  useProjectReminders(isAuthenticated)
  useContractReminders(isAuthenticated)
  useInvoiceEngine(isAuthenticated)

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
    <HelpProvider>
    <RefreshProvider reopen={reopen} alwaysReopen={DETAIL.test(location.pathname)} refreshable={allowed && !NOT_REFRESHABLE.test(location.pathname)}>
    <div className="app-bg min-h-screen">
      <Sidebar />
      <div className={clsx('flex min-h-screen flex-col transition-[margin] duration-200', collapsed ? 'lg:ml-[76px]' : 'lg:ml-[260px]')}>
        <Header />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {unassigned && <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">No branch has been assigned to your account yet, so branch context is not available. Ask your Super Admin to assign one.</p>}
            {allowed && <PageGuide />}
            {allowed && <RecordBranchBar />}
            {allowed && <RefreshRow />}
            {/* keyed by the branch scope: changing branch re-loads the current page from the new scope, so nothing from the old one stays on screen */}
            {allowed ? <ErrorBoundary resetKey={`${scopeKey}|${location.pathname}|${nonce}`}><Suspense fallback={<PageFallback />}><Outlet key={`${scopeKey}|${nonce}`} /></Suspense></ErrorBoundary> : <AccessDenied module={module} />}
          </motion.div>
        </main>
      </div>
    </div>
    </RefreshProvider>
    </HelpProvider>
  )
}
