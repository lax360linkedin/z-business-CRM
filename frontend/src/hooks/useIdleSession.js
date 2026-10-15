import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/http'

// Signs a person out when - and only when - they have done nothing at all for the inactivity period.
//
//  * "Doing something" = typing, clicking, touching, scrolling, moving the pointer, or coming back to the tab. Background work (the app polling the server, renewing its access
//    token) is NOT activity, so a forgotten open tab really does time out.
//  * While the person is active the app tells the server so ("heartbeat", at most once a minute). The server is the authority: it ends an idle session on the next request
//    whatever this browser believes, and answers with the code SESSION_IDLE, which the API client turns into the same sign-out.
//  * Time is measured with clock timestamps, not counters, so a throttled background tab or a sleeping laptop is judged correctly the moment the person returns.
//  * Activity in any tab of this browser counts for all tabs (shared through localStorage).
//  * One minute before the end a warning appears; only "Stay signed in" (or sign-out) answers it, so a stray mouse movement cannot hide it by accident.
const ACTIVITY_KEY = 'business_crm_last_activity'
const HEARTBEAT_MS = 60 * 1000
const WARNING_MS = 60 * 1000
const THROTTLE_MS = 1000
const EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'pointerdown', 'scroll', 'mousemove']

const readShared = () => { try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0 } catch { return 0 } }
const writeShared = (t) => { try { localStorage.setItem(ACTIVITY_KEY, String(t)) } catch { /* storage blocked: this tab still counts its own activity */ } }

/** True when an open dialog holds something typed - the warning then says so, because signing out would lose it. */
function hasOpenForm() {
  return [...document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select')].some((el) => el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio' && String(el.value || '').trim() !== '')
}

/**
 * @param {{ enabled: boolean, idleMinutes: number, onIdle: () => void }} options
 * @returns {{ warning: null | { secondsLeft: number, unsaved: boolean }, stay: () => void }}
 */
export function useIdleSession({ enabled, idleMinutes, onIdle }) {
  const [warning, setWarning] = useState(null)
  const last = useRef(Date.now())
  const beat = useRef(0)
  const warned = useRef(false)
  const idleRef = useRef(onIdle)
  idleRef.current = onIdle
  const idleMs = Math.max(5, Number(idleMinutes) || 30) * 60 * 1000

  const heartbeat = useCallback(() => {
    beat.current = Date.now()
    api.post('/auth/activity', null, { silent: true }).catch(() => null) // an answer of "session idle / ended" is handled by the API client
  }, [])

  const markActive = useCallback((force = false) => {
    if (warned.current && !force) return // once the warning is up, only an explicit choice answers it
    const now = Date.now()
    if (!force && now - last.current < THROTTLE_MS) return
    last.current = now
    writeShared(now)
    if (now - beat.current >= HEARTBEAT_MS) heartbeat()
  }, [heartbeat])

  const stay = useCallback(() => {
    warned.current = false
    setWarning(null)
    markActive(true)
    heartbeat()
  }, [markActive, heartbeat])

  useEffect(() => {
    if (!enabled) return undefined
    const start = Date.now()
    last.current = start
    beat.current = start // signing in counts as the first heartbeat
    writeShared(start)
    warned.current = false
    setWarning(null)

    const onActivity = () => markActive(false)
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }))
    const onShared = (e) => { if (e.key === ACTIVITY_KEY) last.current = Math.max(last.current, Number(e.newValue) || 0) }
    window.addEventListener('storage', onShared)

    const tick = () => {
      last.current = Math.max(last.current, readShared())
      const remaining = last.current + idleMs - Date.now()
      if (remaining <= 0) { idleRef.current?.(); return }
      if (remaining <= WARNING_MS) {
        warned.current = true
        setWarning({ secondsLeft: Math.ceil(remaining / 1000), unsaved: hasOpenForm() })
      } else if (warned.current) { // another tab of this browser showed activity: the warning is no longer needed
        warned.current = false
        setWarning(null)
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') { tick(); if (!warned.current) markActive(false) } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    const timer = setInterval(tick, 1000)
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }))
      window.removeEventListener('storage', onShared)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
      clearInterval(timer)
    }
  }, [enabled, idleMs, markActive])

  return { warning, stay }
}
