import { Phone, Target, Briefcase, Clock } from 'lucide-react'
import { PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { getUserById } from '../../data/users'
import { formatDate, isOverdue } from '../../utils/format'
import { LEAD_STATUSES } from '../../data/constants'

const COLUMN_ACCENTS = {
  New: 'border-t-ink-400',
  Contacted: 'border-t-amber-400',
  Qualified: 'border-t-sky-400',
  Unqualified: 'border-t-ink-300',
  Lost: 'border-t-rose-400',
  Converted: 'border-t-emerald-400',
}

function LeadCard({ lead, onClick }) {
  const owner = getUserById(lead.assignedTo)
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-ink-100 bg-white p-3.5 text-left shadow-sm transition-shadow hover:shadow-card dark:border-ink-800 dark:bg-ink-900"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{lead.company}</p>
          <p className="truncate text-xs text-ink-500 dark:text-ink-400">{lead.name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">{lead.score}</span>
      </div>

      <div className="mt-2.5 space-y-1 text-xs text-ink-500 dark:text-ink-400">
        <p className="flex items-center gap-1.5"><Phone size={11} className="shrink-0" /> {lead.phone}</p>
        <p className="flex items-center gap-1.5"><Target size={11} className="shrink-0" /> {lead.source}</p>
        <p className="flex items-center gap-1.5 truncate"><Briefcase size={11} className="shrink-0" /> <span className="truncate">{lead.service}</span></p>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <Avatar name={owner?.name || 'Unassigned'} size="xs" />
          <span className="truncate text-xs text-ink-500 dark:text-ink-400">{owner?.name?.split(' ')[0] || 'Unassigned'}</span>
        </div>
        <PriorityBadge priority={lead.priority} className="!px-1.5 !py-0.5 !text-[10px]" />
      </div>

      {lead.nextFollowUp && (
        <p className={`mt-2 flex items-center gap-1 text-[11px] ${isOverdue(lead.nextFollowUp) ? 'font-medium text-rose-500' : 'text-ink-400'}`}>
          <Clock size={11} className="shrink-0" /> {formatDate(lead.nextFollowUp)}
        </p>
      )}

      <p className="mt-1.5 text-[10px] text-ink-300 dark:text-ink-600">{lead.id}</p>
    </button>
  )
}

/** Groups the same filtered/searched lead list the table view uses into 6 status columns — both views always read from `crud.allFiltered`, so a create/edit/assign/qualify/convert/mark-lost anywhere is reflected in whichever view is showing, immediately. */
export function LeadKanbanBoard({ leads, onOpenLead }) {
  return (
    <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-2">
      {LEAD_STATUSES.map((status) => {
        const columnLeads = leads.filter((l) => l.status === status)
        return (
          <div key={status} className={`w-72 shrink-0 rounded-2xl border-t-4 ${COLUMN_ACCENTS[status]} bg-ink-50/60 p-3 dark:bg-ink-900/40`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{status}</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-500 shadow-sm dark:bg-ink-800 dark:text-ink-300">{columnLeads.length}</span>
            </div>
            <div className="max-h-[calc(100vh-22rem)] space-y-2.5 overflow-y-auto scrollbar-thin pr-0.5">
              {columnLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onClick={() => onOpenLead(lead)} />
              ))}
              {columnLeads.length === 0 && (
                <p className="rounded-xl border border-dashed border-ink-200 py-6 text-center text-xs text-ink-400 dark:border-ink-700">No leads</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
