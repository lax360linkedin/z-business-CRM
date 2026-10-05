// Real, persisted security configuration (Settings → Security) — read by sessionStore.js on
// every session/device-trust decision, so changing the policy here actually changes
// enforcement, rather than a Settings field that only toasts "saved" and does nothing (which
// several other Settings panels in this app are still, intentionally, left as — this one isn't,
// since session expiry/device trust duration need to be real for the auth spec this supports).
const KEY = 'business_crm_security_settings_v1'

export const SESSION_TIMEOUT_PRESETS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 300, label: '5 hours' },
  { minutes: 480, label: '8 hours' },
  { minutes: 1440, label: '24 hours' },
]

const DEFAULTS = {
  sessionTimeoutMinutes: 60,
  trustedDeviceDays: 30,
  minPasswordLength: 8,
  requireSpecialChar: true,
}

export function getSecuritySettings() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSecuritySettings(patch) {
  const next = { ...getSecuritySettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}
