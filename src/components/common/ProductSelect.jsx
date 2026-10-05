import { useMemo } from 'react'
import { Select } from './FormField'
import { formatCurrency } from '../../utils/format'
import { pickableProducts } from '../../utils/productRules'

/**
 * Catalog picker grouped by category. Only Active items are offered — except the one already on the line, which stays
 * selectable (marked inactive) so opening an old document never blanks its product.
 * `onSelect(product | null)`; null means "custom item".
 */
export function ProductSelect({ products, value, onSelect, allowCustom = true, customLabel = 'Custom item…', disabled, className, 'aria-label': ariaLabel = 'Product or service' }) {
  const groups = useMemo(() => {
    const m = new Map()
    pickableProducts(products, value).sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => { m.set(p.category || 'Other', [...(m.get(p.category || 'Other') || []), p]) })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [products, value])
  return (
    <Select aria-label={ariaLabel} disabled={disabled} value={value || ''} className={className} onChange={(e) => onSelect(products.find((p) => p.id === e.target.value) || null)}>
      {allowCustom ? <option value="">{customLabel}</option> : <option value="">Select a product / service…</option>}
      {groups.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name} — {formatCurrency(p.price)}{p.unit ? ` / ${p.unit}` : ''}{p.status === 'Inactive' ? ' (inactive)' : ''}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}
