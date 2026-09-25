import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ALWAYS_ALLOWED_PATHS } from './moduleAccess'

export function ProtectedRoute() {
  const { isAuthenticated, mustChangePassword } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) return <Navigate to="/login" replace />

  // First-login / forced password change: block every other protected page until resolved.
  if (mustChangePassword && !ALWAYS_ALLOWED_PATHS.includes(location.pathname)) {
    return <Navigate to="/change-password" replace state={{ forced: true }} />
  }

  return <Outlet />
}
