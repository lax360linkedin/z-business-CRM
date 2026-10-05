import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { USERS } from './users'
import { USER_ACCOUNT_STATUSES } from './constants'

resetSeed(4040)

// Shared demo credential for mock authentication — every seeded account uses this password.
// This is a frontend-only demo; a real backend integration would never expose/validate
// passwords like this on the client. See authenticate() in AuthContext for how it's used.
export const DEMO_PASSWORD = 'Lax@360'

// Every employee gets a corresponding system login account. User Management tracks the
// *account/access* lifecycle (status, login activity, security) separately from the
// Employees module, which tracks the *HR/people* record.
export const USER_ACCOUNTS = USERS.map((u, i) => {
  const [firstName, ...rest] = u.name.split(' ')
  const lastName = rest.join(' ')
  // Indices 20+ (newer demo accounts, e.g. Marketing/CEO) always default to Active so
  // freshly-added roles stay trivially testable instead of landing on the status-variety
  // modulo pattern used for the original 20 seeded accounts.
  const status = i >= 20
    ? (u.status === 'Inactive' ? 'Inactive' : 'Active')
    : i % 9 === 8 ? 'Locked' : i % 7 === 6 ? 'Suspended' : i % 5 === 4 ? 'Pending' : u.status === 'Inactive' ? 'Inactive' : 'Active'
  return {
    id: `USR-${String(5000 + i)}`,
    employeeId: u.id,
    firstName,
    lastName,
    name: u.name,
    email: u.email,
    phone: u.phone,
    username: u.email.split('@')[0],
    password: DEMO_PASSWORD,
    role: u.role,
    // Multi-role support: `role` stays the primary/default role (used everywhere else in
    // the app — User Management table, Employees, etc). `roles` is the full set a user may
    // choose from at login. Priya is seeded with two so the multi-role login UX is
    // demonstrable without hunting for it; everyone else just has their single role.
    roles: i === 1 ? ['Admin', 'HR'] : [u.role],
    department: u.department,
    status,
    // Excludes index 0 (the primary Super Admin demo account) so the most commonly used
    // demo login isn't interrupted by the forced-change flow; still exercised by others.
    forcePasswordChange: i > 0 && i % 6 === 0,
    failedAttempts: 0,
    lockedUntil: null,
    // Single authoritative credential record — this `password` field (not a copy) is what
    // both authenticate() and the User Management credentials view read. Never introduce a
    // second "display password" field that could drift from what's actually used to log in.
    passwordChangedAt: daysFromNow(-randInt(1, 90)),
    passwordChangedBy: 'System (Initial Setup)',
    sendWelcomeEmail: true,
    lastLogin: status === 'Pending' ? null : daysFromNow(-randInt(0, 20)),
    createdDate: u.joinDate,
    initials: u.initials,
    avatarColor: u.avatarColor,
  }
})

export function getUserAccountById(id) {
  return USER_ACCOUNTS.find((u) => u.id === id)
}

const DEVICES = ['Windows 11 · Chrome', 'macOS Sonoma · Safari', 'Windows 10 · Edge', 'Android · Chrome Mobile', 'iOS · Safari Mobile', 'Ubuntu · Firefox']

// Mock "other devices" this account is (fictitiously) also signed in on, for the Active
// Sessions panel — the CURRENT browser's real session is prepended separately by the caller,
// since that's the one actual session this frontend-only app can honestly track.
export function generateMockSessions(userId, count = 2) {
  resetSeed(userId.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + 7)
  return Array.from({ length: count }).map((_, i) => {
    const device = pick(DEVICES)
    const [os, browser] = device.split(' · ')
    return {
      id: `${userId}-SESSION-${i}`,
      device: os,
      browser,
      ip: `103.${randInt(10, 250)}.${randInt(10, 250)}.${randInt(2, 254)}`,
      loginTime: daysFromNow(-randInt(1, 14)),
      lastActivity: daysFromNow(-randInt(0, 3)),
      current: false,
    }
  })
}

export function generateLoginActivity(userId, count = 8) {
  resetSeed(userId.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + 1)
  return Array.from({ length: count }).map((_, i) => {
    const device = pick(DEVICES)
    const [os, browser] = device.split(' · ')
    const success = randInt(0, 9) > 1
    return {
      id: `${userId}-LOGIN-${i}`,
      date: daysFromNow(-randInt(0, 90)),
      time: `${String(randInt(6, 22)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`,
      device: os,
      browser,
      ip: `103.${randInt(10, 250)}.${randInt(10, 250)}.${randInt(2, 254)}`,
      status: success ? 'Success' : 'Failed',
    }
  }).sort((a, b) => new Date(b.date) - new Date(a.date))
}
