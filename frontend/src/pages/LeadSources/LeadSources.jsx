import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Download, Pencil, Trash2, Target, AlertTriangle, Power, Layers, CheckCircle2, PauseCircle, Plug, XCircle, FilterX } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { Badge } from '../../components/common/Badge'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { StatCard } from '../../components/common/StatCard'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { IntegrationBadge } from './IntegrationBadge'
import { useToast } from '../../context/ToastContext'
import { useBranch } from '../../context/BranchContext'
import { downloadBlob } from '../Invoices/invoiceClient'
import { useSources, useMarketingConfig, saveSource, deleteSource, addSourceCategory, exportMarketing, mkErr, mkFields } from '../Marketing/marketingClient'

const ALL = 'all'
const th = 'px-3 py-2.5 text-left'

/** Add / edit a lead source. The server owns every rule (names, scope, who may manage common sources); this form only collects values and shows what it says. */
export function SourceFormDialog({ source, onClose, onSaved }) {
  const { toast } = useToast()
  const { categories } = useMarketingConfig()
  const { isGlobal, activeNames, scope: viewing, isAll } = useBranch()
  const editing = !!source
  const [f, setF] = useState({
    name: source?.name || '', category: source?.category || '', sourceType: source?.sourceType || 'Digital', captureMethod: source?.captureMethod || 'Manual', description: source?.description || '',
    scope: source ? (source.branch ? 'branch' : 'common') : (isGlobal && isAll ? 'common' : 'branch'),
    branch: source?.branch || (isGlobal && !isAll && activeNames.includes(viewing) ? viewing : ''), active: source ? source.active : true,
  })
  const [extra, setExtra] = useState([]); const [adding, setAdding] = useState(false); const [newCat, setNewCat] = useState(''); const [catError, setCatError] = useState('')
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const all = [...new Set([...categories, ...extra])]
  const locked = editing && source.used // already referenced by enquiries, leads, deals, customers or campaigns: it stays where it is
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrors((x) => ({ ...x, [k]: undefined })) } // a field's message goes away as soon as it is edited
  const addCategory = () => addSourceCategory(newCat).then((list) => { setExtra(list); setF((x) => ({ ...x, category: list[list.length - 1] })); setAdding(false); setNewCat(''); setCatError('') }).catch((e) => setCatError(mkErr(e)))
  const go = () => {
    setBusy(true); setErrors({}); setError('')
    const payload = { name: f.name, category: f.category, sourceType: f.sourceType, captureMethod: f.captureMethod, description: f.description }
    if (isGlobal && !locked) Object.assign(payload, { scope: f.scope, branch: f.scope === 'branch' ? f.branch : null })
    if (!editing) payload.active = f.active
    saveSource(source?.id, payload).then((s) => { toast(`Source ${s.name} saved.`, { type: 'success' }); onSaved?.(s); onClose() }).catch((e) => { setErrors(mkFields(e)); setError(mkErr(e)) }).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="md" title={editing ? `Edit ${source.name}` : 'Add lead source'} description="Renaming a source updates the name shown on every enquiry, lead, deal and customer that already uses it." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save source</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && !Object.keys(errors).length && <p role="alert" className="text-sm text-rose-500 sm:col-span-2">{error}</p>}
        <FormField label="Source name" required error={errors.name} className="sm:col-span-2"><Input aria-label="Source name" value={f.name} onChange={set('name')} error={!!errors.name} maxLength={60} /></FormField>
        <FormField label="Category" required error={errors.category || catError} className="sm:col-span-2">
          {adding ? (
            <div className="flex gap-2"><Input aria-label="New category name" autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" maxLength={40} /><Button onClick={addCategory}>Add</Button><Button variant="ghost" onClick={() => { setAdding(false); setCatError('') }}>Cancel</Button></div>
          ) : (
            <div className="flex gap-2"><Select aria-label="Source category" value={f.category} onChange={set('category')} error={!!errors.category}><option value="">Choose a category…</option>{all.map((c) => <option key={c}>{c}</option>)}</Select><Button variant="secondary" onClick={() => setAdding(true)} aria-label="Add a new category">New</Button></div>
          )}
        </FormField>
        <FormField label="Scope" hint={isGlobal ? 'Common sources can be chosen in every branch. A branch-specific source belongs to one branch.' : 'Your source will belong to your branch. Common sources are managed by the Super Admin.'} error={errors.scope}>
          {isGlobal ? <Select aria-label="Scope" value={f.scope} onChange={set('scope')} disabled={locked}><option value="common">Common (all branches)</option><option value="branch">Branch-specific</option></Select> : <Input aria-label="Scope" value="Branch-specific" disabled />}
        </FormField>
        <FormField label="Branch" required={f.scope === 'branch'} error={errors.branch}>
          {isGlobal ? <Select aria-label="Branch" value={f.scope === 'branch' ? f.branch : ''} onChange={set('branch')} disabled={f.scope !== 'branch' || locked}><option value="">{f.scope === 'branch' ? 'Choose a branch…' : 'All branches'}</option>{activeNames.map((b) => <option key={b}>{b}</option>)}</Select> : <Input aria-label="Branch" value={source?.branch || viewing || ''} disabled />}
        </FormField>
        {locked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2 dark:bg-amber-900/20 dark:text-amber-200">This source is already used by CRM records, so its scope and branch can no longer change. You can still rename it or deactivate it.</p>}
        <FormField label="Source type"><Select aria-label="Source type" value={f.sourceType} onChange={set('sourceType')}>{['Digital', 'Offline', 'Integration'].map((c) => <option key={c}>{c}</option>)}</Select></FormField>
        <FormField label="How enquiries arrive" hint="Information only. It does not connect anything."><Select aria-label="Capture method" value={f.captureMethod} onChange={set('captureMethod')}>{['Manual', 'Form', 'API', 'Webhook'].map((c) => <option key={c}>{c}</option>)}</Select></FormField>
        <FormField label="Description" className="sm:col-span-2"><Textarea aria-label="Description" value={f.description} onChange={set('description')} maxLength={500} className="min-h-[70px]" /></FormField>
        {!editing && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active (people can choose it on new enquiries and leads)</label>}
      </div>
    </Modal>
  )
}

