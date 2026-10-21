import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Download, Loader2, FileWarning, Trash2, UploadCloud, ShieldAlert, Clock } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { VISIBILITIES, VISIBILITY_HELP, acceptAttr, familyOf, extOf, sizeLabel, validateFileContent } from '../../utils/documentRules'
import { formatDate, formatDateTime } from '../../utils/format'
import { fetchFile, downloadFile, updateDocument, shareDocument, revokeShare, addVersion, useDocConfig, useFolders, errText, errList, readBytes } from './documentClient'
import { VisibilityBadge } from './DocumentBits'

// ---- preview --------------------------------------------------------------------------------------------------------
function csvRows(text, max = 200) {
  const rows = []
  let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length && rows.length < max; i += 1) {
    const ch = text[i]
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1 } else if (ch === '"') q = false; else cell += ch } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** In-app preview of the authorised file. The bytes arrive from the secured endpoint as a Blob — there is no storage URL to expose. */
export function PreviewDialog({ doc, onClose, initialVersion }) {
  const [version, setVersion] = useState(initialVersion || doc?.version)
  const [state, setState] = useState({ loading: true, error: '', url: '', text: '' })
  const urlRef = useRef('')
  const v = doc?.versions.find((x) => x.version === version)
  const fam = familyOf(extOf(v?.fileName || doc?.fileName))
  useEffect(() => { if (doc) setVersion(initialVersion || doc.version) }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!doc) return undefined
    let dead = false
    setState({ loading: true, error: '', url: '', text: '' })
    fetchFile(doc.id, { version, mode: 'preview' }).then(async ({ blob }) => {
      if (dead) return
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      if (fam === 'excel' && extOf(v?.fileName) === 'csv') { setState({ loading: false, error: '', url: '', text: await blob.text() }); return }
      if (fam === 'pdf' || fam === 'image') { urlRef.current = URL.createObjectURL(blob); setState({ loading: false, error: '', url: urlRef.current, text: '' }); return }
      setState({ loading: false, error: '', url: '', text: '' })
    }).catch(async (e) => {
      if (dead) return
      let msg = errText(e)
      if (e?.response?.data instanceof Blob) { try { msg = JSON.parse(await e.response.data.text()).message || msg } catch { /* keep msg */ } }
      setState({ loading: false, error: msg, url: '', text: '' })
    })
    return () => { dead = true }
  }, [doc?.id, version]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  const rows = useMemo(() => (state.text ? csvRows(state.text) : []), [state.text])
  if (!doc) return null
  return (
    <Modal open onClose={onClose} size="xl" title={doc.name} description={`${doc.id} · v${version}${v?.active ? ' (current)' : ' (earlier version)'} · ${v ? sizeLabel(v.size) : ''}`}
      footer={<>
        {doc.versions.length > 1 && <Select aria-label="Version to preview" className="!h-9 !w-44 text-xs" value={version} onChange={(e) => setVersion(Number(e.target.value))}>{[...doc.versions].reverse().map((x) => <option key={x.version} value={x.version}>v{x.version}{x.active ? ' — current' : ''}</option>)}</Select>}
        {doc.access.download && <Button variant="secondary" icon={Download} onClick={() => downloadFile(doc.id, { version }).catch(() => null)}>Download</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      <div className="min-h-[50vh]">
        {state.loading && <div className="flex h-[50vh] items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div>}
        {state.error && <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-center"><ShieldAlert className="text-rose-500" /><p className="text-sm text-ink-600 dark:text-ink-300">{state.error}</p></div>}
        {!state.loading && !state.error && fam === 'pdf' && state.url && <iframe title={`Preview of ${doc.name}`} src={state.url} className="h-[65vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
        {!state.loading && !state.error && fam === 'image' && state.url && <div className="flex max-h-[65vh] justify-center overflow-auto rounded-lg bg-ink-50 p-3 dark:bg-ink-950"><img src={state.url} alt={doc.name} className="max-h-[60vh] object-contain" /></div>}
        {!state.loading && !state.error && rows.length > 0 && (
          <div className="max-h-[65vh] overflow-auto rounded-lg border border-ink-100 dark:border-ink-800"><table className="crm-table w-full text-xs"><tbody>{rows.map((r, i) => <tr key={i} className={clsx('border-b border-ink-50 dark:border-ink-800/60', i === 0 && 'bg-ink-50 font-semibold dark:bg-ink-800/50')}>{r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5">{c}</td>)}</tr>)}</tbody></table></div>
        )}
        {!state.loading && !state.error && !state.url && !rows.length && (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-center"><FileWarning className="text-ink-400" size={28} /><p className="text-sm font-medium text-ink-700 dark:text-ink-200">No in-browser preview for {v?.fileName ? `.${extOf(v.fileName)}` : 'this'} files</p><p className="max-w-sm text-xs text-ink-400">Word, Excel and PowerPoint files open in their own applications.{doc.access.download ? ' Use Download to open it.' : ''}</p></div>
        )}
      </div>
    </Modal>
  )
}

// ---- new version ----------------------------------------------------------------------------------------------------
export function VersionDialog({ doc, onClose, onDone }) {
  const { toast } = useToast()
  const { config } = useDocConfig()
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { setFile(null); setNote(''); setAck(false); setErrors([]) }, [doc?.id])
  if (!doc) return null
  const contract = doc.primary?.type === 'Contract'
  const pick = async (f) => {
    setErrors([]); setFile(null)
    if (!f) return
    const bytes = await readBytes(f)
    const r = validateFileContent({ name: f.name, mime: f.type, bytes, size: f.size }, config)
    if (!r.ok) { setErrors(r.errors); return }
    setFile(f)
  }
  const go = () => {
    setBusy(true); setErrors([])
    addVersion(doc.id, file, { note, acknowledged: ack }).then((d) => { toast(`Version ${d.version} saved — earlier versions are kept.`, { type: 'success' }); onDone?.(d); onClose() }).catch((e) => setErrors(errList(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="md" title="Upload a new version" description={`${doc.name} · currently v${doc.version}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={UploadCloud} loading={busy} disabled={!file || (contract && !ack)} onClick={go}>Save as v{doc.version + 1}</Button></>}>
      <div className="space-y-4">
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-800/50">The current file is never overwritten — it stays as version {doc.version} in the history, and the new file becomes the active version.</p>
        {errors.length > 0 && <ul role="alert" className="space-y-1 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <FormField label="New file" required hint={`${config.allowedExtensions.map((e) => e.toUpperCase()).join(', ')} — max ${config.maxSizeMb} MB`}>
          <input type="file" accept={acceptAttr(config)} aria-label="New version file" onChange={(e) => pick(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700" />
          {file && <p className="mt-1 text-xs text-emerald-600">{file.name} · {sizeLabel(file.size)} — checked</p>}
        </FormField>
        <FormField label="What changed?" hint="Recorded in the version history and audit trail."><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[72px]" /></FormField>
        {contract && <label className="flex items-start gap-2 text-sm text-ink-600 dark:text-ink-300"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this replaces the contract document — a signed or active contract needs a reason above.</label>}
      </div>
    </Modal>
  )
}

// ---- edit details ---------------------------------------------------------------------------------------------------
export function EditDialog({ doc, onClose, onDone, focus }) {
  const { toast } = useToast()
  const { activeCategories } = useDocConfig()
  const { folders } = useFolders()
  const [f, setF] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (doc) { setF({ name: doc.name, category: doc.category, folderId: doc.folderId || '', visibility: doc.visibility, assignedTo: doc.assignedTo || '', description: doc.description || '', tags: (doc.tags || []).join(', '), reviewBy: doc.reviewBy || '', reviewNote: doc.reviewNote || '' }); setError('') } }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc || !f) return null
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const cats = activeCategories.some((c) => c.name === f.category) ? activeCategories : [...activeCategories, { name: f.category }]
  const confidentialLocked = (doc.visibility === 'Confidential' || f.visibility === 'Confidential') && !(doc.access.owner || doc.access.admin)
  const save = () => {
    setBusy(true); setError('')
    updateDocument(doc.id, { name: f.name, category: f.category, folderId: f.folderId || null, visibility: f.visibility, assignedTo: f.assignedTo || null, description: f.description, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), reviewBy: f.reviewBy || null, reviewNote: f.reviewNote })
      .then((d) => { toast('Document details saved.', { type: 'success' }); onDone?.(d); onClose() }).catch((e) => setError(errText(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="lg" title={focus === 'review' ? 'Review deadline' : 'Document details'} description={`${doc.id} — renaming or moving never changes its identity or its CRM links`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        {focus !== 'review' && (
          <>
            <FormField label="Name" required><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Category"><Select value={f.category} onChange={(e) => set({ category: e.target.value })}>{cats.map((c) => <option key={c.name}>{c.name}</option>)}</Select></FormField>
              <FormField label="Folder"><Select value={f.folderId} onChange={(e) => set({ folderId: e.target.value })}><option value="">No folder</option>{folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
              <FormField label="Who can open it" hint={VISIBILITY_HELP[f.visibility]}><Select value={f.visibility} disabled={confidentialLocked} onChange={(e) => set({ visibility: e.target.value })}>{VISIBILITIES.map((v) => <option key={v}>{v}</option>)}</Select></FormField>
              <FormField label="Assigned to"><Select value={f.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}><option value="">Nobody</option>{USERS.filter((u) => u.status === 'Active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            </div>
            <FormField label="Description"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[64px]" /></FormField>
            <FormField label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></FormField>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Review / action needed by" hint="Appears on the Calendar and the dashboard until cleared."><Input type="date" value={f.reviewBy} onChange={(e) => set({ reviewBy: e.target.value })} /></FormField>
          <FormField label="What needs doing?"><Input value={f.reviewNote} onChange={(e) => set({ reviewNote: e.target.value })} placeholder="e.g. Legal review" /></FormField>
        </div>
      </div>
    </Modal>
  )
}

// ---- share ----------------------------------------------------------------------------------------------------------
export function ShareDialog({ doc, onClose, onDone }) {
  const { toast } = useToast()
  const { config, me } = useDocConfig()
  const [type, setType] = useState('user')
  const [target, setTarget] = useState('')
  const [access, setAccess] = useState('download')
  const [expires, setExpires] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState(doc)
  useEffect(() => { setCurrent(doc); setTarget(''); setExpires(''); setError('') }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return null
  const confidential = current.visibility === 'Confidential'
  const depts = [...new Set(USERS.map((u) => u.department))].sort()
  const max = new Date(Date.now() + config.shareMaxDays * 86400000).toISOString().slice(0, 10)
  const min = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const go = () => {
    setBusy(true); setError('')
    shareDocument(doc.id, { targets: [{ type, targetId: target }], access, expiresAt: expires || null }).then((d) => { toast('Shared — they’ve been notified.', { type: 'success' }); setCurrent(d); setTarget(''); onDone?.(d) }).catch((e) => setError(errText(e))).finally(() => setBusy(false))
  }
  const revoke = (s) => revokeShare(doc.id, s.id).then((d) => { setCurrent(d); toast('Access removed.', { type: 'success' }); onDone?.(d) }).catch((e) => setError(errText(e)))
  const active = (current.shares || []).filter((s) => s.active)
  return (
    <Modal open onClose={onClose} size="lg" title="Share document" description={`${doc.name} — internal sharing only; no public links are created`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_9rem]">
          <FormField label="Share with"><Select aria-label="Share with" value={type} onChange={(e) => { setType(e.target.value); setTarget('') }}><option value="user">A person</option><option value="team">A team</option></Select></FormField>
          <FormField label={type === 'user' ? 'Person' : 'Team'}>
            <Select aria-label="Share target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {type === 'user' ? USERS.filter((u) => u.status === 'Active' && u.id !== me?.id).map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>) : depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </FormField>
          <FormField label="Access"><Select aria-label="Access level" value={access} onChange={(e) => setAccess(e.target.value)}><option value="view">View only</option><option value="download">View & download</option><option value="edit">Can edit</option></Select></FormField>
        </div>
        <FormField label={`Access expires${confidential ? '' : ' (optional)'}`} required={confidential} hint={confidential ? 'Confidential documents can only be shared for a limited time.' : `Up to ${config.shareMaxDays} days.`}>
          <Input type="date" aria-label="Access expiry" min={min} max={max} value={expires} onChange={(e) => setExpires(e.target.value)} className="max-w-[12rem]" />
        </FormField>
        <div className="flex justify-end"><Button loading={busy} disabled={!target || (confidential && !expires)} onClick={go}>Share</Button></div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Who has access ({active.length})</p>
          {!(current.shares || []).length ? <p className="text-sm text-ink-400">Not shared with anyone yet.</p> : (
            <ul className="divide-y divide-ink-50 rounded-xl border border-ink-100 dark:divide-ink-800/60 dark:border-ink-800">
              {current.shares.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-800 dark:text-ink-100">{s.targetName || s.targetId}{s.type === 'team' ? ' team' : ''}</p>
                    <p className="text-xs text-ink-400">{s.access === 'edit' ? 'Can edit' : s.access === 'download' ? 'View & download' : 'View only'} · by {s.byName} · {formatDate(s.at)}{s.expiresAt ? ` · ${s.expired ? 'expired' : 'expires'} ${formatDate(s.expiresAt)}` : ' · no expiry'}</p></div>
                  {s.revokedAt ? <span className="text-xs text-ink-400">Removed</span> : s.expired ? <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Clock size={12} />Expired</span> : <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove access for ${s.targetName || s.targetId}`} onClick={() => revoke(s)}>Remove</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---- task chooser ---------------------------------------------------------------------------------------------------
export const DOC_TASK_PRESETS = [
  ['Review Contract', 'Review contract'], ['Verify KYC Document', 'Verify KYC document'], ['Approve Proposal', 'Approve proposal'], ['Review Technical Document', 'Review technical document'],
  ['Collect Missing Document', 'Collect missing document'], ['Send Document to Client', 'Send document to client'], ['Custom', ''],
]
export function TaskPresetDialog({ doc, onClose, onPick }) {
  if (!doc) return null
  return (
    <Modal open onClose={onClose} size="sm" title="Create a task from this document" description={`${doc.id} · ${doc.name}`} footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="grid gap-2">
        {DOC_TASK_PRESETS.map(([label, title]) => <button key={label} type="button" onClick={() => onPick(title ? `${title}: ${doc.name}` : '')} className="rounded-xl border border-ink-100 px-4 py-2.5 text-left text-sm font-medium text-ink-800 hover:border-brand-300 hover:bg-brand-50/40 dark:border-ink-800 dark:text-ink-100 dark:hover:bg-ink-800">{label === 'Custom' ? 'Another task…' : label}</button>)}
        <p className="text-xs text-ink-400">The task is linked to this document, its customer, company and related records, and appears on the Tasks page and the Calendar.</p>
      </div>
    </Modal>
  )
}

export { VisibilityBadge, formatDateTime }
