import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus, Briefcase, Phone, CalendarClock } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Tabs } from '../../components/common/Tabs'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { FormModal } from '../../components/common/FormModal'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getUserById } from '../../data/users'
import { formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

const RESOURCES = ['tasks', 'activities', 'leads']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const NEW_EVENT_TYPES = ['Meeting', 'Follow-up', 'Demo', 'Task']

const TYPE_DOT = { task: 'bg-brand-500', followup: 'bg-rose-500', meeting: 'bg-emerald-500' }
const TYPE_CHIP = {
  task: 'bg-brand-500 text-white',
  followup: 'bg-rose-500 text-white',
  meeting: 'bg-emerald-500 text-white',
}
const TYPE_ICON = { task: CalendarClock, followup: Phone, meeting: Briefcase }
const TYPE_LABEL = { task: 'Task', followup: 'Follow-up', meeting: 'Activity' }

function useCalendarData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(() => {
    setLoading(true)
    return Promise.all(RESOURCES.map((r) => api.get(`/${r}`, { params: { all: true } })))
      .then((results) => {
        const merged = {}
        RESOURCES.forEach((r, i) => { merged[r] = results[i].data })
        setData(merged)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  return { data, loading, refresh: fetchAll }
}

function dateKey(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function isSameDay(a, b) {
  return dateKey(a) === dateKey(b)
}

function startOfWeek(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function buildEvents(data) {
  if (!data) return []
  const events = []
  data.tasks.forEach((t) => {
    if (!t.dueDate) return
    events.push({ id: `task-${t.id}`, kind: 'task', title: t.title, date: t.dueDate, sub: `${t.relatedType}: ${t.relatedName}`, meta: t.priority })
  })
  data.activities.forEach((a) => {
    if (!a.date) return
    const kind = a.type === 'Follow-up' ? 'followup' : 'meeting'
    events.push({ id: `act-${a.id}`, kind, title: a.subject, date: a.date, sub: getUserById(a.by)?.name || a.relatedName, meta: a.type })
  })
  data.leads.forEach((l) => {
    if (!l.nextFollowUp || ['Converted', 'Lost'].includes(l.status)) return
    events.push({ id: `lead-${l.id}`, kind: 'followup', title: `Follow up with ${l.name}`, date: l.nextFollowUp, sub: l.company, meta: l.priority })
  })
  return events
}

function EventChip({ event }) {
  return (
    <span className={clsx('block truncate rounded px-1.5 py-0.5 text-[10px] font-medium', TYPE_CHIP[event.kind])}>
      {event.title}
    </span>
  )
}

function EventRow({ event }) {
  const Icon = TYPE_ICON[event.kind] || CalendarClock
  return (
    <div className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800">
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white', TYPE_DOT[event.kind])}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{event.title}</p>
        <p className="truncate text-xs text-ink-400">{event.sub}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-ink-400">{TYPE_LABEL[event.kind]}</p>
        <p className="text-xs text-ink-400">{formatDate(event.date, { year: undefined })}</p>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  const { data, loading, refresh } = useCalendarData()
  const { user } = useAuth()
  const { toast } = useToast()

  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(new Date())
  const [dayModal, setDayModal] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const events = useMemo(() => buildEvents(data), [data])

  const eventsByDay = useMemo(() => {
    const map = {}
    events.forEach((ev) => {
      const key = dateKey(ev.date)
      if (!map[key]) map[key] = []
      map[key].push(ev)
    })
    Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.date) - new Date(b.date)))
    return map
  }, [events])

  const goPrev = () => setCursor((c) => {
    const d = new Date(c)
    if (view === 'month') d.setMonth(d.getMonth() - 1)
    else if (view === 'week') d.setDate(d.getDate() - 7)
    else d.setDate(d.getDate() - 1)
    return d
  })
  const goNext = () => setCursor((c) => {
    const d = new Date(c)
    if (view === 'month') d.setMonth(d.getMonth() + 1)
    else if (view === 'week') d.setDate(d.getDate() + 7)
    else d.setDate(d.getDate() + 1)
    return d
  })
  const goToday = () => setCursor(new Date())

  const monthCells = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay())
    return Array.from({ length: 42 }).map((_, i) => addDays(gridStart, i))
  }, [cursor])

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor)
    return Array.from({ length: 7 }).map((_, i) => addDays(start, i))
  }, [cursor])

  const agendaGroups = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = addDays(today, 30)
    const upcoming = events.filter((ev) => {
      const d = new Date(ev.date)
      return d >= today && d <= end
    }).sort((a, b) => new Date(a.date) - new Date(b.date))
    const groups = []
    upcoming.forEach((ev) => {
      const key = dateKey(ev.date)
      let group = groups.find((g) => g.key === key)
      if (!group) { group = { key, date: ev.date, items: [] }; groups.push(group) }
      group.items.push(ev)
    })
    return groups
  }, [events])

  const headerLabel = useMemo(() => {
    if (view === 'month') return cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    if (view === 'week') {
      const start = startOfWeek(cursor)
      const end = addDays(start, 6)
      return `${formatDate(start)} – ${formatDate(end)}`
    }
    if (view === 'day') return cursor.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    return 'Next 30 days'
  }, [view, cursor])

  const createEvent = (formData) => {
    setSaving(true)
    const payload = {
      id: genId('ACT'),
      type: formData.type,
      relatedType: 'Event',
      relatedId: null,
      relatedName: formData.title,
      subject: formData.title,
      notes: formData.notes || '',
      date: formData.date ? new Date(formData.date).toISOString() : new Date().toISOString(),
      by: user?.id,
      status: 'Scheduled',
    }
    api.post('/activities', payload).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Event added to the calendar.', { type: 'success' })
      refresh()
    })
  }

  const today = new Date()

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Meetings, follow-ups, demos and task deadlines across your business, in one place."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>New Event</Button>}
      />

      <Tabs
        tabs={[
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'Week' },
          { value: 'day', label: 'Day' },
          { value: 'agenda', label: 'Agenda' },
        ]}
        active={view}
        onChange={setView}
        className="mb-4"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{headerLabel}</h2>
        {view !== 'agenda' && (
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
            <IconNavButton icon={ChevronLeft} onClick={goPrev} />
            <IconNavButton icon={ChevronRight} onClick={goNext} />
          </div>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-[560px] rounded-2xl" />
      ) : (
        <>
          {view === 'month' && (
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 shadow-card dark:border-ink-800 dark:bg-ink-800">
              <div className="grid grid-cols-7 gap-px bg-ink-100 dark:bg-ink-800">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="bg-ink-50/80 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/60 dark:text-ink-400">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-ink-100 dark:bg-ink-800">
                {monthCells.map((day) => {
                  const key = dateKey(day)
                  const dayEvents = eventsByDay[key] || []
                  const inMonth = day.getMonth() === cursor.getMonth()
                  const isToday = isSameDay(day, today)
                  return (
                    <button
                      key={key}
                      onClick={() => setDayModal(day)}
                      className={clsx(
                        'flex min-h-[110px] flex-col items-start gap-1 bg-white p-2 text-left transition-colors hover:bg-brand-50/40 dark:bg-ink-900 dark:hover:bg-brand-900/10',
                        !inMonth && 'bg-ink-50/60 dark:bg-ink-900/40',
                      )}
                    >
                      <span className={clsx(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                        isToday ? 'bg-brand-600 text-white' : inMonth ? 'text-ink-700 dark:text-ink-200' : 'text-ink-300 dark:text-ink-600',
                      )}>
                        {day.getDate()}
                      </span>
                      <div className="flex w-full flex-col gap-1">
                        {dayEvents.slice(0, 3).map((ev) => <EventChip key={ev.id} event={ev} />)}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] font-medium text-ink-400">+{dayEvents.length - 3} more</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'week' && (
            <div className="grid grid-cols-7 gap-3">
              {weekDays.map((day) => {
                const key = dateKey(day)
                const dayEvents = eventsByDay[key] || []
                const isToday = isSameDay(day, today)
                return (
                  <div key={key} className={clsx('flex min-h-[320px] flex-col rounded-2xl border bg-white p-2.5 dark:bg-ink-900', isToday ? 'border-brand-400 dark:border-brand-500' : 'border-ink-100 dark:border-ink-800')}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">{WEEKDAYS[day.getDay()]}</span>
                      <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', isToday ? 'bg-brand-600 text-white' : 'text-ink-700 dark:text-ink-200')}>
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto">
                      {dayEvents.map((ev) => <EventChip key={ev.id} event={ev} />)}
                      {dayEvents.length === 0 && <p className="mt-4 text-center text-[11px] text-ink-300 dark:text-ink-600">No events</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {view === 'day' && (
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              {(eventsByDay[dateKey(cursor)] || []).length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-400">Nothing scheduled for this day.</p>
              ) : (
                <div className="space-y-1">
                  {(eventsByDay[dateKey(cursor)] || []).map((ev) => <EventRow key={ev.id} event={ev} />)}
                </div>
              )}
            </div>
          )}

          {view === 'agenda' && (
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              {agendaGroups.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-400">Nothing scheduled in the next 30 days.</p>
              ) : (
                <div className="space-y-5">
                  {agendaGroups.map((group) => (
                    <div key={group.key}>
                      <h3 className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                        {isSameDay(group.date, today) ? 'Today' : isSameDay(group.date, addDays(today, 1)) ? 'Tomorrow' : formatDate(group.date, { weekday: 'long', month: 'short' })}
                      </h3>
                      <div className="space-y-1">
                        {group.items.map((ev) => <EventRow key={ev.id} event={ev} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal
        open={!!dayModal}
        onClose={() => setDayModal(null)}
        title={dayModal ? dayModal.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : ''}
        description="All events scheduled on this day."
      >
        <div className="space-y-1">
          {(dayModal ? eventsByDay[dateKey(dayModal)] || [] : []).map((ev) => <EventRow key={ev.id} event={ev} />)}
          {dayModal && (eventsByDay[dateKey(dayModal)] || []).length === 0 && (
            <p className="py-8 text-center text-sm text-ink-400">No events scheduled for this day.</p>
          )}
        </div>
      </Modal>

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Event"
        description="Add a meeting, follow-up, demo or task to the calendar."
        submitLabel="Add Event"
        loading={saving}
        onSubmit={createEvent}
        defaultValues={{ type: NEW_EVENT_TYPES[0], date: new Date().toISOString().slice(0, 10) }}
        fields={[
          { name: 'title', label: 'Event title', required: true, span: 2 },
          { name: 'type', label: 'Type', type: 'select', options: NEW_EVENT_TYPES.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'date', label: 'Date', type: 'date', required: true, span: 1 },
          { name: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ]}
      />
    </div>
  )
}

function IconNavButton({ icon: Icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100"
    >
      <Icon size={16} />
    </button>
  )
}
