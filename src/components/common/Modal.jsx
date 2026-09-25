import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import clsx from 'clsx'

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={clsx('relative flex max-h-[88vh] w-full flex-col rounded-2xl bg-white shadow-popover dark:bg-ink-900', SIZES[size])}
          >
            {(title || onClose) && (
              <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                <div>
                  {title && <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h2>}
                  {description && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
                </div>
                <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-800 dark:hover:text-ink-200">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-6 py-4 dark:border-ink-800">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
