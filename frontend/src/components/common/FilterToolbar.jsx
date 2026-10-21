import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { SearchBar } from './SearchBar'
import { Button } from './Button'
import { FilterPanel, FilterToggleButton } from './FilterPanel'

/**
 * The filter row every list uses (Leads, Enquiries, Companies …): a search box, a "Filters" button that opens a row of dropdowns with a
 * "Clear (n)" link, and a "More Filters" button that opens the extra fields (dates, ranges). Only the pieces a page passes are shown.
 *
 *   search / onSearch / searchPlaceholder   the search box
 *   filters / values / onChange / onClear   FilterPanel: [{ key, label, options: [{ value, label }] }]; a value of '' or 'all' means "no filter"
 *   advanced                                the fields inside "More Filters" (FormField + Input / Select children, laid out in a 4-column grid)
 *   advancedCount / onClearAdvanced         how many of them are set, and how to reset them
 *   children                                extra text or buttons after the buttons (e.g. "3 selected")
 */
export function FilterToolbar({ search, onSearch, searchPlaceholder, filters = [], values = {}, onChange, onClear, advanced, advancedCount = 0, onClearAdvanced, children }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const activeCount = Object.values(values).filter((v) => v && v !== 'all').length
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {onSearch && <SearchBar value={search} onChange={onSearch} placeholder={searchPlaceholder} className="w-full max-w-sm" />}
        {filters.length > 0 && <FilterToggleButton active={filtersOpen} count={activeCount} onClick={() => setFiltersOpen((o) => !o)} />}
        {advanced && (
          <Button variant={advancedOpen ? 'subtle' : 'secondary'} size="md" icon={Search} onClick={() => setAdvancedOpen((o) => !o)}>
            More Filters {advancedCount > 0 && <span className="ml-0.5">({advancedCount})</span>}
          </Button>
        )}
        {children}
      </div>
      {filtersOpen && filters.length > 0 && (
        <div className="mb-4">
          <FilterPanel filters={filters} values={values} onChange={onChange} onClear={onClear} />
        </div>
      )}
      {advancedOpen && advanced && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 sm:grid-cols-4">
          {advanced}
          {advancedCount > 0 && onClearAdvanced && (
            <div className="col-span-2 sm:col-span-4">
              <Button variant="ghost" size="sm" icon={X} onClick={onClearAdvanced}>Clear advanced filters</Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
