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

/** A random temporary password that always meets the server's policy: 12 characters with an upper-case letter, a lower-case letter, a digit and a special character. */
export function genTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?']
  const all = sets.join('')
  const rand = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n }
  const out = [...sets.map((set) => set[rand(set.length)]), ...Array.from({ length: 8 }, () => all[rand(all.length)])]
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]] } // shuffle so the guaranteed characters are not always first
  return out.join('')
}
