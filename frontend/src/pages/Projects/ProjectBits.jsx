import clsx from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { formatDate } from '../../utils/format'
import { daysUntil, isOpenProject } from '../../utils/projectRules'

export function ProgressBar({ value, className, label = true }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)))
  return (
    <div className={clsx('flex items-center gap-2', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className={clsx('h-full rounded-full transition-all', v >= 100 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${v}%` }} /></div>
      {label && <span className="w-9 text-right text-[11px] font-semibold text-ink-600 dark:text-ink-300">{v}%</span>}
    </div>
  )
}

/** End date with an overdue / due-soon cue for open projects. */
export function EndDate({ project, className }) {
  if (!project.deadline) return <span className="text-ink-400">—</span>
  const left = daysUntil(project.deadline)
  const open = isOpenProject(project)
  const over = open && left < 0
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap text-xs', over ? 'font-semibold text-rose-600 dark:text-rose-400' : open && left <= 7 ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-ink-600 dark:text-ink-300', className)} title={over ? `${-left} day${-left === 1 ? '' : 's'} overdue` : open ? `${left} day${left === 1 ? '' : 's'} left` : undefined}>
      {over && <AlertTriangle size={12} />}{formatDate(project.deadline)}
    </span>
  )
}
