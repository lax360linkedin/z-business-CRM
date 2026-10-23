// Fails (exit 1) if any page of the app has no page-specific help, if the help is thin, or if two pages share the same text. Run with `npm run check:help`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { ALL_HELP, ROUTES, getPageHelp } = await import(new URL('../src/help/helpContent.js', import.meta.url))

const problems = []
const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
const addresses = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*' && !['/login', '/forgot-password'].includes(p))

// every address in the router must have its own help (parameters are filled with sample values; a trailing /* is a section that has its own pages)
const sample = (p) => p.replace(/\/\*$/, '').replace(/:[A-Za-z]+/g, 'SAMPLE')
for (const address of addresses) {
  const real = address.startsWith('/reports/:') ? '/reports/sales' : sample(address)
  const help = getPageHelp(real)
  if (help.key === 'general') problems.push(`No help for the page ${address}`)
}
for (const section of ['company-profile', 'personalization', 'tax-settings', 'users', 'departments', 'security', 'login-history', 'audit-logs', 'notification-settings', 'email-settings', 'whatsapp-settings', 'automation']) {
  if (getPageHelp(`/settings/${section}`).key !== `settings-${section}`) problems.push(`No help for /settings/${section}`)
}
for (const key of ['leads', 'enquiries', 'companies', 'deals', 'quotations', 'products', 'invoices', 'contracts', 'documents', 'tickets', 'campaigns', 'expenses', 'tasks']) {
  if (getPageHelp(`/settings/modules/${key}`).key !== `settings-modules-${key}`) problems.push(`No help for /settings/modules/${key}`)
}

// every entry is complete and unique
const all = [...ROUTES.map(([, id]) => id)]
for (const id of new Set(all)) {
  const h = ALL_HELP[id]
  if (!h) { problems.push(`ROUTES points at "${id}" but there is no such help entry`); continue }
  if (!h.title) problems.push(`${id}: missing title`)
  if (!h.purpose || h.purpose.length < 50) problems.push(`${id}: the purpose is missing or too short`)
  if (!h.features?.length) problems.push(`${id}: no features listed`)
  if (!h.actions?.length) problems.push(`${id}: no buttons / actions explained`)
  for (const a of h.actions || []) if (!Array.isArray(a) || a.length !== 2 || !a[0] || !a[1]) problems.push(`${id}: an action is not [label, how]`)
  for (const [label, to] of h.related || []) if (!label || !to?.startsWith('/')) problems.push(`${id}: a related link is not [label, /path]`)
}
for (const id of Object.keys(ALL_HELP)) if (!all.includes(id)) problems.push(`The help entry "${id}" is not used by any route`)
const seen = new Map()
for (const id of new Set(all)) {
  const text = ALL_HELP[id]?.purpose
  if (seen.has(text)) problems.push(`${id} and ${seen.get(text)} have identical purpose text`)
  seen.set(text, id)
}

if (problems.length) {
  console.error(`Help check FAILED (${problems.length}):\n - ${problems.join('\n - ')}`)
  process.exit(1)
}
console.log(`Help check passed: ${addresses.length} routes, ${new Set(all).size} help entries, all with purpose, features and actions.`)
