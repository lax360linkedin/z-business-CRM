import { useEffect, useMemo, useState } from 'react'
import { Sun, Moon, Monitor, Check, Bell, Search, Plus, LayoutDashboard, Users, Handshake, RotateCcw, Save, Undo2, Pipette, Info, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { useTheme } from '../../context/ThemeContext'
import { useToast } from '../../context/ToastContext'
import { Button } from '../../components/common/Button'
import {
  ACCENTS, BACKGROUNDS, BLURS, BORDERS, CARDS, CONTRASTS, DEFAULT_PREFS, DENSITIES, MODES, RADII, READABILITIES, SHADOWS, SIZES, STYLES,
  buildScale, contrastRatio, hexToRgb, isHex, samePrefs, withStyle,
} from '../../theme/personalization'

// ---------------------------------------------------------------- building blocks
function Section({ title, description, children, action }) {
  return (
    <section className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** A choice shown as a card. A real (visually hidden) radio button underneath gives arrow-key navigation, focus and screen-reader support for free. */
function RadioCard({ name, value, current, onChange, disabled, children, className }) {
  const active = current === value
  return (
    <label className={clsx('relative block', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      <input type="radio" name={name} value={value} checked={active} disabled={disabled} onChange={() => onChange(value)} className="peer sr-only" />
      <div className={clsx('h-full rounded-xl border-2 p-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-ink-900',
        active ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600')}>
        {children}
      </div>
      {active && <span aria-hidden className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white"><Check size={12} strokeWidth={3} /></span>}
    </label>
  )
}

function Segmented({ name, label, options, value, onChange, disabled, hint }) {
  return (
    <fieldset disabled={disabled} className={clsx('min-w-0', disabled && 'opacity-50')}>
      <legend className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o.key} className={clsx('relative', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
            <input type="radio" name={name} value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} className="peer sr-only" />
            <span className={clsx('block rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-ink-900',
              value === o.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800')}>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
    </fieldset>
  )
}

// ---------------------------------------------------------------- previews that do not depend on the current theme (each card shows its own option)
function MiniWindow({ bg, side, sideBorder, children, style }) {
  return (
    <div className="flex h-[74px] overflow-hidden rounded-lg" style={{ background: bg, ...style }}>
      <div className="w-[18%] shrink-0" style={{ background: side, borderRight: sideBorder }} />
      <div className="flex flex-1 flex-col gap-1.5 p-2">{children}</div>
    </div>
  )
}
const Bar = ({ w, color }) => <span className="block h-1.5 rounded-full" style={{ width: w, background: color }} />

function ModeThumb({ mode }) {
  const parts = {
    light: { bg: '#f8fafc', panel: '#ffffff', line: '#cbd5e1', text: '#334155' },
    dark: { bg: '#020617', panel: '#0f172a', line: '#334155', text: '#e2e8f0' },
  }
  const half = (key) => {
    const c = parts[key]
    return (
      <div className="flex h-full w-full" style={{ background: c.bg }}>
        <div className="w-[22%]" style={{ background: c.panel, borderRight: `1px solid ${c.line}` }} />
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <div className="rounded-md p-1.5" style={{ background: c.panel, border: `1px solid ${c.line}` }}><Bar w="55%" color={c.text} /><div className="mt-1"><Bar w="35%" color={c.line} /></div></div>
          <span className="block h-3.5 w-12 rounded-md" style={{ background: 'rgb(var(--brand-600))' }} />
        </div>
      </div>
    )
  }
  return (
    <div className="relative h-[74px] overflow-hidden rounded-lg ring-1 ring-ink-200 dark:ring-ink-700">
      {mode === 'system' ? (
        <>
          <div className="absolute inset-0">{half('light')}</div>
          <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>{half('dark')}</div>
        </>
      ) : half(mode)}
    </div>
  )
}

function StyleThumb({ kind }) {
  const accent = 'rgb(var(--brand-600))'
  if (kind === 'glass') {
    const glass = { background: 'rgba(255,255,255,.55)', border: '1px solid rgba(255,255,255,.8)', borderRadius: 10, boxShadow: '0 6px 16px -8px rgba(15,23,42,.35), inset 0 1px 0 rgba(255,255,255,.7)', backdropFilter: 'blur(6px)' }
    return (
      <MiniWindow bg="radial-gradient(circle at 15% 20%, rgb(var(--brand-300)), transparent 60%), radial-gradient(circle at 90% 80%, rgb(var(--brand-200)), transparent 60%), #eef2ff" side="rgba(255,255,255,.45)" sideBorder="1px solid rgba(255,255,255,.7)">
        <div className="p-1.5" style={glass}><Bar w="60%" color="#334155" /><div className="mt-1"><Bar w="35%" color="#94a3b8" /></div></div>
        <span className="block h-3.5 w-12" style={{ background: accent, borderRadius: 8 }} />
      </MiniWindow>
    )
  }
  const look = {
    classic: { bg: '#e2e8f0', side: '#ffffff', sideBorder: '1px solid #94a3b8', card: { background: '#fff', border: '1px solid #94a3b8', borderRadius: 3 }, btn: 3 },
    modern: { bg: '#f1f5f9', side: '#ffffff', sideBorder: '1px solid #e2e8f0', card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, boxShadow: '0 2px 6px -2px rgba(15,23,42,.18)' }, btn: 7 },
    minimal: { bg: '#f5f5f5', side: '#f5f5f5', sideBorder: '1px solid #e5e5e5', card: { background: '#fff', border: '1px solid #ececec', borderRadius: 5 }, btn: 5 },
    contrast: { bg: '#ffffff', side: '#ffffff', sideBorder: '2px solid #0f172a', card: { background: '#fff', border: '2px solid #0f172a', borderRadius: 2 }, btn: 2 },
  }[kind]
  const strong = kind === 'contrast'
  return (
    <MiniWindow bg={look.bg} side={look.side} sideBorder={look.sideBorder}>
      <div className="p-1.5" style={look.card}><Bar w="60%" color={strong ? '#020617' : '#334155'} /><div className="mt-1"><Bar w="35%" color={strong ? '#334155' : '#94a3b8'} /></div></div>
      <span className="block h-3.5 w-12" style={{ background: strong ? '#1d4ed8' : accent, borderRadius: look.btn, outline: strong ? '2px solid #0f172a' : undefined }} />
    </MiniWindow>
  )
}

function BackgroundThumb({ kind }) {
  const bg = {
    solid: '#f8fafc',
    gradient: 'linear-gradient(160deg, rgb(var(--brand-200)), #f8fafc 70%)',
    neutral: '#f5f5f5',
    tinted: 'color-mix(in srgb, rgb(var(--brand-500)) 12%, #f8fafc)',
  }[kind]
  return <div className="h-9 rounded-md ring-1 ring-ink-200 dark:ring-ink-700" style={{ background: bg }} />
}

// ---------------------------------------------------------------- the live preview: real components and classes, so it shows exactly what the CRM will look like
function LivePreview() {
  return (
    <div className="app-bg overflow-hidden rounded-2xl border border-ink-200 dark:border-ink-700" style={{ backgroundAttachment: 'scroll' }} aria-label="Live preview of your Personalization">
      <div className="flex">
        <aside className="flex w-36 shrink-0 flex-col gap-1 border-r border-ink-100 bg-white p-2 dark:border-ink-800 dark:bg-ink-950 max-sm:hidden">
          <p className="px-2 pb-1 text-xs font-bold text-ink-900 dark:text-white">LAX360</p>
          <span className="flex items-center gap-2 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm"><LayoutDashboard size={13} /> Dashboard</span>
          <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 dark:text-ink-300"><Users size={13} /> Leads</span>
          <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-600 dark:text-ink-300"><Handshake size={13} /> Deals</span>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 flex h-11 items-center gap-2 border-b border-ink-100 bg-white/80 px-3 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/80">
            <span className="flex h-7 max-w-[8rem] flex-1 items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2 text-[11px] text-ink-500 dark:border-ink-800 dark:bg-ink-900"><Search size={12} /> Search…</span>
            <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><Plus size={13} /></span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-500"><Bell size={14} /></span>
          </header>
          <main className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400">Open deals</p>
                <p className="mt-1 text-xl font-bold text-ink-900 dark:text-ink-50">128</p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><TrendingUp size={12} /> 12% this month</p>
              </div>
              <div className="rounded-2xl border border-ink-100 bg-white p-3 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <p className="text-xs font-medium text-ink-500 dark:text-ink-400">Pipeline</p>
                <div className="mt-2 flex h-9 items-end gap-1" aria-hidden>
                  {[40, 65, 50, 80, 62, 95].map((h, i) => <span key={i} className="flex-1 rounded-sm bg-brand-500" style={{ height: `${h}%`, opacity: 0.45 + i * 0.1 }} />)}
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
              <table className="w-full table-fixed text-xs">
                <thead><tr className="h-9 border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
                  <th className="px-3 text-left font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Lead</th>
                  <th className="px-3 text-left font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Status</th>
                </tr></thead>
                <tbody>
                  {[['Asha Mehta', 'Won', 'success'], ['Ravi Kumar', 'Follow-up', 'warning'], ['Nila Traders', 'Lost', 'danger']].map(([n, s, t]) => (
                    <tr key={n} className="h-10 border-b border-ink-100 last:border-0 dark:border-ink-800">
                      <td className="truncate px-3 text-ink-700 dark:text-ink-200">{n}</td>
                      <td className="px-3">
                        <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                          t === 'success' && 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300',
                          t === 'warning' && 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300',
                          t === 'danger' && 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-900/30 dark:text-rose-300')}>{s}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly tabIndex={-1} aria-label="Sample input" value="Sample input" className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-xs text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100" />
              <Button size="sm" tabIndex={-1}>Primary</Button>
              <Button size="sm" variant="secondary" tabIndex={-1}>Secondary</Button>
              <Button size="sm" variant="danger" tabIndex={-1}>Delete</Button>
              <Button size="sm" disabled>Disabled</Button>
              <span className="inline-flex h-5 w-9 items-center rounded-full bg-brand-600 p-0.5" aria-hidden><span className="ml-auto h-4 w-4 rounded-full bg-white shadow" /></span>
            </div>
            <div className="w-56 rounded-xl border border-ink-100 bg-white py-1.5 text-xs shadow-popover dark:border-ink-800 dark:bg-ink-900">
              <p className="px-3 py-1 font-semibold text-ink-800 dark:text-ink-100">Popover menu</p>
              <p className="px-3 py-1 text-ink-600 dark:text-ink-300">Quick action</p>
              <p className="px-3 py-1 text-brand-700 dark:text-brand-300">Highlighted item</p>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the page
export function PersonalizationPanel() {
  const { prefs, applied, dirty, updateDraft, applyDraft, discardDraft, resetDraft, accentAdjusted, contrast, deviceWantsMore, contrastQuerySupported, theme } = useTheme()
  const { toast } = useToast()
  const [customText, setCustomText] = useState(prefs.customAccent)
  const glass = prefs.ui === 'glass'
  const atDefaults = samePrefs(prefs, DEFAULT_PREFS)

  // changes that were never applied are dropped when the person leaves the page
  useEffect(() => discardDraft, [discardDraft])
  useEffect(() => { setCustomText(prefs.customAccent) }, [prefs.customAccent])

  const set = (patch) => updateDraft(patch)
  const chooseStyle = (key) => updateDraft((cur) => withStyle(cur, key))
  const chooseCustom = (value) => {
    setCustomText(value)
    if (isHex(value)) set({ accent: 'custom', customAccent: value.toLowerCase() })
  }
  const apply = () => { applyDraft(); toast('Personalization saved. It stays active as you move around the CRM and next time you sign in.', { type: 'success' }) }
  const discard = () => { discardDraft(); toast('Unapplied changes discarded.', { type: 'info' }) }

  const accentScale = useMemo(() => {
    const hex = prefs.accent === 'custom' ? prefs.customAccent : (ACCENTS.find((a) => a.key === prefs.accent) || ACCENTS[15]).hex
    const s = buildScale(hex, theme === 'dark')
    return { ...s, ratio: contrastRatio(hexToRgb(s.hex600), [255, 255, 255]) }
  }, [prefs.accent, prefs.customAccent, theme])
  const swatchInk = (hex) => (contrastRatio(hexToRgb(hex), [255, 255, 255]) >= 2.2 ? '#fff' : '#0f172a')

  return (
    <div className="space-y-6">
      <Section title="Live preview" description="Your choices appear here and across the whole CRM straight away. They are only kept when you press Apply Changes.">
        <LivePreview />
      </Section>

      <Section title="Appearance mode" description="Light, Dark, or let the CRM follow your device. It applies to every page, table, chart, form, dialog and panel.">
        <div role="radiogroup" aria-label="Appearance mode" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MODES.map((m) => {
            const Icon = m.key === 'light' ? Sun : m.key === 'dark' ? Moon : Monitor
            return (
              <RadioCard key={m.key} name="mode" value={m.key} current={prefs.mode} onChange={(v) => set({ mode: v })}>
                <ModeThumb mode={m.key} />
                <p className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-ink-800 dark:text-ink-100"><Icon size={14} /> {m.label}</p>
                <p className="text-xs text-ink-500 dark:text-ink-400">{m.description}</p>
              </RadioCard>
            )
          })}
        </div>
      </Section>

      <Section title="Accent colour" description="Buttons, links, active menu items, focus rings, toggles, badges and charts all follow it. Each palette gets its own light and dark shades, kept readable."
        action={<Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => set({ accent: DEFAULT_PREFS.accent })} disabled={prefs.accent === DEFAULT_PREFS.accent}>Default colour</Button>}>
        <div role="radiogroup" aria-label="Accent colour" className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-7">
          {ACCENTS.map((a) => {
            const active = prefs.accent === a.key
            return (
              <label key={a.key} className="relative flex cursor-pointer flex-col items-center gap-1.5">
                <input type="radio" name="accent" value={a.key} checked={active} onChange={() => set({ accent: a.key })} className="peer sr-only" />
                <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white transition-all peer-focus-visible:ring-brand-500 dark:ring-offset-ink-900', active ? 'ring-ink-800 dark:ring-white' : 'ring-transparent hover:ring-ink-300 dark:hover:ring-ink-600')} style={{ background: a.hex }}>
                  {active && <Check size={16} strokeWidth={3} style={{ color: swatchInk(a.hex) }} />}
                </span>
                <span className="text-center text-[11px] font-medium leading-tight text-ink-600 dark:text-ink-300">{a.label}</span>
              </label>
            )
          })}
          <label className="relative flex cursor-pointer flex-col items-center gap-1.5">
            <input type="radio" name="accent" value="custom" checked={prefs.accent === 'custom'} onChange={() => chooseCustom(customText)} className="peer sr-only" />
            <span className={clsx('flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-white transition-all peer-focus-visible:ring-brand-500 dark:ring-offset-ink-900', prefs.accent === 'custom' ? 'ring-ink-800 dark:ring-white' : 'ring-transparent hover:ring-ink-300 dark:hover:ring-ink-600')}
              style={{ background: prefs.accent === 'custom' ? prefs.customAccent : 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #ef4444)' }}>
              {prefs.accent === 'custom' ? <Check size={16} strokeWidth={3} style={{ color: swatchInk(prefs.customAccent) }} /> : <Pipette size={15} className="text-white drop-shadow" />}
            </span>
            <span className="text-center text-[11px] font-medium leading-tight text-ink-600 dark:text-ink-300">Custom</span>
          </label>
        </div>

        <div className="mt-6 grid gap-4 rounded-xl border border-ink-100 p-4 dark:border-ink-800 sm:grid-cols-[auto_1fr] sm:items-end">
          <div>
            <label htmlFor="custom-accent" className="text-sm font-medium text-ink-700 dark:text-ink-200">Custom accent (HEX)</label>
            <div className="mt-1.5 flex items-center gap-2">
              <input type="color" aria-label="Pick a custom accent colour" value={isHex(customText) ? customText : prefs.customAccent} onChange={(e) => chooseCustom(e.target.value)} className="h-9.5 h-9 w-11 cursor-pointer rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900" />
              <input id="custom-accent" value={customText} onChange={(e) => chooseCustom(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} maxLength={7} spellCheck={false} aria-invalid={!isHex(customText)} placeholder="#2563eb"
                className={clsx('h-9 w-32 rounded-lg border bg-white px-3 font-mono text-sm uppercase text-ink-800 focus:outline-none focus:ring-2 dark:bg-ink-900 dark:text-ink-100', isHex(customText) ? 'border-ink-200 focus:border-brand-500 focus:ring-brand-500/20 dark:border-ink-700' : 'border-rose-400 focus:ring-rose-500/20')} />
            </div>
            {!isHex(customText) && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">Enter a 6-digit HEX colour, for example #0f766e.</p>}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-500 dark:text-ink-400">Palette in {theme === 'dark' ? 'dark' : 'light'} mode (50 → 950)</p>
            <div className="mt-1.5 flex h-8 overflow-hidden rounded-lg ring-1 ring-ink-200 dark:ring-ink-700" aria-hidden>
              {Object.entries(accentScale.vars).map(([shade, rgb]) => <span key={shade} className="flex-1" style={{ background: `rgb(${rgb})` }} />)}
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-500 dark:text-ink-400">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>White text on buttons: {accentScale.ratio.toFixed(1)}:1 contrast ({accentScale.ratio >= 4.5 ? 'meets WCAG AA' : 'below AA'}).{accentAdjusted && ' The colour was darkened slightly so text on it stays readable.'}</span>
            </p>
          </div>
        </div>
      </Section>

      <Section title="Interface style" description="Changes the character of the surfaces, not the page layout, menus, permissions or what the CRM does. Choosing a style also sets the surface options below, which you can still fine-tune.">
        <div role="radiogroup" aria-label="Interface style" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STYLES.map((s) => (
            <RadioCard key={s.key} name="ui" value={s.key} current={prefs.ui} onChange={chooseStyle}>
              <StyleThumb kind={s.key} />
              <p className="mt-2.5 text-sm font-semibold text-ink-800 dark:text-ink-100">{s.label}{s.key === 'modern' && <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">Standard</span>}</p>
              <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{s.description}</p>
            </RadioCard>
          ))}
        </div>
      </Section>

      <Section title="Contrast & accessibility" description="Application-level themes, so they work on any screen. Text targets WCAG AA; borders, focus rings and disabled controls get clearer as contrast increases.">
        <div role="radiogroup" aria-label="Contrast" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONTRASTS.map((c) => (
            <RadioCard key={c.key} name="contrast" value={c.key} current={prefs.ui === 'contrast' ? 'high' : prefs.contrast} onChange={(v) => set({ contrast: v })} disabled={prefs.ui === 'contrast'}>
              <p className="pr-6 text-sm font-semibold text-ink-800 dark:text-ink-100">{c.label}</p>
              <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{c.description}</p>
            </RadioCard>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500 dark:text-ink-400">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            {prefs.ui === 'contrast' ? 'The High Contrast interface style always uses the High contrast level. Choose another style to pick a level yourself. '
              : prefs.contrast === 'auto' ? (contrastQuerySupported ? `Your device currently ${deviceWantsMore ? 'asks for more contrast, so Increased contrast is in use.' : 'does not ask for more contrast, so Standard contrast is in use.'} ` : 'Your browser does not report a contrast preference, so Standard contrast is used. ') : ''}
            Now showing: {contrast === 'high' ? 'High' : contrast === 'increased' ? 'Increased' : 'Standard'} contrast.
          </span>
        </p>
      </Section>

      <Section title="Background & surfaces" description="Safe, predefined ranges only. The default is the professional standard look.">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">Page background</legend>
          <div role="radiogroup" aria-label="Page background" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BACKGROUNDS.map((b) => (
              <RadioCard key={b.key} name="bg" value={b.key} current={prefs.bg} onChange={(v) => set({ bg: v })}>
                <BackgroundThumb kind={b.key} />
                <p className="mt-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{b.label}</p>
                <p className="text-xs text-ink-500 dark:text-ink-400">{b.description}</p>
              </RadioCard>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Segmented name="card" label="Card surface" options={CARDS} value={prefs.card} onChange={(v) => set({ card: v })} disabled={glass} hint={glass ? 'Glass uses its own translucent surfaces.' : CARDS.find((c) => c.key === prefs.card)?.description} />
          <Segmented name="border" label="Border strength" options={BORDERS} value={prefs.border} onChange={(v) => set({ border: v })} />
          <Segmented name="shadow" label="Shadow strength" options={SHADOWS} value={prefs.shadow} onChange={(v) => set({ shadow: v })} />
          <Segmented name="radius" label="Corner radius" options={RADII} value={prefs.radius} onChange={(v) => set({ radius: v })} />
          <Segmented name="blur" label="Glass background blur" options={BLURS} value={prefs.blur} onChange={(v) => set({ blur: v })} disabled={!glass} hint={glass ? 'How strongly panels blur what is behind them.' : 'Only used by the Glass interface style.'} />
        </div>
      </Section>

      <Section title="Typography & density" description="Applied to the menu, tables, forms, cards and dialogs. Tables keep their fixed layout and actions stay visible.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Segmented name="size" label="Text size" options={SIZES} value={prefs.size} onChange={(v) => set({ size: v })} />
          <Segmented name="density" label="Density" options={DENSITIES} value={prefs.density} onChange={(v) => set({ density: v })} hint={DENSITIES.find((d) => d.key === prefs.density)?.description} />
          <Segmented name="read" label="Text readability" options={READABILITIES} value={prefs.read} onChange={(v) => set({ read: v })} hint={READABILITIES.find((d) => d.key === prefs.read)?.description} />
        </div>
      </Section>

      <p className="px-1 text-xs text-ink-500 dark:text-ink-400">Your choices are saved for your account on this device. They only change how the CRM looks to you; they never change what you can see or do.</p>

      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-2xl border border-ink-100 bg-white p-3 shadow-popover dark:border-ink-800 dark:bg-ink-900 sm:flex-row sm:items-center sm:gap-3" role="region" aria-label="Apply personalization">
        <p role="status" className="flex-1 text-xs text-ink-600 dark:text-ink-300 sm:text-sm">
          {dirty ? <><span className="font-semibold text-ink-900 dark:text-ink-50">You have unapplied changes.</span> <span className="max-sm:hidden">They are shown across the CRM until you apply or discard them.</span></> : atDefaults && samePrefs(applied, DEFAULT_PREFS) ? 'You are using the standard look.' : 'Your saved look is showing.'}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RotateCcw} onClick={resetDraft} disabled={atDefaults} className="max-sm:flex-1 max-sm:px-2 max-sm:text-xs">Reset to Default</Button>
          <Button variant="secondary" icon={Undo2} onClick={discard} disabled={!dirty} className="max-sm:flex-1 max-sm:px-2 max-sm:text-xs">Discard</Button>
          <Button icon={Save} onClick={apply} disabled={!dirty} className="max-sm:flex-1 max-sm:px-2 max-sm:text-xs">Apply Changes</Button>
        </div>
      </div>
    </div>
  )
}
