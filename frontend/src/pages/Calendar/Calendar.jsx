import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus, X, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Tabs } from '../../components/common/Tabs'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { EmptyState } from '../../components/common/EmptyState'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { getUserById, USERS } from '../../data/users'
import { formatDate } from '../../utils/format'
import { KIND_ORDER, localDate, parseLocalDate } from '../../utils/calendarRules'
import { useOnTasksChanged, errMsg } from '../Tasks/taskClient'
import { KIND_STYLE } from './calendarStyle'
import { EventDetailDialog, EventFormDialog, rescheduleEvent } from './EventDialogs'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 07:00 – 21:00
const key = (d) => localDate(d instanceof Date ? d : new Date(d))
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const startOfWeek = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay())

function rangeFor(view, cursor) {
  if (view === 'month') { const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const s = addDays(first, -first.getDay()); return [s, addDays(s, 41)] }
  if (view === 'week') { const s = startOfWeek(cursor); return [s, addDays(s, 6)] }
  if (view === 'day') return [cursor, cursor]
  const t = new Date(); t.setHours(0, 0, 0, 0); return [t, addDays(t, 30)]
}

function Chip({ ev, onOpen, drag }) {
  const st = KIND_STYLE[ev.kind]
  const Icon = st.icon
  return (
    <button
      type="button" draggable={!!ev.can?.reschedule} onDragStart={(e) => { e.dataTransfer.setData('text/cal-event', ev.id); drag?.(ev) }} onClick={(e) => { e.stopPropagation(); onOpen(ev) }}
      title={`${ev.time ? `${ev.time} · ` : ''}${ev.title}${ev.relatedName ? ` — ${ev.relatedName}` : ''}`}
      className={clsx('flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium leading-4 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        st.chip, ev.state === 'done' && 'opacity-60 line-through', ev.state === 'cancelled' && 'bg-ink-100 text-ink-400 line-through opacity-70 dark:bg-ink-800', ev.state === 'overdue' && 'ring-1 ring-rose-400', ev.can?.reschedule && 'cursor-grab')}
    >
      <Icon size={10} className="shrink-0" />
      {ev.time && <span className="shrink-0 font-semibold">{ev.time}</span>}
      <span className="truncate">{ev.title}</span>
    </button>
  )
}

function EventRow({ ev, onOpen }) {
  const st = KIND_STYLE[ev.kind]
  const Icon = st.icon
  return (
    <button type="button" onClick={() => onOpen(ev)} className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-ink-50 dark:hover:bg-ink-800">
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', st.solid)}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-sm font-medium', ev.state === 'done' || ev.state === 'cancelled' ? 'text-ink-400 line-through' : 'text-ink-800 dark:text-ink-100')}>{ev.title}</p>
        <p className="truncate text-xs text-ink-400">{ev.relatedName ? `${ev.relatedType} · ${ev.relatedName}` : st.singular}{ev.assignees?.[0] ? ` · ${getUserById(ev.assignees[0])?.name || ev.assignees[0]}` : ''}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={clsx('text-xs font-medium', ev.state === 'overdue' ? 'text-rose-500' : 'text-ink-500')}>{ev.time ? `${ev.time}${ev.endTime ? `–${ev.endTime}` : ''}` : 'All day'}</p>
        <p className="text-[11px] text-ink-400">{ev.state === 'overdue' ? 'Overdue' : st.singular}</p>
      </div>
    </button>
  )
}

