// Stable per-browser device identifier — the one honest client-side anchor a frontend-only
// app can offer (every real "remember this device" feature needs *some* client-held id to
// present back to the server; the difference that actually matters for security is that the
// TRUST DECISION for this id is made and stored server-side — see sessionStore.js's
// trustedDevices collection — never by a flag living next to this id in localStorage).
// Persists across tabs/restarts in this browser; only disappears if site data is cleared,
// which is exactly the same boundary a real device-bound cookie would have.
const DEVICE_ID_KEY = 'business_crm_device_id'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `dev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// In-memory fallback, used only when localStorage itself throws (not just "empty" — some
// locked-down browser/privacy configurations throw on every access, not merely on write).
// Root cause this guards against: without it, every call to getDeviceId() would generate and
// return a BRAND NEW random id in that case — and this function is called more than once per
// login (once in authenticate(), again in completeMfaLogin() after the OTP step), so the two
// calls in the SAME login attempt would already disagree, making a device's trust grant from
// completeMfaLogin() unobservable to the very next authenticate() call that's supposed to honor
// it. Caching in memory keeps every call *within this page load* consistent even then — the
// device still won't be recognized across a full reload in that storage-blocked environment
// (nothing short of real persistence can fix that), but it stops ever registering trust under
// an id that's already different by the next call.
let memoryFallbackId = null

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = randomId()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    if (!memoryFallbackId) memoryFallbackId = randomId()
    return memoryFallbackId
  }
}

/** Best-effort, display-only label — never used as part of the trust decision itself (spec: "do not trust a device based only on its ... user-agent string"). Purely cosmetic for the Trusted Devices list. */
export function getDeviceLabel() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown Browser'
  return `${os} · ${browser}`
}
