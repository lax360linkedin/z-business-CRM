import { createContext, useCallback, useContext, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
const STYLES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-300',
  error: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-900/30 dark:text-rose-300',
  info: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800/50 dark:bg-brand-900/30 dark:text-brand-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-300',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2)
    const type = opts.type || 'success'
    setToasts((t) => [...t, { id, message, type, title: opts.title }])
    setTimeout(() => dismiss(id), opts.duration || 3500)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.type]
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
                className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-popover backdrop-blur-sm ${STYLES[t.type]}`}
              >
                <Icon size={18} className="mt-0.5 shrink-0" />
                <div className="flex-1 text-sm">
                  {t.title && <p className="font-semibold">{t.title}</p>}
                  <p>{t.message}</p>
                </div>
                <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100">
                  <X size={14} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
