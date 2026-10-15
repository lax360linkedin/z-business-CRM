// A read-through cache of the lists the server returns (GET /<collection>?all=true), so screens that join records for display (a customer's projects, a deal's company,
// who owns what) can read them synchronously while every byte still comes from - and is authorised by - the backend. The server only sends what the signed-in person may see.
//
//   live('companies')            -> a stable array whose contents are replaced in place when the list is (re)loaded; safe to import at module level
//   useCollections('companies')  -> hook for a screen: loads / refreshes what it needs and re-renders it when the data arrives or changes
//   after any successful write the loaded lists are marked stale and the ones a mounted screen is using are re-fetched (debounced)
//
// The cache is cleared on sign-out and holds nothing the server did not return for that session.
import { useEffect, useReducer } from 'react'
import { api, onWrite, clearReadCache } from './http'

const arrays = new Map() // name -> live array
const meta = new Map() // name -> { loadedAt, loading: Promise|null, stale, refs }
const listeners = new Set()
const STALE_MS = 15000

export function live(name) {
  if (!arrays.has(name)) arrays.set(name, [])
  return arrays.get(name)
}
const info = (name) => { if (!meta.has(name)) meta.set(name, { loadedAt: 0, loading: null, stale: true, refs: 0 }); return meta.get(name) }
const notify = () => listeners.forEach((fn) => fn())
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/** Replaces a collection's contents (a screen that already fetched the list can share it). */
export function put(name, rows) {
  const arr = live(name)
  arr.splice(0, arr.length, ...(Array.isArray(rows) ? rows : []))
  const m = info(name)
  m.loadedAt = Date.now(); m.stale = false
  notify()
}

/** Loads (or re-loads) one collection. Concurrent calls share one request. */
export function load(name, { force = false } = {}) {
  const m = info(name)
  if (m.loading) return m.loading
  if (!force && !m.stale && Date.now() - m.loadedAt < STALE_MS) return Promise.resolve(live(name))
  m.loading = api.get(`/${name}`, { params: { all: true } })
    .then((res) => { put(name, Array.isArray(res.data) ? res.data : res.data?.data || []); return live(name) })
    .catch(() => live(name)) // a list the person may not open simply stays empty
    .finally(() => { m.loading = null })
  return m.loading
}

export function loadMany(names, opts) {
  return Promise.all(names.map((n) => load(n, opts)))
}

/** Forgets everything (sign-out). */
export function clearStore() {
  clearReadCache()
  arrays.forEach((arr) => arr.splice(0, arr.length))
  meta.clear()
  notify()
}

let timer = null
onWrite(() => {
  meta.forEach((m) => { m.stale = true })
  clearTimeout(timer)
  timer = setTimeout(() => meta.forEach((m, name) => { if (m.refs > 0) load(name, { force: true }) }), 250)
})

/** Hook for a screen: makes sure the named collections are loaded and re-renders the screen whenever they change. Returns a counter you can use as a memo dependency. */
export function useCollections(...names) {
  const [tick, bump] = useReducer((n) => n + 1, 0)
  const key = names.join('|')
  useEffect(() => {
    names.forEach((n) => { info(n).refs += 1 })
    const off = subscribe(bump)
    loadMany(names)
    return () => { off(); names.forEach((n) => { info(n).refs -= 1 }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return tick
}
