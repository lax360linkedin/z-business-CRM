import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { USERS, getUserById } from '../data/users'
import { getPermissionsForRole } from '../data/permissions'
import { getCollection, setCollection } from '../api/db'
import { logAuditEvent } from '../utils/auditLog'
import { genTempPassword } from '../utils/password'
import { getDeviceId, getDeviceLabel } from '../utils/deviceId'
import { SESSION_KEY, readSessionBlob, onSessionExpired } from '../utils/sessionToken'
import {
  createSession, getSession, validateSession, revokeSession,
  isDeviceTrusted, trustDevice, listTrustedDevices, revokeDevice,
} from '../utils/sessionStore'

const AuthContext = createContext(null)
const EXPIRED_FLAG_KEY = 'business_crm_session_expired'
const FORCE_LOGOUT_KEY = 'business_crm_force_logout'
const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes, then auto-unlock

const STATUS_MESSAGES = {
  Inactive: 'Your account is currently inactive. Please contact your administrator.',
  Locked: 'Your account has been temporarily locked. Please contact your administrator.',
  Pending: 'Your account is pending activation. Please contact your administrator.',
  Suspended: 'Your account has been suspended. Please contact your administrator.',
}

const LOCKOUT_MESSAGE = 'Your account has been temporarily locked due to multiple unsuccessful login attempts. Please try again later or contact your administrator.'
const ROLE_MISMATCH_MESSAGE = 'Wrong role selection. Your credentials are not authorized for the selected role. Please select the correct role or contact your administrator.'

// --- Live account access -----------------------------------------------------------------
// IMPORTANT: reads/writes go through the localStorage-backed mock DB (same store the mock
// REST API and User Management use), never the static `USER_ACCOUNTS` seed import — that
// static array never changes, so authenticate()/session-restore checked stale data before
// this fix. An admin's Deactivate/Lock/Change-Role action in User Management must be honored
// on the next login attempt, which only works if both read from the same live source.
function getAccounts() {
  return getCollection('userAccounts')
}
function findAccountByEmail(email) {
  return getAccounts().find((a) => a.email.toLowerCase() === email.toLowerCase())
}
function findAccountById(id) {
  return getAccounts().find((a) => a.id === id)
}
function patchAccount(id, patch) {
  const accounts = getAccounts()
  const idx = accounts.findIndex((a) => a.id === id)
  if (idx === -1) return null
  const updated = { ...accounts[idx], ...patch }
  const next = [...accounts]
  next[idx] = updated
  setCollection('userAccounts', next)
  return updated
}

// Single authoritative credential record: every password-change path (self-service, admin
// set, admin reset, forgot-password OTP) funnels through this one function so `password`
// never has a second, potentially-stale copy anywhere. Never logs the password value itself —
// audit/log entries record *that* a change happened and *who* made it, never the credential.
function applyPasswordChange(accountId, newPassword, changedBy, extraPatch = {}) {
  return patchAccount(accountId, {
    password: newPassword,
    passwordChangedAt: new Date().toISOString(),
    passwordChangedBy: changedBy,
    failedAttempts: 0,
    lockedUntil: null,
    ...extraPatch,
  })
}

function deviceFingerprint() {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
}

// Auto-unlock: a lock that has passed its duration is treated as Active again — the account
// record itself is normalized back to Active the moment it's looked up past that point.
function resolveEffectiveStatus(account) {
  if (account.status === 'Locked' && account.lockedUntil && Date.now() >= account.lockedUntil) {
    return patchAccount(account.id, { status: 'Active', failedAttempts: 0, lockedUntil: null })
  }
  return account
}

