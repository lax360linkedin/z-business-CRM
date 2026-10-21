import { useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { useHelp } from '../../help/HelpContext'

const SEEN_KEY = 'business_crm_help_seen_v1'
const OFF_KEY = 'business_crm_help_tips_off_v1'

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window: the tip simply shows again next time */ } }

/** A one-line "what is this page" note, shown the first time someone opens each kind of page. Dismiss it once and it stays away; "Turn off page tips" silences all of them. */
export function PageGuide() {
  const { help, openHelp } = useHelp()
  const [seen, setSeen] = useState(() => read(SEEN_KEY, []))
  const [off, setOff] = useState(() => read(OFF_KEY, false))
  if (!help?.key || off || seen.includes(help.key)) return null
  const dismiss = () => { const next = [...seen, help.key]; setSeen(next); write(SEEN_KEY, next) }
  return (
    <aside aria-label="About this page" className="mb-5 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 px-4 py-3 text-sm dark:border-brand-900/40 dark:bg-brand-900/15">
      <BookOpen size={17} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-ink-700 dark:text-ink-200"><span className="font-semibold text-ink-900 dark:text-ink-50">About this page: </span>{help.purpose}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button type="button" onClick={() => { dismiss(); openHelp() }} className="font-medium text-brand-700 hover:underline dark:text-brand-300">How to use it</button>
          <button type="button" onClick={() => { setOff(true); write(OFF_KEY, true) }} className="text-ink-500 hover:underline dark:text-ink-400">Turn off page tips</button>
        </div>
      </div>
      <button type="button" aria-label="Dismiss this tip" onClick={dismiss} className="shrink-0 rounded-lg p-1 text-ink-400 hover:bg-white/70 hover:text-ink-600 dark:hover:bg-ink-800"><X size={16} /></button>
    </aside>
  )
}
