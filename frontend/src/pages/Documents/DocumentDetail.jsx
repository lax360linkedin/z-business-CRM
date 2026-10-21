import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Eye, Download, UploadCloud, Pencil, Share2, ListPlus, CalendarClock, ShieldAlert, FileX2, History, RotateCcw, Lock, ExternalLink, Info, ClipboardList, Activity as ActivityIcon, Trash2, Archive } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { FAMILY_LABEL, familyOf, sizeLabel, VISIBILITY_HELP } from '../../utils/documentRules'
import { formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { fetchDocument, fetchAudit, restoreVersion, errText } from './documentClient'
import { useDocumentActions } from './DocumentActions'
import { FileTile, VisibilityBadge, VersionTag, DocStatus } from './DocumentBits'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const TONE = { Uploaded: 'bg-emerald-50 text-emerald-600', 'New version': 'bg-brand-50 text-brand-600', Viewed: 'bg-sky-50 text-sky-600', Downloaded: 'bg-sky-50 text-sky-600', Shared: 'bg-violet-50 text-violet-600', Deleted: 'bg-rose-50 text-rose-600', Restored: 'bg-emerald-50 text-emerald-600' }

export default function DocumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [doc, setDoc] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | missing
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [audit, setAudit] = useState(null)
  const [auditError, setAuditError] = useState('')
  const load = useCallback(() => {
    fetchDocument(id).then((d) => { setDoc(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data.filter((a) => a.documentId === id || a.links?.documentId === id))).catch(() => {})
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks((r.data.items || r.data).filter((t) => t.links?.documentId === id || (t.relatedType === 'Document' && t.relatedId === id)))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { window.addEventListener('crm:documents-changed', load); window.addEventListener('crm:tasks-changed', load); return () => { window.removeEventListener('crm:documents-changed', load); window.removeEventListener('crm:tasks-changed', load) } }, [load])
  const actions = useDocumentActions({ onChanged: load, onDeleted: (d) => { if (d.status === 'Deleted' && doc?.access?.restore) return; navigate('/documents') } })
  useEffect(() => {
    if (tab !== 'audit' || !doc?.access?.viewAudit) return
    setAudit(null); setAuditError('')
    fetchAudit(id).then(setAudit).catch((e) => setAuditError(errText(e)))
  }, [tab, id, doc?.access?.viewAudit, doc?.updatedAt])

  const timeline = useMemo(() => {
    const out = activities.map((a) => ({ key: a.id, at: a.date, type: a.attachmentAction || 'Updated', text: a.subject, by: a.by }))
    tasks.forEach((t) => out.push({ key: `t-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy, href: `/tasks/${t.id}` }))
    if (doc?.reviewBy) out.push({ key: 'review', at: doc.updatedAt, type: 'Review', text: `Review deadline set for ${formatDate(doc.reviewBy)}${doc.reviewNote ? ` — ${doc.reviewNote}` : ''}`, by: doc.updatedBy })
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [activities, tasks, doc])

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !doc) return <EmptyState icon={FileX2} title="Document not found" description="It may have been deleted, or you may not have access to it." action={<Button variant="secondary" onClick={() => navigate('/documents')}>Back to Documents</Button>} />

  const a = doc.access
  const cur = doc.versions.find((v) => v.active) || doc.versions[doc.versions.length - 1]
  const trashed = doc.status === 'Deleted'
  const overdue = doc.reviewBy && doc.reviewBy < new Date().toISOString().slice(0, 10)
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'versions', label: 'Versions', count: doc.versions.length }, { value: 'activity', label: 'Activity', count: timeline.length }, { value: 'tasks', label: 'Tasks', count: tasks.length }, ...(a.viewAudit ? [{ value: 'audit', label: 'Access & audit' }] : [])]
  const doRestore = (v) => restoreVersion(doc.id, v.version).then((d) => { toast(`Version ${v.version} restored as v${d.version}.`, { type: 'success' }); load() }).catch((e) => toast(errText(e), { type: 'error' }))

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Documents', href: '/documents' }, { label: doc.id }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <Link to="/documents" aria-label="Back to documents" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <FileTile ext={doc.fileType} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{doc.id}</span><VersionTag doc={doc} /><VisibilityBadge value={doc.visibility} /><DocStatus status={doc.status} />{a.shareLevel && !a.owner && <Badge tone="info">Shared with you · {a.shareLevel}</Badge>}{doc.managedBy && <Badge>Managed by quotation</Badge>}{overdue && <Badge tone="danger">Review overdue</Badge>}</div>
            <h1 className="mt-2 break-words text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{doc.name}</h1>
            <p className="mt-1 text-sm text-ink-500">{doc.category} · {FAMILY_LABEL[familyOf(doc.fileType)] || doc.fileType.toUpperCase()} · {sizeLabel(doc.sizeBytes)} · uploaded by {doc.uploaderName || '—'} {timeAgo(doc.uploadedDate)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!trashed && a.preview && <Button icon={Eye} onClick={() => actions.run('preview', doc)}>Preview</Button>}
          {!trashed && a.download && <Button variant="secondary" icon={Download} onClick={() => actions.run('download', doc)}>Download</Button>}
          {!trashed && a.replace && <Button variant="secondary" icon={UploadCloud} onClick={() => actions.run('version', doc)}>New version</Button>}
          {!trashed && a.editDetails && <Button variant="secondary" icon={Pencil} onClick={() => actions.run('edit', doc)}>Edit</Button>}
          {!trashed && a.share && <Button variant="secondary" icon={Share2} onClick={() => actions.run('share', doc)}>Share</Button>}
          {!trashed && a.createTask && <Button variant="secondary" icon={ListPlus} onClick={() => actions.run('task', doc)}>Create task</Button>}
          {!trashed && a.editDetails && <Button variant="secondary" icon={CalendarClock} onClick={() => actions.run('review', doc)}>Review deadline</Button>}
          {!trashed && a.editDetails && doc.status === 'Active' && <Button variant="ghost" icon={Archive} onClick={() => actions.run('archive', doc)}>Archive</Button>}
          {!trashed && a.editDetails && doc.status === 'Archived' && <Button variant="secondary" onClick={() => actions.run('unarchive', doc)}>Make active</Button>}
          {!trashed && a.delete && <Button variant="ghost" icon={Trash2} onClick={() => actions.run('delete', doc)} aria-label="Delete document" />}
          {trashed && a.restore && <Button icon={RotateCcw} onClick={() => actions.run('restore', doc)}>Restore</Button>}
          {trashed && a.purge && <Button variant="danger" onClick={() => actions.run('purge', doc)}>Delete permanently</Button>}
        </div>
        {trashed && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">This document is in the bin{doc.purgeAfter ? ` and will be permanently removed after ${formatDate(doc.purgeAfter)}` : ''}. {a.restore ? 'You can restore it.' : ''}</p>}
        {doc.status === 'Archived' && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Archived documents are read-only. Make it active again to upload a new version.</p>}
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Card title="Document information"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
              <KV k="Document name">{doc.name}</KV><KV k="Document ID"><span className="font-mono">{doc.id}</span></KV><KV k="Current file">{cur?.fileName}</KV><KV k="Category">{doc.category}</KV>{doc.subCategory && <KV k="Original label">{doc.subCategory}</KV>}
              <KV k="File type">{FAMILY_LABEL[familyOf(doc.fileType)] || '—'} (.{doc.fileType})</KV><KV k="File size">{sizeLabel(doc.sizeBytes)}</KV><KV k="Uploaded by">{doc.uploaderName}</KV><KV k="Uploaded">{formatDateTime(doc.uploadedDate)}</KV>
              <KV k="Last updated">{formatDateTime(doc.updatedAt)}{doc.updatedByName ? ` by ${doc.updatedByName}` : ''}</KV><KV k="Current version">v{doc.version} of {doc.versions.length}</KV><KV k="Visibility">{doc.visibility}</KV><KV k="Status">{doc.status}</KV>
              {doc.assignedToName && <KV k="Assigned to">{doc.assignedToName}</KV>}{doc.reviewBy && <KV k="Review by"><span className={overdue ? 'text-rose-600' : ''}>{formatDate(doc.reviewBy)}{doc.reviewNote ? ` — ${doc.reviewNote}` : ''}</span></KV>}
            </dl>
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 dark:bg-ink-800/50"><Lock size={13} className="mt-0.5 shrink-0" />{VISIBILITY_HELP[doc.visibility]} The file itself is kept in private storage and is only delivered after your access is checked.</p>
              {doc.description && <p className="mt-3 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{doc.description}</p>}
              {(doc.tags || []).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{doc.tags.map((t) => <span key={t} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">#{t}</span>)}</div>}
            </Card>
          </div>
          <div className="min-w-0 space-y-5">
            <Card title="Related records">
              {!doc.related.length ? <p className="text-sm text-ink-400">General document — not linked to a CRM record.</p> : (
                <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
                  {doc.related.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="text-ink-400">{r.type}{doc.primary?.type === r.type ? ' · uploaded from' : ''}</span>
                      {r.restricted ? <span className="inline-flex items-center gap-1 text-xs text-ink-400"><ShieldAlert size={12} />Restricted</span> : <Link to={r.href} className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-brand-700 hover:underline dark:text-brand-300">{r.label}<ExternalLink size={11} /></Link>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-ink-400">Links are filled in automatically from the record the document was uploaded on. Renaming or moving the document never changes them.</p>
            </Card>
            <Card title="Sharing" action={a.share && !trashed ? <Button size="sm" variant="secondary" icon={Share2} onClick={() => actions.run('share', doc)}>Manage</Button> : null}>
              {a.viewShares ? (
                (doc.shares || []).filter((s) => s.active).length ? <ul className="space-y-2 text-sm">{doc.shares.filter((s) => s.active).map((s) => <li key={s.id} className="flex justify-between gap-3"><span className="truncate">{s.targetName}{s.type === 'team' ? ' team' : ''}</span><span className="shrink-0 text-xs text-ink-400">{s.access}{s.expiresAt ? ` · until ${formatDate(s.expiresAt)}` : ''}</span></li>)}</ul> : <p className="text-sm text-ink-400">Not shared with anyone beyond its visibility setting.</p>
              ) : <p className="text-sm text-ink-400">Sharing details are visible to the owner and administrators.</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'versions' && (
        <Card title="Version history" action={!trashed && a.replace ? <Button size="sm" icon={UploadCloud} onClick={() => actions.run('version', doc)}>New version</Button> : null}>
          <ol className="space-y-3">
            {[...doc.versions].reverse().map((v) => (
              <li key={v.version} className={clsx('rounded-xl border px-4 py-3', v.active ? 'border-brand-200 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-900/10' : 'border-ink-100 dark:border-ink-800')}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md bg-white px-2 py-0.5 text-sm font-bold text-ink-800 ring-1 ring-ink-100 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700">v{v.version}</span>
                  {v.active ? <Badge tone="success">Current version</Badge> : <Badge>Superseded</Badge>}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800 dark:text-ink-100">{v.fileName}</span>
                  <span className="text-xs text-ink-400">{sizeLabel(v.size)}</span>
                  <div className="flex gap-1">
                    {a.preview && !trashed && <Button size="sm" variant="ghost" icon={Eye} onClick={() => actions.run('preview', doc, v.version)}>Preview</Button>}
                    {a.download && !trashed && <Button size="sm" variant="ghost" icon={Download} onClick={() => actions.run('download', doc, v.version)}>Download</Button>}
                    {a.manageVersions && !v.active && <Button size="sm" variant="ghost" icon={History} onClick={() => doRestore(v)}>Restore</Button>}
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-500">Uploaded by {v.byName || getUserById(v.by)?.name || '—'} · {formatDateTime(v.at)}{v.previousVersion ? ` · replaces v${v.previousVersion}` : ' · first version'}{v.restoredFrom ? ` · restored from v${v.restoredFrom}` : ''}</p>
                {v.note && <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">{v.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {tab === 'activity' && (
        <Card title="Activity timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          {!timeline.length ? <EmptyState icon={ActivityIcon} title="No activity yet" description="Uploads, new versions, downloads, sharing and tasks appear here." /> : (
            <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
              {timeline.map((e) => (
                <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span>
                  <div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p><p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{getUserById(e.by)?.name || '—'} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'tasks' && (
        <Card title="Tasks about this document" action={!trashed && a.createTask ? <Button size="sm" icon={ListPlus} onClick={() => actions.run('task', doc)}>Create task</Button> : null}>
          {!tasks.length ? <EmptyState icon={ClipboardList} title="No tasks yet" description="Create a task to review, verify, approve, collect or send this document. It’s linked to the document and its customer, and appears on the Calendar." /> : (
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul>
          )}
        </Card>
      )}

      {tab === 'audit' && a.viewAudit && (
        <Card title="Access & audit history" action={<span className="inline-flex items-center gap-1 text-xs text-ink-400"><Info size={12} />Read-only — nobody can edit this trail</span>}>
          {auditError ? <p className="text-sm text-rose-600">{auditError}</p> : !audit ? <CardSkeleton className="h-40" /> : !audit.length ? <p className="text-sm text-ink-400">No audited events yet.</p> : (
            <div className="overflow-x-auto"><table className="crm-table w-full text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2 pr-3">When</th><th className="pb-2 pr-3">User</th><th className="pb-2 pr-3">Action</th><th className="pb-2 pr-3">Ver.</th><th className="pb-2 pr-3">Result</th><th className="pb-2">Details</th></tr></thead>
              <tbody>{audit.map((e) => <tr key={e.id} className="border-b border-ink-50 align-top dark:border-ink-800/60"><td className="whitespace-nowrap py-2 pr-3 text-xs text-ink-500">{formatDateTime(e.at)}</td><td className="py-2 pr-3">{e.byName}<span className="block text-[11px] text-ink-400">{e.role || 'System'}</span></td><td className="py-2 pr-3">{e.action}</td><td className="py-2 pr-3 text-xs">{e.version ? `v${e.version}` : '—'}</td><td className="py-2 pr-3"><Badge tone={e.result === 'Success' ? 'success' : 'danger'}>{e.result}</Badge></td><td className="py-2 text-xs text-ink-500">{e.details}{e.relatedType ? ` · ${e.relatedType} ${e.relatedId}` : ''}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}
      {actions.dialogs}
    </div>
  )
}
