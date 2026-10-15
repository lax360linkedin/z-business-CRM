import { Sun, Moon, Monitor, Check, Bell, Search, Plus, LayoutDashboard, Users, Handshake } from 'lucide-react'
import clsx from 'clsx'
import { useTheme, ACCENTS } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'

const MODES = [
  { key: 'light', label: 'Light', icon: Sun, description: 'Purple + White' },
  { key: 'dark', label: 'Dark', icon: Moon, description: 'Purple + Black' },
  { key: 'system', label: 'System', icon: Monitor, description: 'Match your device' },
]

function ModeCard({ mode, active, onSelect }) {
  const Icon = mode.icon
  return (
    <button
      onClick={() => onSelect(mode.key)}
      className={clsx(
        'flex flex-1 flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-center transition-colors',
        active ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-ink-100 hover:border-ink-200 dark:border-ink-800 dark:hover:border-ink-700',
      )}
    >
      <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full', active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400')}>
        <Icon size={18} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-800 dark:text-ink-100">{mode.label}</span>
        <span className="block text-xs text-ink-400">{mode.description}</span>
      </span>
    </button>
  )
}

function AccentSwatch({ accent, active, onSelect }) {
  return (
    <button
      onClick={() => onSelect(accent.key)}
      title={accent.label}
      className="flex flex-col items-center gap-1.5"
    >
      <span className={clsx('relative flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white transition-all dark:ring-offset-ink-900', accent.swatch, active ? 'ring-ink-800 dark:ring-white' : 'ring-transparent hover:ring-ink-200 dark:hover:ring-ink-700')}>
        {active && <Check size={16} className="text-white" strokeWidth={3} />}
      </span>
      <span className="text-[11px] font-medium text-ink-500 dark:text-ink-400">{accent.label}</span>
    </button>
  )
}

function PresetCard({ preset, active, onSelect }) {
  const accent = ACCENTS.find((a) => a.key === preset.accent)
  return (
    <button
      onClick={() => onSelect(preset.accent)}
      className={clsx(
        'flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors',
        active ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-ink-100 hover:border-ink-200 dark:border-ink-800 dark:hover:border-ink-700',
      )}
    >
      <span className="flex overflow-hidden rounded-lg shadow-sm">
        <span className={clsx('h-9 w-9', accent.swatch)} />
        <span className="flex h-9 w-9 items-center justify-center bg-white text-[9px] font-bold text-ink-400 dark:bg-ink-950 dark:text-ink-500">Aa</span>
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{preset.label}</p>
        <p className="text-xs text-ink-400">{accent.label} + White / {accent.label} + Black</p>
      </div>
      {active && <Check size={16} className="ml-auto shrink-0 text-brand-600 dark:text-brand-400" strokeWidth={3} />}
    </button>
  )
}

/** A miniature, non-interactive mock of the real chrome (sidebar/navbar/button/card/input/
 * active menu) — built from the exact same brand and ink Tailwind tokens (with dark: variants)
 * every real component uses, so it never needs its own update logic: it reflects mode/accent changes
 * automatically, the instant they change, because it's the same theme system, not a copy. */
function LivePreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 shadow-card dark:border-ink-700">
      <div className="flex h-56">
        <div className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-ink-100 bg-white py-3 dark:border-ink-800 dark:bg-ink-950">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><LayoutDashboard size={13} /></span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-400 dark:text-ink-500"><Users size={13} /></span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-400 dark:text-ink-500"><Handshake size={13} /></span>
        </div>
        <div className="flex flex-1 flex-col bg-ink-50 dark:bg-ink-950">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ink-100 bg-white px-3 dark:border-ink-800 dark:bg-ink-950">
            <span className="flex h-5 flex-1 max-w-[80px] items-center gap-1 rounded-md bg-ink-100 px-1.5 text-ink-400 dark:bg-ink-800">
              <Search size={9} />
            </span>
            <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-md bg-brand-600 text-white"><Plus size={10} /></span>
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-ink-400 dark:text-ink-500"><Bell size={11} /></span>
            <span className="h-5 w-5 rounded-full bg-brand-100 dark:bg-brand-900/40" />
          </div>
          <div className="flex-1 space-y-2 p-3">
            <div className="rounded-lg border border-ink-100 bg-white p-2 shadow-sm dark:border-ink-800 dark:bg-ink-900">
              <div className="h-1.5 w-10 rounded-full bg-ink-200 dark:bg-ink-700" />
              <div className="mt-1.5 h-2.5 w-16 rounded-full bg-ink-800 dark:bg-ink-100" />
            </div>
            <div className="h-6 rounded-md border border-ink-200 bg-white px-2 text-[9px] leading-6 text-ink-400 dark:border-ink-700 dark:bg-ink-900">Input field</div>
            <button className="h-6 rounded-md bg-brand-600 px-2 text-[9px] font-medium leading-6 text-white">Primary Button</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppearancePanel() {
  const { mode, setMode, accent, setAccent, accents, presets } = useTheme()
  const { toast } = useToast()

  const chooseAccent = (key) => {
    setAccent(key)
    toast(`Accent color set to ${accents.find((a) => a.key === key)?.label}.`, { type: 'success' })
  }
  const choosePreset = (accentKey) => {
    setAccent(accentKey)
    toast('Theme preset applied.', { type: 'success' })
  }
  const chooseMode = (key) => {
    setMode(key)
    toast(`Appearance mode set to ${key === 'system' ? 'System' : key === 'dark' ? 'Dark' : 'Light'}.`, { type: 'success' })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Appearance Mode</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Choose Light, Dark, or match your device automatically. Applies across the whole CRM instantly.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {MODES.map((m) => <ModeCard key={m.key} mode={m} active={mode === m.key} onSelect={chooseMode} />)}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Theme Color</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Purple is the default brand color. Pick any accent — it updates the sidebar, buttons, links, charts and every active state consistently.</p>
        <div className="mt-5 grid grid-cols-5 gap-4 sm:grid-cols-10">
          {accents.map((a) => <AccentSwatch key={a.key} accent={a} active={accent === a.key} onSelect={chooseAccent} />)}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Theme Presets</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Polished accent + neutral pairings. Default Purple is recommended.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((p) => <PresetCard key={p.key} preset={p} active={accent === p.accent} onSelect={choosePreset} />)}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Live Preview</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">Sidebar, navbar, buttons, cards and inputs — reflecting your current selection.</p>
        <div className="mt-5 max-w-xl">
          <LivePreview />
        </div>
      </div>
    </div>
  )
}
