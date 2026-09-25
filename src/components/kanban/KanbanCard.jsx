import { motion } from 'framer-motion'
import { Calendar, IndianRupee, User, CalendarClock } from 'lucide-react'
import { Avatar } from '../common/Avatar'
import { PriorityBadge } from '../common/Badge'
import { formatCurrency, formatDate, isOverdue } from '../../utils/format'
import { getUserById } from '../../data/users'

/** Compact pipeline card — spec §2's field list, kept scannable rather than crammed: Deal ID/
 * Company/Contact/Value/Probability/Expected Close/Salesperson/Priority/Next Follow-up. "Last
 * Activity" isn't shown here (it would need an activities fetch per card across a whole board)
 * — it's on the full Deal Detail page instead. */
export function KanbanCard({ deal, onClick, dragHandlers }) {
  const owner = getUserById(deal.salesperson)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onClick}
      draggable
      {...dragHandlers}
      className="cursor-pointer rounded-xl border border-ink-100 bg-white p-3.5 shadow-card transition-shadow hover:shadow-card-hover active:cursor-grabbing dark:border-ink-800 dark:bg-ink-900"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-ink-800 dark:text-ink-100">{deal.companyName}</p>
        <PriorityBadge priority={deal.priority} className="shrink-0 !px-1.5 !py-0.5" />
      </div>
      <p className="mb-2 text-[11px] font-medium text-ink-400">{deal.id}</p>
      <p className="mb-1 line-clamp-1 flex items-center gap-1 text-xs text-ink-500 dark:text-ink-400"><User size={11} /> {deal.contactName}</p>
      <p className="mb-3 line-clamp-1 text-xs text-ink-500 dark:text-ink-400">{deal.service}</p>
      <div className="mb-3 flex items-center gap-1.5 text-sm font-bold text-ink-900 dark:text-ink-50">
        <IndianRupee size={13} className="text-emerald-600" />
        {formatCurrency(deal.value, { compact: true }).replace('₹', '')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-ink-400">
          <Calendar size={12} />
          {formatDate(deal.expectedClosingDate, { year: undefined })}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-ink-400">{deal.probability}%</span>
          {owner && <Avatar name={owner.name} size="xs" />}
        </div>
      </div>
      {deal.nextFollowUp && (
        <div className={`mt-2 flex items-center gap-1 text-[11px] ${isOverdue(deal.nextFollowUp) ? 'font-medium text-rose-500' : 'text-ink-400'}`}>
          <CalendarClock size={11} /> Follow-up {formatDate(deal.nextFollowUp, { year: undefined })}
        </div>
      )}
    </motion.div>
  )
}
