export function passwordScore(password = '') {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return Math.min(score, 4)
}

export const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong']

export function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
  return Array.from({ length: 10 }).map(() => chars[Math.floor(Math.random() * chars.length)]).join('')
}
