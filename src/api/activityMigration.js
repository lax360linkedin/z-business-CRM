// One-time, idempotent upgrade of every stored activity to the linked-activity model: a `links`
// block resolved from the record it was logged on, a `source` (manual vs system-recorded) and an
// `assignedTo`. Runs after the other migrations so activities written by them are covered too.
import { resolveActivityLinks } from '../utils/activityLinks'
import { SYSTEM_EVENT_TYPES } from '../utils/activityRules'

export function migrateActivities(db) {
  db.__migrations = db.__migrations || {}
  if (db.__migrations.activityV2) return db
  const index = {}
  const find = (col, id) => {
    if (!index[col]) index[col] = new Map((db[col] || []).map((r) => [r.id, r]))
    return index[col].get(id) || null
  }
  // The old "Log Activity" form stored only a typed name (relatedId null). Re-attach those to the
  // real record when exactly one record carries that name; otherwise they stay unlinked.
  const COLLECTION_OF = { Lead: 'leads', Deal: 'deals', Customer: 'customers', Project: 'projects', Contact: 'contacts', Company: 'companies' }
  const reattach = (a) => {
    if (a.relatedId || !a.relatedName || !COLLECTION_OF[a.relatedType]) return a
    const hits = (db[COLLECTION_OF[a.relatedType]] || []).filter((r) => String(r.name || '').toLowerCase() === String(a.relatedName).trim().toLowerCase())
    return hits.length === 1 ? { ...a, relatedId: hits[0].id, relatedName: hits[0].name } : a
  }
  db.activities = (db.activities || []).map((raw) => {
    if (raw.links) return raw
    const a = reattach(raw)
    return {
      ...a,
      source: a.source || (SYSTEM_EVENT_TYPES.includes(a.type) ? 'system' : 'manual'),
      links: resolveActivityLinks(find, a.relatedType, a.relatedId),
      assignedTo: a.assignedTo || a.by || null,
      status: a.status || 'Completed',
    }
  })
  db.__migrations.activityV2 = true
  return db
}
