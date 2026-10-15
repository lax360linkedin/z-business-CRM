import { useEffect, useRef } from 'react'

// Ctrl+K (Cmd+K on a Mac) toggles the global search. ONE listener serves the whole app:
//  * capture phase on `window`, so no component can swallow the key before it arrives, whichever element has focus (inputs, dropdowns, an open dialog ...);
//  * `preventDefault()` + `stopPropagation()`, so the browser's own Ctrl+K (focus the address / search bar, open a web search) never takes over;
//  * matched on the physical key as well as the letter, so it also works with non-Latin keyboard layouts, and an event without a `key` (browser autofill sends those) is ignored safely;
//  * registered once however many components ask for it - the most recent one handles the key - and removed with the last one, so navigating between pages never stacks listeners.
const consumers = []
let attached = false

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
export const SEARCH_SHORTCUT_LABEL = isMac ? '⌘ K' : 'Ctrl K'

export function isSearchShortcut(e) {
  if (!e || e.isComposing || e.altKey || e.shiftKey) return false
  if (!(e.ctrlKey || e.metaKey)) return false
  return e.code === 'KeyK' || (typeof e.key === 'string' && e.key.toLowerCase() === 'k')
}

function onKeyDown(e) {
  if (!isSearchShortcut(e)) return
  e.preventDefault()
  e.stopPropagation()
  if (e.repeat) return // holding the keys down must not flicker the overlay open and shut
  consumers[consumers.length - 1]?.current?.()
}

export function useGlobalSearchShortcut(toggle) {
  const ref = useRef(toggle)
  ref.current = toggle // the latest callback, without ever re-registering
  useEffect(() => {
    consumers.push(ref)
    if (!attached) { window.addEventListener('keydown', onKeyDown, true); attached = true }
    return () => {
      consumers.splice(consumers.indexOf(ref), 1)
      if (!consumers.length && attached) { window.removeEventListener('keydown', onKeyDown, true); attached = false }
    }
  }, [])
}
