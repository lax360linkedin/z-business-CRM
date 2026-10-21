import { Select } from './FormField'
import { SlidersHorizontal, X } from 'lucide-react'
import { Button } from './Button'

/**
 * filters: [{ key, label, options: [{ value, label }] }]
 */
export function FilterPanel({ filters, values, onChange, onClear }) {
  const activeCount = Object.values(values).filter((v) => v && v !== 'all').length
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <div key={f.key} className="w-40">
          <Select aria-label={`Filter by ${f.label}`} value={values[f.key] || 'all'} onChange={(e) => onChange(f.key, e.target.value)} className="h-9 text-xs">
            <option value="all">All {f.label}</option>
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
      ))}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" icon={X} onClick={onClear}>
          Clear ({activeCount})
        </Button>
      )}
    </div>
  )
}

export function FilterToggleButton({ active, onClick, count = 0 }) {
  return (
    <Button variant={active ? 'subtle' : 'secondary'} size="md" icon={SlidersHorizontal} onClick={onClick}>
      Filters {count > 0 && <span className="ml-0.5">({count})</span>}
    </Button>
  )
}