// The login ACCOUNT (User Management) is the source of truth for role/email/status.
// The linked EMPLOYEE record (Employees module) supplies descriptive fields the rest of
// the app already expects (designation, joinDate, phone) — merged so every existing
// `user.*` consumer keeps working unchanged. `id` intentionally stays the employee id so
// cross-references (tasks.assignedTo, activities.by, etc, all seeded against employee ids)
// keep resolving correctly. `activeRole` is whichever of the account's assigned `roles` was
// selected at login (multi-role support) — everything else in the app should read `role`.
function mergeUser(account, employee, activeRole) {
  return {
    ...(employee || {}),
    id: employee?.id || account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    role: activeRole || account.role,
    assignedRoles: account.roles || [account.role],
    department: account.department,
    accountId: account.id,
    accountStatus: account.status,
    forcePasswordChange: account.forcePasswordChange,
    initials: account.initials,
    avatarColor: account.avatarColor,
  }
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

// Re-validates against the current (live) account record AND the server-side session record
// (src/utils/sessionStore.js) on every mount/restore — so a session created before an admin
// locked/suspended/deactivated the account, or one whose configured duration has simply run
// out since the tab was last open, never stays "logged in" just because a localStorage blob
// still exists. This is the check that makes "refresh the browser — session only valid if it
// hasn't expired" and "backend-enforced expiration" real rather than a UI-only timer.
function resolveSessionUser() {
  const stored = readSessionBlob()
  if (!stored?.accountId) return null
  const { valid, reason } = validateSession(stored.token)
  if (!valid) {
    clearStoredSession()
    if (reason === 'expired' || reason === 'revoked') sessionStorage.setItem(EXPIRED_FLAG_KEY, '1')
    return null
  }
  let account = findAccountById(stored.accountId)
  if (!account) return null
  account = resolveEffectiveStatus(account)
  if (account.status !== 'Active') return null
  const employee = account.employeeId ? getUserById(account.employeeId) : null
  return mergeUser(account, employee, stored.activeRole)
}

/** Looks up which roles an email is actually allowed to log in as — for the Login page's role dropdown to narrow itself to only the assigned role(s), per the "users must never see roles not assigned to them" requirement. Returns null if the email isn't recognized (in which case the full role list should still show, since we can't know who they are yet). */
export function lookupAssignableRoles(email) {
  if (!email || !email.includes('@')) return null
  const account = findAccountByEmail(email)
  if (!account) return null
  return account.roles && account.roles.length ? account.roles : [account.role]
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(resolveSessionUser)

  const persistSession = (account, rememberMe, activeRole, token) => {
    const payload = JSON.stringify({ accountId: account.id, activeRole, token, loginTime: new Date().toISOString() })
    if (rememberMe) {
      localStorage.setItem(SESSION_KEY, payload)
      sessionStorage.removeItem(SESSION_KEY)
    } else {
      // Not remembered: session only survives this tab until it's closed.
      sessionStorage.setItem(SESSION_KEY, payload)
      localStorage.removeItem(SESSION_KEY)
    }
  }

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SESSION_KEY)
  }

  const finalizeLogin = (account, role, rememberMe, deviceId) => {
    const employee = account.employeeId ? getUserById(account.employeeId) : null
    const merged = mergeUser(account, employee, role)
    // The actual, backend-held session record — `session.id` (the token) is the only thing
    // persisted client-side to identify it; expiry is decided by reading this record back
    // (see validateSession in sessionStore.js), never by trusting a client-side timestamp.
    const session = createSession({ accountId: account.id, role, deviceId })
    setUser(merged)
    persistSession(account, rememberMe, role, session.id)

    const currentDevice = deviceFingerprint()
    if (account.lastDevice && account.lastDevice !== currentDevice) {
      logAuditEvent({ user: merged, action: 'Device Change Detection', module: 'Authentication', detail: 'Login from a previously unseen device/browser.' })
    }
    patchAccount(account.id, { failedAttempts: 0, lockedUntil: null, lastDevice: currentDevice, lastLogin: new Date().toISOString() })
    logAuditEvent({ user: merged, action: 'Login', module: 'Authentication', success: true, detail: `Signed in as ${role}.` })
    return merged
  }

  /**
   * Full login-page authentication, validated in this order: account exists → account
   * status (incl. brute-force lockout, auto-unlock) → password correct (tracking failed
   * attempts) → selected role is one of the account's assigned roles → device trust. Returns
   * either the signed-in user, or `{ mfaRequired: true, accountId, role }` if this is the
   * first login from this device (or the device's trust has lapsed or been revoked) — the
   * caller (Login.jsx) must then complete `completeMfaLogin` with the same `deviceId`.
   */
  const authenticate = (email, password, role, rememberMe = true, deviceId) => {
    let account = findAccountByEmail(email)
    const attemptedUser = { name: account?.name || email, role: account?.role || role }

    if (!account) {
      logAuditEvent({ user: attemptedUser, action: 'Login Attempt', module: 'Authentication', success: false, detail: 'No account found for this email.' })
      const err = new Error('Invalid email/username or password.')
      err.code = 'invalid'
      throw err
    }

    account = resolveEffectiveStatus(account)

    if (account.status !== 'Active') {
      const isLockout = account.status === 'Locked' && account.failedAttempts >= MAX_FAILED_ATTEMPTS
      logAuditEvent({ user: attemptedUser, action: 'Login Attempt', module: 'Authentication', success: false, detail: `Account status: ${account.status}.` })
      const err = new Error(isLockout ? LOCKOUT_MESSAGE : (STATUS_MESSAGES[account.status] || 'Your account cannot sign in right now. Please contact your administrator.'))
      err.code = account.status === 'Locked' ? 'locked' : 'status'
      throw err
    }

    if (account.password !== password) {
      const failedAttempts = (account.failedAttempts || 0) + 1
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        patchAccount(account.id, { failedAttempts, status: 'Locked', lockedUntil: Date.now() + LOCK_DURATION_MS })
        logAuditEvent({ user: attemptedUser, action: 'Account Locked', module: 'Authentication', detail: `Locked after ${failedAttempts} consecutive failed attempts.` })
        logAuditEvent({ user: attemptedUser, action: 'Login Attempt', module: 'Authentication', success: false, detail: 'Invalid password — account now locked.' })
        const err = new Error(LOCKOUT_MESSAGE)
        err.code = 'locked'
        throw err
      }
      patchAccount(account.id, { failedAttempts })
      logAuditEvent({ user: attemptedUser, action: 'Login Attempt', module: 'Authentication', success: false, detail: `Invalid password (attempt ${failedAttempts}/${MAX_FAILED_ATTEMPTS}).` })
      const err = new Error('Invalid email/username or password.')
      err.code = 'invalid'
      throw err
    }

    const assignableRoles = account.roles && account.roles.length ? account.roles : [account.role]
    if (!assignableRoles.includes(role)) {
      logAuditEvent({ user: attemptedUser, action: 'Login Attempt', module: 'Authentication', success: false, detail: `Selected role "${role}" is not assigned to this account.` })
      const err = new Error(ROLE_MISMATCH_MESSAGE)
      err.code = 'role'
      throw err
    }

    // Device-based two-step verification: 2FA on the first login per device, not every login.
    // The ONLY thing that triggers a code is the device's own trust state held server-side
    // (sessionStore.js trustedDevices): new device, revoked, or trust window lapsed. There is
    // deliberately no per-account "always ask" flag any more — the seeded Super Admin/Admin
    // accounts used to carry one, which made those logins ask for a code every time even from a
    // verified device, and after every session expiry.
    if (!isDeviceTrusted(account.id, deviceId)) {
      logAuditEvent({
        user: attemptedUser, action: 'MFA Challenge Sent', module: 'Authentication',
        detail: 'Password validated — new, revoked or expired device, awaiting OTP.',
      })
      return { mfaRequired: true, accountId: account.id, role, rememberMe }
    }

    // Using a trusted device renews its trust window (sliding), so a regularly-used device
    // never silently ages out.
    trustDevice({ accountId: account.id, deviceId, deviceLabel: getDeviceLabel() })
    return finalizeLogin(account, role, rememberMe, deviceId)
  }

  /** Called after the Login page's OTP step verifies the code for an MFA-required account — registers (or renews) this device as trusted before completing login, so the NEXT login from it can skip straight to credentials-only. */
  const completeMfaLogin = (accountId, role, rememberMe, deviceId) => {
    const account = findAccountById(accountId)
    if (!account) throw new Error('Session expired — please sign in again.')
    trustDevice({ accountId, deviceId, deviceLabel: getDeviceLabel() })
    logAuditEvent({ user: { name: account.name, role }, action: 'MFA Verification', module: 'Authentication', success: true, detail: 'Device registered as trusted.' })
    return finalizeLogin(account, role, rememberMe, deviceId)
  }

  const logout = (reason) => {
    if (user) logAuditEvent({ user, action: reason === 'expired' ? 'Session Expired' : 'Logout', module: 'Authentication', success: true })
    const token = readSessionBlob()?.token
    if (token) revokeSession(token)
    setUser(null)
    clearSession()
    if (reason === 'expired') sessionStorage.setItem(EXPIRED_FLAG_KEY, '1')
  }

  // Real cross-tab forced logout: an admin terminating this user's session from User
  // Management (in another tab of the same browser) writes a flag to localStorage, which
  // fires a `storage` event in every other same-origin tab — including this one. This is an
  // honest, same-browser-only implementation of "session termination by Admin" — there's no
  // backend here to reach a genuinely different device.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== FORCE_LOGOUT_KEY || !e.newValue || !user?.accountId) return
      try {
        const { accountId } = JSON.parse(e.newValue)
        if (accountId === user.accountId) logout('terminated')
      } catch {
        // ignore malformed payloads
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId])

  /** Admin-initiated: force-logs-out a user's session in any other open tab of this browser. */
  const forceLogoutAccount = (accountId) => {
    localStorage.setItem(FORCE_LOGOUT_KEY, JSON.stringify({ accountId, ts: Date.now() }))
  }

  // Post-login convenience used only by the Header's "demo role switch" — intentionally
  // bypasses credential/device checks since it's for exploring the app as a signed-in user,
  // not a login path. Kept separate from `authenticate`, which is the real gate. Still needs a
  // genuine server-side session (not a decorative token string) — every protected API call now
  // checks the `sessions` collection, so a fake token would 401 on the very next request.
  const loginAsRole = (role) => {
    const employee = USERS.find((u) => u.role === role) || USERS[0]
    const account = getAccounts().find((a) => a.employeeId === employee.id)
    const merged = account ? mergeUser(account, employee, role) : employee
    setUser(merged)
    if (account) {
      const session = createSession({ accountId: account.id, role, deviceId: getDeviceId() })
      persistSession(account, true, role, session.id)
    }
    return merged
  }

  const switchUser = (userId) => {
    const match = USERS.find((u) => u.id === userId)
    if (match) setUser(match)
  }

  const clearForcePasswordChange = () => {
    if (!user?.accountId) return
    patchAccount(user.accountId, { forcePasswordChange: false })
    setUser((u) => (u ? { ...u, forcePasswordChange: false } : u))
  }

  /** Called at the end of the OTP-verified Forgot Password flow to set a new password. Also clears any lockout/forced-change state, since a verified reset is a strong-enough identity proof to lift both. */
  const resetPassword = (email, newPassword) => {
    const account = findAccountByEmail(email)
    if (!account) throw new Error('Account not found.')
    applyPasswordChange(account.id, newPassword, 'Self (Forgot Password)', {
      forcePasswordChange: false,
      status: account.status === 'Locked' ? 'Active' : account.status,
    })
    logAuditEvent({ user: { name: account.name, role: account.role }, action: 'Password Reset', module: 'Authentication', success: true })
  }

  /**
   * Self-service change from Profile → Change Password. Requires the correct current
   * password unless the account is under a forced change (the user already proved identity
   * at login in that case — an admin-issued temp password they may not "remember" as their
   * own shouldn't block them). This is the ONLY path that also updates the live `user` state,
   * since it's the only one that can be changing the currently-signed-in session's own account.
   */
  const updateOwnPassword = (currentPassword, newPassword) => {
    if (!user?.accountId) throw new Error('Not signed in.')
    const account = findAccountById(user.accountId)
    if (!account) throw new Error('Account not found.')
    if (!account.forcePasswordChange && account.password !== currentPassword) {
      const err = new Error('Current password is incorrect.')
      err.code = 'current'
      throw err
    }
    applyPasswordChange(account.id, newPassword, account.username || account.name, { forcePasswordChange: false })
    setUser((u) => (u ? { ...u, forcePasswordChange: false } : u))
    logAuditEvent({ user, action: 'Password Changed', module: 'Authentication', success: true, detail: 'User changed their own password.' })
  }

  /** Admin sets a specific new password for another user, from User Management → Credentials. Gated by the caller checking `hasPermission('User Management','edit')` and role-based `canViewCredentials`. */
  const adminSetPassword = (accountId, newPassword) => {
    const account = findAccountById(accountId)
    if (!account) throw new Error('Account not found.')
    applyPasswordChange(accountId, newPassword, user?.name || 'Administrator', { forcePasswordChange: false })
    logAuditEvent({ user, action: 'Password Changed', module: 'User Management', record: accountId, detail: `Password changed by ${user?.name || 'an administrator'} for ${account.name}.` })
  }

  /** Admin-generated temporary password (User Management → Credentials → Reset Password). Forces a change on next login and returns the plaintext temp password so the calling UI can display/copy it — never written to the audit log. */
  const adminResetPassword = (accountId) => {
    const account = findAccountById(accountId)
    if (!account) throw new Error('Account not found.')
    const tempPassword = genTempPassword()
    applyPasswordChange(accountId, tempPassword, user?.name || 'Administrator', { forcePasswordChange: true })
    logAuditEvent({ user, action: 'Reset Password', module: 'User Management', record: accountId, detail: `Temporary password issued to ${account.name}.` })
    return tempPassword
  }

  const permissions = useMemo(() => (user ? getPermissionsForRole(user.role) : {}), [user?.role])

  const hasPermission = (moduleLabel, action = 'view') => {
    if (!moduleLabel) return true
    return !!permissions[moduleLabel]?.[action]
  }

  /** Listed trusted devices for the signed-in user — Profile → Trusted Devices reads this. */
  const listMyTrustedDevices = () => (user?.accountId ? listTrustedDevices(user.accountId) : [])

  /** Revokes a trusted device; if it's the one this tab is currently running on, also ends the current session immediately rather than leaving it live until the next natural expiry. */
  const revokeMyDevice = (deviceRecordId, isCurrentDevice) => {
    revokeDevice(deviceRecordId)
    logAuditEvent({ user, action: 'Trusted Device Revoked', module: 'Authentication', success: true, detail: isCurrentDevice ? 'Revoked the device currently in use.' : undefined })
    if (isCurrentDevice) logout('revoked')
  }

  // Session expiration, enforced server-side: the mock API layer (src/api/mockServer.js)
  // independently rejects any request once the session record it looks up has expired or been
  // revoked, and fires `crm:session-expired` the moment that happens — this listener is what
  // reacts to that (clear local state, show the "session expired" message on next Login visit)
  // the instant it's caught, rather than waiting for this tab's own timer to also notice.
  useEffect(() => onSessionExpired((reason) => { if (user) logout(reason === 'revoked' ? 'revoked' : 'expired') }), [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Absolute session-duration timer — a courtesy that proactively logs an idle tab out right
  // at the configured duration (so "automatically log out" doesn't require the user to first
  // trigger an API call); the 30s re-validation guards against setTimeout drift in a
  // throttled/background tab over a multi-hour duration. Neither is the actual authority — both
  // ultimately just call logout() after independently confirming the same server-side session
  // record (readSessionBlob().token / validateSession) is no longer valid, the same check
  // mockServer.js performs on every protected request.
  useEffect(() => {
    if (!user) return
    const token = readSessionBlob()?.token
    if (!token) return

    const checkNow = () => {
      const { valid, reason } = validateSession(token)
      if (!valid) logout(reason === 'revoked' ? 'revoked' : 'expired')
    }

    const session = getSession(token)
    const msRemaining = session ? session.expiresAt - Date.now() : 0
    const preciseTimer = setTimeout(checkNow, Math.max(0, msRemaining))
    const safetyInterval = setInterval(checkNow, 30 * 1000)

    return () => {
      clearTimeout(preciseTimer)
      clearInterval(safetyInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.accountId])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        permissions,
        hasPermission,
        mustChangePassword: !!user?.forcePasswordChange,
        authenticate,
        completeMfaLogin,
        logout,
        loginAsRole,
        switchUser,
        clearForcePasswordChange,
        forceLogoutAccount,
        resetPassword,
        updateOwnPassword,
        adminSetPassword,
        adminResetPassword,
        listMyTrustedDevices,
        revokeMyDevice,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** One-shot read: was the last logout due to session expiry? Clears the flag once read. */
export function consumeExpiredFlag() {
  const flag = sessionStorage.getItem(EXPIRED_FLAG_KEY)
  if (flag) sessionStorage.removeItem(EXPIRED_FLAG_KEY)
  return !!flag
}
