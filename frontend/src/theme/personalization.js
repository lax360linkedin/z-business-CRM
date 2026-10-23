// The single source of truth for Settings → Personalization: every option the person can choose, the defaults, how a choice becomes <html> attributes / CSS variables
// (the styling itself lives in src/theme/personalization.css and tailwind.config.js), and the colour maths that builds an accent palette from one colour.
// The defaults reproduce the CRM exactly as it looked before Personalization existed.

export const STORAGE_KEY = 'business_crm_personalization_v1' // visual preferences only - never anything sensitive
const LEGACY_MODE_KEY = 'business_crm_theme_mode_v1'
const LEGACY_ACCENT_KEY = 'business_crm_theme_accent_v1'

// ---------------------------------------------------------------- options
export const MODES = [
  { key: 'light', label: 'Light', description: 'Bright, clean and professional' },
  { key: 'dark', label: 'Dark', description: 'Low glare for long working hours' },
  { key: 'system', label: 'System', description: 'Follows your device automatically' },
]

// `hex` is the colour the swatch shows; the palette itself is generated from it (see buildScale), darkened or lifted where needed so text stays readable.
export const ACCENTS = [
  { key: 'indigo', label: 'Indigo', hex: '#4f46e5' },
  { key: 'blue', label: 'Royal Blue', hex: '#2563eb' },
  { key: 'ocean', label: 'Ocean Blue', hex: '#0284c7' },
  { key: 'cyan', label: 'Cyan', hex: '#0891b2' },
  { key: 'teal', label: 'Teal', hex: '#0d9488' },
  { key: 'emerald', label: 'Emerald Green', hex: '#059669' },
  { key: 'forest', label: 'Forest Green', hex: '#15803d' },
  { key: 'lime', label: 'Lime', hex: '#84cc16' },
  { key: 'amber', label: 'Amber', hex: '#f59e0b' },
  { key: 'orange', label: 'Orange', hex: '#ea580c' },
  { key: 'coral', label: 'Coral', hex: '#f4695a' },
  { key: 'red', label: 'Red', hex: '#dc2626' },
  { key: 'rose', label: 'Rose', hex: '#e11d48' },
  { key: 'pink', label: 'Pink', hex: '#db2777' },
  { key: 'violet', label: 'Violet', hex: '#7c3aed' },
  { key: 'purple', label: 'Purple', hex: '#9333ea' },
  { key: 'lavender', label: 'Lavender', hex: '#a78bfa' },
  { key: 'slate', label: 'Slate', hex: '#475569' },
  { key: 'graphite', label: 'Graphite', hex: '#3f3f46' },
  { key: 'mono', label: 'Monochrome', hex: '#525252' },
]
export const DEFAULT_ACCENT = 'purple' // its palette is written out in index.css (:root), so the default needs no runtime colour work
const LEGACY_ACCENTS = { green: 'forest' }

export const STYLES = [
  { key: 'classic', label: 'Classic', description: 'A conventional enterprise CRM: solid surfaces, square-ish corners and clear borders.', preset: { bg: 'solid', card: 'solid', border: 'strong', shadow: 'none', radius: 'sharp' } },
  { key: 'modern', label: 'Modern', description: 'Balanced spacing, soft shadows and rounded cards. This is the standard CRM look.', preset: { bg: 'solid', card: 'solid', border: 'standard', shadow: 'soft', radius: 'default' } },
  { key: 'glass', label: 'Glass', description: 'Translucent, softly blurred surfaces layered over a gentle gradient.', preset: { bg: 'gradient', card: 'solid', border: 'subtle', shadow: 'medium', radius: 'rounded', blur: 'medium' } },
  { key: 'minimal', label: 'Minimal', description: 'Distraction-free: flat surfaces, hairline borders, no shadows and a neutral canvas.', preset: { bg: 'neutral', card: 'solid', border: 'subtle', shadow: 'none', radius: 'default' } },
  { key: 'contrast', label: 'High Contrast', description: 'Accessibility-first: strong borders, flat solid surfaces and the High contrast level.', preset: { bg: 'solid', card: 'solid', border: 'strong', shadow: 'none', radius: 'sharp' } },
]

export const CONTRASTS = [
  { key: 'standard', label: 'Standard Contrast', description: 'The default colours.' },
  { key: 'increased', label: 'Increased Contrast', description: 'Darker secondary text, firmer borders and a stronger keyboard focus ring.' },
  { key: 'high', label: 'High Contrast', description: 'Maximum text contrast, clearly outlined controls, thick focus rings and no translucency.' },
  { key: 'auto', label: 'Automatic Contrast', description: 'Follows your device’s “more contrast” setting when your browser reports one.' },
]

