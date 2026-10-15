import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Star, Power, Trash2, Pencil, LayoutTemplate, FileType as WordIcon, FileImage, ArrowLeft } from 'lucide-react'
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
import { formatDateTime } from '../../utils/format'
import { TEMPLATE_MANAGER_ROLES } from '../Settings/QuotationTemplates'
import { pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { buildProposalPdf } from './proposalPdf'
import { sampleProposal } from './ProposalTemplateEditor'

const TYPE = { standard: ['Standard layout', LayoutTemplate], docx: ['Word template', WordIcon], pdf: ['PDF letterhead', FileImage], image: ['Image letterhead', FileImage] }

export default function ProposalTemplates() {
  const crud = useCrud('proposalTemplates', { pageSize: 100 })
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const canManage = TEMPLATE_MANAGER_ROLES.includes(user?.role)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [usage, setUsage] = useState({})
  useEffect(() => {
    api.get('/proposals', { params: { all: true } }).then((r) => {
      const c = {}
      r.data.forEach((p) => { if (p.templateId) c[p.templateId] = (c[p.templateId] || 0) + 1 })
      setUsage(c)
    })
  }, [crud.allItems.length])

  const preview = (t) => buildProposalPdf({ proposal: sampleProposal(), template: t, ownerName: user?.name, ownerEmail: user?.email }).then((b) => setPreviewUrl(pdfBytesToBlobUrl(b))).catch(() => toast('Could not generate a preview.', { type: 'error' }))
  const setDefault = (t) => Promise.all(crud.allItems.filter((x) => x.isDefault && x.id !== t.id).map((x) => crud.update(x.id, { isDefault: false }))).then(() => crud.update(t.id, { isDefault: true, isActive: true })).then(() => toast(`"${t.name}" is now the default proposal template.`, { type: 'success' }))
  const toggle = (t) => crud.update(t.id, { isActive: !t.isActive, ...(t.isActive ? { isDefault: false } : {}) }).then(() => toast(t.isActive ? 'Template deactivated.' : 'Template activated.', { type: 'success' }))

  return (
    <div>
      <PageHeader
        title="Proposal Templates"
        description="Branded layouts for generated proposal PDFs — header, footer, watermark and logo."
        actions={<>
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/proposals')}>Proposals</Button>
          {canManage && <Button icon={Plus} onClick={() => navigate('/proposal-templates/new')}>New Template</Button>}
        </>}
      />
      {!crud.loading && crud.allItems.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="No proposal templates yet" description="Proposals use the built-in layout until you add a template with your logo, header, footer or letterhead." action={canManage ? <Button icon={Plus} onClick={() => navigate('/proposal-templates/new')}>New Template</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {crud.allItems.map((t) => {
            const [label, Icon] = TYPE[t.fileType] || TYPE.standard
            return (
              <div key={t.id} className="flex flex-col rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{t.name}</p><p className="text-xs text-ink-400">{label} · v{t.version} · {formatDateTime(t.uploadedAt)}</p></div>
                  <Icon size={18} className="shrink-0 text-ink-400" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <StatusBadge status={t.isActive ? 'Active' : 'Inactive'} />
                  {t.isDefault && <Badge tone="info">Default</Badge>}
                  {t.header?.enabled && <Badge tone="neutral">Header</Badge>}
                  {t.footer?.enabled && <Badge tone="neutral">Footer</Badge>}
                  {t.watermark?.enabled && <Badge tone="neutral">Watermark</Badge>}
                  {usage[t.id] > 0 && <Badge tone="neutral">Used by {usage[t.id]}</Badge>}
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                  <Button size="sm" variant="secondary" icon={Eye} onClick={() => preview(t)}>Preview</Button>
                  {canManage && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => navigate(`/proposal-templates/${t.id}`)}>Edit</Button>}
                  {canManage && <Button size="sm" variant="secondary" icon={Power} onClick={() => toggle(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>}
                  {canManage && t.isActive && !t.isDefault && <Button size="sm" variant="secondary" icon={Star} onClick={() => setDefault(t)}>Set Default</Button>}
                  {canManage && !t.isDefault && !usage[t.id] && <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDeleteTarget(t)}>Delete</Button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <Modal open={!!previewUrl} onClose={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }} title="Template preview" description="Generated from sample data." size="xl">
        {previewUrl && <iframe src={previewUrl} title="Preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      </Modal>
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => crud.remove(deleteTarget.id).then(() => { toast('Template deleted.', { type: 'success' }); setDeleteTarget(null) })} title="Delete this template?" description={`"${deleteTarget?.name}" will be removed.`} confirmLabel="Delete" />
    </div>
  )
}
