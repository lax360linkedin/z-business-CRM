import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Search, Check, UserCheck, Users, Building2, BadgeCheck, X, Lock } from 'lucide-react'
import { Avatar } from '../../components/common/Avatar'

const MODES = [
  { id: 'me', label: 'Myself', icon: UserCheck },
  { id: 'people', label: 'People', icon: Users },
  { id: 'team', label: 'Team', icon: Building2 },
  { id: 'role', label: 'Role', icon: BadgeCheck },
]

/** Workload line: "4 active · 2 overdue" — overdue turns red so overloaded people are obvious at a glance. */
function Load({ active, overdue }) {
  return (
    <span className="shrink-0 text-right text-[11px] leading-tight text-ink-400">
      <span className="block">{active} active</span>
      <span className={clsx('block', overdue ? 'font-semibold text-rose-500' : '')}>{overdue} overdue</span>
    </span>
  )
}

/**
 * Assign to myself / one person / several people / a team (department) / a role.
 * value: { assignees: string[], assignedTeam: {kind, value} | null }
 */
export function AssignPicker({ value, onChange, dir, me, suggestedOwner, canAssignOthers = true, error }) {
  const [mode, setMode] = useState(() => (value.assignedTeam ? (value.assignedTeam.kind === 'role' ? 'role' : 'team') : value.assignees?.length > 1 || (value.assignees?.length === 1 && value.assignees[0] !== me) ? 'people' : 'me'))
  const [q, setQ] = useState('')
  const last = useRef(null)
  const users = dir?.users || []
  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const selected = value.assignees || []

  const people = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = users.filter((u) => !t || `${u.name} ${u.role} ${u.department} ${u.designation}`.toLowerCase().includes(t))
    return list.sort((a, b) => (b.id === suggestedOwner) - (a.id === suggestedOwner) || (b.isMe) - (a.isMe) || a.name.localeCompare(b.name))
  }, [users, q, suggestedOwner])

  // when the form changes the assignee for us (e.g. the record owner is suggested), show the matching tab
  useEffect(() => {
    const key = JSON.stringify(value)
    if (key === last.current) return
    last.current = key
    const a = value.assignees || []
    setMode(value.assignedTeam ? (value.assignedTeam.kind === 'role' ? 'role' : 'team') : a.length === 1 && a[0] === me ? 'me' : a.length ? 'people' : (m) => m)
  }, [value, me])
  const emit = (v) => { last.current = JSON.stringify(v); onChange(v) }
  const pickMode = (m) => {
    setMode(m); setQ('')
    if (m === 'me') emit({ assignees: me ? [me] : [], assignedTeam: null })
    else if (m === 'people') emit({ assignees: value.assignedTeam ? [] : selected, assignedTeam: null })
    else emit({ assignees: [], assignedTeam: null })
  }
  const toggle = (id) => emit({ assignees: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], assignedTeam: null })
  const pickGroup = (g) => emit(value.assignedTeam?.value === g.value && value.assignedTeam?.kind === g.kind ? { assignees: [], assignedTeam: null } : { assignees: g.members, assignedTeam: { kind: g.kind, value: g.value } })

  if (!canAssignOthers) {
    return (
      <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-800/40">
        <div className="flex items-center gap-2 text-ink-700 dark:text-ink-200"><Avatar name={byId[me]?.name || 'Me'} size="xs" /> {byId[me]?.name || 'You'} <span className="text-xs text-ink-400">(you)</span></div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-400"><Lock size={11} /> Your role can assign tasks to yourself only.</p>
      </div>
    )
  }

  return (
    <div className={clsx('rounded-xl border bg-white dark:bg-ink-900', error ? 'border-rose-400' : 'border-ink-200 dark:border-ink-700')}>
      <div className="flex gap-1 border-b border-ink-100 p-1.5 dark:border-ink-800" role="tablist" aria-label="Assign to">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => pickMode(m.id)} className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors', mode === m.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800')}>
            <m.icon size={13} /> {m.label}
          </button>
        ))}
      </div>

      {mode === 'me' && (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-700 dark:text-ink-200">
          <Avatar name={byId[me]?.name || 'Me'} size="sm" />
          <div><p className="font-medium">{byId[me]?.name || 'You'}</p><p className="text-xs text-ink-400">{byId[me] ? `${byId[me].active} active · ${byId[me].overdue} overdue` : 'Assigned to you'}</p></div>
        </div>
      )}

      {mode === 'people' && (
        <div>
          <div className="relative border-b border-ink-100 dark:border-ink-800">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, role or department…" aria-label="Search people" className="h-9 w-full bg-transparent pl-9 pr-3 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none dark:text-ink-100" />
          </div>
          <ul className="scrollbar-thin max-h-52 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
            {people.map((u) => {
              const on = selected.includes(u.id)
              return (
                <li key={u.id}>
                  <button type="button" role="option" aria-selected={on} onClick={() => toggle(u.id)} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-800', on && 'bg-brand-50/60 dark:bg-brand-900/20')}>
                    <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-ink-600')}>{on && <Check size={11} />}</span>
                    <Avatar name={u.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-800 dark:text-ink-100">{u.name}{u.isMe && <span className="text-[10px] font-normal text-ink-400">(you)</span>}{u.id === suggestedOwner && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Record owner</span>}</span>
                      <span className="block truncate text-xs text-ink-400">{u.role} · {u.department}</span>
                    </span>
                    <Load active={u.active} overdue={u.overdue} />
                  </button>
                </li>
              )
            })}
            {!people.length && <li className="px-3 py-6 text-center text-xs text-ink-400">No one matches “{q}”.</li>}
          </ul>
        </div>
      )}

      {(mode === 'team' || mode === 'role') && (
        <ul className="scrollbar-thin max-h-52 overflow-y-auto py-1">
          {(mode === 'team' ? dir?.departments : dir?.roles || []).map((g) => {
            const on = value.assignedTeam?.value === g.value && value.assignedTeam?.kind === g.kind
            return (
              <li key={g.value}>
                <button type="button" onClick={() => pickGroup(g)} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-800', on && 'bg-brand-50/60 dark:bg-brand-900/20')}>
                  <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 dark:border-ink-600')}>{on && <Check size={11} />}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink-800 dark:text-ink-100">{g.value}</span><span className="block text-xs text-ink-400">{g.members.length} member{g.members.length > 1 ? 's' : ''} — everyone gets the task</span></span>
                  <Load active={g.active} overdue={g.overdue} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {mode !== 'me' && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-ink-100 p-2 dark:border-ink-800">
          {selected.slice(0, 8).map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-1 pr-2 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">
              <Avatar name={byId[id]?.name || id} size="xs" />{byId[id]?.name || id}
              {mode === 'people' && <button type="button" aria-label={`Remove ${byId[id]?.name}`} onClick={() => toggle(id)} className="text-ink-400 hover:text-ink-700"><X size={11} /></button>}
            </span>
          ))}
          {selected.length > 8 && <span className="px-1 text-xs text-ink-400">+{selected.length - 8} more</span>}
        </div>
      )}
    </div>
  )
}
