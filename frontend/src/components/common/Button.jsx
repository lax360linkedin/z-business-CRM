import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 focus-visible:ring-brand-500',
  secondary: 'bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 dark:bg-ink-900 dark:text-ink-200 dark:ring-ink-700 dark:hover:bg-ink-800',
  ghost: 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20 focus-visible:ring-rose-500',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50',
}
const SIZES = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-9.5 h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-sm gap-2' }

export function Button({ children, variant = 'primary', size = 'md', className, icon: Icon, loading = false, disabled, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-ink-900 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon && <Icon size={15} />}
      {children}
    </button>
  )
}

export function IconButton({ icon: Icon, className, size = 'md', ...props }) {
  const dims = { sm: 'h-8 w-8', md: 'h-9 w-9', lg: 'h-10 w-10' }
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100',
        dims[size],
        className,
      )}
      {...props}
    >
      <Icon size={18} />
    </button>
  )
}
