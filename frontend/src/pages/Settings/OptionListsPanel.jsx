import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, RotateCcw, Trash2, X, AlertTriangle, ListChecks } from 'lucide-react'
import clsx from 'clsx'
import { Button, IconButton } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { Input } from '../../components/common/FormField'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api, errorMessage } from '../../api/http'
import { useOptionLists } from '../../hooks/useOptions'

const box = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'
const enc = (v) => encodeURIComponent(v)
const fieldError = (e) => e?.response?.data?.fields?.value || errorMessage(e)

function Switch({ on, onClick, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50', on ? 'bg-emerald-500' : 'bg-ink-200 dark:bg-ink-700')}>
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

/** One list: its options with how many records use each, add / rename / switch off / reorder / delete. Only the Super Admin can change anything; everyone else sees it read-only. */
function ListEditor({ list, usage, canEdit, onChanged }) {
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // { value, text }
  const [confirm, setConfirm] = useState(null) // { kind: 'delete' | 'reset', value? }
  const base = `/options/${list.key}`

  const run = (call, done) => { setBusy(true); setError(''); return call().then(() => { if (done) toast(done, { type: 'success' }); onChanged(); return true }).catch((e) => { setError(fieldError(e)); return false }).finally(() => setBusy(false)) }
  const add = () => run(() => api.post(`${base}/items`, { value: draft }), `“${draft.trim()}” added.`).then((ok) => { if (ok) setDraft('') })
  const toggle = (item) => run(() => api.put(`${base}/items/${enc(item.value)}`, { active: !item.active }), item.active ? `“${item.value}” switched off. Existing records keep it.` : `“${item.value}” switched on.`)
  const rename = () => run(() => api.put(`${base}/items/${enc(editing.value)}`, { value: editing.text }), `Renamed to “${editing.text.trim()}”.`).then((ok) => { if (ok) setEditing(null) })
  const move = (index, by) => {
    const values = list.items.map((i) => i.value)
    const to = index + by
    if (to < 0 || to >= values.length) return
    ;[values[index], values[to]] = [values[to], values[index]]
    run(() => api.put(`${base}/order`, { values }))
  }
  const doConfirm = () => {
    const c = confirm
    const call = c.kind === 'reset' ? () => api.post(`${base}/reset`) : () => api.delete(`${base}/items/${enc(c.value)}`)
    run(call, c.kind === 'reset' ? `${list.label} reset to the built-in options.` : `“${c.value}” deleted.`).then(() => setConfirm(null))
  }

  return (
    <section className={box} aria-label={list.label}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">{list.label} <span className="ml-1 text-xs font-medium text-ink-400">{list.items.length}</span></h3>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{list.help}</p>
        </div>
        {canEdit && list.customised && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setConfirm({ kind: 'reset' })}>Reset to defaults</Button>}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}

      {canEdit && (
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) add() }}>
          <Input aria-label={`Add to ${list.label}`} value={draft} onChange={(e) => { setDraft(e.target.value); setError('') }} placeholder={`Add an option to ${list.label.toLowerCase()}`} maxLength={120} />
          <Button type="submit" icon={Plus} loading={busy && !editing && !confirm} disabled={!draft.trim()}>Add</Button>
        </form>
      )}

      {!list.items.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-400 dark:border-ink-700">No options yet.{canEdit ? ' Add the first one above.' : ''}</p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {list.items.map((item, index) => {
            const used = usage?.[item.value] || 0
            const isEditing = editing?.value === item.value
            return (
              <li key={item.value} className={clsx('flex items-center gap-2 px-3 py-2.5', !item.active && 'bg-ink-50/60 dark:bg-ink-800/30')}>
                {isEditing ? (
                  <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename() }}>
                    <Input aria-label={`Rename ${item.value}`} autoFocus value={editing.text} onChange={(e) => { setEditing({ ...editing, text: e.target.value }); setError('') }} maxLength={120} />
                    <IconButton icon={Check} type="submit" size="sm" aria-label="Save name" disabled={busy || !editing.text.trim()} />
                    <IconButton icon={X} type="button" size="sm" aria-label="Cancel rename" onClick={() => { setEditing(null); setError('') }} />
                  </form>
                ) : (
                  <>
                    <span className={clsx('min-w-0 flex-1 truncate text-sm', item.active ? 'text-ink-800 dark:text-ink-100' : 'text-ink-400 line-through')}>{item.value}</span>
                    {!item.active && <Badge tone="neutral">Off</Badge>}
                    {usage && <Badge tone={used ? 'info' : 'neutral'}>{used ? `${used} in use` : 'Unused'}</Badge>}
                    {canEdit && (
                      <div className="flex items-center gap-0.5">
                        <IconButton icon={ArrowUp} size="sm" aria-label={`Move ${item.value} up`} disabled={busy || index === 0} onClick={() => move(index, -1)} />
                        <IconButton icon={ArrowDown} size="sm" aria-label={`Move ${item.value} down`} disabled={busy || index === list.items.length - 1} onClick={() => move(index, 1)} />
                        <IconButton icon={Pencil} size="sm" aria-label={`Rename ${item.value}`} onClick={() => { setEditing({ value: item.value, text: item.value }); setError('') }} />
                        <IconButton icon={Trash2} size="sm" aria-label={`Delete ${item.value}`} title={used ? 'In use: switch it off instead' : 'Delete'} disabled={busy || used > 0} className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setConfirm({ kind: 'delete', value: item.value })} />
                        <Switch on={item.active} label={item.active ? `Switch off ${item.value}` : `Switch on ${item.value}`} disabled={busy} onClick={() => toggle(item)} />
                      </div>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog open={confirm?.kind === 'delete'} onClose={() => setConfirm(null)} onConfirm={doConfirm} loading={busy} title={`Delete “${confirm?.value}”?`}
        description="No record uses this option, so it can be removed. This cannot be undone." confirmLabel="Delete" />
      <ConfirmDialog open={confirm?.kind === 'reset'} onClose={() => setConfirm(null)} onConfirm={doConfirm} loading={busy} tone="primary" title={`Reset ${list.label}?`}
        description="The list goes back to the built-in options. A value that records still use stays in the list, switched off, so nothing is orphaned." confirmLabel="Reset" />
    </section>
  )
}

/**
 * The dropdown / filter lists of ONE module (`keys`), each with its editor. Used by the module settings pages (Settings -> Leads, Enquiries, Deals ...): a module shows only the lists its own
 * forms and filters use. A list shared with another module (industries, cities ...) is the same list: editing it here changes it everywhere, and the note on the card says so.
 */
export function OptionLists({ keys, sharedNote = {} }) {
  const { user } = useAuth()
  const canEdit = user?.accessLevel === 'Super Admin'
  const { lists, loading, error, reload } = useOptionLists()
  const [usage, setUsage] = useState(null)
  const loadUsage = () => { if (canEdit) api.get('/options/usage').then((r) => setUsage(r.data.usage)).catch(() => setUsage(null)) }
  useEffect(() => { loadUsage() }, [lists]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !lists) return <EmptyState icon={AlertTriangle} title="Couldn’t load the options" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  if (loading) return <div className="space-y-4"><Skeleton className="h-56 w-full rounded-2xl" /><Skeleton className="h-56 w-full rounded-2xl" /></div>
  const mine = keys.map((k) => lists?.[k]).filter(Boolean)
  if (!mine.length) return <EmptyState icon={ListChecks} title="No options to configure" description="This module has no dropdown values of its own to manage." />
  return (
    <div className="space-y-4">
      {!canEdit && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">You can see these options, but only the Super Admin can change them.</p>}
      {mine.map((list) => (
        <div key={list.key}>
          {sharedNote[list.key] && <p className="mb-1.5 px-1 text-xs text-ink-400">{sharedNote[list.key]}</p>}
          <ListEditor list={list} usage={usage?.[list.key]} canEdit={canEdit} onChanged={() => { reload(); loadUsage() }} />
        </div>
      ))}
      <p className="px-1 text-xs text-ink-400">An option that records use cannot be deleted: switch it off instead (it is no longer offered for new records; existing ones keep it). Renaming updates the records that carry it.</p>
    </div>
  )
}
