// Where the signed-in session's tokens live in this browser, shared by context/AuthContext.jsx (writes them on sign-in / sign-out) and api/http.js (reads them to
// authorise every request and to renew the access token) without those two importing each other.
//
// The access token is short-lived; the refresh token is opaque and rotates on every renewal (the server keeps only its hash and treats a replayed old one as theft).
// "Remember me" keeps the session in localStorage (it survives closing the browser); otherwise it lives in sessionStorage (this tab only). Neither store ever
// holds a password. Whether a session is still valid is decided by the server on every request - nothing stored here is trusted for that.
export const SESSION_KEY = 'business_crm_session_v2'

function read(store) {
  try {
    const raw = store.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** The stored session blob: { accessToken, refreshToken, expiresAt, accountId, remember }, or null. */
export function readSessionBlob() {
  return read(localStorage) || read(sessionStorage)
}

export function getActiveToken() {
  return readSessionBlob()?.accessToken || null
}
export function getRefreshToken() {
  return readSessionBlob()?.refreshToken || null
}

export function storeSession({ accessToken, refreshToken, expiresAt, accountId, remember }) {
  const keep = remember === undefined ? !!readSessionBlob()?.remember : !!remember
  const blob = JSON.stringify({ accessToken, refreshToken, expiresAt, accountId, remember: keep })
  try {
    if (keep) { localStorage.setItem(SESSION_KEY, blob); sessionStorage.removeItem(SESSION_KEY) } else { sessionStorage.setItem(SESSION_KEY, blob); localStorage.removeItem(SESSION_KEY) }
  } catch { /* storage blocked: the session then lasts until the page is closed only */ }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY) } catch { /* nothing to clear */ }
}

const EVENT_NAME = 'crm:session-expired'

/** Fired by the API client the moment the server refuses the session for good (expired, revoked, replaced) - AuthContext reacts at once: clears state and shows the message. */
export function emitSessionExpired(reason) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { reason } }))
}

export function onSessionExpired(callback) {
  const handler = (e) => callback(e.detail?.reason)
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
