import { CardSkeleton, Skeleton } from './LoadingSkeleton'

/** Shown inside the page area (the menu and top bar stay put) for the instant a screen's code is still arriving - normally it has been fetched ahead of time and this never appears. */
export function PageFallback() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
      <Skeleton className="mt-5 h-72 rounded-2xl" />
    </div>
  )
}
