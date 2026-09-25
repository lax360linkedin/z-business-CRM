import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

const MODE_KEY = 'business_crm_theme_mode_v1'
const ACCENT_KEY = 'business_crm_theme_accent_v1'
const DEFAULT_ACCENT = 'purple'

// The single source of truth for every accent option the app offers — Settings → Appearance,
// the navbar quick-switch (if any) and this context all read from this one list rather than
// duplicating color names/labels/hexes in multiple places. `hex` is the 600-shade, used only
// where a literal color string is unavoidable (Recharts fill/stroke props can't consume a
// Tailwind class) — see accentHex below. Every other UI use the `brand-*` Tailwind classes,
// which resolve through the CSS custom properties in src/index.css.
export const ACCENTS = [
  { key: 'purple', label: 'Purple', hex: '#9333ea', swatch: 'bg-purple-600' },
  { key: 'indigo', label: 'Indigo', hex: '#4f46e5', swatch: 'bg-indigo-600' },
  { key: 'blue', label: 'Blue', hex: '#2563eb', swatch: 'bg-blue-600' },
  { key: 'cyan', label: 'Cyan', hex: '#0891b2', swatch: 'bg-cyan-600' },
  { key: 'teal', label: 'Teal', hex: '#0d9488', swatch: 'bg-teal-600' },
  { key: 'green', label: 'Green', hex: '#16a34a', swatch: 'bg-green-600' },
  { key: 'emerald', label: 'Emerald', hex: '#059669', swatch: 'bg-emerald-600' },
  { key: 'orange', label: 'Orange', hex: '#ea580c', swatch: 'bg-orange-600' },
  { key: 'rose', label: 'Rose', hex: '#e11d48', swatch: 'bg-rose-600' },
  { key: 'red', label: 'Red', hex: '#dc2626', swatch: 'bg-red-600' },
]
const VALID_ACCENTS = ACCENTS.map((a) => a.key)

// Polished presets for Settings → Appearance — each just pairs an accent with a suggested
// mode, since the accent tokens themselves already carry both their light and dark values.
export const THEME_PRESETS = [
  { key: 'purple', label: 'Default Purple', accent: 'purple' },
  { key: 'indigo', label: 'Indigo', accent: 'indigo' },
  { key: 'blue', label: 'Ocean Blue', accent: 'blue' },
  { key: 'emerald', label: 'Emerald', accent: 'emerald' },
  { key: 'rose', label: 'Rose', accent: 'rose' },
  { key: 'orange', label: 'Orange', accent: 'orange' },
]

function readStoredMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // storage may be unavailable
  }
  return 'system'
}

function readStoredAccent() {
  try {
    const stored = localStorage.getItem(ACCENT_KEY)
    if (stored && VALID_ACCENTS.includes(stored)) return stored
  } catch {
    // storage may be unavailable
  }
  return DEFAULT_ACCENT
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Centralized appearance system: `mode` (light/dark/system, what the user picked) resolves to
 * `theme` (the actual light/dark rendered right now). Both `mode` and `accent` persist to
 * localStorage under their own dedicated keys (never scattered into other storage) and are
 * applied to <html> as the `dark` class + `data-accent` attribute — every themed component in
 * the app (Sidebar, Header, cards, tables, forms, modals, charts…) reads through those two
 * mechanisms via Tailwind's `dark:` variant and the `brand-*` CSS-variable-backed color scale,
 * so a mode or accent change repaints the entire CRM instantly with no reload and no per-page
 * plumbing required.
 */
export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode)
  const [accent, setAccentState] = useState(readStoredAccent)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // Track the OS preference live so `mode: 'system'` updates without a reload if the user
  // flips their OS theme while the app is open.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const theme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  const setMode = useCallback((next) => {
    setModeState(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // storage may be unavailable — appearance just won't persist across reloads
    }
  }, [])

  const setAccent = useCallback((next) => {
    if (!VALID_ACCENTS.includes(next)) return
    setAccentState(next)
    try {
      localStorage.setItem(ACCENT_KEY, next)
    } catch {
      // storage may be unavailable
    }
  }, [])

  // Backward-compatible explicit flip (used by the navbar's quick Sun/Moon toggle) — always
  // resolves to a concrete light/dark choice, overriding 'system' with whichever it isn't.
  const toggleTheme = useCallback(() => setMode(theme === 'dark' ? 'light' : 'dark'), [theme, setMode])

  const accentMeta = useMemo(() => ACCENTS.find((a) => a.key === accent) || ACCENTS[0], [accent])

  const value = useMemo(() => ({
    mode,
    setMode,
    theme,
    toggleTheme,
    accent,
    setAccent,
    accentHex: accentMeta.hex,
    accentLabel: accentMeta.label,
    accents: ACCENTS,
    presets: THEME_PRESETS,
  }), [mode, setMode, theme, toggleTheme, accent, setAccent, accentMeta])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
