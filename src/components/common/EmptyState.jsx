import { Inbox } from 'lucide-react'

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here yet', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white/50 px-6 py-16 text-center dark:border-ink-800 dark:bg-ink-900/30">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
        <Icon size={26} />
      </div>
      <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
