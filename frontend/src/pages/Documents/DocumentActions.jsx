import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Download, UploadCloud, Pencil, Share2, ListPlus, CalendarClock, Copy, ExternalLink, Archive, ArchiveRestore, Trash2, RotateCcw, History, MoreHorizontal, FolderInput, XCircle, Info } from 'lucide-react'
import { Dropdown, DropdownItem, DropdownDivider } from '../../components/common/Dropdown'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { primaryLinkOf } from './documentLinks'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { PreviewDialog, VersionDialog, EditDialog, ShareDialog, TaskPresetDialog } from './DocumentDialogs'
import { downloadFile, updateDocument, deleteDocument, restoreDocument, purgeDocument, errText } from './documentClient'

/**
 * One place for every document action. `run(action, doc)` opens the right dialog or performs the call; `dialogs` must be rendered once by the host.
 * Which actions exist for a document comes from `doc.access`, computed by the API for the signed-in user — nothing is shown that would be refused.
 */
export function useDocumentActions({ onChanged, onDeleted } = {}) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [dlg, setDlg] = useState(null) // { kind, doc, ... }
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setDlg(null); setReason('') }
  const changed = (d, m) => { if (m) toast(m, { type: 'success' }); onChanged?.(d) }
  const fail = (e) => toast(errText(e), { type: 'error' })

  const run = (action, doc, extra) => {
    switch (action) {
      case 'open': navigate(`/documents/${doc.id}`); break
      case 'preview': setDlg({ kind: 'preview', doc, version: extra }); break
      case 'download': downloadFile(doc.id, extra ? { version: extra } : undefined).then(() => onChanged?.(doc)).catch(fail); break
      case 'version': setDlg({ kind: 'version', doc }); break
      case 'edit': setDlg({ kind: 'edit', doc }); break
      case 'review': setDlg({ kind: 'edit', doc, focus: 'review' }); break
      case 'share': setDlg({ kind: 'share', doc }); break
      case 'task': setDlg({ kind: 'taskpick', doc }); break
      case 'copy': {
        const text = `${doc.id} — ${window.location.origin}/documents/${doc.id}`
        ;(navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('Reference copied.', { type: 'success' })).catch(() => toast(`Reference: ${text}`, { type: 'info' }))
        break
      }
      case 'related': { const l = primaryLinkOf(doc); if (l?.href) navigate(l.href); break }
      case 'archive': updateDocument(doc.id, { status: 'Archived' }).then((d) => changed(d, 'Archived — it is now read-only.')).catch(fail); break
      case 'unarchive': updateDocument(doc.id, { status: 'Active' }).then((d) => changed(d, 'Document is active again.')).catch(fail); break
      case 'delete': setDlg({ kind: 'delete', doc }); break
      case 'restore': restoreDocument(doc.id).then((d) => changed(d, 'Document restored.')).catch(fail); break
      case 'purge': setDlg({ kind: 'purge', doc }); break
      default: break
    }
  }

  const dialogs = (
    <>
      {dlg?.kind === 'preview' && <PreviewDialog doc={dlg.doc} initialVersion={dlg.version} onClose={close} />}
      {dlg?.kind === 'version' && <VersionDialog doc={dlg.doc} onClose={close} onDone={(d) => changed(d)} />}
      {dlg?.kind === 'edit' && <EditDialog doc={dlg.doc} focus={dlg.focus} onClose={close} onDone={(d) => changed(d)} />}
      {dlg?.kind === 'share' && <ShareDialog doc={dlg.doc} onClose={close} onDone={(d) => onChanged?.(d)} />}
      {dlg?.kind === 'taskpick' && <TaskPresetDialog doc={dlg.doc} onClose={close} onPick={(title) => setDlg({ kind: 'task', doc: dlg.doc, title })} />}
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={close} related={{ type: 'Document', id: dlg.doc.id, label: `${dlg.doc.id} · ${dlg.doc.name}` }} preset={{ title: dlg.title, description: `Document ${dlg.doc.id} (${dlg.doc.category})` }} onSaved={() => { toast('Task created and linked to the document.', { type: 'success' }); onChanged?.(dlg.doc) }} />}
      {dlg?.kind === 'delete' && (
        <Modal open onClose={close} size="sm" title="Delete this document?" description={`${dlg.doc.id} · ${dlg.doc.name}`}
          footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} icon={Trash2} onClick={() => { setBusy(true); deleteDocument(dlg.doc.id, reason).then((d) => { close(); changed(d, 'Moved to the bin — recoverable until it is purged.'); onDeleted?.(d) }).catch(fail).finally(() => setBusy(false)) }}>Move to bin</Button></>}>
          <div className="space-y-3"><p className="text-sm text-ink-600 dark:text-ink-300">It leaves the CRM record’s list but nothing is destroyed yet: the file and all {dlg.doc.versions.length} version(s) are kept in the bin for the retention period and can be restored.</p>
            <Textarea aria-label="Reason for deleting" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" /></div>
        </Modal>
      )}
      <ConfirmDialog open={dlg?.kind === 'purge'} onClose={close} loading={busy} title={`Permanently delete ${dlg?.doc?.id}?`} description="The file and every version are erased from storage and cannot be recovered. The audit trail keeps a record that this happened." confirmLabel="Delete permanently"
        onConfirm={() => { setBusy(true); purgeDocument(dlg.doc.id).then(() => { const d = dlg.doc; close(); toast('Permanently deleted.', { type: 'success' }); onChanged?.(d); onDeleted?.(d) }).catch(fail).finally(() => setBusy(false)) }} />
    </>
  )
  return { run, dialogs }
}

