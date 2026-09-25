import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export function Breadcrumbs({ items }) {
  return (
    <nav className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-400">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} />}
          {item.href ? (
            <Link to={item.href} className="hover:text-brand-600 dark:hover:text-brand-400">{item.label}</Link>
          ) : (
            <span className="text-ink-500 dark:text-ink-400">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
