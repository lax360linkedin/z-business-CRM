import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Check, UserCog2 } from 'lucide-react'
import clsx from 'clsx'

/**
 * Polished custom single-select dropdown for choosing a login role.
 * Controlled component: { value, onChange, options, error, placeholder }.
 * NOTE: never set a manual CSS `transform` via style on the animated panel below —
 * Framer Motion owns `style.transform` once it animates y, so alignment must come
 * from layout classes (`left-0 right-0`), not translateX.
 */
export function RoleSelect({ value, onChange, options, placeholder = 'Select your role', error, onBlur }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        onBlur?.()
      }
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onBlur])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex h-11 w-full items-center gap-2.5 rounded-xl border bg-white/[0.04] px-3.5 text-left text-sm text-white transition-all focus:outline-none',
          error ? 'border-rose-500/60' : 'border-white/10 hover:border-white/20',
          open && 'border-brand-400/70 ring-2 ring-brand-500/25',
        )}
      >
        <UserCog2 size={16} className="shrink-0 text-brand-300" />
        <span className={clsx('flex-1 truncate', value ? 'text-white' : 'text-white/40')}>{value || placeholder}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }} className="shrink-0 text-white/50">
          <ChevronDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16 }}
            className="scrollbar-thin absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1330] py-1.5 shadow-2xl shadow-black/40"
          >
            {options.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => { onChange(role); setOpen(false); onBlur?.() }}
                className={clsx(
                  'flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors',
                  value === role ? 'bg-brand-500/15 text-brand-200' : 'text-white/70 hover:bg-white/5 hover:text-white',
                )}
              >
                {role}
                {value === role && <Check size={14} className="text-brand-300" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
    </div>
  )
}
