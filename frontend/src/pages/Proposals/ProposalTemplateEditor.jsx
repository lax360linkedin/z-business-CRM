import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Eye, Printer, UploadCloud, LayoutTemplate, FileType as WordIcon, FileImage, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { FormField, Input } from '../../components/common/FormField'
import { Modal } from '../../components/common/Modal'
import { EmptyState } from '../../components/common/EmptyState'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { readTemplateFile } from '../Settings/quotationTemplateRender'
import { PageDesigner } from '../Settings/PageDesigner'
import { normalizeDecorations } from '../Settings/templateBands'
import { TEMPLATE_MANAGER_ROLES } from '../Settings/QuotationTemplates'
import { pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { normalizeContent } from '../../utils/proposalCalc'
import { buildProposalPdf } from './proposalPdf'

/** A realistic sample proposal for the in-editor Preview (clearly sample data, same shape as a real record). */
export function sampleProposal() {
  const content = normalizeContent({
    executiveSummary: 'Acme Technologies needs a modern, scalable web platform. This proposal outlines our recommended solution, delivery approach and commercial summary.',
    requirement: 'A customer-facing portal with self-service ordering, integrated payments and an admin dashboard.',
    proposedSolution: 'A modular web application with a headless CMS, secure payment gateway integration and role-based admin tools, delivered in two phases.',
    objectives: 'Reduce manual order handling by 60%. Launch within 10 weeks.',
    scopeOfWork: 'Discovery and design, front-end and back-end development, payment integration, testing, deployment and training.',
    implementationApproach: 'Agile delivery in two-week sprints with a demo at the end of each sprint.',
    technology: 'React, Node.js, PostgreSQL, hosted on a managed cloud platform.',
    assumptions: 'Client provides content and brand assets within the agreed timelines.',
    exclusions: 'Third-party licence costs and data migration from legacy systems.',
    paymentTerms: '50% advance, 40% on UAT sign-off, 10% on go-live.',
    modules: [{ name: 'Customer portal', description: 'Self-service ordering and order tracking' }, { name: 'Admin dashboard', description: 'Orders, customers and reports' }],
    deliverables: ['Signed-off design system', 'Production-ready web application', 'Admin and user documentation'],
    timeline: [{ phase: 'Discovery & design', description: 'Workshops, wireframes, UI design', duration: '2 weeks' }, { phase: 'Build & test', description: 'Sprints, QA, UAT', duration: '6 weeks' }, { phase: 'Launch', description: 'Deployment and training', duration: '2 weeks' }],
    responsibilities: { company: 'Design, development, testing, deployment and training.', client: 'Timely feedback, content, access to systems and a single point of contact.' },
    items: [{ name: 'Web platform build', description: 'Design and development', qty: 1, unitPrice: 350000, discount: 0 }, { name: 'Payment gateway integration', description: '', qty: 1, unitPrice: 100000, discount: 0 }],
  })
  return {
    id: 'sample', number: 'PROP-2026-0001', version: 1, title: 'Web Platform Proposal — Acme Technologies', status: 'Draft', dealName: 'Acme — Website Development',
    createdDate: new Date().toISOString().slice(0, 10), validUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), value: 450000,
    clientSnapshot: { companyName: 'Acme Technologies Pvt Ltd', contactName: 'Rohan Iyer', designation: 'Head of IT', phone: '+91 98765 43210', email: 'rohan@acmetech.com', billingAddress: '4th Floor, Tech Park Avenue, Bengaluru', shippingAddress: '4th Floor, Tech Park Avenue, Bengaluru', gstin: '29AACCL1234A1Z5', website: 'www.acmetech.com', industry: 'Information Technology' },
    content,
  }
}

const TYPES = [
  { key: 'standard', title: 'Standard layout', icon: LayoutTemplate, text: 'Built-in professional layout. Add your logo, header, footer and watermark.' },
  { key: 'docx', title: 'Word template (.docx)', icon: WordIcon, text: 'Upload a Word file, edit its content here and place proposal fields and sections.' },
  { key: 'letterhead', title: 'PDF / image letterhead', icon: FileImage, text: 'Print the proposal on your branded letterhead (PDF, PNG or JPG).' },
]

