import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ALWAYS_ALLOWED_PATHS } from './moduleAccess'
import { IdleGuard } from '../components/auth/IdleGuard'

export function ProtectedRoute() {
  const { isAuthenticated, mustChangePassword, booting } = useAuth()
  const location = useLocation()

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 text-sm text-ink-500 dark:bg-ink-950 dark:text-ink-400" role="status" aria-live="polite">
        Restoring your session…
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // First-login / forced password change: block every other protected page until resolved.
  if (mustChangePassword && !ALWAYS_ALLOWED_PATHS.includes(location.pathname)) {
    return <Navigate to="/change-password" replace state={{ forced: true }} />
  }

  return (
    <>
      <IdleGuard />
      <Outlet />
    </>
  )
}
