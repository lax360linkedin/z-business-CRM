import { COLLECTIONS } from './seedData'
import { migrateSalesOrders } from './salesOrderMigration'
import { migrateProposals } from './proposalMigration'
import { migrateActivities } from './activityMigration'
import { migrateTasks } from './taskMigration'
import { migrateProducts } from './productMigration'

// Every idempotent data upgrade, in dependency order.
const migrateAll = (db) => migrateProducts(migrateTasks(migrateActivities(migrateProposals(migrateSalesOrders(db)))))

// Bump this whenever COLLECTIONS shape changes so stale localStorage gets reseeded.
export const DB_KEY = 'business_crm_db_v18'

function loadRaw() {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (!raw) return null
    const db = JSON.parse(raw)
    // Upgrade a database saved before the corporate Sales Order model existed (idempotent).
    if (!db.__migrations?.salesOrderV2 || !db.__migrations?.proposalV2 || !db.__migrations?.activityV2 || !db.__migrations?.taskV2 || !db.__migrations?.productV4) {
      migrateAll(db)
      saveRaw(db)
    }
    return db
  } catch {
    return null
  }
}

function saveRaw(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
}

export function initDb() {
  const existing = loadRaw()
  if (existing) return existing
  const fresh = migrateAll(structuredClone(COLLECTIONS))
  saveRaw(fresh)
  return fresh
}

export function resetDb() {
  const fresh = migrateAll(structuredClone(COLLECTIONS))
  saveRaw(fresh)
  return fresh
}

export function getCollection(name) {
  const db = loadRaw() || initDb()
  return db[name] || []
}

export function setCollection(name, data) {
  const db = loadRaw() || initDb()
  db[name] = data
  saveRaw(db)
  return data
}

export function getDb() {
  return loadRaw() || initDb()
}
