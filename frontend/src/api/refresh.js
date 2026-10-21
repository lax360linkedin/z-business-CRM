// The Refresh button. "Refresh" must reach the data the page is really showing, so it does the same thing a change made elsewhere would do - and then waits for the answers:
//   1. the short read cache is emptied, so nothing old is served;
//   2. the "something changed" signals the screens already listen to are sent (tasks, invoices, marketing ...): every mounted list that follows one re-reads its data;
//   3. the shared collections a screen is using are re-fetched, and every loader a page registered with useRefreshHandler() is run (lists keep their search, filters, sort and page);
//   4. every GET that this starts is counted: the refresh is finished when they have all answered, and it failed only if one really failed (no answer / a server error).
// A page that read nothing at all in step 2-3 (it loads once when it opens) is re-opened in place by the layout instead, so the button never pretends: it always re-reads.
import { useEffect, useRef } from 'react'
import { clearReadCache, trackReads } from './http'
import { reloadMounted } from './store'

const handlers = new Set()

/** A page that loads its own data registers the function that reloads it (called with no arguments, may return a promise). The latest function is always used. */
export function useRefreshHandler(fn) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const run = () => ref.current?.()
    handlers.add(run)
    return () => { handlers.delete(run) }
  }, [])
}

const SIGNALS = ['crm:tasks-changed', 'crm:documents-changed', 'crm:invoices-changed', 'crm:payments-changed', 'crm:expenses-changed', 'crm:marketing-changed', 'crm:projects-changed', 'crm:products-changed', 'crm:contracts-changed', 'crm:org-changed', 'crm:options-changed']

/** Re-reads the current page. `reopen` re-mounts the page: used when the page made no read of its own, or always for a record's detail page (nothing there is a filter worth keeping). Resolves { failures: [message] }. */
export async function runRefresh(reopen, { alwaysReopen = false } = {}) {
  clearReadCache()
  const t = trackReads()
  SIGNALS.forEach((name) => window.dispatchEvent(new Event(name)))
  await Promise.allSettled([reloadMounted(), ...[...handlers].map((h) => { try { return Promise.resolve(h()) } catch (e) { return Promise.reject(e) } })])
  await new Promise((r) => setTimeout(r, 30)) // let anything the handlers started register
  if (reopen && (alwaysReopen || t.started === 0)) { reopen(); await new Promise((r) => setTimeout(r, 80)) } // the re-opened page makes its reads under the same count
  const done = await t.settled()
  return { failures: [...new Set(done.failures)] }
}
