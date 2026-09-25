import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, LayoutList, History } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { Badge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { DateInput } from '../../components/common/FormField'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { ACTIVITY_TYPES } from '../../data/constants'
import { getUserById } from '../../data/users'
import { formatDateTime } from '../../utils/format'
import { genId } from '../../utils/csv'

const RELATED_TYPES = ['Lead', 'Deal', 'Customer', 'Project']
const RELATED_ROUTES = { Lead: '/leads', Deal: '/deals', Customer: '/customers', Project: '/projects' }
const TYPE_TONE = {
  Call: 'info',
  Email: 'neutral',
  WhatsApp: 'success',
  Meeting: 'warning',
  Demo: 'info',
  'Follow-up': 'danger',
  Note: 'neutral',
  Task: 'success',
}

const PAGE_SIZE = 15
const TIMELINE_STEP = 50

export default function Activities() {
  const crud = useCrud('activities', { searchFields: ['subject', 'relatedName', 'notes'], pageSize: PAGE_SIZE })
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [view, setView] = useState('timeline')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [timelineLimit, setTimelineLimit] = useState(TIMELINE_STEP)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPage(1)
    setTimelineLimit(TIMELINE_STEP)
  }, [crud.search, crud.filters, dateFrom, dateTo])

  const filterDefs = [
    { key: 'type', label: 'Types', options: ACTIVITY_TYPES.map((t) => ({ value: t, label: t })) },
    { key: 'relatedType', label: 'Related To', options: RELATED_TYPES.map((t) => ({ value: t, label: t })) },
  ]

  const dateFiltered = useMemo(() => {
    return crud.allFiltered.filter((a) => {
      if (dateFrom && new Date(a.date) < new Date(dateFrom)) return false
      if (dateTo && new Date(a.date) > new Date(`${dateTo}T23:59:59`)) return false
      return true
    })
  }, [crud.allFiltered, dateFrom, dateTo])

  const timelineSorted = useMemo(
    () => [...dateFiltered].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [dateFiltered],
  )
  const timelineItems = timelineSorted.slice(0, timelineLimit)

  const totalPages = Math.max(1, Math.ceil(dateFiltered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const tableItems = useMemo(
    () => dateFiltered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [dateFiltered, currentPage],
  )

  const activeFilterCount = Object.values(crud.filters).filter((v) => v && v !== 'all').length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)

  const goToRelated = (row) => {
    const base = RELATED_ROUTES[row.relatedType]
    if (!base) return
    if (row.relatedType === 'Lead' && row.relatedId) navigate(`${base}?open=${row.relatedId}`)
    else navigate(base)
  }

  const columns = [
    { key: 'type', header: 'Type', render: (row) => <Badge tone={TYPE_TONE[row.type] || 'neutral'}>{row.type}</Badge> },
    { key: 'subject', header: 'Subject', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    {
      key: 'relatedName', header: 'Related To',
      render: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); goToRelated(row) }}
          className="inline-flex items-center gap-1.5 text-left text-xs font-medium text-ink-700 hover:text-brand-600 dark:text-ink-200 dark:hover:text-brand-400"
        >
          <Badge tone="neutral">{row.relatedType}</Badge>
          <span className="truncate">{row.relatedName}</span>
        </button>
      ),
    },
    {
      key: 'notes', header: 'Notes',
      render: (row) => <span className="line-clamp-1 max-w-xs text-ink-500 dark:text-ink-400">{row.notes || '—'}</span>,
    },
    { key: 'by', header: 'Logged By', render: (row) => getUserById(row.by)?.name || '—' },
    { key: 'date', header: 'Date', sortable: true, render: (row) => formatDateTime(row.date) },
  ]

  const createActivity = (data) => {
    setSaving(true)
    crud.create({
      id: genId('ACT'),
      type: data.type,
      relatedType: data.relatedType,
      relatedId: null,
      relatedName: data.relatedName,
      subject: `${data.type} with ${data.relatedName}`,
      notes: data.notes || '',
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      by: user?.id,
      status: 'Completed',
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Activity logged successfully.', { type: 'success' })
    })
  }

  return (
    <div>
      <PageHeader
        title="Activities"
        description="A complete log of every call, email, meeting and touchpoint across your business."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Log Activity</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by subject, related name or notes…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={activeFilterCount} onClick={() => setFiltersOpen((o) => !o)} />
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900">
          <Button variant={view === 'timeline' ? 'subtle' : 'ghost'} size="sm" icon={History} onClick={() => setView('timeline')}>Timeline</Button>
          <Button variant={view === 'table' ? 'subtle' : 'ghost'} size="sm" icon={LayoutList} onClick={() => setView('table')}>Table</Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          <FilterPanel
            filters={filterDefs}
            values={crud.filters}
            onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))}
            onClear={() => { crud.setFilters({}); setDateFrom(''); setDateTo('') }}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-500 dark:text-ink-400">From</span>
            <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-36 text-xs" />
            <span className="text-xs font-medium text-ink-500 dark:text-ink-400">To</span>
            <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-36 text-xs" />
          </div>
        </div>
      )}

      {view === 'timeline' ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
          {crud.loading ? (
            <p className="py-10 text-center text-sm text-ink-400">Loading activity feed…</p>
          ) : (
            <>
              <ActivityTimeline items={timelineItems} />
              {timelineSorted.length > timelineLimit && (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" size="sm" onClick={() => setTimelineLimit((n) => n + TIMELINE_STEP)}>
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={tableItems}
          loading={crud.loading}
          sort={crud.sort}
          onSortChange={crud.setSort}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          total={dateFiltered.length}
          pageSize={PAGE_SIZE}
          emptyTitle="No activities found"
          emptyDescription="Try adjusting your search, filters or date range."
        />
      )}

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Log Activity"
        description="Record a new activity against a lead, deal, customer or project."
        submitLabel="Log Activity"
        loading={saving}
        onSubmit={createActivity}
        defaultValues={{ type: ACTIVITY_TYPES[0], relatedType: RELATED_TYPES[0], date: new Date().toISOString().slice(0, 10) }}
        fields={[
          { name: 'type', label: 'Activity type', type: 'select', options: ACTIVITY_TYPES.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'relatedType', label: 'Related to', type: 'select', options: RELATED_TYPES.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'relatedName', label: 'Related name', placeholder: 'e.g. Rahul Sharma / Acme Corp', required: true, span: 2 },
          { name: 'date', label: 'Date', type: 'date', required: true, span: 1 },
          { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'What happened during this activity?', span: 2 },
        ]}
      />
    </div>
  )
}
