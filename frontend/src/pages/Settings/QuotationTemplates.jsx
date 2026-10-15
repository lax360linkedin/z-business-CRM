import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Image as ImageIcon, FileType as WordIcon, Eye, Star, Power, CheckCircle2, Trash2, Pencil, ShieldAlert, Copy } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { REQUIRED_TEMPLATE_FIELD_KEYS, QUOTATION_TEMPLATE_FIELDS } from '../../data/constants'
import { formatDateTime } from '../../utils/format'
import { getUserById } from '../../data/users'
import { extractFieldKeysFromHtml } from './templateFieldTokens'

// Roles with authority to upload, replace, activate or delete a quotation letterhead — same
// convention as QuotationDetail.jsx's APPROVER_ROLES. Everyone else can still view and preview
// templates (read-only), matching the spec's "only authorized users can upload or replace".
export const TEMPLATE_MANAGER_ROLES = ['Super Admin', 'Admin', 'MD', 'Sales Manager']

function missingRequiredFields(template) {
  const have = new Set(template.fileType === 'docx' ? extractFieldKeysFromHtml(template.contentHtml) : (template.fields || []).map((f) => f.key))
  return REQUIRED_TEMPLATE_FIELD_KEYS.filter((k) => !have.has(k))
}
function fileTypeIcon(fileType) {
  if (fileType === 'pdf') return FileText
  if (fileType === 'docx') return WordIcon
  return ImageIcon
}
function fileTypeLabel(fileType) {
  if (fileType === 'pdf') return 'PDF'
  if (fileType === 'docx') return 'Word'
  return 'Image'
}
function labelFor(key) {
  return QUOTATION_TEMPLATE_FIELDS.find((f) => f.key === key)?.label || key
}

export default function QuotationTemplates() {
  const crud = useCrud('quotationTemplates', { pageSize: 100 })
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const canManage = TEMPLATE_MANAGER_ROLES.includes(user?.role)
  const [preview, setPreview] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [usageCounts, setUsageCounts] = useState({})

  useEffect(() => {
    api.get('/quotations', { params: { all: true } }).then((res) => {
      const counts = {}
      res.data.forEach((q) => { if (q.templateId) counts[q.templateId] = (counts[q.templateId] || 0) + 1 })
      setUsageCounts(counts)
    })
  }, [crud.allItems.length])

  const setDefault = (template) => {
    const others = crud.allItems.filter((t) => t.isDefault && t.id !== template.id)
    Promise.all(others.map((t) => crud.update(t.id, { isDefault: false })))
      .then(() => crud.update(template.id, { isDefault: true }))
      .then(() => toast(`"${template.name}" set as the default quotation template.`, { type: 'success' }))
  }

  const toggleActive = (template) => {
    if (!template.isActive) {
      const missing = missingRequiredFields(template)
      if (missing.length) {
        toast(`Can't activate — map these fields first: ${missing.map(labelFor).join(', ')}.`, { type: 'error' })
        return
      }
    }
    crud.update(template.id, { isActive: !template.isActive })
      .then(() => toast(`"${template.name}" ${template.isActive ? 'deactivated' : 'activated'}.`, { type: 'success' }))
  }

  const validate = (template) => {
    const missing = missingRequiredFields(template)
    if (missing.length) toast(`Missing required fields: ${missing.map(labelFor).join(', ')}.`, { type: 'error' })
    else toast('Template is valid — every required field is mapped.', { type: 'success' })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`"${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Quotation Templates"
        description="Upload your official quotation letterhead and control which template new quotations generate against."
        actions={canManage && <Button icon={Plus} onClick={() => navigate('/quotation-templates/new')}>Upload Template</Button>}
      />

      {!canManage && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
          <ShieldAlert size={15} /> Only Super Admin, Admin, MD or Sales Manager can upload, replace or activate templates.
        </div>
      )}

      {crud.allItems.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No letterhead uploaded yet"
          description="Quotations currently use the built-in default layout. Upload your official quotation letterhead (PDF, PNG, JPG or Word .docx) to generate quotations on your own branded template."
          action={canManage ? <Button icon={Plus} onClick={() => navigate('/quotation-templates/new')}>Upload Template</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {crud.allItems.map((t) => {
            const missing = missingRequiredFields(t)
            const uploader = getUserById(t.uploadedBy)
            const usedCount = usageCounts[t.id] || 0
            const TypeIcon = fileTypeIcon(t.fileType)
            return (
              <div key={t.id} className="flex flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
                <button onClick={() => setPreview(t)} className="block h-40 w-full overflow-hidden bg-ink-50 dark:bg-ink-800">
                  {t.fileType === 'docx' ? (
                    <div className="scrollbar-thin h-full w-full overflow-hidden bg-white p-3 text-left text-[7px] leading-tight text-ink-600 dark:bg-ink-900 dark:text-ink-300" dangerouslySetInnerHTML={{ __html: t.contentHtml || '' }} />
                  ) : (
                    <img src={t.previewDataUrl} alt={t.name} className="h-full w-full object-contain" />
                  )}
                </button>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{t.name}</p>
                      <p className="text-xs text-ink-400">{fileTypeLabel(t.fileType)} · v{t.version} · {formatDateTime(t.uploadedAt)}</p>
                    </div>
                    <TypeIcon size={16} className="shrink-0 text-ink-400" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={t.isActive ? 'Active' : 'Inactive'} />
                    {t.isDefault && <Badge tone="info">Default</Badge>}
                    {missing.length > 0 && <Badge tone="warning">{missing.length} field{missing.length > 1 ? 's' : ''} unmapped</Badge>}
                    {t.header?.enabled && <Badge tone="neutral">Header</Badge>}
                    {t.footer?.enabled && <Badge tone="neutral">Footer</Badge>}
                    {t.watermark?.enabled && <Badge tone="neutral">Watermark</Badge>}
                    {usedCount > 0 && <Badge tone="neutral">Used by {usedCount}</Badge>}
                  </div>
                  <p className="text-xs text-ink-400">Uploaded by {uploader?.name || '—'}</p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    <Button variant="secondary" size="sm" icon={Eye} onClick={() => setPreview(t)}>Preview</Button>
                    {canManage && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => navigate(`/quotation-templates/${t.id}`)}>{t.fileType === 'docx' ? 'Edit Template' : 'Field Mapping & Page'}</Button>}
                    {canManage && <Button variant="secondary" size="sm" icon={CheckCircle2} onClick={() => validate(t)}>Validate</Button>}
                    {canManage && <Button variant="secondary" size="sm" icon={Power} onClick={() => toggleActive(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>}
                    {canManage && t.isActive && !t.isDefault && <Button variant="secondary" size="sm" icon={Star} onClick={() => setDefault(t)}>Set Default</Button>}
                    {canManage && <Button variant="secondary" size="sm" icon={Copy} onClick={() => navigate(`/quotation-templates/new?replace=${t.id}`)}>Replace</Button>}
                    {canManage && !t.isDefault && !usedCount && (
                      <Button variant="danger" size="sm" icon={Trash2} onClick={() => setDeleteTarget(t)}>Delete</Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name} description="Template preview" size="lg">
        {preview && (
          preview.fileType === 'docx'
            ? <div className="prose-sm max-h-[70vh] max-w-none overflow-y-auto rounded-lg border border-ink-100 bg-white p-6 dark:border-ink-800 dark:bg-ink-900" dangerouslySetInnerHTML={{ __html: preview.contentHtml || '' }} />
            : <img src={preview.previewDataUrl} alt={preview.name} className="w-full rounded-lg border border-ink-100 dark:border-ink-800" />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this template?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Template"
      />
    </div>
  )
}
