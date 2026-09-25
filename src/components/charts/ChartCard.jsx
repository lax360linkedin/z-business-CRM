import clsx from 'clsx'

export function ChartCard({ title, subtitle, action, children, className, bodyClassName }) {
  return (
    <div className={clsx('rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}
