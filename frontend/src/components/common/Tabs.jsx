import clsx from 'clsx'

export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={clsx('scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-ink-100 dark:border-ink-800', className)}>
      {tabs.map((tab) => {
        const value = typeof tab === 'string' ? tab : tab.value
        const label = typeof tab === 'string' ? tab : tab.label
        const count = typeof tab === 'object' ? tab.count : undefined
        const isActive = active === value
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={clsx(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200',
            )}
          >
            {label}
            {count !== undefined && (
              <span className={clsx('rounded-full px-1.5 py-0.5 text-[11px]', isActive ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400')}>
                {count}
              </span>
            )}
            {isActive && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
          </button>
        )
      })}
    </div>
  )
}
