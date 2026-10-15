// The audit trail is written by the server (append-only table) for every sign-in, refusal, permission change and record change, and read back through GET /audit.
// These two names remain so existing call sites keep working; the browser no longer keeps a copy of its own.
export function logAuditEvent() {}
export function getAuditLog() { return [] }
