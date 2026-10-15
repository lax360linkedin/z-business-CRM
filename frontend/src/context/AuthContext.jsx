import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, isNotOurApi, NOT_CONNECTED_MESSAGE } from '../api/http'
import { clearStore } from '../api/store'
import { setDirectory, clearDirectory } from '../data/users'
import { ALL_BRANCHES, setBranchNames } from '../data/branches'
import { setDepartments } from '../utils/orgLookup'
import { landingPathFor } from '../routes/moduleAccess'
import { writeSelectedScope } from '../utils/branchScope'
import { getDeviceId } from '../utils/deviceId'
import { readSessionBlob, storeSession, clearSession, onSessionExpired } from '../utils/sessionToken'
import { prefetchData } from '../api/prefetch'

// The signed-in session. Everything that decides who someone is and what they may do - credentials, lockout, role, branch, module permissions, expiry - is decided by the
// server (POST /auth/login, GET /auth/me, the per-request checks). This context only holds the answer: the user, their effective permissions, and the helpers screens call.
const AuthContext = createContext(null)
const EXPIRED_FLAG_KEY = 'business_crm_session_expired'
const RETURN_KEY = 'business_crm_return_to'
const REFRESH_MS = 30 * 1000 // how often the server is asked again who I am (role / permission / status changes take effect without signing in again)
const DIRECTORY_MS = 2 * 60 * 1000

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const fail = (err, fallback) => {
  const e = new Error((isNotOurApi(err) ? NOT_CONNECTED_MESSAGE : null) || err?.response?.data?.message || (err?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection and try again.' : err?.message) || fallback)
  e.code = err?.response?.data?.code || err?.code
  e.fields = err?.response?.data?.fields
  e.status = err?.response?.status
  return e
}

/** The user object the screens use (same shape as before: `id` is the employee id so records that point at people keep resolving). */
function toUser(me) {
  return {
    id: me.id, accountId: me.accountId, name: me.name, email: me.email, username: me.username, phone: me.phone || '', accessLevel: me.accessLevel, role: me.role, branch: me.branch || null,
    allBranches: !!me.allBranches, department: me.department || '', designation: me.designation || '', joinDate: me.joinDate || null, initials: me.initials, avatarColor: me.avatarColor,
    forcePasswordChange: !!me.forcePasswordChange, accountStatus: me.accountStatus, permissions: me.permissions || {}, idleTimeoutMinutes: me.idleTimeoutMinutes || 30,
  }
}

/** Loads what the screens need to name things: the people directory, the branches and the departments. Failures leave the previous lists in place. */
async function loadReferenceData(isSuperAdmin) {
  const [people, branches, depts] = await Promise.allSettled([
    api.get('/directory/people'), api.get('/auth/branches'), api.get('/directory/departments'), // names only: the full department list computes workload figures that nothing here needs
  ])
  if (people.status === 'fulfilled') setDirectory(people.value.data)
  if (branches.status === 'fulfilled') setBranchNames(branches.value.data.map((b) => b.name))
  if (depts.status === 'fulfilled') setDepartments(depts.value.data)
  void isSuperAdmin
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(() => !!readSessionBlob())
  const userRef = useRef(null)
  userRef.current = user

  const signedOut = useCallback((reason) => {
    const who = userRef.current
    clearSession()
    clearStore()
    clearDirectory()
    setUser(null)
    try {
      if (['expired', 'revoked', 'idle'].includes(reason)) {
        sessionStorage.setItem(EXPIRED_FLAG_KEY, JSON.stringify({ reason, minutes: who?.idleTimeoutMinutes || 30 }))
        // an unexpected sign-out must not cost the person their place: after signing in again (as the same person) they land back where they were
        const here = `${window.location.pathname}${window.location.search}`
        if (who?.accountId && !/^\/(login|change-password|forgot-password)/.test(here)) sessionStorage.setItem(RETURN_KEY, JSON.stringify({ accountId: who.accountId, path: here }))
      }
    } catch { /* storage blocked: the message and the return trip are simply skipped */ }
  }, [])

  // restore a session after a page load: ask the server who the stored token belongs to
  useEffect(() => {
    if (!readSessionBlob()) return undefined
    let alive = true
    // who am I, and the lists that name things, are independent: ask for all of them at once
    const who = api.get('/auth/me').then((res) => { // the page being reopened starts fetching its data the moment the server says what this person may see
      prefetchData(window.location.pathname, (label) => !!res.data.permissions?.[label]?.view)
      return res
    })
    Promise.all([who, loadReferenceData(true)])
      .then(([res]) => { if (alive) setUser(toUser(res.data)) })
      .catch((err) => { if (alive && err?.response?.status !== undefined) signedOut(err.response.status === 401 ? 'expired' : undefined) })
      .finally(() => { if (alive) setBooting(false) })
    return () => { alive = false }
  }, [signedOut])

  /** Sign in with an e-mail address or username and the password. The branch picked on the form (or 'all', or empty = automatic) is only ever compared with the account by the server. */
  const authenticate = useCallback(async (identifier, password, rememberMe = true, deviceId, selectedBranch) => {
    try {
      const res = await api.post('/auth/login', { identifier, password, branch: selectedBranch || '' }, { headers: { 'X-Device-Id': deviceId || getDeviceId() } })
      const me = toUser(res.data.user)
      const t = res.data.tokens
      storeSession({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, accountId: me.accountId, remember: rememberMe })
      // the Super Admin's authorised all-branch access starts on the centralised (all branches) view; everyone else is fixed to their own branch by the server
      if (me.allBranches) writeSelectedScope(ALL_BRANCHES)
      // the landing screen's data is requested NOW, in parallel with the reference lists, instead of after the screen has rendered and asked for it
      prefetchData(landingPathFor(me.permissions), (label) => !!me.permissions?.[label]?.view)
      await loadReferenceData(me.accessLevel === 'Super Admin')
      setUser(me)
      return { ...me, landingPath: landingPathFor(me.permissions) }
    } catch (err) {
      throw fail(err, 'Sign-in failed. Please try again.')
    }
  }, [])

  const logout = useCallback((reason) => {
    if (!reason || !['expired', 'revoked'].includes(reason)) api.post('/auth/logout', null, { silent: true }).catch(() => null) // ends the session on the server too (an idle sign-out included)
    signedOut(reason)
  }, [signedOut])

  // the server ended this session (expired, signed out elsewhere, account suspended): leave immediately
  useEffect(() => onSessionExpired((reason) => { if (userRef.current) signedOut(reason === 'revoked' ? 'revoked' : reason === 'idle' ? 'idle' : 'expired') }), [signedOut])

  // live account check: role, branch, permission and status changes made by the Super Admin take effect without signing in again; a suspended account is signed out
  useEffect(() => {
    if (!user?.accountId) return undefined
    const check = () => {
      api.get('/auth/me').then((res) => {
        const me = toUser(res.data)
        setUser((cur) => (cur && sameJson({ ...cur }, { ...me }) ? cur : me))
      }).catch(() => null)
    }
    const people = () => api.get('/directory/people').then((r) => setDirectory(r.data)).catch(() => null)
    const a = setInterval(check, REFRESH_MS)
    const b = setInterval(people, DIRECTORY_MS)
    window.addEventListener('focus', check)
    return () => { clearInterval(a); clearInterval(b); window.removeEventListener('focus', check) }
  }, [user?.accountId])

  const permissions = useMemo(() => user?.permissions || {}, [user])
  const hasPermission = useCallback((moduleLabel, action = 'view') => {
    if (!moduleLabel) return true
    return !!permissions[moduleLabel]?.[action]
  }, [permissions])

  /** Applies a fresh /auth/me style answer (after the person edits their own profile). */
  const refreshUser = useCallback((me) => setUser(toUser(me)), [])

  const clearForcePasswordChange = useCallback(() => setUser((u) => (u ? { ...u, forcePasswordChange: false } : u)), [])

  /** Self-service change (Profile → Change Password, or the forced first-login change). The server checks the current password. */
  const updateOwnPassword = useCallback(async (currentPassword, newPassword) => {
    try {
      await api.post('/auth/change-password', { currentPassword: currentPassword || '', newPassword })
      setUser((u) => (u ? { ...u, forcePasswordChange: false } : u))
    } catch (err) {
      throw fail(err, 'The password could not be changed.')
    }
  }, [])

  /** Forgot password, step 1: asks the server to prepare a reset (it always answers the same, whether or not the account exists). May return a dev-only token while the server runs in debug mode. */
  const requestPasswordReset = useCallback(async (identifier) => {
    try {
      const res = await api.post('/auth/forgot-password', { identifier })
      return res.data
    } catch (err) {
      throw fail(err, 'The request could not be sent.')
    }
  }, [])

  /** Forgot password, step 2: completes the reset with the token that was issued. */
  const resetPassword = useCallback(async (token, newPassword) => {
    try {
      await api.post('/auth/reset-password', { token, newPassword })
    } catch (err) {
      throw fail(err, 'The password could not be reset.')
    }
  }, [])

  /** Super Admin: sets a specific new password for another account. */
  const adminSetPassword = useCallback(async (accountId, newPassword) => {
    try {
      await api.post(`/userAccounts/${accountId}/password`, { newPassword, forcePasswordChange: false })
    } catch (err) {
      throw fail(err, 'The password could not be changed.')
    }
  }, [])

  /** Super Admin: issues a one-time temporary password (shown once, never stored in clear) and forces a change at next sign-in. */
  const adminResetPassword = useCallback(async (accountId) => {
    try {
      const res = await api.post(`/userAccounts/${accountId}/reset-password`)
      return res.data.temporaryPassword
    } catch (err) {
      throw fail(err, 'The password could not be reset.')
    }
  }, [])

  /** Ends every session of an account (Super Admin), or of my own account when it is mine (sign out everywhere). */
  const forceLogoutAccount = useCallback(async (accountId) => {
    try {
      if (accountId === userRef.current?.accountId) await api.post('/auth/logout-all')
      else await api.post(`/userAccounts/${accountId}/terminate-sessions`)
    } catch (err) {
      throw fail(err, 'The sessions could not be ended.')
    }
  }, [])

  const value = useMemo(() => ({
    user, booting, isAuthenticated: !!user, permissions, hasPermission, mustChangePassword: !!user?.forcePasswordChange,
    authenticate, logout, clearForcePasswordChange, refreshUser, forceLogoutAccount, requestPasswordReset, resetPassword, updateOwnPassword, adminSetPassword, adminResetPassword,
  }), [user, booting, permissions, hasPermission, authenticate, logout, clearForcePasswordChange, refreshUser, forceLogoutAccount, requestPasswordReset, resetPassword, updateOwnPassword, adminSetPassword, adminResetPassword])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** One-shot read: why was the person signed out without asking? { reason: 'idle' | 'expired' | 'revoked', minutes } or null. Clears the flag once read. */
export function consumeExpiredFlag() {
  try {
    const flag = sessionStorage.getItem(EXPIRED_FLAG_KEY)
    if (!flag) return null
    sessionStorage.removeItem(EXPIRED_FLAG_KEY)
    try { return JSON.parse(flag) } catch { return { reason: 'expired', minutes: 30 } }
  } catch { return null }
}

/** One-shot read: the page this person was on when they were signed out, if they are the same person signing back in. */
export function consumeReturnPath(accountId) {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    const saved = raw ? JSON.parse(raw) : null
    return saved && saved.accountId === accountId && String(saved.path || '').startsWith('/') ? saved.path : null
  } catch { return null }
}
