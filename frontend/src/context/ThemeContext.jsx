import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ACCENTS, DEFAULT_PREFS, applyToDocument, buildScale, accentHexFor, effectiveContrast, prefersMoreContrast, readStore, samePrefs, sanitize, supportsContrastQuery, writeStore,
} from '../theme/personalization'

const ThemeContext = createContext(null)

export { ACCENTS }

const matches = (query) => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches

/**
 * The CRM's personalization system (Settings → Personalization). Everything visual is a small set of preferences (see theme/personalization.js) that this provider writes onto <html>
 * as the `dark` class, data-* attributes and CSS variables - the stylesheet (theme/personalization.css, tailwind.config.js, index.css) does the rest, so a change repaints the whole app
 * at once with no reload and no per-page code.
 *
 *  - `applied` is what is saved (in this browser, per signed-in person - see bindUser); `draft` is a set of changes being tried out on the Personalization page. The page shows the draft
 *    everywhere straight away, and it only becomes the saved choice on applyDraft(); discardDraft() (or leaving the page) returns to the saved one.
 *  - `mode` / `setMode` / `accent` / `setAccent` / `toggleTheme` keep working exactly as before for the header's quick toggle and the charts; they save immediately.
 */
export function ThemeProvider({ children }) {
  const storeRef = useRef(null)
  if (storeRef.current === null) storeRef.current = readStore()
  const userIdRef = useRef(null)
  const [applied, setApplied] = useState(() => storeRef.current.last || DEFAULT_PREFS)
  const [draft, setDraft] = useState(null)
  const [systemDark, setSystemDark] = useState(() => matches('(prefers-color-scheme: dark)'))
  const [deviceWantsMore, setDeviceWantsMore] = useState(prefersMoreContrast)

  // follow the device live, so System mode and Automatic contrast update without a reload
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const more = window.matchMedia('(prefers-contrast: more)')
    const onDark = (e) => setSystemDark(e.matches)
    const onMore = (e) => setDeviceWantsMore(e.matches)
    dark.addEventListener('change', onDark)
    more.addEventListener('change', onMore)
    return () => { dark.removeEventListener('change', onDark); more.removeEventListener('change', onMore) }
  }, [])

  const prefs = draft || applied
  const theme = prefs.mode === 'system' ? (systemDark ? 'dark' : 'light') : prefs.mode
  const contrast = effectiveContrast(prefs, deviceWantsMore)

  useLayoutEffect(() => { applyToDocument(prefs, { dark: theme === 'dark', deviceWantsMore }) }, [prefs, theme, deviceWantsMore])

  const commit = useCallback((next) => {
    const clean = sanitize(next)
    const store = storeRef.current
    if (userIdRef.current) store.users = { ...store.users, [userIdRef.current]: clean }
    writeStore(store, clean)
    setApplied(clean)
    return clean
  }, [])

  /** Called when the signed-in person changes: they get their own saved look back; someone with none yet starts from the standard look. */
  const bindUser = useCallback((id) => {
    const key = id ? String(id) : null
    if (userIdRef.current === key) return
    userIdRef.current = key
    if (!key) return
    setDraft(null)
    const own = storeRef.current.users[key]
    if (own) {
      const clean = sanitize(own)
      writeStore(storeRef.current, clean)
      setApplied(clean)
    } else {
      // nobody has signed in since Personalization existed: keep the look this browser already had (the old mode / accent); any later newcomer starts from the standard look
      const first = Object.keys(storeRef.current.users).length === 0
      setApplied((cur) => {
        const start = first ? cur : DEFAULT_PREFS
        storeRef.current.users = { ...storeRef.current.users, [key]: start }
        writeStore(storeRef.current, start)
        return start
      })
    }
  }, [])

  const setMode = useCallback((mode) => {
    commit({ ...applied, mode })
    setDraft((d) => (d ? { ...d, mode } : d))
  }, [applied, commit])
  const setAccent = useCallback((accent) => {
    commit({ ...applied, accent })
    setDraft((d) => (d ? { ...d, accent } : d))
  }, [applied, commit])
  // the header's quick Sun/Moon flip: always lands on an explicit light or dark choice
  const toggleTheme = useCallback(() => setMode(theme === 'dark' ? 'light' : 'dark'), [theme, setMode])

  const updateDraft = useCallback((patch) => setDraft((d) => sanitize({ ...(d || applied), ...(typeof patch === 'function' ? patch(d || applied) : patch) })), [applied])
  const applyDraft = useCallback(() => { if (draft) commit(draft); setDraft(null) }, [draft, commit])
  const discardDraft = useCallback(() => setDraft(null), [])
  const resetDraft = useCallback(() => setDraft({ ...DEFAULT_PREFS }), [])
  const dirty = !!draft && !samePrefs(draft, applied)

  const scale = useMemo(() => buildScale(accentHexFor(prefs), theme === 'dark'), [prefs, theme])
  const accentHex = prefs.accent === 'purple' ? '#9333ea' : scale.hex600

  const value = useMemo(() => ({
    mode: prefs.mode, setMode, theme, toggleTheme,
    accent: prefs.accent, setAccent, accentHex, accentAdjusted: scale.adjusted, accents: ACCENTS,
    prefs, applied, draft, dirty, contrast, deviceWantsMore, contrastQuerySupported: supportsContrastQuery(),
    updateDraft, applyDraft, discardDraft, resetDraft, bindUser,
  }), [prefs, applied, draft, dirty, theme, contrast, deviceWantsMore, accentHex, scale.adjusted, setMode, setAccent, toggleTheme, updateDraft, applyDraft, discardDraft, resetDraft, bindUser])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/** Sits inside the auth provider and tells the theme who is signed in, so each person keeps their own personalization in this browser. */
export function useBindThemeUser(userId) {
  const { bindUser } = useTheme()
  useEffect(() => { bindUser(userId) }, [userId, bindUser])
}
