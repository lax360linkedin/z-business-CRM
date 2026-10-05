// The server-side (mock-"backend") half of authentication: session issuance/validation and
// trusted-device registration, both persisted in the same localStorage-backed DB every other
// resource in this app uses (src/api/db.js) — never only a frontend flag or timer. This module
// is the single authority both AuthContext (the React-facing login/logout flow) and
// api/mockServer.js (the request-gating layer every protected API call goes through) read from,
// so the two can never disagree about whether a session or device is actually valid.
import { getCollection, setCollection } from '../api/db'
import { getSecuritySettings } from './securitySettings'

function genToken() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `SES-${Date.now().toString(36)}-${rand}`
}
function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// --- Sessions ------------------------------------------------------------------------------

function getSessions() {
  return getCollection('sessions')
}
function saveSessions(list) {
  setCollection('sessions', list)
}

/** Issues a new server-side session record with an absolute expiry — "keep logged in for the configured session duration" is measured from login, not sliding on activity, matching "After the configured session duration expires, automatically log out" literally. */
export function createSession({ accountId, role, deviceId }) {
  const now = Date.now()
  const { sessionTimeoutMinutes } = getSecuritySettings()
  const record = {
    id: genToken(),
    accountId,
    role,
    deviceId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + sessionTimeoutMinutes * 60 * 1000,
    revoked: false,
  }
  saveSessions([record, ...getSessions()])
  return record
}

export function getSession(token) {
  if (!token) return null
  return getSessions().find((s) => s.id === token) || null
}

/**
 * The one function both the login-restore path (AuthContext) and every protected mock API call
 * (mockServer.js) run a request through. Returns a reason so callers can distinguish "never had
 * a session" (reason: 'missing' — just not logged in, no message needed) from "had one but it's
 * no longer good" (reason: 'expired'/'revoked' — show "Your session has expired" and force a
 * fresh login).
 */
export function validateSession(token) {
  if (!token) return { valid: false, reason: 'missing' }
  const session = getSession(token)
  if (!session) return { valid: false, reason: 'missing' }
  if (session.revoked) return { valid: false, reason: 'revoked', session }
  if (Date.now() > session.expiresAt) return { valid: false, reason: 'expired', session }
  return { valid: true, session }
}

export function touchSession(token) {
  const sessions = getSessions()
  const idx = sessions.findIndex((s) => s.id === token)
  if (idx === -1) return
  const next = [...sessions]
  next[idx] = { ...next[idx], lastSeenAt: Date.now() }
  saveSessions(next)
}

export function revokeSession(token) {
  const sessions = getSessions()
  const idx = sessions.findIndex((s) => s.id === token)
  if (idx === -1) return
  const next = [...sessions]
  next[idx] = { ...next[idx], revoked: true }
  saveSessions(next)
}

function revokeSessionsForDevice(accountId, deviceId) {
  saveSessions(getSessions().map((s) => (s.accountId === accountId && s.deviceId === deviceId ? { ...s, revoked: true } : s)))
}

// --- Trusted devices -----------------------------------------------------------------------

function getDevices() {
  return getCollection('trustedDevices')
}
function saveDevices(list) {
  setCollection('trustedDevices', list)
}

export function getDeviceRecord(accountId, deviceId) {
  return getDevices().find((d) => d.accountId === accountId && d.deviceId === deviceId) || null
}

/** The device-trust gate every login checks before deciding whether to require a 2FA code. A device is trusted only while a record exists, isn't revoked, and its (renewable) trust window hasn't lapsed — never by matching IP/user-agent alone. */
export function isDeviceTrusted(accountId, deviceId) {
  const record = getDeviceRecord(accountId, deviceId)
  if (!record || record.revoked) return false
  return Date.now() < record.trustExpiresAt
}

/**
 * Registers (or renews) trust for a device — called once after a successful 2FA verification,
 * and again, silently, on every later login from that same still-trusted device (a sliding
 * window: using a trusted device keeps it trusted for another full period, same as how most
 * real "remember this device for 30 days" implementations behave, rather than a single
 * one-shot grant that lapses on a fixed calendar date regardless of use).
 */
export function trustDevice({ accountId, deviceId, deviceLabel }) {
  const { trustedDeviceDays } = getSecuritySettings()
  const now = Date.now()
  const trustExpiresAt = now + trustedDeviceDays * 24 * 60 * 60 * 1000
  const devices = getDevices()
  const idx = devices.findIndex((d) => d.accountId === accountId && d.deviceId === deviceId)
  if (idx === -1) {
    const record = { id: genId('DEV'), accountId, deviceId, deviceLabel, createdAt: now, lastUsedAt: now, trustExpiresAt, revoked: false }
    saveDevices([record, ...devices])
    return record
  }
  const next = [...devices]
  next[idx] = { ...next[idx], lastUsedAt: now, trustExpiresAt, revoked: false, deviceLabel: deviceLabel || next[idx].deviceLabel }
  saveDevices(next)
  return next[idx]
}

export function listTrustedDevices(accountId) {
  return getDevices()
    .filter((d) => d.accountId === accountId)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

/** Revokes one trusted device and immediately kills any live session opened from it — a revoked device shouldn't keep using a session token it already had in hand. */
export function revokeDevice(deviceRecordId) {
  const devices = getDevices()
  const idx = devices.findIndex((d) => d.id === deviceRecordId)
  if (idx === -1) return
  const target = devices[idx]
  const next = [...devices]
  next[idx] = { ...target, revoked: true }
  saveDevices(next)
  revokeSessionsForDevice(target.accountId, target.deviceId)
}
