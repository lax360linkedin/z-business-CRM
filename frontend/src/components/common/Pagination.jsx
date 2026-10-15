import { ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

export function Pagination({ page, totalPages, onChange, total, pageSize }) {
  if (totalPages <= 1 && !total) return null
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const pages = []
  const windowSize = 1
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - windowSize && p <= page + windowSize)) pages.push(p)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-ink-100 px-4 py-3.5 sm:flex-row dark:border-ink-800">
      <p className="text-xs text-ink-500 dark:text-ink-400">
        Showing <span className="font-medium text-ink-700 dark:text-ink-200">{start}–{end}</span> of{' '}
        <span className="font-medium text-ink-700 dark:text-ink-200">{total}</span> results
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 disabled:opacity-30 dark:text-ink-400 dark:hover:bg-ink-800"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1.5 text-xs text-ink-400">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={clsx(
                'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors',
                p === page ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 disabled:opacity-30 dark:text-ink-400 dark:hover:bg-ink-800"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
