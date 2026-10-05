// Neutral module shared by context/AuthContext.jsx (writes the token on login/logout) and
// api/mockServer.js (reads it to gate every protected request) without those two importing
// each other — keeps the mock "backend" layer able to check session validity independently of
// whichever React component happens to be mounted.
export const SESSION_KEY = 'business_crm_session'

export function readSessionBlob() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** The opaque session token the mock API layer treats as this tab's bearer credential — never trusted for anything beyond "which session record to look up", the actual validity/expiry decision happens server-side against the `sessions` collection (see sessionStore.js). */
export function getActiveToken() {
  return readSessionBlob()?.token || null
}

const EVENT_NAME = 'crm:session-expired'

/** Fired by the mock API layer the moment it rejects a request for an expired/invalid/revoked session — lets AuthContext react immediately (clear state, redirect, show the message) instead of waiting for its own next polling tick. */
export function emitSessionExpired(reason) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { reason } }))
}

export function onSessionExpired(callback) {
  const handler = (e) => callback(e.detail?.reason)
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
