import { useEffect, useRef, useState, cloneElement } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'

// NOTE: never set a manual CSS `transform` via style on the motion.div below —
// Framer Motion owns `style.transform` once it animates y, and will silently
// clobber it. Alignment must be done with `left-0`/`right-0` classes, not translateX.
export function Dropdown({ trigger, children, align = 'right', width = 'w-56', className }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      {cloneElement(trigger, { onClick: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15 }}
            className={clsx(
              'absolute top-full z-40 mt-2 overflow-hidden rounded-xl border border-ink-100 bg-white py-1.5 shadow-popover dark:border-ink-800 dark:bg-ink-900',
              align === 'right' ? 'right-0' : 'left-0',
              width,
              className,
            )}
            onClick={() => setOpen(false)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function DropdownItem({ icon: Icon, children, className, danger = false, ...props }) {
  return (
    <button
      className={clsx(
        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors',
        danger ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20' : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800',
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={15} className="shrink-0" />}
      <span className="flex-1">{children}</span>
    </button>
  )
}

export function DropdownLabel({ children }) {
  return <div className="px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">{children}</div>
}

export function DropdownDivider() {
  return <div className="my-1.5 border-t border-ink-100 dark:border-ink-800" />
}
