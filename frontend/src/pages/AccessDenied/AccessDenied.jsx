import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { useAuth } from '../../context/AuthContext'

export default function AccessDenied({ module }) {
  const { user } = useAuth()

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
        <ShieldAlert size={30} />
      </span>
      <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">Access Denied</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500 dark:text-ink-400">
        {module
          ? <>Your role, <span className="font-medium text-ink-700 dark:text-ink-200">{user?.role}</span>, does not have permission to view <span className="font-medium text-ink-700 dark:text-ink-200">{module}</span>.</>
          : "You don't have permission to view this page."}
      </p>
      <p className="mt-1 text-xs text-ink-400">If you believe this is a mistake, contact your administrator.</p>
      <Link to="/dashboard" className="mt-6"><Button>Back to Dashboard</Button></Link>
    </div>
  )
}
