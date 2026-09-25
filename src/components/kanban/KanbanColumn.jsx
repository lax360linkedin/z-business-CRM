import clsx from 'clsx'
import { formatCurrency } from '../../utils/format'
import { DEAL_STAGE_PROBABILITY } from '../../data/constants'
import { KanbanCard } from './KanbanCard'

const STAGE_DOT = {
  'Deal Created': 'bg-ink-400', 'Requirement Analysis': 'bg-sky-400', 'Solution Discussion': 'bg-sky-500',
  'Decision Maker Review': 'bg-indigo-500', 'Proposal / Quotation': 'bg-amber-500', Negotiation: 'bg-violet-500',
  'Final Decision': 'bg-fuchsia-500', 'Closed Won': 'bg-emerald-500', 'Closed Lost': 'bg-rose-500', 'Closed Lost – Competition': 'bg-rose-600',
}

/**
 * Each column shows the spec §2 stage-level summary — Number of Deals, Total Deal Value,
 * Probability (fixed per stage now that it's stage-derived, not per-deal) and Weighted Pipeline
 * Value (Deal Value × Probability, summed across the column).
 */
export function KanbanColumn({ stage, deals, onCardClick, onDrop, isDragOver, onDragOver, onDragLeave }) {
  const value = deals.reduce((s, d) => s + d.value, 0)
  const probability = DEAL_STAGE_PROBABILITY[stage] ?? 0
  const weightedValue = deals.reduce((s, d) => s + (d.value * d.probability) / 100, 0)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver?.() }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={clsx(
        'flex w-72 shrink-0 flex-col rounded-2xl border bg-ink-50/60 transition-colors dark:bg-ink-900/40',
        isDragOver ? 'border-brand-400 bg-brand-50/60 dark:border-brand-600 dark:bg-brand-900/20' : 'border-ink-100 dark:border-ink-800',
      )}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className={clsx('h-2 w-2 shrink-0 rounded-full', STAGE_DOT[stage])} />
          <h3 className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{stage}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-ink-200/70 px-1.5 py-0.5 text-[11px] font-medium text-ink-600 dark:bg-ink-700 dark:text-ink-300">{deals.length}</span>
      </div>
      <div className="space-y-0.5 px-4 pt-2.5 text-xs text-ink-500 dark:text-ink-400">
        <p className="font-medium">{formatCurrency(value, { compact: true })} · {probability}%</p>
        <p className="text-[11px] text-ink-400">Weighted {formatCurrency(weightedValue, { compact: true })}</p>
      </div>
      <div className="scrollbar-thin flex-1 space-y-2.5 overflow-y-auto px-3 py-3" style={{ maxHeight: 560 }}>
        {deals.map((deal) => (
          <KanbanCard key={deal.id} deal={deal} onClick={() => onCardClick(deal)} dragHandlers={{ onDragStart: (e) => e.dataTransfer.setData('text/plain', deal.id) }} />
        ))}
        {deals.length === 0 && <p className="py-6 text-center text-xs text-ink-400">No deals</p>}
      </div>
    </div>
  )
}