export const BACKGROUNDS = [
  { key: 'solid', label: 'Solid', description: 'Plain page colour' },
  { key: 'gradient', label: 'Subtle gradient', description: 'A soft accent-coloured wash' },
  { key: 'neutral', label: 'Neutral', description: 'Pure grey, no colour cast' },
  { key: 'tinted', label: 'Soft tint', description: 'Lightly tinted with your accent' },
]
export const CARDS = [
  { key: 'solid', label: 'Solid', description: 'White / dark panel' },
  { key: 'soft', label: 'Soft tint', description: 'Panel tinted with your accent' },
  { key: 'outlined', label: 'Outlined', description: 'Transparent with a clear outline' },
]
export const BORDERS = [{ key: 'subtle', label: 'Subtle' }, { key: 'standard', label: 'Standard' }, { key: 'strong', label: 'Strong' }]
export const SHADOWS = [{ key: 'none', label: 'None', scale: 0 }, { key: 'soft', label: 'Soft', scale: 1 }, { key: 'medium', label: 'Medium', scale: 2 }, { key: 'strong', label: 'Strong', scale: 3.2 }]
export const RADII = [{ key: 'sharp', label: 'Sharp', scale: 0.55 }, { key: 'default', label: 'Standard', scale: 1 }, { key: 'rounded', label: 'Rounded', scale: 1.3 }, { key: 'round', label: 'Extra round', scale: 1.6 }]
export const BLURS = [{ key: 'low', label: 'Low', px: 8 }, { key: 'medium', label: 'Medium', px: 16 }, { key: 'high', label: 'High', px: 26 }]
export const SIZES = [{ key: 'small', label: 'Small', percent: 93.75 }, { key: 'medium', label: 'Medium', percent: 100 }, { key: 'large', label: 'Large', percent: 112.5 }]
export const DENSITIES = [
  { key: 'compact', label: 'Compact', description: 'More on screen' },
  { key: 'comfortable', label: 'Comfortable', description: 'The standard spacing' },
  { key: 'spacious', label: 'Spacious', description: 'More breathing room' },
]
export const READABILITIES = [
  { key: 'standard', label: 'Standard', description: 'Default line height and spacing' },
  { key: 'enhanced', label: 'Enhanced', description: 'Looser lines, wider letter spacing, darker secondary text' },
]

export const DEFAULT_PREFS = {
  mode: 'system', accent: DEFAULT_ACCENT, customAccent: '#2563eb',
  ui: 'modern', contrast: 'standard',
  bg: 'solid', card: 'solid', border: 'standard', shadow: 'soft', radius: 'default', blur: 'medium',
  size: 'medium', density: 'comfortable', read: 'standard',
}

const CHOICES = {
  mode: MODES, ui: STYLES, contrast: CONTRASTS, bg: BACKGROUNDS, card: CARDS, border: BORDERS, shadow: SHADOWS, radius: RADII, blur: BLURS, size: SIZES, density: DENSITIES, read: READABILITIES,
}

export const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())

/** Whatever was stored (or typed) becomes a complete, valid set of preferences: unknown values fall back to the defaults, so a damaged entry can never break the app. */
export function sanitize(input) {
  const src = input && typeof input === 'object' ? input : {}
  const out = { ...DEFAULT_PREFS }
  for (const [field, list] of Object.entries(CHOICES)) if (list.some((o) => o.key === src[field])) out[field] = src[field]
  const accent = LEGACY_ACCENTS[src.accent] || src.accent
  if (accent === 'custom' || ACCENTS.some((a) => a.key === accent)) out.accent = accent
  if (isHex(src.customAccent)) out.customAccent = src.customAccent.trim().toLowerCase()
  if (out.accent === 'custom' && !isHex(src.customAccent)) out.accent = DEFAULT_ACCENT
  return out
}

export const samePrefs = (a, b) => Object.keys(DEFAULT_PREFS).every((k) => (k === 'customAccent' && a.accent !== 'custom' && b.accent !== 'custom') || a[k] === b[k])

/** Picking an interface style also sets the surface options that give that style its character; each can still be fine-tuned afterwards. */
export function withStyle(prefs, key) {
  const style = STYLES.find((s) => s.key === key)
  return style ? { ...prefs, ...style.preset, ui: key } : prefs
}

// ---------------------------------------------------------------- colour maths
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

