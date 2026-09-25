import { COLLECTIONS } from './seedData'

// Bump this whenever COLLECTIONS shape changes so stale localStorage gets reseeded.
export const DB_KEY = 'business_crm_db_v16'

function loadRaw() {
  try {
    const raw = localStorage.getItem(DB_KEY)
    return raw ? JSON.parse(raw) : null
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
  const fresh = structuredClone(COLLECTIONS)
  saveRaw(fresh)
  return fresh
}

export function resetDb() {
  const fresh = structuredClone(COLLECTIONS)
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