/** The ⋯ menu. Only actions the API says the caller may perform are listed. */
export function DocumentMenu({ doc, run, align = 'right' }) {
  const a = doc.access
  const rel = primaryLinkOf(doc)
  const trashed = doc.status === 'Deleted'
  return (
    <Dropdown align={align} width="w-56" trigger={<button type="button" aria-label={`Actions for ${doc.name}`} onClick={(e) => e.stopPropagation()} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><MoreHorizontal size={16} /></button>}>
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownItem icon={Info} onClick={() => run('open', doc)}>Open details</DropdownItem>
        {!trashed && a.preview && <DropdownItem icon={Eye} onClick={() => run('preview', doc)}>Preview</DropdownItem>}
        {!trashed && a.download && <DropdownItem icon={Download} onClick={() => run('download', doc)}>Download</DropdownItem>}
        {!trashed && a.replace && <DropdownItem icon={UploadCloud} onClick={() => run('version', doc)}>Upload new version</DropdownItem>}
        {!trashed && a.editDetails && <DropdownItem icon={Pencil} onClick={() => run('edit', doc)}>Rename / edit details</DropdownItem>}
        {!trashed && a.editDetails && <DropdownItem icon={FolderInput} onClick={() => run('edit', doc)}>Move category / folder</DropdownItem>}
        {!trashed && a.editDetails && <DropdownItem icon={CalendarClock} onClick={() => run('review', doc)}>Set review deadline</DropdownItem>}
        {!trashed && a.share && <DropdownItem icon={Share2} onClick={() => run('share', doc)}>Share…</DropdownItem>}
        {!trashed && a.createTask && <DropdownItem icon={ListPlus} onClick={() => run('task', doc)}>Create task</DropdownItem>}
        <DropdownItem icon={Copy} onClick={() => run('copy', doc)}>Copy reference</DropdownItem>
        {rel?.href && <DropdownItem icon={ExternalLink} onClick={() => run('related', doc)}>Open {rel.type.toLowerCase()}</DropdownItem>}
        {!trashed && <DropdownItem icon={History} onClick={() => run('open', doc)}>Version history</DropdownItem>}
        {(a.editDetails || a.delete || a.restore || a.purge) && <DropdownDivider />}
        {!trashed && a.editDetails && doc.status === 'Active' && <DropdownItem icon={Archive} onClick={() => run('archive', doc)}>Archive</DropdownItem>}
        {!trashed && a.editDetails && doc.status === 'Archived' && <DropdownItem icon={ArchiveRestore} onClick={() => run('unarchive', doc)}>Make active again</DropdownItem>}
        {!trashed && a.delete && <DropdownItem icon={Trash2} danger onClick={() => run('delete', doc)}>Delete</DropdownItem>}
        {trashed && a.restore && <DropdownItem icon={RotateCcw} onClick={() => run('restore', doc)}>Restore</DropdownItem>}
        {trashed && a.purge && <DropdownItem icon={XCircle} danger onClick={() => run('purge', doc)}>Delete permanently</DropdownItem>}
      </div>
    </Dropdown>
  )
}