export function hexToRgb(hex) {
  const n = parseInt(hex.trim().slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

export function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const WHITE = [255, 255, 255]
const PANEL_DARK = [15, 23, 42] // the dark card surface (ink-900)

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

/**
 * Builds the 11-shade accent scale from one colour, for light or dark mode.
 *  - shade 600 (buttons, active items) is darkened until white text on it reaches WCAG AA (4.5:1); in dark mode a very dark accent is lifted so it still shows on dark panels;
 *  - shade 400 / 300 (links and highlights on dark panels) are lifted until they reach AA on the dark panel colour;
 *  - the tints (50-200) and deep shades (700-950) follow the colour's own hue and saturation.
 * Returns { vars: { 50: 'r g b', ... }, hex600, adjusted } where `adjusted` says whether the chosen colour had to be changed to keep text readable.
 */
export function buildScale(hex, dark = false) {
  const [h, s, l0] = rgbToHsl(hexToRgb(hex))
  const at = (l, sat = s) => hslToRgb([h, sat, l])
  let l600 = l0
  while (contrastRatio(at(l600), WHITE) < 4.5 && l600 > 6) l600 -= 0.5
  if (dark) while (luminance(at(l600)) < 0.085 && contrastRatio(at(l600 + 0.5), WHITE) >= 4.5) l600 += 0.5
  let l400 = Math.max(l600 + 17, 56)
  while (contrastRatio(at(l400), PANEL_DARK) < 4.6 && l400 < 88) l400 += 1
  const l500 = (l600 + l400) / 2
  const l300 = Math.max(l400 + 11, 78)
  const l200 = Math.max(l300 + 8, 88)
  const l100 = Math.max(l200 + 5, 94)
  const l50 = Math.max(l100 + 3, 97)
  const levels = { 50: l50, 100: l100, 200: l200, 300: l300, 400: l400, 500: l500, 600: l600, 700: l600 * 0.86, 800: l600 * 0.72, 900: l600 * 0.58, 950: Math.max(l600 * 0.36, 5) }
  const vars = {}
  for (const shade of SHADES) vars[shade] = at(levels[shade], shade <= 200 ? Math.min(100, s) : s).map((v) => Math.round(v)).join(' ')
  return { vars, hex600: toHex(at(l600)), adjusted: Math.abs(l600 - l0) > 1 }
}

export function accentHexFor(prefs) {
  if (prefs.accent === 'custom') return prefs.customAccent
  return (ACCENTS.find((a) => a.key === prefs.accent) || ACCENTS.find((a) => a.key === DEFAULT_ACCENT)).hex
}
const cssVars = (vars) => SHADES.map((shade) => `--brand-${shade}:${vars[shade]}`).join(';')

// ---------------------------------------------------------------- storage (per signed-in person, in this browser)
/** { last, vars, users: { [id]: prefs } } - `last` is what the login screen and the first paint use; `users` keeps each person's own choices. */
export function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (raw && typeof raw === 'object') return { last: raw.last ? sanitize(raw.last) : null, users: raw.users && typeof raw.users === 'object' ? raw.users : {} }
  } catch { /* storage may be unavailable or damaged - start from the defaults */ }
  let legacy = null
  try {
    legacy = {}
    const mode = localStorage.getItem(LEGACY_MODE_KEY); const accent = localStorage.getItem(LEGACY_ACCENT_KEY)
    if (mode) legacy.mode = mode
    if (accent) legacy.accent = accent
  } catch { legacy = null }
  return { last: legacy && Object.keys(legacy).length ? sanitize(legacy) : null, users: {} }
}

export function writeStore(store, prefs) {
  const vars = {
    light: cssVars(buildScale(accentHexFor(prefs), false).vars),
    dark: cssVars(buildScale(accentHexFor(prefs), true).vars),
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ last: prefs, vars, users: store.users })) } catch { /* storage may be unavailable - the choice just won't survive a reload */ }
}

// ---------------------------------------------------------------- applying to the page
export const prefersMoreContrast = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches
export const supportsContrastQuery = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-contrast: no-preference), (prefers-contrast: more), (prefers-contrast: less), (prefers-contrast: custom)').matches

/** The contrast level actually drawn: the High Contrast style forces High, Automatic follows the device. */
export function effectiveContrast(prefs, deviceWantsMore) {
  if (prefs.ui === 'contrast') return 'high'
  if (prefs.contrast === 'auto') return deviceWantsMore ? 'increased' : 'standard'
  return prefs.contrast
}

/** Writes the preferences onto <html>: the `dark` class, data-* attributes the stylesheet keys on, and the accent's CSS variables. Returns what the screens need to know. */
export function applyToDocument(prefs, { dark, deviceWantsMore }) {
  const root = document.documentElement
  const contrast = effectiveContrast(prefs, deviceWantsMore)
  root.classList.toggle('dark', dark)
  const attrs = { ui: prefs.ui, contrast, bg: prefs.bg, card: prefs.card, border: prefs.border, shadow: prefs.shadow, radius: prefs.radius, blur: prefs.blur, size: prefs.size, density: prefs.density, read: prefs.read, accent: prefs.accent }
  for (const [name, value] of Object.entries(attrs)) root.setAttribute(`data-${name}`, value)
  const scale = buildScale(accentHexFor(prefs), dark)
  if (prefs.accent === DEFAULT_ACCENT) for (const shade of SHADES) root.style.removeProperty(`--brand-${shade}`)
  else for (const shade of SHADES) root.style.setProperty(`--brand-${shade}`, scale.vars[shade])
  root.style.setProperty('--radius-scale', String((RADII.find((r) => r.key === prefs.radius) || RADII[1]).scale))
  root.style.setProperty('--shadow-scale', String((SHADOWS.find((r) => r.key === prefs.shadow) || SHADOWS[1]).scale))
  root.style.setProperty('--glass-blur', `${(BLURS.find((r) => r.key === prefs.blur) || BLURS[1]).px}px`)
  root.style.setProperty('--font-percent', `${(SIZES.find((r) => r.key === prefs.size) || SIZES[1]).percent}%`)
  return { contrast, accentHex: prefs.accent === DEFAULT_ACCENT ? ACCENTS.find((a) => a.key === DEFAULT_ACCENT).hex : scale.hex600, accentAdjusted: scale.adjusted }
}