const pct = (v) => `${Number(v || 0).toFixed(1).replace(/\.0$/, '')}%`

export default function LeadSources() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { isGlobal, activeNames } = useBranch()
  const { perms, categories } = useMarketingConfig()
  const [filters, setFilters] = useState({ category: ALL, scope: ALL, branch: ALL, status: ALL, integration: ALL, from: '', to: '' })
  const [search, setSearch] = useState('')
  const server = useMemo(() => ({ ...(filters.from && { from: filters.from }), ...(filters.to && { to: filters.to }), ...(isGlobal && filters.branch !== ALL && { branch: filters.branch }) }), [filters.from, filters.to, filters.branch, isGlobal])
  const { sources, error, reload } = useSources(server)
  const [edit, setEdit] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value })
  const filtered = !!search.trim() || Object.entries(filters).some(([k, v]) => (k === 'from' || k === 'to' ? v : v !== ALL))
  const reset = () => { setSearch(''); setFilters({ category: ALL, scope: ALL, branch: ALL, status: ALL, integration: ALL, from: '', to: '' }) }
  const list = useMemo(() => (sources || []).filter((s) => (
    (!search.trim() || `${s.name} ${s.category} ${s.branch || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    && (filters.category === ALL || s.category === filters.category)
    && (filters.scope === ALL || s.scope === filters.scope)
    && (filters.status === ALL || (filters.status === 'Active') === s.active)
    && (filters.integration === ALL || s.integrationStatus === filters.integration)
  )), [sources, search, filters])
  const all = sources || []
  const cards = [
    ['Total sources', all.length, Layers, 'brand'], ['Active', all.filter((s) => s.active).length, CheckCircle2, 'emerald'], ['Inactive', all.filter((s) => !s.active).length, PauseCircle, 'ink'],
    ['Connected', all.filter((s) => s.integrationStatus === 'Connected').length, Plug, 'sky'], ['Integration errors', all.filter((s) => s.integrationStatus === 'Error').length, XCircle, 'rose'],
  ]
  const toggle = (s) => { setBusy(true); saveSource(s.id, { active: !s.active }).then(() => { toast(s.active ? `${s.name} deactivated. Existing records keep it.` : `${s.name} activated.`, { type: 'success' }); setConfirm(null); reload() }).catch((e) => toast(mkErr(e), { type: 'error' })).finally(() => setBusy(false)) }
  const remove = (s) => { setBusy(true); deleteSource(s.id).then(() => { toast('Source deleted.', { type: 'success' }); setConfirm(null); reload() }).catch((e) => { toast(mkErr(e), { type: 'error' }); setConfirm(null) }).finally(() => setBusy(false)) }
  const exportCsv = () => exportMarketing('sources', server).then((csv) => { downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'lead-sources.csv'); toast('Source register exported.', { type: 'success' }) }).catch((e) => toast(mkErr(e), { type: 'error' }))
  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load lead sources" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  const actions = (s) => s.perms.edit && (
    <div className="flex justify-end gap-0.5">
      <button type="button" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => setEdit(s)} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><Pencil size={14} /></button>
      <button type="button" aria-label={`${s.active ? 'Deactivate' : 'Activate'} ${s.name}`} title={s.active ? 'Deactivate' : 'Activate'} onClick={() => (s.active ? setConfirm({ kind: 'deactivate', s }) : toggle(s))} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><Power size={14} /></button>
      {!s.system && !s.used && <button type="button" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => setConfirm({ kind: 'delete', s })} className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"><Trash2 size={14} /></button>}
    </div>
  )
  return (
    <div>
      <PageHeader title="Lead Sources" description="Where enquiries come from. Every enquiry, lead, deal and customer points to one of these sources; a source never decides which branch a record belongs to." actions={<>{perms.export && <Button variant="secondary" icon={Download} onClick={exportCsv}>Export</Button>}{perms.manageSources && <Button icon={Plus} onClick={() => setEdit({})}>Add source</Button>}</>} />
      {sources && <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([label, value, icon, tone]) => <StatCard key={label} label={label} value={value} icon={icon} tone={tone} />)}</div>}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search sources…" className="w-full sm:w-64" />
        <label className="text-xs text-ink-500">Category<Select aria-label="Filter by category" className="mt-1 min-w-40" value={filters.category} onChange={set('category')}><option value={ALL}>All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select></label>
        <label className="text-xs text-ink-500">Scope<Select aria-label="Filter by scope" className="mt-1 min-w-36" value={filters.scope} onChange={set('scope')}><option value={ALL}>All scopes</option><option>Common</option><option>Branch-specific</option></Select></label>
        {isGlobal && <label className="text-xs text-ink-500">Branch<Select aria-label="Filter by branch" className="mt-1 min-w-36" value={filters.branch} onChange={set('branch')}><option value={ALL}>All branches</option>{activeNames.map((b) => <option key={b}>{b}</option>)}</Select></label>}
        <label className="text-xs text-ink-500">Status<Select aria-label="Filter by status" className="mt-1 min-w-28" value={filters.status} onChange={set('status')}><option value={ALL}>All</option><option>Active</option><option>Inactive</option></Select></label>
        <label className="text-xs text-ink-500">Integration<Select aria-label="Filter by integration status" className="mt-1 min-w-36" value={filters.integration} onChange={set('integration')}><option value={ALL}>All</option>{['Not Connected', 'Connected', 'Error', 'Inactive'].map((c) => <option key={c}>{c}</option>)}</Select></label>
        <label className="text-xs text-ink-500">Enquiries from<Input type="date" aria-label="Enquiries from date" className="mt-1" value={filters.from} max={filters.to || undefined} onChange={set('from')} /></label>
        <label className="text-xs text-ink-500">to<Input type="date" aria-label="Enquiries to date" className="mt-1" value={filters.to} min={filters.from || undefined} onChange={set('to')} /></label>
        {filtered && <Button variant="ghost" icon={FilterX} onClick={reset}>Clear</Button>}
      </div>
      {!sources ? <CardSkeleton className="h-64" /> : !list.length ? (
        <EmptyState icon={Target} title={filtered ? 'No sources match these filters' : 'No lead sources yet'} description={filtered ? 'Change or clear the filters to see more.' : perms.manageSources ? 'Add the first source to start tracking where enquiries come from.' : 'Lead sources will appear here once they are set up.'} action={filtered ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : undefined} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card md:block dark:border-ink-800 dark:bg-ink-900">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className={clsx(th, 'px-4')}>Source</th><th className={th}>Category</th><th className={th}>Scope</th><th className={th}>Branch</th><th className={th}>Integration</th><th className={th}>Status</th><th className="px-3 text-right">Enquiries</th><th className="px-3 text-right">Converted</th><th className="px-3 text-right">Conversion</th><th className="w-28 px-3"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.id} onClick={(e) => { if (!e.target.closest('button')) navigate(`/lead-sources/${s.id}`) }} className={clsx('cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/60 dark:border-ink-800/60 dark:hover:bg-ink-800/30', !s.active && 'opacity-70')}>
                  <td className="px-4 py-3"><button type="button" onClick={() => navigate(`/lead-sources/${s.id}`)} className="text-left font-medium text-brand-700 hover:underline dark:text-brand-300">{s.name}</button></td>
                  <td className="px-3 text-xs text-ink-500">{s.category}</td>
                  <td className="px-3 text-xs"><Badge tone={s.scope === 'Common' ? 'neutral' : 'info'}>{s.scope}</Badge></td>
                  <td className="px-3 text-xs text-ink-500">{s.branch || 'All branches'}</td>
                  <td className="px-3"><IntegrationBadge status={s.integrationStatus} /></td>
                  <td className="px-3"><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="px-3 text-right tabular-nums">{s.enquiryCount}</td><td className="px-3 text-right tabular-nums">{s.convertedLeadCount}</td><td className="px-3 text-right tabular-nums">{pct(s.enquiryConversionRate)}</td>
                  <td className="px-3">{actions(s)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">{list.map((s) => (
            <li key={s.id} className={clsx('rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900', !s.active && 'opacity-70')}>
              <div className="flex items-start justify-between gap-2"><button type="button" onClick={() => navigate(`/lead-sources/${s.id}`)} className="text-left text-sm font-semibold text-brand-700 dark:text-brand-300">{s.name}</button><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Inactive'}</Badge></div>
              <p className="mt-1 text-xs text-ink-500">{s.category} · {s.scope}{s.branch ? ` · ${s.branch}` : ''}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><IntegrationBadge status={s.integrationStatus} /><span className="text-xs text-ink-500">{s.enquiryCount} enquiries · {s.convertedLeadCount} converted · {pct(s.enquiryConversionRate)}</span></div>
              <div className="mt-2">{actions(s)}</div>
            </li>))}</ul>
        </>
      )}
      <p className="mt-3 text-xs text-ink-400">Conversion = enquiries converted to a lead ÷ enquiries received, inside the selected dates{isGlobal ? ' and branch' : ''}. Integration status shows what the Integrations module has reported; nothing is connected until it says so.</p>
      {edit && <SourceFormDialog source={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={reload} />}
      <ConfirmDialog open={confirm?.kind === 'deactivate'} onClose={() => setConfirm(null)} onConfirm={() => toggle(confirm.s)} loading={busy} tone="primary" title={`Deactivate ${confirm?.s.name}?`} description="It will no longer be offered on new enquiries and leads. Everything that already uses it keeps it, and you can activate it again at any time." confirmLabel="Deactivate" />
      <ConfirmDialog open={confirm?.kind === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => remove(confirm.s)} loading={busy} title={`Delete ${confirm?.s.name}?`} description="This source is not used by any record, so it can be removed. This cannot be undone." confirmLabel="Delete" />
    </div>
  )
}
