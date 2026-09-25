// Lightweight, real (not decorative) audit trail for permission-sensitive actions, persisted
// to localStorage. A production build would send these events to a backend instead — the
// shape here (user/role/action/module/record/previousValue/newValue/date/success) is chosen
// to be a straightforward fit for that later swap.
const AUDIT_LOG_KEY = 'business_crm_audit_log_v1'
const MAX_ENTRIES = 500

export function logAuditEvent({ user, action, module, record, previousValue, newValue, success = true, detail }) {
  try {
    const entries = getAuditLog()
    entries.unshift({
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user: user?.name || 'Unknown',
      role: user?.role || '—',
      action,
      module,
      record: record || null,
      previousValue: previousValue ?? null,
      newValue: newValue ?? null,
      success,
      detail: detail || null,
      date: new Date().toISOString(),
    })
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // storage may be unavailable — auditing best-effort only, never block the action
  }
}

export function getAuditLog() {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
