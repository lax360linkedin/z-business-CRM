import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Upload, Pencil, History, Trash2, FileText, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useContractsData, useContractSettings } from '../../hooks/useContracts'
import { MERGE_FIELDS, mergeTemplate, mergeValues } from '../../utils/contractRules'
import { getUserById } from '../../data/users'
import { formatDateTime } from '../../utils/format'
import { useContractTemplates, saveContractTemplates, upsertTemplate, extractTemplateText } from './contractTemplates.js'
import { errText } from './contractActions'

const MANAGER_ROLES = ['Super Admin', 'Admin', 'Sales Manager']

function relatedOf(c, data) {
  const f = (col, id) => data[col].find((x) => x.id === id)
  return { customer: f('customers', c.customerId), company: f('companies', c.companyId), contact: f('contacts', c.contactId), owner: getUserById(c.owner), project: f('projects', c.projectId), deal: f('deals', c.dealId), quotation: f('quotations', c.quotationId), salesOrder: f('salesOrders', c.salesOrderId) }
}

/** Create, upload (Word / PDF / text), edit, preview and version contract templates. {{Fields}} are filled from CRM data when a contract is generated. */
export default function ContractTemplatesPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const templates = useContractTemplates()
  const { types } = useContractSettings()
  const store = (list, message) => saveContractTemplates(list).then(() => { if (message) toast(message, { type: 'success' }) }).catch((e) => toast(e?.response?.data?.message || 'The template could not be saved.', { type: 'error' }))
  const { data } = useContractsData()
  const canManage = MANAGER_ROLES.includes(user?.role)
  const fileRef = useRef(null)
  const bodyRef = useRef(null)
  const [edit, setEdit] = useState(null) // { id?, name, contractType, body, note }
  const [previewId, setPreviewId] = useState('')
  const [history, setHistory] = useState(null)
  const [del, setDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sample = useMemo(() => {
    if (!data || !edit) return null
    const c = data.contracts.find((x) => x.id === previewId) || data.contracts[0]
    return c ? { text: mergeTemplate(edit.body, mergeValues(c, relatedOf(c, data))), number: c.number } : null
  }, [data, edit, previewId])

  const save = () => {
    if (!edit.name.trim()) { setError('Give the template a name.'); return }
    if (!edit.contractType) { setError('Choose the contract type it is for.'); return }
    if (edit.body.trim().length < 20) { setError('The template body is too short.'); return }
    store(upsertTemplate(templates, edit, user.id), edit.id ? 'Template saved.' : 'Template created.'); setEdit(null)
  }
  const upload = async (file) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast('That file is over 2 MB.', { type: 'error' }); return }
    setBusy(true)
    try {
      const body = await extractTemplateText(file)
      setError(''); setEdit({ name: file.name.replace(/\.[^.]+$/, ''), contractType: types[0], body, note: `Uploaded from ${file.name}`, source: 'uploaded', sourceFile: file.name })
      toast('Text imported — add {{fields}} where client details belong, then save.', { type: 'success' })
    } catch (e) { toast(errText(e), { type: 'error' }) } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const insert = (key) => {
    const el = bodyRef.current
    const token = `{{${key}}}`
    if (!el) { setEdit({ ...edit, body: `${edit.body}${token}` }); return }
    const s = el.selectionStart ?? edit.body.length; const e = el.selectionEnd ?? s
    setEdit({ ...edit, body: `${edit.body.slice(0, s)}${token}${edit.body.slice(e)}` })
    setTimeout(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length) }, 0)
  }
  const toggle = (t) => store(templates.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)))
  const restore = (t, v) => { store(upsertTemplate(templates, { ...t, body: v.body, note: `Restored version ${v.version}` }, user.id), `Version ${v.version} restored as a new version.`); setHistory(null) }
  const unknown = edit ? [...edit.body.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !MERGE_FIELDS.some(([f]) => f === k)) : []

  return (
    <div>
      <PageHeader breadcrumb={<Breadcrumbs items={[{ label: 'Contracts', href: '/contracts' }, { label: 'Templates' }]} />} title="Contract templates" description="Reusable contract wording with {{fields}} that fill in from the CRM when you generate a contract."
        actions={<><Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/contracts')}>Contracts</Button>{canManage && <><input ref={fileRef} type="file" accept=".docx,.pdf,.txt" className="hidden" aria-label="Upload a template file" onChange={(e) => upload(e.target.files?.[0])} /><Button variant="secondary" icon={Upload} loading={busy} onClick={() => fileRef.current?.click()}>Upload Word / PDF</Button><Button icon={Plus} onClick={() => { setError(''); setEdit({ name: '', contractType: types[0], body: '', note: 'Created' }) }}>New template</Button></>}</>} />
      {!templates.length ? <EmptyState icon={FileText} title="No templates" description="Create one or upload your standard contract." /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <section key={t.id} className="flex flex-col rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{t.name}</h3><p className="text-xs text-ink-400">{t.contractType}</p></div><Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge></div>
              <p className="mt-3 line-clamp-3 flex-1 whitespace-pre-line text-xs text-ink-500">{t.body}</p>
              <p className="mt-3 text-[11px] text-ink-400">v{t.version} · {t.source === 'uploaded' ? `uploaded (${t.sourceFile})` : t.source} · {formatDateTime(t.updatedAt)}{t.updatedBy ? ` · ${getUserById(t.updatedBy)?.name}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" icon={Eye} onClick={() => { setError(''); setPreviewId(''); setEdit({ ...t, note: '' }) }}>{canManage ? 'Edit / preview' : 'Preview'}</Button>
                <Button size="sm" variant="ghost" icon={History} onClick={() => setHistory(t)}>{t.versions.length} version{t.versions.length === 1 ? '' : 's'}</Button>
                {canManage && <Button size="sm" variant="ghost" icon={t.active ? EyeOff : Eye} onClick={() => toggle(t)}>{t.active ? 'Deactivate' : 'Activate'}</Button>}
                {canManage && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete ${t.name}`} onClick={() => setDel(t)} />}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-400">Word (.docx) and PDF uploads are converted to editable text — layout and images are not carried over. Generated contracts are PDFs saved under the contract’s Documents tab.</p>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="xl" title={edit?.id ? `Edit ${edit.name}` : 'New template'} description={edit?.id ? 'Saving a changed body creates a new version; earlier versions stay available.' : 'Write the contract wording and add {{fields}} for CRM data.'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button>{canManage && <Button onClick={save}>Save template</Button>}</>}>
        {edit && (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3">
              {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20">{error}</p>}
              <div className="grid grid-cols-2 gap-3"><FormField label="Name" required><Input value={edit.name} disabled={!canManage} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></FormField><FormField label="Contract type" required><Select value={edit.contractType} disabled={!canManage} onChange={(e) => setEdit({ ...edit, contractType: e.target.value })}>{[...new Set([...types, edit.contractType])].map((t) => <option key={t}>{t}</option>)}</Select></FormField></div>
              {canManage && <FormField label="Insert CRM field"><Select aria-label="Insert CRM field" value="" onChange={(e) => e.target.value && insert(e.target.value)}><option value="">Choose a field to insert at the cursor…</option>{MERGE_FIELDS.map(([k, l]) => <option key={k} value={k}>{l} — {`{{${k}}}`}</option>)}</Select></FormField>}
              <FormField label="Template body" required><Textarea ref={bodyRef} aria-label="Template body" value={edit.body} readOnly={!canManage} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="min-h-[340px] font-mono text-xs" /></FormField>
              {unknown.length > 0 && <p className="text-xs text-amber-600">Unknown fields (will not be filled): {[...new Set(unknown)].map((k) => `{{${k}}}`).join(', ')}</p>}
              {edit.id && canManage && <FormField label="Change note (optional)"><Input value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></FormField>}
            </div>
            <div className="space-y-3">
              <FormField label="Preview with contract" hint="Shows exactly how the fields fill from that contract’s CRM data.">
                <Select aria-label="Preview with contract" value={previewId} onChange={(e) => setPreviewId(e.target.value)}><option value="">First contract</option>{(data?.contracts || []).map((c) => <option key={c.id} value={c.id}>{c.number} · {c.customerName}</option>)}</Select>
              </FormField>
              <pre aria-label="Merged preview" className="scrollbar-thin max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-ink-100 bg-white p-4 font-sans text-xs leading-5 text-ink-800 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100">{sample ? sample.text.text : 'No contract to preview with yet.'}</pre>
              {sample?.text.missing.length > 0 && <p className="text-xs text-amber-600">Empty for {sample.number}: {sample.text.missing.join(', ')}</p>}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!history} onClose={() => setHistory(null)} size="md" title="Template versions" description={history?.name}>
        <ol className="space-y-2">{[...(history?.versions || [])].reverse().map((v) => (
          <li key={v.version} className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5 text-sm dark:bg-ink-800/50"><Badge tone={v.version === history.version ? 'success' : 'neutral'}>v{v.version}{v.version === history.version ? ' · current' : ''}</Badge><div className="min-w-0 flex-1"><p className="truncate text-ink-800 dark:text-ink-100">{v.note || 'Edited'}</p><p className="text-xs text-ink-400">{getUserById(v.by)?.name || 'System'} · {formatDateTime(v.at)}</p></div>{canManage && v.version !== history.version && <Button size="sm" variant="secondary" onClick={() => restore(history, v)}>Restore</Button>}</li>
        ))}</ol>
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name}?`} description="Contracts already generated from it keep their documents. This cannot be undone." confirmLabel="Delete template" onConfirm={() => { store(templates.filter((t) => t.id !== del.id), 'Template deleted.'); setDel(null) }} />
      <span className="hidden"><Link to="/contracts">Contracts</Link></span>
    </div>
  )
}
