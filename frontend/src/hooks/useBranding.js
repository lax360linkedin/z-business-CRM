// The company logo shown everywhere (sidebar, sign-in screens, Settings, quotation preview, PDFs, the browser tab icon).
//
// The Super Admin uploads it in Settings -> Company Profile; the server keeps it. This module holds the current address in one place, so every screen follows at once when it changes:
//  * it is read from the public GET /branding as the app starts (the sign-in page needs it before anybody has signed in);
//  * re-read when the tab regains focus and every few minutes, so a logo changed in another session / on another device shows up without a reload;
//  * the Settings screen hands the server's answer over directly after an upload / removal (applyBranding), so the change is visible immediately.
// With no custom logo - or if the custom file cannot be loaded - the built-in logo is used.
import { useSyncExternalStore } from 'react'
import { api, API_BASE } from '../api/http'
import defaultLogo from '../assets/lax360-logo.jpeg'

export const DEFAULT_LOGO_SRC = defaultLogo
const DEFAULT_ICON = '/lax360-logo.jpeg'
const REFRESH_MS = 2 * 60 * 1000

let state = { custom: false, src: DEFAULT_LOGO_SRC, mime: null, name: '', size: 0, updatedAt: null, version: null }
const listeners = new Set()
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => state

function setFavicon(href, type) {
  if (typeof document === 'undefined') return
  let link = document.querySelector('link[rel~="icon"]')
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
  link.type = type
  link.href = href
}

/** Takes the server's branding answer ({ hasLogo, url, version, mime, name, size, updatedAt }) and updates every screen that shows the logo. */
export function applyBranding(data) {
  const next = data?.hasLogo && data.url
    ? { custom: true, src: `${API_BASE}${data.url}`, mime: data.mime, name: data.name || '', size: data.size || 0, updatedAt: data.updatedAt || null, version: data.version }
    : { custom: false, src: DEFAULT_LOGO_SRC, mime: null, name: '', size: 0, updatedAt: null, version: null }
  if (next.version === state.version && next.custom === state.custom) return
  state = next
  setFavicon(next.custom ? next.src : DEFAULT_ICON, next.custom ? next.mime : 'image/jpeg')
  listeners.forEach((fn) => fn())
}

export function loadBranding() {
  return api.get('/branding', { noCache: true }).then((res) => applyBranding(res.data)).catch(() => null) // unreachable server: keep what is shown
}

/** The current logo address, for code that is not a React component (PDF generation). */
export const getLogoSrc = () => state.src

/** { custom, src, mime, name, size, updatedAt } - re-renders when the logo changes. */
export function useBranding() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

if (typeof window !== 'undefined') {
  loadBranding()
  window.addEventListener('focus', loadBranding)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadBranding() })
  setInterval(() => { if (document.visibilityState === 'visible') loadBranding() }, REFRESH_MS)
}
