import { NAV_SECTIONS } from './navConfig'

// Flattened, longest-path-first so nested routes (e.g. /companies/CMP-001) resolve to
// their parent module (Companies) rather than matching nothing.
const FLAT_ITEMS = NAV_SECTIONS.flatMap((section) => section.items).sort((a, b) => b.to.length - a.to.length)

/**
 * Resolves a pathname to the NAV_SECTIONS module label that owns it, for permission checks.
 * Returns null for paths with no module mapping (e.g. /profile, /change-password) — those
 * are treated as always-allowed to any authenticated user.
 */
export function getModuleForPath(pathname) {
  if (pathname === '/departments' || pathname.startsWith('/departments/')) return 'Employees'
  const match = FLAT_ITEMS.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
  return match?.label ?? null
}

// Paths every authenticated user may reach regardless of role/permissions.
export const ALWAYS_ALLOWED_PATHS = ['/profile', '/change-password']

/** Where a freshly signed-in person lands: the Dashboard when their permissions include it, otherwise the first module they may open. */
export function landingPathFor(permissions) {
  if (permissions?.Dashboard?.view) return '/dashboard'
  const first = FLAT_ITEMS.slice().reverse().find((item) => permissions?.[item.label]?.view)
  return first ? first.to : '/profile'
}
