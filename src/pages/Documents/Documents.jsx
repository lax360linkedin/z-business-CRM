import { useMemo, useRef, useState } from 'react'
import {
  Upload, Download, Eye, FileText, FileSpreadsheet, FileImage, Archive, File as FileIcon,
  Presentation, Trash2, Folder,
} from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { DataTable } from '../../components/common/DataTable'
import { Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { DOCUMENT_CATEGORIES } from '../../data/constants'
import { getUserById } from '../../data/users'
import { formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'

const FILE_ICONS = {
  pdf: FileText, docx: FileText, doc: FileText, txt: FileText,
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  pptx: Presentation, ppt: Presentation,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage,
  zip: Archive, rar: Archive,
}

function fileExt(name) {
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function fileSizeLabel(kb) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

export default function Documents() {
  const crud = useCrud('documents', { searchFields: ['name', 'relatedTo'], pageSize: 10 })
  const [previewDoc, setPreviewDoc] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [uploadCategory, setUploadCategory] = useState(DOCUMENT_CATEGORIES[0])
  const fileRef = useRef(null)
  const { toast } = useToast()
  const { user } = useAuth()

  const activeCategory = crud.filters.category || 'all'
  const setActiveCategory = (c) => crud.setFilters((f) => ({ ...f, category: c === 'all' ? '' : c }))

  const categoryCounts = useMemo(() => {
    const counts = {}
    crud.allItems.forEach((d) => { counts[d.category] = (counts[d.category] || 0) + 1 })
    return counts
  }, [crud.allItems])

  const recentFiles = useMemo(() =>
    [...crud.allItems].sort((a, b) => new Date(b.uploadedDate) - new Date(a.uploadedDate)).slice(0, 5),
  [crud.allItems])

  const handleUploadClick = () => fileRef.current?.click()

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    crud.create({
      id: genId('DOC'),
      name: file.name,
      category: uploadCategory,
      fileType: fileExt(file.name),
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      relatedTo: 'Unassigned',
      relatedCustomerId: null,
      uploadedBy: user?.id,
      uploadedDate: new Date().toISOString().slice(0, 10),
    }).then(() => {
      toast(`"${file.name}" uploaded successfully.`, { type: 'success' })
    })
    e.target.value = ''
  }

  const handleDownload = () => {
    toast('This is a demo document — no file is attached.', { type: 'info' })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`"${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const columns = [
    {
      key: 'name', header: 'Name', sortable: true,
      render: (row) => {
        const Icon = FILE_ICONS[row.fileType] || FileIcon
        return (
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
              <Icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
              <p className="text-xs text-ink-400">{fileSizeLabel(row.sizeKb)}</p>
            </div>
          </div>
        )
      },
    },
    { key: 'category', header: 'Category', render: (row) => <Badge tone="neutral">{row.category}</Badge> },
    { key: 'relatedTo', header: 'Related To' },
    {
      key: 'uploadedBy', header: 'Uploaded By',
      render: (row) => {
        const u = getUserById(row.uploadedBy)
        return u ? (
          <div className="flex items-center gap-2">
            <Avatar name={u.name} size="xs" />
            <span>{u.name.split(' ')[0]}</span>
          </div>
        ) : '—'
      },
    },
    { key: 'uploadedDate', header: 'Uploaded', sortable: true, render: (row) => formatDate(row.uploadedDate) },
    {
      key: 'actions', header: '', headerClassName: 'w-24',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => setPreviewDoc(row)} />
          <IconButton icon={Download} size="sm" onClick={handleDownload} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Centralized library for contracts, proposals, invoices, and client files."
        actions={
          <>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelected} />
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              title="Category for next upload"
              className="h-9 rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200"
            >
              {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button icon={Upload} onClick={handleUploadClick}>Upload</Button>
          </>
        }
      />

      {recentFiles.length > 0 && (
        <div className="mb-5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Recent Files</p>
          <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-1">
            {recentFiles.map((d) => {
              const Icon = FILE_ICONS[d.fileType] || FileIcon
              return (
                <button
                  key={d.id}
                  onClick={() => setPreviewDoc(d)}
                  className="flex w-48 shrink-0 flex-col items-start gap-2 rounded-xl border border-ink-100 bg-white p-3.5 text-left shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                    <Icon size={16} />
                  </span>
                  <p className="line-clamp-2 text-xs font-medium text-ink-800 dark:text-ink-100">{d.name}</p>
                  <p className="text-[11px] text-ink-400">{formatDate(d.uploadedDate)}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[200px_1fr]">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <button
            onClick={() => setActiveCategory('all')}
            className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${activeCategory === 'all' ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'}`}
          >
            <span className="flex items-center gap-2"><Folder size={15} /> All Files</span>
            <span className="text-xs text-ink-400">{crud.allItems.length}</span>
          </button>
          {DOCUMENT_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${activeCategory === c ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'}`}
            >
              <span className="flex items-center gap-2"><Folder size={15} /> {c}</span>
              <span className="text-xs text-ink-400">{categoryCounts[c] || 0}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="mb-4">
            <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search documents by name…" className="w-full max-w-xs" />
          </div>
          <DataTable
            columns={columns}
            data={crud.items}
            loading={crud.loading}
            onRowClick={(row) => setPreviewDoc(row)}
            sort={crud.sort}
            onSortChange={crud.setSort}
            page={crud.page}
            totalPages={crud.totalPages}
            onPageChange={crud.setPage}
            total={crud.total}
            pageSize={10}
            emptyTitle="No documents found"
            emptyDescription="Try a different category or search term, or upload a new document."
          />
        </div>
      </div>

      <Modal open={!!previewDoc} onClose={() => setPreviewDoc(null)} title={previewDoc?.name} description="Document preview">
        {previewDoc && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-ink-100 p-4 dark:border-ink-800">
              {(() => {
                const Icon = FILE_ICONS[previewDoc.fileType] || FileIcon
                return (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                    <Icon size={22} />
                  </span>
                )
              })()}
              <div>
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{previewDoc.name}</p>
                <p className="text-xs text-ink-400">{fileSizeLabel(previewDoc.sizeKb)}{previewDoc.fileType ? ` · .${previewDoc.fileType}` : ''}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-ink-400">Category</p><p className="font-medium text-ink-800 dark:text-ink-100">{previewDoc.category}</p></div>
              <div><p className="text-xs text-ink-400">Related To</p><p className="font-medium text-ink-800 dark:text-ink-100">{previewDoc.relatedTo || '—'}</p></div>
              <div><p className="text-xs text-ink-400">Uploaded By</p><p className="font-medium text-ink-800 dark:text-ink-100">{getUserById(previewDoc.uploadedBy)?.name || '—'}</p></div>
              <div><p className="text-xs text-ink-400">Uploaded Date</p><p className="font-medium text-ink-800 dark:text-ink-100">{formatDate(previewDoc.uploadedDate)}</p></div>
            </div>
            <Button variant="secondary" icon={Download} onClick={handleDownload}>Download</Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this document?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Document"
      />
    </div>
  )
}
