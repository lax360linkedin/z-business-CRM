import { useEffect, useMemo, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { Avatar } from '../../components/common/Avatar'
import { Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'

const COMM_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting']

export default function CommunicationHistory() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/activities', { params: { all: true } })
      .then((res) => setActivities(res.data.filter((a) => COMM_TYPES.includes(a.type))))
      .finally(() => setLoading(false))
  }, [])

  const entityOptions = useMemo(() => {
    const seen = new Map()
    activities.forEach((a) => { if (!seen.has(a.relatedId)) seen.set(a.relatedId, a.relatedName) })
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [activities])

  const filterDefs = [
    { key: 'type', label: 'Channels', options: COMM_TYPES.map((t) => ({ value: t, label: t })) },
    { key: 'relatedId', label: 'Entities', options: entityOptions },
  ]

  const filtered = useMemo(() => {
    let list = [...activities]
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter((a) => [a.relatedName, a.subject, a.notes].some((f) => String(f ?? '').toLowerCase().includes(q)))
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (!value || value === 'all') return
      list = list.filter((a) => a[key] === value)
    })
    return list
  }, [activities, search, filters])

  const groups = useMemo(() => {
    const map = new Map()
    filtered.forEach((a) => {
      if (!map.has(a.relatedId)) map.set(a.relatedId, { relatedId: a.relatedId, relatedName: a.relatedName, relatedType: a.relatedType, items: [] })
      map.get(a.relatedId).items.push(a)
    })
    const result = [...map.values()].map((g) => ({
      ...g,
      items: g.items.sort((a, b) => new Date(b.date) - new Date(a.date)),
    }))
    result.sort((a, b) => new Date(b.items[0].date) - new Date(a.items[0].date))
    return result
  }, [filtered])

  return (
    <div>
      <PageHeader
        title="Communication History"
        description="A unified, chronological view of every call, email, WhatsApp message, and meeting across your customers and leads."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by entity, subject, or notes…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={filters} onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))} onClear={() => setFilters({})} />
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} className="h-56" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No communication found" description="Try adjusting your search or filters." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {groups.map((g) => (
            <div key={g.relatedId} className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={g.relatedName} size="sm" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{g.relatedName}</p>
                    <p className="text-xs text-ink-400">{g.relatedType}</p>
                  </div>
                </div>
                <Badge tone="neutral">{g.items.length} {g.items.length === 1 ? 'activity' : 'activities'}</Badge>
              </div>
              <ActivityTimeline items={g.items} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
