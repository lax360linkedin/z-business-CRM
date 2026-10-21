import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { UploadCloud, ArrowLeft, Save, Trash2, X, FileText, ShieldAlert, Eye, Printer } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { FormField, Input } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { Modal } from '../../components/common/Modal'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { QUOTATION_TEMPLATE_FIELDS, REQUIRED_TEMPLATE_FIELD_KEYS, DEFAULT_QUOTATION_TERMS } from '../../data/constants'
import { readTemplateFile } from './quotationTemplateRender'
import { extractFieldKeysFromHtml } from './templateFieldTokens'
import { PageDesigner } from './PageDesigner'
import { normalizeDecorations } from './templateBands'
import { buildQuotationPdf, pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { TEMPLATE_MANAGER_ROLES } from './QuotationTemplates'

// A realistic, clearly-sample quotation used only for the in-editor "Preview" action, so an
// admin can see roughly how real data will fill the template before any actual quotation is
// generated against it — built from each field's own `sample` value in QUOTATION_TEMPLATE_FIELDS
// (the same vocabulary the field-mapping canvas already shows), not fabricated separately.
function sampleQuotation() {
  return {
    number: 'QUO-2026-SAMPLE', createdDate: new Date().toISOString().slice(0, 10), validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    customerName: 'Acme Technologies Pvt Ltd', contactName: 'Rohan Iyer', contactPhone: '+91 98765 43210', contactEmail: 'rohan@acmetech.com',
    billingAddress: '4th Floor, Tech Park Avenue, Bengaluru', shippingAddress: '4th Floor, Tech Park Avenue, Bengaluru', gstin: '29AACCL1234A1Z5',
    dealId: 'DL-2003', leadId: null,
    items: [
      { name: 'Sample service A', qty: 1, unitPrice: 250000, discount: 10 },
      { name: 'Sample service B', qty: 2, unitPrice: 80000, discount: 0 },
    ],
    subtotal: 385000, tax: 69300, amount: 454300,
    paymentTerms: '50% advance, 50% on delivery', // preview text only terms: DEFAULT_QUOTATION_TERMS,
  }
}

const CANVAS_WIDTH = 680
const DEFAULT_SIZE = { quotationNumber: { w: 24 }, quotationDate: { w: 18 }, validUntil: { w: 18 }, clientName: { w: 32 }, contactPerson: { w: 26 }, phone: { w: 20 }, email: { w: 26 }, billingAddress: { w: 32 }, shippingAddress: { w: 32 }, gstin: { w: 22 }, dealId: { w: 18 }, quotationOwner: { w: 24 }, paymentTerms: { w: 34 }, terms: { w: 50 } }

function defaultField(key, index) {
  const isRegion = key === 'itemsTable' || key === 'totals'
  const base = { key, xPct: 8 + (index % 4) * 3, yPct: 20 + Math.floor(index / 4) * 8, fontSize: 9, bold: false }
  if (isRegion) return { ...base, wPct: key === 'itemsTable' ? 80 : 28, hPct: key === 'itemsTable' ? 30 : 10 }
  return { ...base, wPct: DEFAULT_SIZE[key]?.w || 24 }
}

export default function QuotationTemplateEditor() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const replaceId = searchParams.get('replace')
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const canManage = TEMPLATE_MANAGER_ROLES.includes(user?.role)

  const [loading, setLoading] = useState(!isNew)
  const [existing, setExisting] = useState(null)
  const [replaceFrom, setReplaceFrom] = useState(null)
  const [fileDraft, setFileDraft] = useState(null)
  const [name, setName] = useState('')
  const [fields, setFields] = useState([])
  const [contentHtml, setContentHtml] = useState('')
  const [decos, setDecos] = useState(() => normalizeDecorations(null))
  const [view, setView] = useState('fields') // letterhead templates: 'fields' mapping vs 'page' (header/footer/watermark)
  const [selectedKey, setSelectedKey] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const containerRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    if (!isNew) {
      api.get(`/quotationTemplates/${id}`).then((res) => {
        setExisting(res.data)
        setName(res.data.name)
        setFields(res.data.fields || [])
        setContentHtml(res.data.contentHtml || '')
        setDecos(normalizeDecorations(res.data))
      }).finally(() => setLoading(false))
    } else if (replaceId) {
      api.get(`/quotationTemplates/${replaceId}`).then((res) => {
        setReplaceFrom(res.data)
        setName(`${res.data.name} (updated)`)
        setFields(res.data.fields || [])
        setContentHtml(res.data.contentHtml || '')
        setDecos(normalizeDecorations(res.data))
      })
    }
  }, [id, isNew, replaceId])

  const background = fileDraft || existing
  const isDocx = background?.fileType === 'docx'
  const pageAspect = background ? background.pageHeight / background.pageWidth : 1.414
  const canvasHeight = CANVAS_WIDTH * pageAspect

  const availableFields = useMemo(() => {
    const placed = new Set(fields.map((f) => f.key))
    return QUOTATION_TEMPLATE_FIELDS.filter((f) => !placed.has(f.key))
  }, [fields])

  const missing = useMemo(() => {
    const have = new Set(isDocx ? extractFieldKeysFromHtml(contentHtml) : fields.map((f) => f.key))
    return REQUIRED_TEMPLATE_FIELD_KEYS.filter((k) => !have.has(k))
  }, [fields, isDocx, contentHtml])

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    readTemplateFile(file)
      .then((draft) => {
        setFileDraft(draft)
        if (draft.fileType === 'docx') setContentHtml(draft.contentHtml)
        if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
      })
      .catch((err) => toast(err.message, { type: 'error' }))
      .finally(() => setUploading(false))
  }

  const doPreview = () => {
    setPreviewing(true)
    const template = isDocx
      ? { fileType: 'docx', contentHtml, ...decos }
      : { fileType: background?.fileType, fileData: background?.fileData, mimeType: background?.mimeType, pageWidth: background?.pageWidth, pageHeight: background?.pageHeight, fields, ...decos }
    buildQuotationPdf({ quotation: sampleQuotation(), preparedByName: user?.name, template })
      .then((bytes) => setPreviewUrl(pdfBytesToBlobUrl(bytes)))
      .catch(() => toast('Could not generate a preview.', { type: 'error' }))
      .finally(() => setPreviewing(false))
  }

  const addField = (key) => setFields((fs) => [...fs, defaultField(key, fs.length)])
  const removeField = (key) => {
    setFields((fs) => fs.filter((f) => f.key !== key))
    if (selectedKey === key) setSelectedKey(null)
  }
  const patchField = (key, patch) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const startDrag = (key, mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedKey(key)
    const rect = containerRef.current.getBoundingClientRect()
    const field = fields.find((f) => f.key === key)
    dragRef.current = { key, mode, startX: e.clientX, startY: e.clientY, rect, origin: { ...field } }
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragEnd)
  }
  const onDragMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dxPct = ((e.clientX - d.startX) / d.rect.width) * 100
    const dyPct = ((e.clientY - d.startY) / d.rect.height) * 100
    if (d.mode === 'move') {
      const xPct = Math.min(96, Math.max(0, d.origin.xPct + dxPct))
      const yPct = Math.min(96, Math.max(0, d.origin.yPct + dyPct))
      patchField(d.key, { xPct, yPct })
    } else {
      const wPct = Math.min(100 - d.origin.xPct, Math.max(6, d.origin.wPct + dxPct))
      const hPct = Math.min(100 - d.origin.yPct, Math.max(5, (d.origin.hPct || 10) + dyPct))
      patchField(d.key, { wPct, hPct })
    }
  }
  const onDragEnd = () => {
    dragRef.current = null
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', onDragEnd)
  }
  useEffect(() => () => {
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', onDragEnd)
  }, [])

  const selectedField = fields.find((f) => f.key === selectedKey)

  const save = () => {
    if (!name.trim()) { toast('Give this template a name.', { type: 'error' }); return }
    setSaving(true)
    if (isNew) {
      if (!fileDraft) { toast('Upload a PDF, PNG, JPG or Word (.docx) letterhead first.', { type: 'error' }); setSaving(false); return }
      const record = {
        name: name.trim(),
        fileType: fileDraft.fileType,
        mimeType: fileDraft.mimeType,
        fileData: fileDraft.fileData,
        pageWidth: fileDraft.pageWidth,
        pageHeight: fileDraft.pageHeight,
        previewDataUrl: fileDraft.previewDataUrl,
        fileSize: fileDraft.fileSize,
        fields,
        contentHtml: fileDraft.fileType === 'docx' ? contentHtml : null,
        header: decos.header,
        footer: decos.footer,
        watermark: decos.watermark,
        isDefault: replaceFrom?.isDefault || false,
        isActive: false,
        version: (replaceFrom?.version || 0) + 1,
        previousVersionId: replaceFrom?.id || null,
      }
      api.post('/quotationTemplates', record)
        .then(() => (replaceFrom ? api.put(`/quotationTemplates/${replaceFrom.id}`, { isActive: false, isDefault: false }) : Promise.resolve()))
        .then(() => {
          toast(`"${record.name}" uploaded. Map any remaining fields, then Activate it from the template list.`, { type: 'success' })
          navigate('/quotation-templates')
        })
        .catch(() => { toast('Could not save the template.', { type: 'error' }); setSaving(false) })
    } else {
      const patch = isDocx ? { name: name.trim(), contentHtml, ...decos } : { name: name.trim(), fields, ...decos }
      api.put(`/quotationTemplates/${id}`, patch)
        .then(() => { toast('Template updated.', { type: 'success' }); navigate('/quotation-templates') })
        .catch(() => { toast('Could not save changes.', { type: 'error' }); setSaving(false) })
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Not authorized"
        description="Only Super Admin, Admin, MD or Sales Manager can upload or edit quotation templates."
        action={<Button onClick={() => navigate('/quotation-templates')}>Back to Templates</Button>}
      />
    )
  }
  if (loading) return <div className="py-16 text-center text-sm text-ink-400">Loading template…</div>

  return (
    <div>
      <PageHeader
        title={isNew ? (replaceFrom ? `Replace "${replaceFrom.name}"` : 'Upload Quotation Template') : `Edit "${existing?.name}"`}
        description={
          isDocx
            ? "Edit the page like a Word document — type directly in the header, body and footer, format with the ribbon, add a logo or watermark, and insert CRM fields wherever they should appear."
            : 'Position each CRM field where it should print on your letterhead. Drag to move, drag the corner handle to resize the items table and totals block.'
        }
        actions={
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/quotation-templates')}>Back</Button>
            {background && <Button variant="secondary" icon={Eye} loading={previewing} onClick={doPreview}>Preview</Button>}
            <Button icon={Save} loading={saving} onClick={save}>{isNew ? 'Save Template' : 'Update Template'}</Button>
          </>
        }
      />

      {missing.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
          Required before this template can be activated: {missing.map((k) => QUOTATION_TEMPLATE_FIELDS.find((f) => f.key === k)?.label || k).join(', ')}.
        </div>
      )}

      <div className="mb-5 max-w-xs">
        <FormField label="Template Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Official Letterhead 2026" />
        </FormField>
      </div>

      {background && !isDocx && (
        <div className="mb-4 inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm font-medium dark:border-ink-700 dark:bg-ink-900">
          {[['fields', 'Field Mapping'], ['page', 'Header, Footer & Watermark']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={`rounded-md px-4 py-1.5 ${view === k ? 'bg-brand-600 text-white' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-100'}`}>{l}</button>
          ))}
        </div>
      )}

      {!background ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 bg-white py-20 text-center hover:border-brand-400 dark:border-ink-700 dark:bg-ink-900">
          <UploadCloud size={28} className="text-ink-400" />
          <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{uploading ? 'Reading file…' : 'Click to upload your letterhead'}</p>
          <p className="text-xs text-ink-400">PDF, PNG, JPG or Word (.docx) — up to 10 MB</p>
          <input type="file" accept="application/pdf,image/png,image/jpeg,.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={handleFile} disabled={uploading} />
        </label>
      ) : isDocx ? (
        <PageDesigner value={decos} onChange={setDecos} body={{ kind: 'docx', html: contentHtml, onHtmlChange: setContentHtml }} />
      ) : view === 'page' ? (
        <PageDesigner value={decos} onChange={setDecos} body={{ kind: 'image', previewDataUrl: background.previewDataUrl, aspect: pageAspect, fields }} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="overflow-auto rounded-2xl border border-ink-100 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-950">
            <div
              ref={containerRef}
              className="relative mx-auto select-none bg-white shadow-card"
              style={{ width: CANVAS_WIDTH, height: canvasHeight, backgroundImage: `url(${background.previewDataUrl})`, backgroundSize: '100% 100%' }}
            >
              {fields.map((f) => {
                const def = QUOTATION_TEMPLATE_FIELDS.find((q) => q.key === f.key)
                const isRegion = f.key === 'itemsTable' || f.key === 'totals'
                return (
                  <div
                    key={f.key}
                    onMouseDown={startDrag(f.key, 'move')}
                    className={`absolute cursor-move rounded border-2 px-1.5 py-1 text-[10px] font-medium leading-tight shadow-sm ${selectedKey === f.key ? 'border-brand-500 bg-brand-50/90 text-brand-700' : 'border-brand-300/70 bg-white/90 text-ink-600'} ${isRegion ? 'border-dashed' : ''}`}
                    style={{
                      left: `${f.xPct}%`, top: `${f.yPct}%`,
                      width: isRegion ? `${f.wPct}%` : undefined,
                      height: isRegion ? `${f.hPct}%` : undefined,
                      maxWidth: isRegion ? undefined : `${f.wPct || 24}%`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="truncate">{def?.label}</span>
                      <button onMouseDown={(e) => e.stopPropagation()} onClick={() => removeField(f.key)} className="shrink-0 text-ink-400 hover:text-rose-500"><X size={10} /></button>
                    </div>
                    {!isRegion && <span className="block truncate text-[9px] font-normal text-ink-400">{def?.sample}</span>}
                    {isRegion && (
                      <div
                        onMouseDown={startDrag(f.key, 'resize')}
                        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-tl bg-brand-500"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Unmapped Fields</p>
              {availableFields.length === 0 ? (
                <p className="text-xs text-ink-400">All fields are placed.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableFields.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => addField(f.key)}
                      className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-300"
                    >
                      + {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedField && (
              <div className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-400">{QUOTATION_TEMPLATE_FIELDS.find((q) => q.key === selectedField.key)?.label}</p>
                <FormField label="Font Size" className="mb-3">
                  <Input type="number" min="6" max="24" value={selectedField.fontSize} onChange={(e) => patchField(selectedField.key, { fontSize: Number(e.target.value) || 9 })} />
                </FormField>
                <label className="mb-3 flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200">
                  <input type="checkbox" checked={!!selectedField.bold} onChange={(e) => patchField(selectedField.key, { bold: e.target.checked })} />
                  Bold
                </label>
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => removeField(selectedField.key)}>Remove Field</Button>
              </div>
            )}

            <div className="rounded-2xl border border-ink-100 bg-white p-4 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-ink-700 dark:text-ink-200"><FileText size={13} /> Tips</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>Drag a field to reposition it.</li>
                <li>The Products table and Totals block are resizable regions — drag the corner handle.</li>
                <li>Long item lists automatically continue on a new page, reusing this letterhead.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!previewUrl}
        onClose={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }}
        title="Template Preview"
        description="Generated from sample data — the same engine real quotations use."
        size="xl"
        footer={<Button variant="secondary" icon={Printer} onClick={() => window.open(previewUrl, '_blank')}>Open in New Tab</Button>}
      >
        {previewUrl && <iframe src={previewUrl} title="Template preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      </Modal>
    </div>
  )
}
