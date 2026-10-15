import { useMemo, useState } from 'react'
import { Pencil, Trash2, Check, X, Tag } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button, IconButton } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { Input, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { addProductCategory, renameProductCategory, deleteProductCategory } from '../../hooks/useProducts'

const errText = (e) => e?.response?.data?.fields?.name || e?.response?.data?.message || e?.message || 'Something went wrong.'

/**
 * Manage the service categories: see every category with how many products / services it holds, add, rename and delete. The server does the work and the rules (unique names, a category
 * in use can only be deleted by moving its items to another one); every picker and filter in the app follows the change automatically.
 */
export function ProductCategoriesDialog({ open, onClose, categories, products, can }) {
  const { toast } = useToast()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { name, value }
  const [deleting, setDeleting] = useState(null) // { name, moveTo }
  const stats = useMemo(() => Object.fromEntries(categories.map((c) => {
    const items = products.filter((p) => p.category === c)
    return [c, { total: items.length, active: items.filter((p) => p.status !== 'Inactive').length }]
  })), [categories, products])

  const run = (fn, done) => { setBusy(true); setError(''); return fn().then(() => { toast(done, { type: 'success' }); return true }).catch((e) => { setError(errText(e)); return false }).finally(() => setBusy(false)) }
  const add = () => run(() => addProductCategory(newName), `Category “${newName.trim()}” added.`).then((ok) => { if (ok) setNewName('') })
  const rename = () => run(() => renameProductCategory(editing.name, editing.value), `Category renamed to “${editing.value.trim()}”.`).then((ok) => { if (ok) setEditing(null) })
  const remove = () => run(() => deleteProductCategory(deleting.name, deleting.moveTo), `Category “${deleting.name}” deleted.`).then((ok) => { if (ok) setDeleting(null) })

  return (
    <Modal open={open} onClose={onClose} size="md" title="Service categories" description="Every category products and services can be filed under. Changes apply everywhere at once."
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        {can.create && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
            <Input aria-label="New category name" value={newName} onChange={(e) => { setNewName(e.target.value); setError('') }} placeholder="New category name" maxLength={80} />
            <Button type="submit" loading={busy && !editing && !deleting} disabled={!newName.trim()}>Add</Button>
          </form>
        )}
        {!categories.length ? (
          <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-400 dark:border-ink-700">No categories yet.{can.create ? ' Add the first one above.' : ''}</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800" aria-label="Categories">
            {categories.map((c) => {
              const s = stats[c] || { total: 0, active: 0 }
              const isEditing = editing?.name === c
              const isDeleting = deleting?.name === c
              return (
                <li key={c} className="px-4 py-3">
                  {isEditing ? (
                    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename() }}>
                      <Input aria-label={`Rename ${c}`} autoFocus value={editing.value} onChange={(e) => { setEditing({ ...editing, value: e.target.value }); setError('') }} maxLength={80} />
                      <IconButton icon={Check} type="submit" size="sm" aria-label="Save name" disabled={busy || !editing.value.trim()} />
                      <IconButton icon={X} type="button" size="sm" aria-label="Cancel rename" onClick={() => { setEditing(null); setError('') }} />
                    </form>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Tag size={15} className="shrink-0 text-ink-400" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-900 dark:text-ink-50">{c}</p></div>
                      <Badge tone={s.total ? 'info' : 'neutral'}>{s.total} {s.total === 1 ? 'item' : 'items'}{s.total && s.active !== s.total ? ` · ${s.active} active` : ''}</Badge>
                      {can.edit && <IconButton icon={Pencil} size="sm" aria-label={`Rename ${c}`} onClick={() => { setEditing({ name: c, value: c }); setDeleting(null); setError('') }} />}
                      {can.delete && <IconButton icon={Trash2} size="sm" aria-label={`Delete ${c}`} className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => { setDeleting({ name: c, moveTo: '' }); setEditing(null); setError('') }} />}
                    </div>
                  )}
                  {isDeleting && (
                    <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm dark:bg-rose-900/20">
                      {s.total ? (
                        <>
                          <p className="text-rose-800 dark:text-rose-200">{s.total} {s.total === 1 ? 'product or service uses' : 'products and services use'} “{c}”. Move {s.total === 1 ? 'it' : 'them'} to another category first:</p>
                          <Select aria-label={`Move the items of ${c} to`} className="mt-2" value={deleting.moveTo} onChange={(e) => setDeleting({ ...deleting, moveTo: e.target.value })}>
                            <option value="">Choose a category…</option>
                            {categories.filter((x) => x !== c).map((x) => <option key={x}>{x}</option>)}
                          </Select>
                        </>
                      ) : <p className="text-rose-800 dark:text-rose-200">Delete “{c}”? No product or service uses it.</p>}
                      <div className="mt-3 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { setDeleting(null); setError('') }}>Cancel</Button>
                        <Button size="sm" variant="danger" loading={busy} disabled={!!s.total && !deleting.moveTo} onClick={remove}>{s.total ? 'Move and delete' : 'Delete'}</Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
