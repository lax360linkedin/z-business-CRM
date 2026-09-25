import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { TableSkeleton } from './LoadingSkeleton'
import { EmptyState } from './EmptyState'
import { Pagination } from './Pagination'

/**
 * columns: [{ key, header, render?(row), sortable?, className?, headerClassName? }]
 */
export function DataTable({
  columns,
  data,
  loading = false,
  rowKey = 'id',
  onRowClick,
  sort,
  onSortChange,
  selectable = false,
  selected = [],
  onSelectChange,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your filters or search terms.',
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
  footer,
}) {
  const allSelected = data.length > 0 && selected.length === data.length
  const toggleAll = () => onSelectChange(allSelected ? [] : data.map((d) => d[rowKey]))
  const toggleOne = (id) => onSelectChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx('whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400', col.headerClassName)}
                >
                  {col.sortable ? (
                    <button
                      className="inline-flex items-center gap-1 hover:text-ink-700 dark:hover:text-ink-200"
                      onClick={() => onSortChange({ field: col.key, dir: sort?.field === col.key && sort.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      {col.header}
                      {sort?.field === col.key ? (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ChevronsUpDown size={13} className="opacity-40" />}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? null : data.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'border-b border-ink-50 transition-colors last:border-0 dark:border-ink-800/60',
                  onRowClick && 'cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-900/10',
                )}
              >
                {selectable && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.includes(row[rowKey])} onChange={() => toggleOne(row[rowKey])} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={clsx('px-4 py-3 align-middle text-ink-700 dark:text-ink-200', col.className)}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <TableSkeleton cols={selectable ? columns.length + 1 : columns.length} />}
      </div>
      {!loading && data.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      {!loading && data.length > 0 && onPageChange && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} total={total} pageSize={pageSize} />
      )}
      {footer}
    </div>
  )
}
