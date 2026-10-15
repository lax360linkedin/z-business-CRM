import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Link2, X, Search, Info } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { AssignPicker } from './AssignPicker'
import { useDirectory, useTaskLookup, useTaskMeta, errMsg, emitTasksChanged, addDaysIso } from './taskClient'
import { TASK_PRIORITIES, TASK_TYPES, VISIBILITY_LEVELS, VISIBILITY_HELP, REMINDER_OPTIONS, RECURRENCE_OPTIONS, validateTaskInput } from '../../utils/taskRules'
import { TASK_RELATED_TYPES, TASK_RELATED_BY_TYPE, TASK_RELATED_BY_KEY, TASK_LINK_ORDER } from '../../utils/taskLinks'

const PRIORITY_ON = { Low: 'bg-ink-200 text-ink-800 dark:bg-ink-700 dark:text-ink-100', Medium: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', High: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', Urgent: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200' }

/** Search a real record of the chosen type (leads, deals, invoices …). */
export function RecordPicker({ type, value, onPick, data, disabled, error }) {
  const def = TASK_RELATED_BY_TYPE[type]
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const rows = def ? data?.[def.collection] || [] : []
  const current = rows.find((r) => r.id === value)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter((r) => !t || `${def.label(r)} ${r.id} ${r.email || ''}`.toLowerCase().includes(t)).slice(0, 8)
  }, [rows, q, def])
  if (!def) return <Input disabled placeholder="Choose a record type first" />
  return (
    <div className="relative" ref={ref}>
      <div className={clsx('flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm dark:bg-ink-900', error ? 'border-rose-400' : 'border-ink-200 dark:border-ink-700', disabled && 'opacity-60')}>
        <Search size={14} className="shrink-0 text-ink-400" />
        {current && !open ? (
          <button type="button" disabled={disabled} onClick={() => { setOpen(true); setQ('') }} className="min-w-0 flex-1 truncate text-left text-ink-800 dark:text-ink-100">{def.label(current)}</button>
        ) : (
          <input value={q} disabled={disabled} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true) }} placeholder={`Search ${def.type.toLowerCase()}s…`} aria-label={`Search ${def.type}`} className="min-w-0 flex-1 bg-transparent text-ink-800 placeholder:text-ink-400 focus:outline-none dark:text-ink-100" />
        )}
        {value && !disabled && <button type="button" aria-label="Clear record" onClick={() => { onPick(''); setQ('') }} className="text-ink-400 hover:text-ink-700"><X size={14} /></button>}
      </div>
      {open && !disabled && (
        <ul className="scrollbar-thin absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-ink-100 bg-white py-1 shadow-popover dark:border-ink-800 dark:bg-ink-900" role="listbox">
          {hits.map((r) => (
            <li key={r.id}><button type="button" role="option" aria-selected={r.id === value} onClick={() => { onPick(r.id); setOpen(false); setQ('') }} className="block w-full truncate px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800">{def.label(r)}</button></li>
          ))}
          {!hits.length && <li className="px-3 py-4 text-center text-xs text-ink-400">No {def.type.toLowerCase()} matches.</li>}
        </ul>
      )}
    </div>
  )
}

function Followers({ value, onChange, users }) {
  const left = users.filter((u) => !value.includes(u.id))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">{users.find((u) => u.id === id)?.name || id}<button type="button" aria-label="Remove follower" onClick={() => onChange(value.filter((x) => x !== id))}><X size={11} /></button></span>)}
      <select aria-label="Add follower" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} className="h-7 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
        <option value="">+ Add follower</option>
        {left.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </div>
  )
}

