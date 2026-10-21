import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { useRefresh } from '../../context/RefreshContext'

/**
 * The one Refresh control of the app: a small square icon button that re-reads the page's data from its own source (search, filters, sort, page and branch stay as they are).
 * Pages get it from PageHeader automatically; use it directly only where a page has no PageHeader.
 */
export function RefreshButton({ className }) {
  const ctx = useRefresh()
  if (!ctx || !ctx.refreshable) return null
  const { refresh, refreshing, updatedAt } = ctx
  const label = refreshing ? 'Refreshing…' : updatedAt ? `Refresh data (updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : 'Refresh data'
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={refreshing}
      aria-label="Refresh"
      aria-busy={refreshing}
      title={label}
      data-refresh-button
      className={clsx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-ink-500 ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-50 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-wait dark:bg-ink-900 dark:text-ink-400 dark:ring-ink-700 dark:hover:bg-ink-800 dark:hover:text-ink-200',
        className,
      )}
    >
      <RefreshCw size={15} className={clsx(refreshing && 'animate-spin')} />
    </button>
  )
}
