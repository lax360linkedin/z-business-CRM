import { useEffect, useId } from 'react'
import clsx from 'clsx'
import { setChartData, dropChartData, findChartData } from '../../utils/chartData'

export function ChartCard({ title, subtitle, action, children, className, bodyClassName }) {
  const id = useId()
  const data = findChartData(children)
  useEffect(() => { setChartData(id, { title, subtitle, data }); return () => dropChartData(id) })
  return (
    <div data-card data-chart-id={id} className={clsx('rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 data-card-title className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
          {subtitle && <p data-card-subtitle className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}
