import clsx from 'clsx'
import { STATUS_TONES, PRIORITY_TONES } from '../../data/constants'

const TONE_STYLES = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20',
  info: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-400/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-400/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-400/20',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-500/20 dark:bg-ink-800 dark:text-ink-300 dark:ring-ink-500/20',
}

export function StatusBadge({ status, className }) {
  const tone = STATUS_TONES[status] || 'neutral'
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONE_STYLES[tone], className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', {
        'bg-emerald-500': tone === 'success',
        'bg-brand-500': tone === 'info',
        'bg-amber-500': tone === 'warning',
        'bg-rose-500': tone === 'danger',
        'bg-ink-400': tone === 'neutral',
      })} />
      {status}
    </span>
  )
}

export function PriorityBadge({ priority, className }) {
  const tone = PRIORITY_TONES[priority] || 'neutral'
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONE_STYLES[tone], className)}>{priority}</span>
}

export function Badge({ children, tone = 'neutral', className }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONE_STYLES[tone], className)}>{children}</span>
}