const blankForm = (me, preset = {}) => ({
  title: '', description: '', taskType: 'General', priority: 'Medium', startDate: '', dueDate: addDaysIso(1), dueTime: '', reminderMinutes: '', customReminderAt: '',
  assignees: me ? [me] : [], assignedTeam: null, visibility: 'Team', watchers: [], relatedType: '', relatedId: '', recFreq: 'none', recInterval: 1, productId: '', campaignId: '', projectId: '', ...preset,
})
const fromTask = (t) => ({
  title: t.title, description: t.description || '', taskType: t.taskType, priority: t.priority, startDate: t.startDate || '', dueDate: t.dueDate || '', dueTime: t.dueTime || '', reminderMinutes: t.reminderMinutes || '', customReminderAt: t.customReminderAt ? t.customReminderAt.slice(0, 16) : '',
  assignees: t.assignees || [], assignedTeam: t.assignedTeam || null, visibility: t.visibility, watchers: t.watchers || [], relatedType: t.relatedType || '', relatedId: t.relatedId || '', recFreq: t.recurrence?.frequency || 'none', recInterval: t.recurrence?.interval || 1,
  productId: t.links?.productId || '', campaignId: t.links?.campaignId || '', projectId: t.links?.projectId || '',
})

/**
 * Create or edit a task. Starts as a quick form (title, due, priority, assignee, record) with smart defaults;
 * everything else sits under "More options". `related` pre-attaches (and locks) a CRM record.
 */
