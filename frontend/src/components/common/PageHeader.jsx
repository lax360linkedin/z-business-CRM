import { RefreshButton } from './RefreshButton'
import { useHeaderPresence } from '../../context/RefreshContext'

/** Every page's title row. The Refresh button sits at the end of the actions, at the same place on every page. */
export function PageHeader({ title, description, actions, breadcrumb }) {
  useHeaderPresence()
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div>
        {breadcrumb}
        <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">{actions}<RefreshButton /></div>
    </div>
  )
}
