// Mock OTP engine for a frontend-only app: there is no email/SMS backend to actually
// deliver a code, so the generated OTP is surfaced directly in the UI behind a clearly
// labeled "Demo Mode" banner rather than pretending to have sent it — that's an honesty
// choice, not a missing feature. A real backend integration would generate + email/SMS this
// server-side and never expose it to the client at all.
const OTP_LENGTH = 6
export const OTP_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000

const STORE_KEY = 'business_crm_otp_v1'

function genCode() {
  let code = ''
  for (let i = 0; i < OTP_LENGTH; i++) code += Math.floor(Math.random() * 10)
  return code
}

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  sessionStorage.setItem(STORE_KEY, JSON.stringify(store))
}

/** Starts (or restarts, for resend) an OTP challenge for `purpose` (e.g. 'mfa', 'reset'), scoped to `subjectId` (account id or email). Returns the plaintext code — caller decides how to surface it in demo mode. */
export function startOtp(purpose, subjectId) {
  const code = genCode()
  const store = readStore()
  store[`${purpose}:${subjectId}`] = {
    code,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
    sentAt: Date.now(),
  }
  writeStore(store)
  return code
}

export function getOtpState(purpose, subjectId) {
  return readStore()[`${purpose}:${subjectId}`] || null
}

/** Returns { ok: true } | { ok: false, code: 'expired'|'invalid'|'too_many_attempts' } */
export function verifyOtp(purpose, subjectId, entered) {
  const store = readStore()
  const key = `${purpose}:${subjectId}`
  const entry = store[key]
  if (!entry) return { ok: false, code: 'expired' }
  if (Date.now() > entry.expiresAt) return { ok: false, code: 'expired' }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, code: 'too_many_attempts' }
  entry.attempts += 1
  writeStore(store)
  if (entered !== entry.code) return { ok: false, code: 'invalid' }
  delete store[key]
  writeStore(store)
  return { ok: true }
}

export function clearOtp(purpose, subjectId) {
  const store = readStore()
  delete store[`${purpose}:${subjectId}`]
  writeStore(store)
}
