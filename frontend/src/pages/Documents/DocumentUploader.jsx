import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { UploadCloud, X, CheckCircle2, AlertTriangle, Loader2, Copy, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { VISIBILITIES, acceptAttr, extOf, sizeLabel } from '../../utils/documentRules'
import { precheck, uploadDocument, useDocConfig, errList, errText } from './documentClient'
import { FileTile } from './DocumentBits'

const STATUS = {
  queued: ['Ready', 'text-ink-500'], validating: ['Checking the file…', 'text-brand-600'], uploading: ['Uploading securely…', 'text-brand-600'], done: ['Uploaded', 'text-emerald-600'],
  rejected: ['Rejected', 'text-rose-600'], duplicate: ['Already stored', 'text-amber-600'], error: ['Failed', 'text-rose-600'],
}
const key = (f) => `${f.name}|${f.size}|${f.lastModified}|${Math.random().toString(36).slice(2, 6)}`

/**
 * Drag & drop (or browse) → validate each file on its own → upload → securely store → create the record → link the CRM record → activity log.
 * One bad file never blocks the others. `related` ({type,id}) links every upload to that record (and, through it, the whole customer → payment chain).
 */
export function DocumentUploader({ related = null, defaults = {}, extraMeta = {}, onUploaded, compact = false, disabled = false, disabledReason = '', categoryLocked = false, children }) {
  const { toast } = useToast()
  const { config, activeCategories, ready } = useDocConfig()
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [over, setOver] = useState(false)
  const [category, setCategory] = useState(defaults.category || 'Other')
  // the usual category for this record may have been switched off by an administrator — fall back to Other
  useEffect(() => { if (ready && !activeCategories.some((c) => c.name === category)) setCategory('Other') }, [ready, activeCategories]) // eslint-disable-line react-hooks/exhaustive-deps
  const [visibility, setVisibility] = useState(defaults.visibility || '')
  const [busy, setBusy] = useState(false)
  const set = (k, patch) => setItems((l) => l.map((i) => (i.key === k ? { ...i, ...patch } : i)))
  const catOptions = activeCategories

  const add = (fileList) => {
    if (disabled) return
    const files = [...fileList]
    if (!files.length) return
    setItems((cur) => {
      const room = Math.max(0, config.maxFilesPerUpload - cur.filter((i) => ['queued', 'validating', 'uploading'].includes(i.status)).length)
      const next = files.map((f, n) => (n < room ? { key: key(f), file: f, status: 'queued', progress: 0, error: '' } : { key: key(f), file: f, status: 'rejected', progress: 0, error: `At most ${config.maxFilesPerUpload} files can be uploaded at once.` }))
      return [...cur, ...next]
    })
  }

  const run = async () => {
    setBusy(true)
    const queue = items.filter((i) => i.status === 'queued')
    const made = []
    for (const it of queue) {
      set(it.key, { status: 'validating', progress: 25 })
      let check
      try { check = await precheck(it.file, config) } catch { set(it.key, { status: 'error', error: 'The file could not be read.', progress: 0 }); continue }
      if (!check.ok) { set(it.key, { status: 'rejected', error: check.errors[0], progress: 0 }); continue }
      set(it.key, { status: 'uploading', progress: 65 })
      try {
        const doc = await uploadDocument(it.file, { relatedType: related?.type, relatedId: related?.id, category, visibility: visibility || undefined, ...defaults.meta, ...extraMeta })
        made.push(doc)
        set(it.key, { status: 'done', progress: 100, doc })
      } catch (e) {
        const dup = e?.response?.status === 409
        set(it.key, { status: dup ? 'duplicate' : 'error', error: errList(e)[0] || errText(e), progress: 0, existingId: e?.response?.data?.existingId })
      }
    }
    setBusy(false)
    if (made.length) { toast(`${made.length} document${made.length === 1 ? '' : 's'} uploaded and linked.`, { type: 'success' }); onUploaded?.(made) }
  }

  const pending = items.filter((i) => i.status === 'queued').length
  const finished = items.length > 0 && !pending && !busy

  return (
    <div className="space-y-3">
      <div
        role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="Upload documents — drop files here or press Enter to browse"
        onClick={() => !disabled && inputRef.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
        className={clsx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors', compact ? 'px-4 py-5' : 'px-6 py-9',
          disabled ? 'cursor-not-allowed border-ink-200 bg-ink-50/50 opacity-70 dark:border-ink-800 dark:bg-ink-900/30' : over ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-900/20' : 'border-ink-200 bg-white hover:border-brand-400 hover:bg-brand-50/30 dark:border-ink-700 dark:bg-ink-900/40')}
      >
        <UploadCloud size={compact ? 22 : 28} className={over ? 'text-brand-600' : 'text-ink-400'} />
        <p className="mt-2 text-sm font-medium text-ink-800 dark:text-ink-100">{disabled ? (disabledReason || 'Uploading is not available') : over ? 'Drop to add' : 'Drag & drop files here, or click to browse'}</p>
        <p className="mt-0.5 text-xs text-ink-400">{config.allowedExtensions.map((e) => e.toUpperCase()).join(' · ')} — up to {config.maxSizeMb} MB each</p>
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-400"><ShieldCheck size={11} />Content is checked, not just the extension. Files are stored privately.</p>
        <input ref={inputRef} type="file" multiple accept={acceptAttr(config)} className="hidden" aria-label="Choose files to upload" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      </div>

      {items.length > 0 && (
        <div className="rounded-2xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
          {pending > 0 && (
            <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-ink-100 pb-3 dark:border-ink-800">
              <label className="text-xs font-medium text-ink-500">Category
                <Select aria-label="Category for these uploads" className="mt-1 !h-9 !w-52 text-xs" value={category} disabled={categoryLocked} onChange={(e) => setCategory(e.target.value)}>{catOptions.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
              </label>
              <label className="text-xs font-medium text-ink-500">Who can open it
                <Select aria-label="Visibility for these uploads" className="mt-1 !h-9 !w-52 text-xs" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="">Default ({config.defaultVisibility})</option>{VISIBILITIES.map((v) => <option key={v}>{v}</option>)}
                </Select>
              </label>
              {children}
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setItems([])} disabled={busy}>Clear</Button>
                <Button size="sm" icon={UploadCloud} loading={busy} onClick={run}>Upload {pending} file{pending === 1 ? '' : 's'}</Button>
              </div>
            </div>
          )}
          <ul className="space-y-2" aria-live="polite">
            {items.map((i) => {
              const [label, tone] = STATUS[i.status]
              return (
                <li key={i.key} className="flex items-center gap-3 rounded-xl bg-ink-50/70 px-3 py-2 dark:bg-ink-800/40">
                  <FileTile ext={extOf(i.file.name) || 'file'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{i.file.name}</p>
                    <p className={clsx('flex items-center gap-1 text-xs', tone)}>
                      {['validating', 'uploading'].includes(i.status) && <Loader2 size={11} className="animate-spin" />}
                      {i.status === 'done' && <CheckCircle2 size={11} />}
                      {['rejected', 'error'].includes(i.status) && <AlertTriangle size={11} />}
                      {i.status === 'duplicate' && <Copy size={11} />}
                      <span>{label}</span><span className="text-ink-400">· {sizeLabel(i.file.size)}</span>
                      {i.error && <span className="text-ink-600 dark:text-ink-300">— {i.error}</span>}
                    </p>
                    {['validating', 'uploading', 'done'].includes(i.status) && <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700" role="progressbar" aria-valuenow={i.progress} aria-valuemin={0} aria-valuemax={100}><div className={clsx('h-full rounded-full transition-all duration-300', i.status === 'done' ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${i.progress}%` }} /></div>}
                  </div>
                  {i.status !== 'uploading' && i.status !== 'validating' && <button type="button" aria-label={`Remove ${i.file.name} from the list`} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><X size={14} /></button>}
                </li>
              )
            })}
          </ul>
          {finished && <div className="mt-3 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setItems([])}>Done</Button></div>}
        </div>
      )}
    </div>
  )
}