export default function CalendarPage() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [events, setEvents] = useState([])
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mine, setMine] = useState(true)
  const [person, setPerson] = useState('all')
  const [kinds, setKinds] = useState({ task: true, meeting: true, followup: true, reminder: true, deadline: false })
  const [detail, setDetail] = useState(null)
  const [dayModal, setDayModal] = useState(null)
  const [form, setForm] = useState(null)
  const [dragEv, setDragEv] = useState(null)
  const [overDay, setOverDay] = useState(null)

  const rt = params.get('relatedType')
  const rid = params.get('relatedId')
  const recordFilter = useMemo(() => (rt && rid ? { type: rt, id: rid } : null), [rt, rid])
  const [from, to] = useMemo(() => rangeFor(view, cursor), [view, cursor])
  const fromKey = key(from)
  const toKey = key(to)

  const load = useCallback(() => api.get('/calendar/events', { params: { from: fromKey, to: toKey } })
    .then((r) => { setEvents(r.data.events); setMe(r.data.me); setError('') }).catch((e) => setError(errMsg(e))).finally(() => setLoading(false)), [fromKey, toKey])
  useEffect(() => { setLoading(true); load() }, [load])
  useOnTasksChanged(load)
  useEffect(() => { // stay in step with edits made on other pages / tabs
    const id = setInterval(load, 30000)
    window.addEventListener('focus', load)
    return () => { clearInterval(id); window.removeEventListener('focus', load) }
  }, [load])

  // /calendar?create=1 (the "New Meeting" quick action) opens the scheduler, locked to a record when one is in the URL
  useEffect(() => {
    if (params.get('create') === '1') {
      setForm(recordFilter ? { relatedType: recordFilter.type, relatedId: recordFilter.id, lockRecord: true } : {})
      setParams((p) => { const n = new URLSearchParams(p); n.delete('create'); return n }, { replace: true })
    }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const involved = useCallback((ev) => (ev.assignees || []).includes(me) || ev.createdBy === me, [me])
  const visible = useMemo(() => events.filter((ev) => {
    if (!kinds[ev.kind]) return false
    if (recordFilter && !((ev.relatedType === recordFilter.type && ev.relatedId === recordFilter.id) || ev.related?.some((r) => r.type === recordFilter.type && r.id === recordFilter.id))) return false
    if (mine && !involved(ev)) return false
    if (!mine && person !== 'all' && !(ev.assignees || []).includes(person)) return false
    return true
  }), [events, kinds, mine, person, involved, recordFilter])
  const byDay = useMemo(() => { const m = {}; visible.forEach((ev) => { (m[ev.date] = m[ev.date] || []).push(ev) }); return m }, [visible])
  const counts = useMemo(() => Object.fromEntries(KIND_ORDER.map((k) => [k, events.filter((e) => e.kind === k && (!mine || involved(e))).length])), [events, mine, involved])
  const today = new Date()
  const todayKey = key(today)

  const shift = (n) => setCursor((c) => { const d = new Date(c); if (view === 'month') d.setMonth(d.getMonth() + n); else if (view === 'week') d.setDate(d.getDate() + 7 * n); else d.setDate(d.getDate() + n); return d })
  const header = view === 'month' ? cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : view === 'week' ? `${formatDate(startOfWeek(cursor))} – ${formatDate(addDays(startOfWeek(cursor), 6))}`
      : view === 'day' ? cursor.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : 'Next 30 days'

  const dropOn = (dayKey, e) => {
    e.preventDefault(); setOverDay(null)
    const ev = dragEv; setDragEv(null)
    if (!ev || ev.date === dayKey) return
    rescheduleEvent(ev, dayKey).then(() => { toast(`Moved “${ev.title}” to ${formatDate(dayKey)}.`, { type: 'success' }); load(); window.dispatchEvent(new Event('crm:tasks-changed')) }).catch((err) => toast(errMsg(err), { type: 'error' }))
  }
  const dayProps = (dayKey) => ({ onDragOver: (e) => { if (dragEv) { e.preventDefault(); setOverDay(dayKey) } }, onDragLeave: () => setOverDay((o) => (o === dayKey ? null : o)), onDrop: (e) => dropOn(dayKey, e) })
  const newOn = (dayKey) => setForm({ date: dayKey, ...(recordFilter ? { relatedType: recordFilter.type, relatedId: recordFilter.id, lockRecord: true } : {}) })

  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(from, i)), [from])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from])
  const agenda = useMemo(() => Object.keys(byDay).filter((k) => k >= fromKey && k <= toKey).sort().map((k) => ({ key: k, items: byDay[k] })), [byDay, fromKey, toKey])

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Tasks, meetings, follow-ups, reminders and due dates — each one lives on its CRM record; the calendar just shows them."
        actions={<><Button icon={Plus} onClick={() => newOn(view === 'day' ? key(cursor) : todayKey)}>New Event</Button></>}
      />

      {recordFilter && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-2 text-sm text-brand-800 dark:border-brand-800/40 dark:bg-brand-900/10 dark:text-brand-200">
          Showing only events connected to <b>{recordFilter.type} {recordFilter.id}</b>
          <button type="button" aria-label="Show all events" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.delete('relatedType'); n.delete('relatedId'); return n }, { replace: true })} className="ml-auto rounded p-1 hover:bg-brand-100"><X size={14} /></button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="Whose events">
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)} className={clsx('rounded-md px-3 py-1.5', mine ? 'bg-brand-600 text-white' : 'text-ink-500')}>My calendar</button>
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)} className={clsx('rounded-md px-3 py-1.5', !mine ? 'bg-brand-600 text-white' : 'text-ink-500')}>Everyone I can see</button>
        </div>
        {!mine && (
          <select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)} className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200">
            <option value="all">All people</option>{USERS.filter((u) => u.status !== 'Inactive').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Event types">
          {KIND_ORDER.map((k) => (
            <button key={k} type="button" aria-pressed={kinds[k]} onClick={() => setKinds((x) => ({ ...x, [k]: !x[k] }))}
              className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors', kinds[k] ? 'bg-white text-ink-800 ring-ink-200 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700' : 'text-ink-400 ring-ink-100 line-through dark:ring-ink-800')}>
              <span className={clsx('h-2 w-2 rounded-full', KIND_STYLE[k].dot, !kinds[k] && 'opacity-40')} />{KIND_STYLE[k].label}<span className="text-ink-400">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <Tabs tabs={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }, { value: 'agenda', label: 'Agenda' }]} active={view} onChange={setView} className="mb-4" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{header}</h2>
        {view !== 'agenda' && (
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
            <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"><ChevronLeft size={15} /></button>
            <button type="button" aria-label="Next" onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"><ChevronRight size={15} /></button>
          </div>
        )}
      </div>

      {error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load the calendar" description={error} action={<Button variant="secondary" onClick={load}>Try again</Button>} />
      ) : loading && !events.length ? (
        <Skeleton className="h-[560px] rounded-2xl" />
      ) : (
        <>
          {view === 'month' && (
            <div className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 shadow-card dark:border-ink-800 dark:bg-ink-800">
              <div className="grid grid-cols-7 gap-px">
                {WEEKDAYS.map((w) => <div key={w} className="bg-ink-50/80 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/60 dark:text-ink-400">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {monthCells.map((day) => {
                  const k = key(day)
                  const list = byDay[k] || []
                  const inMonth = day.getMonth() === cursor.getMonth()
                  return (
                    <div key={k} role="button" tabIndex={0} aria-label={`${k}, ${list.length} events`} onClick={() => setDayModal(k)} onKeyDown={(e) => e.key === 'Enter' && setDayModal(k)} {...dayProps(k)}
                      className={clsx('flex min-h-[112px] cursor-pointer flex-col items-start gap-1 bg-white p-1.5 text-left transition-colors hover:bg-brand-50/40 dark:bg-ink-900 dark:hover:bg-brand-900/10', !inMonth && 'bg-ink-50/60 dark:bg-ink-900/40', overDay === k && 'bg-brand-50 ring-2 ring-inset ring-brand-400 dark:bg-brand-900/20')}>
                      <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', k === todayKey ? 'bg-brand-600 text-white' : inMonth ? 'text-ink-700 dark:text-ink-200' : 'text-ink-300 dark:text-ink-600')}>{day.getDate()}</span>
                      <div className="flex w-full flex-col gap-0.5">
                        {list.slice(0, 3).map((ev) => <Chip key={ev.id} ev={ev} onOpen={setDetail} drag={setDragEv} />)}
                        {list.length > 3 && <span className="px-1 text-[10px] font-medium text-ink-400">+{list.length - 3} more</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'week' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {weekDays.map((day) => {
                const k = key(day)
                const list = byDay[k] || []
                return (
                  <div key={k} {...dayProps(k)} className={clsx('flex min-h-[260px] flex-col rounded-2xl border bg-white p-2.5 dark:bg-ink-900', k === todayKey ? 'border-brand-400 dark:border-brand-500' : 'border-ink-100 dark:border-ink-800', overDay === k && 'ring-2 ring-brand-400')}>
                    <div className="mb-2 flex items-center justify-between">
                      <button type="button" onClick={() => { setCursor(day); setView('day') }} className="text-xs font-semibold uppercase tracking-wide text-ink-400 hover:text-brand-600">{WEEKDAYS[day.getDay()]}</button>
                      <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', k === todayKey ? 'bg-brand-600 text-white' : 'text-ink-700 dark:text-ink-200')}>{day.getDate()}</span>
                    </div>
                    <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto">
                      {list.map((ev) => <Chip key={ev.id} ev={ev} onOpen={setDetail} drag={setDragEv} />)}
                      {!list.length && <p className="mt-4 text-center text-[11px] text-ink-300 dark:text-ink-600">No events</p>}
                    </div>
                    <button type="button" onClick={() => newOn(k)} className="mt-2 text-[11px] font-medium text-ink-400 hover:text-brand-600">+ Add</button>
                  </div>
                )
              })}
            </div>
          )}

          {view === 'day' && (() => {
            const k = key(cursor)
            const list = byDay[k] || []
            const hourOf = (e) => Number(e.time.slice(0, 2))
            const loose = list.filter((e) => !e.time || hourOf(e) < HOURS[0] || hourOf(e) > HOURS[HOURS.length - 1])
            return (
              <div {...dayProps(k)} className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
                {!list.length && <p className="px-4 pt-10 text-center text-sm text-ink-400">Nothing scheduled for this day.</p>}
                {loose.length > 0 && (
                  <div className="border-b border-ink-100 p-3 dark:border-ink-800"><p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">All day / outside working hours</p>{loose.map((ev) => <EventRow key={ev.id} ev={ev} onOpen={setDetail} />)}</div>
                )}
                <div className="divide-y divide-ink-50 dark:divide-ink-800/60">
                  {HOURS.map((h) => (
                    <div key={h} className="flex min-h-[48px] gap-3 px-3 py-1.5">
                      <span className="w-12 shrink-0 pt-1 text-right text-[11px] text-ink-400">{String(h).padStart(2, '0')}:00</span>
                      <div className="min-w-0 flex-1">{list.filter((e) => e.time && hourOf(e) === h).map((ev) => <EventRow key={ev.id} ev={ev} onOpen={setDetail} />)}</div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-ink-100 p-3 dark:border-ink-800"><Button variant="secondary" size="sm" icon={Plus} onClick={() => newOn(k)}>Add to this day</Button></div>
              </div>
            )
          })()}

          {view === 'agenda' && (
            <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
              {!agenda.length ? <p className="py-12 text-center text-sm text-ink-400">Nothing scheduled in the next 30 days.</p> : (
                <div className="space-y-5">
                  {agenda.map((g) => (
                    <div key={g.key}>
                      <h3 className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{g.key === todayKey ? 'Today' : g.key === key(addDays(today, 1)) ? 'Tomorrow' : formatDate(g.key, { weekday: 'long', month: 'short' })}</h3>
                      <div className="space-y-0.5">{g.items.map((ev) => <EventRow key={ev.id} ev={ev} onOpen={setDetail} />)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Modal open={!!dayModal} onClose={() => setDayModal(null)} title={dayModal ? parseLocalDate(dayModal).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : ''} description="Everything on this day."
        footer={<Button icon={Plus} onClick={() => { const d = dayModal; setDayModal(null); newOn(d) }}>Add event</Button>}>
        <div className="space-y-0.5">
          {(dayModal ? byDay[dayModal] || [] : []).map((ev) => <EventRow key={ev.id} ev={ev} onOpen={(e) => { setDayModal(null); setDetail(e) }} />)}
          {dayModal && !(byDay[dayModal] || []).length && <p className="py-8 text-center text-sm text-ink-400">No events on this day.</p>}
        </div>
      </Modal>

      <EventDetailDialog event={detail} onClose={() => setDetail(null)} onChanged={load} />
      <EventFormDialog open={!!form} preset={form || undefined} onClose={() => setForm(null)} onSaved={load} />
    </div>
  )
}