export function TaskFormDialog({ open, onClose, onSaved, task, related, parent, preset }) {
  const { toast } = useToast()
  const { me, perms } = useTaskMeta()
  const { dir } = useDirectory(open)
  const { data: lookup, find } = useTaskLookup(open)
  const editing = !!task
  const caps = task?._can || {}
  const [f, setF] = useState(() => blankForm(null))
  const [more, setMore] = useState(false)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [owner, setOwner] = useState({ id: null, name: null })
  const [links, setLinks] = useState({})
  const touchedAssign = useRef(false)
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  useEffect(() => {
    if (!open) return
    touchedAssign.current = false
    setErrors({}); setError(''); setOwner({ id: null, name: null }); setLinks({})
    if (task) { setF(fromTask(task)); setMore(true); return }
    setMore(false)
    setF(blankForm(me?.id, { ...(related ? { relatedType: related.type, relatedId: related.id } : {}), ...(parent ? { relatedType: parent.relatedType || '', relatedId: parent.relatedId || '', priority: parent.priority, assignees: parent.assignees || [], visibility: parent.visibility } : {}), ...(preset || {}) }))
  }, [open, task?.id, related?.id, parent?.id, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // choosing a record resolves its whole chain and suggests the responsible owner as assignee
  useEffect(() => {
    if (!open || !f.relatedType || !f.relatedId) { setLinks({}); setOwner({ id: null, name: null }); return }
    let live = true
    api.get('/tasks/suggest-owner', { params: { relatedType: f.relatedType, relatedId: f.relatedId } }).then((r) => {
      if (!live) return
      setLinks(r.data.links || {}); setOwner({ id: r.data.owner, name: r.data.ownerName })
      if (!editing && !touchedAssign.current && r.data.owner && perms.assign) setF((x) => ({ ...x, assignees: [r.data.owner], assignedTeam: null }))
    }).catch(() => { if (live) { setLinks({}); setOwner({ id: null, name: null }) } })
    return () => { live = false }
  }, [open, f.relatedType, f.relatedId, editing, perms.assign])

  const linkChips = TASK_LINK_ORDER.filter((k) => links[k] && !(TASK_RELATED_BY_KEY[k].type === f.relatedType && links[k] === f.relatedId)).map((k) => { const d = TASK_RELATED_BY_KEY[k]; return { k, type: d.type, label: d.label(find(d.collection, links[k]) || {}) } })

  const submit = () => {
    const input = {
      title: f.title, description: f.description, taskType: f.taskType, priority: f.priority, startDate: f.startDate || null, dueDate: f.dueDate || null, dueTime: f.dueTime || null,
      reminderMinutes: f.reminderMinutes, customReminderAt: f.reminderMinutes === 'custom' ? f.customReminderAt : null, visibility: f.visibility, watchers: f.watchers,
      recurrence: { frequency: f.recFreq, interval: Number(f.recInterval) || 1 }, relatedType: f.relatedType || null, relatedId: f.relatedId || null,
      links: { productId: f.productId, campaignId: f.campaignId, projectId: f.projectId },
    }
    const e = validateTaskInput(input)
    if (f.relatedType && !f.relatedId) e.relatedId = 'Pick the record, or clear the type.'
    if (Object.keys(e).length) { setErrors(e); if (e.description || e.reminderMinutes || e.customReminderAt || e.recurrence || e.visibility) setMore(true); return }
    setErrors({}); setError(''); setSaving(true)
    const sameAssignees = editing && JSON.stringify([...(task.assignees || [])].sort()) === JSON.stringify([...f.assignees].sort())
    const body = editing ? { ...input, ...(sameAssignees ? {} : { assignees: f.assignees, assignedTeam: f.assignedTeam }) } : { ...input, assignees: f.assignees, assignedTeam: f.assignedTeam, ...(parent ? { parentId: parent.id } : {}) }
    if (editing) { delete body.relatedType; delete body.relatedId; if (f.relatedType !== (task.relatedType || '') || f.relatedId !== (task.relatedId || '')) { body.relatedType = f.relatedType || null; body.relatedId = f.relatedId || null } }
    const req = editing ? api.put(`/tasks/${task.id}`, body) : api.post('/tasks', body)
    req.then((r) => { toast(editing ? 'Task updated.' : `Task ${r.data.id} created.`, { type: 'success' }); emitTasksChanged(); onSaved?.(r.data); onClose() })
      .catch((err) => { setError(errMsg(err)); if (err?.response?.data?.fields) setErrors(err.response.data.fields) })
      .finally(() => setSaving(false))
  }

  const lockedRecord = !!related && !editing
  const assignLocked = editing && !(caps.reassign || caps.assign || caps.claim)
  const projects = lookup?.projects || []
  const campaigns = lookup?.campaigns || []
  const products = lookup?.products || []

  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title={editing ? `Edit ${task.id}` : parent ? `New subtask of ${parent.id}` : 'New task'}
      description={editing ? 'Changes are recorded on the task timeline.' : 'Title, date and assignee are enough — everything else is optional.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Create task'}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-4">
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>}
        <FormField label="Title" required error={errors.title}>
          <Input autoFocus value={f.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Call back about the revised quotation" maxLength={160} />
        </FormField>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label="Due date" error={errors.dueDate} className="col-span-1 sm:col-span-2">
            <Input type="date" value={f.dueDate} disabled={editing && !caps.changeDueDate} onChange={(e) => set({ dueDate: e.target.value })} error={errors.dueDate} />
          </FormField>
          <FormField label="Time" error={errors.dueTime} className="col-span-1">
            <Input type="time" value={f.dueTime} disabled={editing && !caps.changeDueDate} onChange={(e) => set({ dueTime: e.target.value })} aria-label="Due time" />
          </FormField>
          <FormField label="Type" className="col-span-2 sm:col-span-1">
            <Select value={f.taskType} onChange={(e) => set({ taskType: e.target.value })}>{TASK_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          </FormField>
        </div>

        <FormField label="Priority" error={errors.priority}>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Priority">
            {TASK_PRIORITIES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.priority === p} disabled={editing && !caps.changePriority} onClick={() => set({ priority: p })} className={clsx('flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors disabled:opacity-50', f.priority === p ? `${PRIORITY_ON[p]} ring-transparent` : 'text-ink-500 ring-ink-200 hover:bg-ink-50 dark:ring-ink-700 dark:hover:bg-ink-800')}>{p}</button>
            ))}
          </div>
        </FormField>

        <FormField label="Related CRM record" error={errors.relatedId || errors.relatedType} hint={lockedRecord ? 'Attached from the record you came from.' : 'Optional. Choosing one links the task to its whole enquiry → payment chain.'}>
          <div className="grid grid-cols-[9rem_1fr] gap-2">
            <Select aria-label="Record type" value={f.relatedType} disabled={lockedRecord} onChange={(e) => set({ relatedType: e.target.value, relatedId: '' })}>
              <option value="">None</option>
              {TASK_RELATED_TYPES.map((r) => <option key={r.type} value={r.type}>{r.type}</option>)}
            </Select>
            <RecordPicker type={f.relatedType} value={f.relatedId} data={lookup} disabled={lockedRecord} error={errors.relatedId} onPick={(id) => set({ relatedId: id })} />
          </div>
          {linkChips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500"><Link2 size={12} /> Also linked to:
              {linkChips.map((c) => <span key={c.k} className="rounded-full bg-ink-100 px-2 py-0.5 dark:bg-ink-800"><span className="text-ink-400">{c.type}</span> {c.label}</span>)}
            </div>
          )}
        </FormField>

        <FormField label="Assign to" error={errors.assignees} hint={owner.id && perms.assign && !assignLocked ? `Suggested: ${owner.name} owns this record.` : owner.id ? `Record owner: ${owner.name}` : undefined}>
          {assignLocked
            ? <p className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-sm text-ink-600 dark:border-ink-700 dark:bg-ink-800/40 dark:text-ink-300">{(task.assignees || []).map((id) => dir?.users.find((u) => u.id === id)?.name || id).join(', ') || 'Unassigned'} <span className="text-xs text-ink-400">— you can’t reassign this task.</span></p>
            : <AssignPicker value={{ assignees: f.assignees, assignedTeam: f.assignedTeam }} me={me?.id} dir={dir} suggestedOwner={owner.id} canAssignOthers={!!perms.assign} error={errors.assignees} onChange={(v) => { touchedAssign.current = true; set(v) }} />}
        </FormField>

        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          <ChevronDown size={15} className={clsx('transition-transform', more && 'rotate-180')} /> {more ? 'Fewer options' : 'More options'} <span className="font-normal text-ink-400">description, reminder, repeat, visibility…</span>
        </button>

        {more && (
          <div className="space-y-4 rounded-xl border border-ink-100 bg-ink-50/40 p-4 dark:border-ink-800 dark:bg-ink-800/20">
            <FormField label="Description" error={errors.description}><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Context, what to say, what done looks like…" className="min-h-[72px]" /></FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></FormField>
              <FormField label="Reminder" error={errors.reminderMinutes || errors.customReminderAt} hint="In-app notification. Email / WhatsApp delivery isn’t configured.">
                <Select value={f.reminderMinutes} onChange={(e) => set({ reminderMinutes: e.target.value })}>{REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                {f.reminderMinutes === 'custom' && <Input type="datetime-local" className="mt-2" value={f.customReminderAt} onChange={(e) => set({ customReminderAt: e.target.value })} error={errors.customReminderAt} aria-label="Custom reminder" />}
              </FormField>
              <FormField label="Repeat" error={errors.recurrence} hint={f.recFreq !== 'none' ? 'The next task is created automatically when this one is completed.' : undefined}>
                <div className="flex gap-2">
                  <Select value={f.recFreq} onChange={(e) => set({ recFreq: e.target.value })}>{RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                  {f.recFreq !== 'none' && <div className="flex w-32 shrink-0 items-center gap-1.5 text-xs text-ink-500">every <Input type="number" min={1} max={365} value={f.recInterval} onChange={(e) => set({ recInterval: e.target.value })} aria-label="Repeat interval" className="px-2" /></div>}
                </div>
              </FormField>
              <FormField label="Visibility" error={errors.visibility} hint={VISIBILITY_HELP[f.visibility]}>
                <Select value={f.visibility} onChange={(e) => set({ visibility: e.target.value })}>{VISIBILITY_LEVELS.map((v) => <option key={v}>{v}</option>)}</Select>
              </FormField>
            </div>
            <FormField label="Followers" hint="Followers can see the task and get its comments."><Followers users={dir?.users || []} value={f.watchers} onChange={(watchers) => set({ watchers })} /></FormField>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Product / service"><Select value={f.productId} onChange={(e) => set({ productId: e.target.value })}><option value="">None</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
              <FormField label="Campaign"><Select value={f.campaignId} onChange={(e) => set({ campaignId: e.target.value })}><option value="">{links.campaignId ? 'From the record' : 'None'}</option>{campaigns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
              <FormField label="Project"><Select value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">{links.projectId ? 'From the record' : 'None'}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-ink-400"><Info size={13} className="mt-0.5 shrink-0" /> Extra links add to — never replace — the links resolved from the related record.</p>
          </div>
        )}
      </form>
    </Modal>
  )
}
