import { lazy } from 'react'

// Every screen is its own JavaScript chunk, so the app shell (and the first paint after sign-in) only carries what is on screen. To keep opening a module instant anyway,
// a chunk is fetched BEFORE it is needed: when the pointer or keyboard focus reaches its menu entry (`preloadPath`), and - once the person has landed and the browser is idle -
// all the others in the background (`preloadAllPages`), most-used first. `preload` is memoised, so a chunk is only ever requested once.
const pending = new Map()
let byName = {}
let byPath = {}

/** React.lazy with a `preload()` that starts (and remembers) the download without rendering anything. */
export function lazyPage(loader) {
  const load = () => { if (!pending.has(loader)) pending.set(loader, loader().catch((e) => { pending.delete(loader); throw e })); return pending.get(loader) }
  const Component = lazy(load)
  Component.preload = load
  return Component
}

export const registerPreloads = (pages) => { byName = pages }
export const registerPaths = (paths) => { byPath = paths }

/** Starts downloading the screen behind a path (menu hover / focus / touch). Unknown paths are ignored. */
export function preloadPath(path) {
  const page = byPath[String(path).split('?')[0].replace(/\/$/, '')]
  if (page?.preload) page.preload().catch(() => null)
}

// screens that pull in the PDF / document tooling (about 1 MB to run): fetched last, so the common screens are ready first and nothing heavy competes with them
const HEAVY = ['/quotations', '/quotation-templates', '/sales-orders', '/proposals', '/proposal-templates', '/contracts', '/contracts/templates', '/invoices', '/payments', '/employees', '/teams']

let started = false
/** After the first screen has settled and the browser is idle, fetch the remaining chunks a few at a time so no later click has to wait for the network. */
export function preloadAllPages() {
  if (started) return
  started = true
  const heavy = new Set(HEAVY.map((path) => byPath[path]))
  const all = [...new Set(Object.values(byPath).concat(Object.values(byName)))].filter((p) => p?.preload)
  const queue = [...all.filter((p) => !heavy.has(p)), ...all.filter((p) => heavy.has(p))]
  if (navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return // never spend a metered / very slow connection on pages nobody asked for
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 10 }), 400))
  const step = () => {
    const batch = queue.splice(0, 4)
    if (!batch.length) return
    Promise.allSettled(batch.map((p) => p.preload())).then(() => idle(step, { timeout: 3000 }))
  }
  idle(step, { timeout: 3000 })
}
