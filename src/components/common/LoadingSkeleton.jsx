import clsx from 'clsx'

export function Skeleton({ className }) {
  return <div className={clsx('relative overflow-hidden rounded-md bg-ink-100 dark:bg-ink-800', className)}>
    <div className="absolute inset-0 animate-shimmer bg-shimmer" />
  </div>
}

export function TableSkeleton({ rows = 6, cols = 6 }) {
  return (
    <div className="w-full">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-ink-100 px-4 py-3.5 last:border-0 dark:border-ink-800">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={clsx('h-4', c === 0 ? 'w-8' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ className }) {
  return (
    <div className={clsx('rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900', className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  )
}
