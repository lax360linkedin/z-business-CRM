import clsx from 'clsx'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { motion } from 'framer-motion'

export function StatCard({ label, value, icon: Icon, change, changeLabel = 'vs last period', tone = 'brand', onClick }) {
  const positive = change >= 0
  const toneStyles = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
    ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      data-stat
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } : undefined}
      className={clsx(
        'group rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900',
        onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
      )}
    >
      <div className="flex items-center justify-between">
        <p data-stat-label className="text-sm font-medium text-ink-500 dark:text-ink-400">{label}</p>
        {Icon && (
          <span className={clsx('flex h-9 w-9 items-center justify-center rounded-xl', toneStyles[tone])}>
            <Icon size={17} />
          </span>
        )}
      </div>
      <p data-stat-value className="mt-3 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{value}</p>
      {change !== undefined && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className={clsx('inline-flex items-center gap-0.5 font-semibold', positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
            {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(change)}%
          </span>
          <span className="text-ink-400 dark:text-ink-500">{changeLabel}</span>
        </div>
      )}
    </motion.div>
  )
}
