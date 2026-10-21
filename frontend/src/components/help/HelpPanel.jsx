import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Compass, HelpCircle, Lightbulb, ListChecks, MousePointerClick, X } from 'lucide-react'

const heading = 'mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500'

function Section({ icon: Icon, title, children }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className={heading}><Icon size={13} aria-hidden="true" />{title}</h3>
      {children}
    </section>
  )
}

/** The page's help, as a side panel (full width on a phone). Rendered into <body> so the blurred top bar can never clip it; Escape, the close button and a click outside all close it. */
export function HelpPanel({ open, onClose, help }) {
  const panel = useRef(null)
  const closeBtn = useRef(null)
  const opener = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    opener.current = document.activeElement
    const saved = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => closeBtn.current?.focus(), 30)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && panel.current) { // keep keyboard focus inside the panel while it is open
        const items = [...panel.current.querySelectorAll('a[href], button:not([disabled])')]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = saved
      if (opener.current && document.contains(opener.current)) opener.current.focus?.()
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose} data-testid="help-backdrop" />
          <motion.aside
            ref={panel}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%', transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            role="dialog" aria-modal="true" aria-labelledby="help-title"
            className="relative flex h-full w-full flex-col bg-white shadow-popover sm:max-w-md dark:bg-ink-900"
          >
            <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"><HelpCircle size={18} /></span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Help for this page</p>
                  <h2 id="help-title" className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{help.title}</h2>
                </div>
              </div>
              <button ref={closeBtn} type="button" aria-label="Close help" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-ink-800 dark:hover:text-ink-200"><X size={18} /></button>
            </header>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5 pb-8">
              <Section icon={Compass} title="What this page is for">
                <p className="text-sm leading-relaxed text-ink-700 dark:text-ink-200">{help.purpose}</p>
              </Section>

              {help.features?.length > 0 && (
                <Section icon={ListChecks} title="What you can do here">
                  <ul className="space-y-1.5 text-sm text-ink-600 dark:text-ink-300">
                    {help.features.map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" /><span>{f}</span></li>)}
                  </ul>
                </Section>
              )}

              {help.actions?.length > 0 && (
                <Section icon={MousePointerClick} title="Buttons, filters and forms">
                  <dl className="divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
                    {help.actions.map(([label, how]) => (
                      <div key={label} className="px-3.5 py-2.5">
                        <dt className="font-medium text-ink-900 dark:text-ink-50">{label}</dt>
                        <dd className="mt-0.5 text-ink-600 dark:text-ink-300">{how}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}

              {help.workflows?.map((w) => (
                <Section key={w.title} icon={ListChecks} title={w.title}>
                  <ol className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
                    {w.steps.map((s, i) => (
                      <li key={s} className="flex gap-3"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{i + 1}</span><span>{s}</span></li>
                    ))}
                  </ol>
                </Section>
              ))}

              {help.tips?.length > 0 && (
                <Section icon={Lightbulb} title="Good to know">
                  <ul className="space-y-1.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/15 dark:text-amber-100">
                    {help.tips.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </Section>
              )}

              {help.related?.length > 0 && (
                <Section icon={ArrowRight} title="Related pages">
                  <div className="flex flex-wrap gap-2">
                    {help.related.map(([label, to]) => (
                      <Link key={to} to={to} onClick={onClose} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50">{label}<ArrowRight size={12} /></Link>
                    ))}
                  </div>
                </Section>
              )}

              <p className="mt-8 border-t border-ink-100 pt-4 text-xs text-ink-400 dark:border-ink-800">Some buttons appear only if your role allows the action. Press <kbd className="rounded border border-ink-200 px-1 dark:border-ink-700">?</kbd> on any page to open or close this help.</p>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