export default function ProposalTemplateEditor() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const canManage = TEMPLATE_MANAGER_ROLES.includes(user?.role)
  const [loading, setLoading] = useState(!isNew)
  const [existing, setExisting] = useState(null)
  const [kind, setKind] = useState(null) // standard | docx | letterhead
  const [fileDraft, setFileDraft] = useState(null)
  const [name, setName] = useState('')
  const [contentHtml, setContentHtml] = useState('')
  const [decos, setDecos] = useState(() => normalizeDecorations(null))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (isNew) return
    api.get(`/proposalTemplates/${id}`).then((r) => {
      const t = r.data
      setExisting(t); setName(t.name); setContentHtml(t.contentHtml || ''); setDecos(normalizeDecorations(t))
      setKind(t.fileType === 'standard' ? 'standard' : t.fileType === 'docx' ? 'docx' : 'letterhead')
    }).finally(() => setLoading(false))
  }, [id, isNew])

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    readTemplateFile(file).then((draft) => {
      if (kind === 'docx' && draft.fileType !== 'docx') throw new Error('Please upload a Word (.docx) file for a Word template.')
      if (kind === 'letterhead' && draft.fileType === 'docx') throw new Error('Choose "Word template" to upload a .docx file.')
      setFileDraft(draft)
      if (draft.fileType === 'docx') setContentHtml(draft.contentHtml)
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
    }).catch((err) => toast(err.message, { type: 'error' })).finally(() => setUploading(false))
  }

  const bg = fileDraft || existing
  const fileType = kind === 'standard' ? 'standard' : bg?.fileType
  const ready = kind === 'standard' || !!bg

  const buildTemplate = () => ({
    fileType, contentHtml: fileType === 'docx' ? contentHtml : null, ...decos,
    ...(fileType === 'pdf' || fileType === 'image' ? { fileData: bg.fileData, mimeType: bg.mimeType, pageWidth: bg.pageWidth, pageHeight: bg.pageHeight } : {}),
  })
  const doPreview = () => {
    setPreviewing(true)
    buildProposalPdf({ proposal: sampleProposal(), template: buildTemplate(), ownerName: user?.name, ownerEmail: user?.email })
      .then((b) => setPreviewUrl(pdfBytesToBlobUrl(b))).catch(() => toast('Could not generate a preview.', { type: 'error' })).finally(() => setPreviewing(false))
  }

  const save = () => {
    if (!name.trim()) { toast('Give this template a name.', { type: 'error' }); return }
    if (!ready) { toast('Upload a file first.', { type: 'error' }); return }
    setSaving(true)
    const common = { name: name.trim(), contentHtml: fileType === 'docx' ? contentHtml : null, ...decos }
    const req = isNew
      ? api.post('/proposalTemplates', {
        ...common, fileType,
        ...(fileType === 'standard' ? {} : { mimeType: bg.mimeType, fileData: bg.fileData, pageWidth: bg.pageWidth, pageHeight: bg.pageHeight, previewDataUrl: bg.previewDataUrl, fileSize: bg.fileSize }),
        isDefault: false, isActive: true, version: 1,
      })
      : api.put(`/proposalTemplates/${id}`, common)
    req.then(() => { toast(isNew ? 'Proposal template saved and activated.' : 'Template updated.', { type: 'success' }); navigate('/proposal-templates') })
      .catch(() => { toast('Could not save the template.', { type: 'error' }); setSaving(false) })
  }

  if (!canManage) return <EmptyState icon={ShieldAlert} title="Not authorized" description="Only Super Admin, Admin, MD or Sales Manager can manage proposal templates." action={<Button onClick={() => navigate('/proposal-templates')}>Back</Button>} />
  if (loading) return <div className="py-16 text-center text-sm text-ink-400">Loading template…</div>

  return (
    <div>
      <PageHeader
        title={isNew ? 'New Proposal Template' : `Edit "${existing?.name}"`}
        description="Manage the header, footer, watermark and logo. Proposal content is filled in automatically from each proposal."
        actions={<>
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/proposal-templates')}>Back</Button>
          {ready && <Button variant="secondary" icon={Eye} loading={previewing} onClick={doPreview}>Preview</Button>}
          <Button icon={Save} loading={saving} onClick={save}>{isNew ? 'Save Template' : 'Update Template'}</Button>
        </>}
      />

      {!kind ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TYPES.map((t) => (
            <button key={t.key} type="button" onClick={() => setKind(t.key)} className="rounded-2xl border border-ink-100 bg-white p-6 text-left hover:border-brand-400 dark:border-ink-800 dark:bg-ink-900">
              <t.icon size={24} className="text-brand-500" /><p className="mt-3 text-sm font-semibold text-ink-800 dark:text-ink-100">{t.title}</p><p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t.text}</p>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 max-w-xs"><FormField label="Template name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corporate Proposal 2026" /></FormField></div>
          {kind !== 'standard' && !bg ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 bg-white py-20 text-center hover:border-brand-400 dark:border-ink-700 dark:bg-ink-900">
              <UploadCloud size={28} className="text-ink-400" />
              <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{uploading ? 'Reading file…' : kind === 'docx' ? 'Upload your Word proposal (.docx)' : 'Upload your letterhead'}</p>
              <p className="text-xs text-ink-400">{kind === 'docx' ? 'Word .docx — up to 10 MB' : 'PDF, PNG or JPG — up to 10 MB'}</p>
              <input type="file" className="hidden" disabled={uploading} onChange={handleFile} accept={kind === 'docx' ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf,image/png,image/jpeg'} />
            </label>
          ) : (
            <PageDesigner
              fieldSet="proposal" value={decos} onChange={setDecos}
              body={kind === 'standard'
                ? { kind: 'generated' }
                : kind === 'docx'
                  ? { kind: 'docx', html: contentHtml, onHtmlChange: setContentHtml }
                  : { kind: 'image', previewDataUrl: bg.previewDataUrl, aspect: bg.pageHeight / bg.pageWidth, fields: [] }}
            />
          )}
        </>
      )}

      <Modal open={!!previewUrl} onClose={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }} title="Template preview" description="Generated from sample data — the same engine real proposals use." size="xl"
        footer={<Button variant="secondary" icon={Printer} onClick={() => window.open(previewUrl, '_blank')}>Open in new tab</Button>}>
        {previewUrl && <iframe src={previewUrl} title="Template preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      </Modal>
    </div>
  )
}
