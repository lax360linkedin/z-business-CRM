import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { Button } from '../../components/common/Button'

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
        <SearchX size={30} />
      </span>
      <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500 dark:text-ink-400">The page you're looking for doesn't exist or has been moved.</p>
      <Link to="/dashboard" className="mt-6"><Button>Back to Dashboard</Button></Link>
    </div>
  )
}
