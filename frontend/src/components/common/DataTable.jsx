import clsx from 'clsx'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { Skeleton } from './LoadingSkeleton'
import { EmptyState } from './EmptyState'
import { Pagination } from './Pagination'
import { useBranch } from '../../context/BranchContext'
import { BranchBadge } from '../layout/BranchSelector'

// One fixed layout for every list: the columns have set widths (table-layout: fixed), every row and the header have the same height,
// long text ends in an ellipsis (the full value shows on hover, see utils/truncationTitles.js) and a table that is wider than its card
// scrolls inside the card, so the page itself never gets wider.
export const ROW_HEIGHT = 56 // px, keep in step with the h-14 row class
const ACTIONS_WIDTH = 56
const SELECT_WIDTH = 48

/** A column's width in px: `width` when the column sets one, else a sensible default from what the column holds. */
export function columnWidth(col) {
  if (typeof col.width === 'number') return col.width
  if (col.key === 'actions' || (col.header === '' && col.render)) return ACTIONS_WIDTH
  const k = `${col.key} ${col.header}`.toLowerCase()
  if (/\bemail\b/.test(k)) return 230
  if (/phone|mobile/.test(k)) return 150
  if (/date|follow-up|created|updated|due|joined|login|time|when/.test(k)) return 140
  if (/status|priority|stage|score|type|source|role|branch|rating|qty|count/.test(k)) return 130
  if (/\bid\b|number|no\./.test(k)) return 120
  if (/name|company|title|subject|customer|product|service|description|owner|assigned|salesperson/.test(k)) return 200
  return 160
}

const alignClass = (align) => (align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left')
const justifyClass = (align) => (align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start')
const isActions = (col) => col.key === 'actions' || (col.header === '' && !!col.render)

/**
 * columns: [{ key, header, render?(row), sortable?, width?, align?, truncate?, className?, headerClassName? }]
 *   width    px the column is laid out at (extra room in a wide card is shared out in proportion); omitted = a default from the column's name
 *   align    'left' (default) | 'center' | 'right'
 *   truncate false for a cell that must not be clipped (the actions column never is)
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
  // In the Super Admin's All-branches view every record list gets a Branch column, so records of different branches are never mixed up.
  const { isGlobal, isAll } = useBranch()
  if (isGlobal && isAll && data.length > 0 && data.some((r) => r.branch !== undefined) && !columns.some((c) => c.key === 'branch')) {
    const at = columns.findIndex((c) => c.key === 'actions')
    const branchColumn = { key: 'branch', header: 'Branch', render: (row) => <BranchBadge branch={row.branch} /> }
    columns = at === -1 ? [...columns, branchColumn] : [...columns.slice(0, at), branchColumn, ...columns.slice(at)]
  }
  const allSelected = data.length > 0 && selected.length === data.length
  const toggleAll = () => onSelectChange(allSelected ? [] : data.map((d) => d[rowKey]))
  const toggleOne = (id) => onSelectChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])

  const widths = columns.map(columnWidth)
  const tableWidth = widths.reduce((a, b) => a + b, 0) + (selectable ? SELECT_WIDTH : 0)
  // On a page of a longer list, pad a short last page out to a full one, so the table (and the pager under it) does not jump when you change page.
  const paged = !!onPageChange && totalPages > 1
  const filler = !loading && paged && pageSize ? Math.max(0, pageSize - data.length) : 0
  const skeletonRows = Math.min(pageSize || 6, 10)

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="scrollbar-thin relative overflow-x-auto overscroll-x-contain">
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: tableWidth }} aria-busy={loading || undefined}>
          <colgroup>
            {selectable && <col style={{ width: SELECT_WIDTH }} />}
            {columns.map((col, i) => <col key={col.key} style={{ width: widths[i] }} />)}
          </colgroup>
          <thead>
            <tr className="h-11 border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
              {selectable && (
                <th className="px-4 py-2 text-left">
                  <input type="checkbox" aria-label="Select all rows" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable && sort?.field === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={clsx('overflow-hidden whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400', alignClass(col.align), col.headerClassName)}
                >
                  {col.sortable ? (
                    <button
                      className={clsx('flex max-w-full items-center gap-1 uppercase hover:text-ink-700 dark:hover:text-ink-200', justifyClass(col.align))}
                      title={typeof col.header === 'string' ? col.header : undefined}
                      onClick={() => onSortChange({ field: col.key, dir: sort?.field === col.key && sort.dir === 'asc' ? 'desc' : 'asc' })}
                    >
                      <span className="min-w-0 truncate">{col.header}</span>
                      {sort?.field === col.key ? (sort.dir === 'asc' ? <ChevronUp size={13} className="shrink-0" /> : <ChevronDown size={13} className="shrink-0" />) : <ChevronsUpDown size={13} className="shrink-0 opacity-40" />}
                    </button>
                  ) : (
                    <div className="crm-cell" title={typeof col.header === 'string' && col.header ? col.header : undefined}>{col.header}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, r) => (
                <tr key={r} className="h-14 border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                  {selectable && <td className="px-4 py-1.5" />}
                  {columns.map((col, c) => (
                    <td key={col.key} className="px-4 py-2">
                      {!isActions(col) && <Skeleton className={clsx('h-4', c === 0 ? 'w-16' : 'w-4/5')} />}
                    </td>
                  ))}
                </tr>
              ))
              : data.map((row) => (
                <tr
                  key={row[rowKey]}
                  onClick={() => onRowClick?.(row)}
                  className={clsx(
                    'h-14 border-b border-ink-50 transition-colors last:border-0 dark:border-ink-800/60',
                    onRowClick && 'cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-900/10',
                  )}
                >
                  {selectable && (
                    <td className="px-4 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select row" checked={selected.includes(row[rowKey])} onChange={() => toggleOne(row[rowKey])} className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
                    </td>
                  )}
                  {columns.map((col) => {
                    const content = col.render ? col.render(row) : row[col.key]
                    // the actions column holds a menu that opens over its neighbours, so it is never clipped
                    const clip = col.truncate !== false && !isActions(col)
                    return (
                      <td key={col.key} className={clsx('px-4 py-1.5 align-middle text-ink-700 dark:text-ink-200', alignClass(col.align), col.className)}>
                        {clip ? <div className="crm-cell">{content}</div> : content}
                      </td>
                    )
                  })}
                </tr>
              ))}
            {filler > 0 && (
              <tr aria-hidden="true" style={{ height: filler * ROW_HEIGHT }}>
                <td colSpan={columns.length + (selectable ? 1 : 0)} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!loading && data.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      {!loading && data.length > 0 && onPageChange && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} total={total} pageSize={pageSize} />
      )}
      {footer}
    </div>
  )
}
