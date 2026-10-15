import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { UploadCloud, Eye, Download, FolderOpen, AlertTriangle, ChevronDown, Search, Link2 } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Select } from '../../components/common/FormField'
import { getUserById } from '../../data/users'
import { sizeLabel } from '../../utils/documentRules'
import { formatDate } from '../../utils/format'
import { useDocuments, useDocConfig } from './documentClient'
import { DocumentUploader } from './DocumentUploader'
import { DocumentMenu, useDocumentActions } from './DocumentActions'
import { FileTile, VisibilityBadge, VersionTag, DocStatus } from './DocumentBits'
import { sourceLabel } from './documentLinks'

/**
 * The Documents tab of any CRM record. It shows the SAME document records the Documents module holds (no copies): everything linked to this
 * record, including documents uploaded on records further along the chain (a customer sees its contracts' and orders' documents, subject to
 * each document's own access rules). Uploads made here are linked to this record and, through it, to the whole chain automatically.
 */
export function DocumentsPanel({ relatedType, relatedId, title = 'Documents', defaultCategory = 'Other', paymentOptions = [], uploadMeta, canUploadHere = true, uploadHint = '', autoOpen = false }) {
  const { docs, error, reload } = useDocuments({ relatedType, relatedId })
  const { has, ready } = useDocConfig()
  const actions = useDocumentActions({ onChanged: reload })
  const [open, setOpen] = useState(!!autoOpen)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('all')
  const [attachTo, setAttachTo] = useState('')
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (docs || []).filter((d) => (scope === 'all' || d.primary?.id === relatedId)).filter((d) => !needle || `${d.id} ${d.name} ${d.category} ${d.uploaderName}`.toLowerCase().includes(needle))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }, [docs, q, scope, relatedId])
  const related = attachTo ? { type: 'Payment', id: attachTo } : { type: relatedType, id: relatedId }
  const canUpload = ready && has('upload') && canUploadHere

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load documents" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" /><input aria-label="Search these documents" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-8 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100" /></div>
        <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="Which documents">
          {[['all', 'All related'], ['own', 'This record only']].map(([k, l]) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={clsx('rounded-md px-2.5 py-1.5 font-medium', scope === k ? 'bg-brand-600 text-white' : 'text-ink-500')}>{l}</button>)}
        </div>
        <Link to="/documents" className="text-xs font-medium text-brand-600 hover:underline">Open Documents module</Link>
        {canUpload && <Button className="ml-auto" size="sm" icon={open ? ChevronDown : UploadCloud} onClick={() => setOpen((o) => !o)}>{open ? 'Hide upload' : 'Upload documents'}</Button>}
      </div>

      {open && canUpload && (
        <DocumentUploader related={related} defaults={{ category: defaultCategory }} extraMeta={uploadMeta} onUploaded={() => reload()}>
          {paymentOptions.length > 0 && (
            <label className="text-xs font-medium text-ink-500">Attach to
              <Select aria-label="Attach to" className="mt-1 !h-9 !w-56 text-xs" value={attachTo} onChange={(e) => setAttachTo(e.target.value)}><option value="">This {relatedType.toLowerCase()}</option>{paymentOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            </label>
          )}
        </DocumentUploader>
      )}
      {uploadHint && open && <p className="text-xs text-ink-400">{uploadHint}</p>}

      {!docs ? <CardSkeleton className="h-40" /> : !list.length ? (
        <EmptyState icon={FolderOpen} title={docs.length ? 'No documents match' : 'No documents yet'} description={docs.length ? 'Change the search or the scope.' : canUpload ? 'Upload a file — it is linked to this record automatically.' : 'Nothing has been uploaded for this record, or you don’t have access to what has.'} action={!docs.length && canUpload && !open && <Button icon={UploadCloud} onClick={() => setOpen(true)}>Upload documents</Button>} />
      ) : (
        <ul className="divide-y divide-ink-50 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:divide-ink-800/60 dark:border-ink-800 dark:bg-ink-900">
          {list.map((d) => {
            const own = d.primary?.id === relatedId && d.primary?.type === relatedType
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <FileTile ext={d.fileType} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/documents/${d.id}`} className="truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline dark:text-ink-50">{d.name}</Link>
                    <VersionTag doc={d} /><VisibilityBadge value={d.visibility} compact />{d.status !== 'Active' && <DocStatus status={d.status} />}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
                    <span>{d.id}</span><span>{d.category}</span><span>{sizeLabel(d.sizeBytes)}</span><span>{getUserById(d.uploadedBy)?.name || d.uploaderName} · {formatDate(d.updatedAt)}</span>
                    {!own && <span className="inline-flex items-center gap-1 text-brand-600"><Link2 size={10} />{sourceLabel(d)}</span>}
                    {d.reviewBy && <span className="text-amber-600">Review by {formatDate(d.reviewBy)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {d.access.preview && <button type="button" aria-label={`Preview ${d.name}`} onClick={() => actions.run('preview', d)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Eye size={16} /></button>}
                  {d.access.download && <button type="button" aria-label={`Download ${d.name}`} onClick={() => actions.run('download', d)} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"><Download size={16} /></button>}
                  <DocumentMenu doc={d} run={actions.run} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-ink-400">{title}: these are the central document records, not copies — open one to see its versions, sharing and audit history.</p>
      {actions.dialogs}
    </div>
  )
}
