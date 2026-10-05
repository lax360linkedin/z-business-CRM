import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UserPlus, UserCheck, Clock, ListChecks, Handshake, FileCheck2, IndianRupee,
  AlertTriangle, FolderKanban, LifeBuoy, Bell, CheckCheck,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { TableSkeleton } from '../../components/common/LoadingSkeleton'
import { useCrud } from '../../hooks/useCrud'
import { NOTIFICATION_TYPES } from '../../data/constants'
import { timeAgo } from '../../utils/format'
import { relatedHref } from '../../utils/activityRules'

const ICONS = {
  UserPlus, UserCheck, Clock, ListChecks, Handshake, FileCheck2, IndianRupee,
  AlertTriangle, FolderKanban, LifeBuoy,
}

const TONE_BY_TYPE = {
  'New Lead': 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
  'Lead Assignment': 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'Follow-up Reminder': 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  'Task Reminder': 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  'Deal Update': 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
  'Quotation Accepted': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Payment Received': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Payment Overdue': 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  'Project Update': 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'Support Ticket': 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  'New Enquiry': 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
  'Enquiry Assignment': 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'Enquiry Qualified': 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  'Enquiry Converted': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Enquiry Closed': 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400',
  'High Priority Enquiry': 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  'Task Assigned': 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'Task Overdue': 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  'Task Mention': 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  'Task Completed': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Task Comment': 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400',
}

export default function Notifications() {
  const navigate = useNavigate()
  const crud = useCrud('notifications', { searchFields: ['message', 'type'], pageSize: 15 })
  const [typeFilter, setTypeFilter] = useState('all')
  const [readFilter, setReadFilter] = useState('all')

  const filtered = useMemo(() => {
    return crud.allFiltered
      .filter((n) => typeFilter === 'all' || n.type === typeFilter)
      .filter((n) => readFilter === 'all' || (readFilter === 'unread' ? !n.read : n.read))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [crud.allFiltered, typeFilter, readFilter])

  const unreadCount = crud.allItems.filter((n) => !n.read).length

  const markAllRead = () => {
    Promise.all(crud.allItems.filter((n) => !n.read).map((n) => crud.update(n.id, { read: true })))
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''} across your workspace.`}
        actions={<Button variant="secondary" icon={CheckCheck} onClick={markAllRead} disabled={unreadCount === 0}>Mark all as read</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-ink-100 bg-white p-1 dark:border-ink-800 dark:bg-ink-900">
          {['all', 'unread', 'read'].map((f) => (
            <button
              key={f}
              onClick={() => setReadFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${readFilter === f ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="scrollbar-thin flex gap-1.5 overflow-x-auto">
          <button
            onClick={() => setTypeFilter('all')}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${typeFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700'}`}
          >
            All Types
          </button>
          {NOTIFICATION_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${typeFilter === t ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        {crud.loading ? (
          <TableSkeleton rows={6} cols={3} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up — nothing matches the current filters." />
        ) : (
          <div className="divide-y divide-ink-50 dark:divide-ink-800/60">
            {filtered.map((n) => {
              const Icon = ICONS[n.icon] || Bell
              return (
                <button
                  key={n.id}
                  onClick={() => { if (!n.read) crud.update(n.id, { read: true }); const href = n.relatedType === 'Task' ? `/tasks/${n.relatedId}` : relatedHref(n.relatedType, n.relatedId); if (n.relatedId && href) navigate(href) }}
                  className={`flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50 ${!n.read ? 'bg-brand-50/40 dark:bg-brand-900/10' : ''}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_BY_TYPE[n.type] || 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>
                    <Icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{n.type}</p>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{n.message}</p>
                    <p className="mt-1 text-xs text-ink-400">{timeAgo(n.date)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
