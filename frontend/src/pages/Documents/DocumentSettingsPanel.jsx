import { useEffect, useState } from 'react'
import { Plus, Trash2, Save, Check, Minus } from 'lucide-react'
import { FormField, Input, Select } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { useToast } from '../../context/ToastContext'
import { DOC_PERMISSIONS, DOC_ROLE_CAPS, FILE_TYPES, ALL_EXTENSIONS, VISIBILITIES, DEFAULT_DOC_CONFIG } from '../../utils/documentRules'
import { useDocConfig, saveConfig, errText } from './documentClient'

const box = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'
const ROLES = Object.keys(DOC_ROLE_CAPS)

/** Admin settings: categories, allowed file types, limits, retention, default visibility — plus the read-only permission matrix. */
export function DocumentSettingsPanel() {
  const { toast } = useToast()
  const { config, has, ready, reload } = useDocConfig()
  const admin = has('manageCategories')
  const [cfg, setCfg] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (ready) setCfg({ ...config, categories: config.categories.map((c) => ({ ...c })), allowedExtensions: [...config.allowedExtensions] }) }, [ready, config])
  if (!cfg) return <div className={box}><p className="text-sm text-ink-400">Loading…</p></div>
  const set = (p) => setCfg((c) => ({ ...c, ...p }))
  const setCat = (id, p) => set({ categories: cfg.categories.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const addCat = () => {
    const n = draft.trim()
    if (!n) return
    if (cfg.categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) { toast(`“${n}” already exists.`, { type: 'error' }); return }
    set({ categories: [...cfg.categories, { id: `new-${Date.now()}`, name: n, active: true }] }); setDraft('')
  }
  const toggleExt = (e) => set({ allowedExtensions: cfg.allowedExtensions.includes(e) ? cfg.allowedExtensions.filter((x) => x !== e) : [...cfg.allowedExtensions, e] })
  const save = () => {
    setBusy(true)
    const payload = { ...cfg, categories: cfg.categories.map((c) => ({ ...c, id: String(c.id).startsWith('new-') ? undefined : c.id })) }
    saveConfig(payload).then(() => { toast('Document settings saved.', { type: 'success' }); reload() }).catch((e) => toast(errText(e), { type: 'error' })).finally(() => setBusy(false))
  }
  return (
    <div className="space-y-5">
      {!admin && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">You can see these settings, but only an administrator can change them.</p>}

      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Document categories</h2>
        <p className="mt-1 text-sm text-ink-500">Deactivate a category to stop it being offered; documents already in it keep it. “Other” always stays available.</p>
        <ul className="mt-4 divide-y divide-ink-50 dark:divide-ink-800/60">
          {cfg.categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <Input aria-label={`Category name ${c.name}`} className="!h-9 max-w-xs" value={c.name} disabled={!admin || c.system} onChange={(e) => setCat(c.id, { name: e.target.value })} />
              <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" checked={c.active} disabled={!admin || c.system} onChange={(e) => setCat(c.id, { active: e.target.checked })} />Active</label>
              {c.system && <Badge>Required</Badge>}
              {admin && !c.system && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Delete category ${c.name}`} onClick={() => set({ categories: cfg.categories.filter((x) => x.id !== c.id) })} />}
            </li>
          ))}
        </ul>
        {admin && <div className="mt-3 flex gap-2"><Input aria-label="New category" className="!h-9 max-w-xs" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCat()} placeholder="Add a category…" /><Button variant="secondary" icon={Plus} onClick={addCat}>Add</Button></div>}
      </div>

      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Upload rules</h2>
        <p className="mt-1 text-sm text-ink-500">Every upload is checked against its real content: signature, structure, macros, scripts and executables are rejected whatever the file is called.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Allowed file types">
          {ALL_EXTENSIONS.filter((e) => e !== 'jpeg').map((e) => (
            <label key={e} className="flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm dark:border-ink-800"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" disabled={!admin} checked={cfg.allowedExtensions.includes(e)} onChange={() => { toggleExt(e); if (e === 'jpg') toggleExt('jpeg') }} /><span><b>.{e}</b><span className="block text-[11px] text-ink-400">{FILE_TYPES[e].label}</span></span></label>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <FormField label="Maximum file size (MB)"><Input type="number" min="1" max="50" disabled={!admin} value={cfg.maxSizeMb} onChange={(e) => set({ maxSizeMb: e.target.value })} /></FormField>
          <FormField label="Files per upload"><Input type="number" min="1" max="25" disabled={!admin} value={cfg.maxFilesPerUpload} onChange={(e) => set({ maxFilesPerUpload: e.target.value })} /></FormField>
          <FormField label="Default visibility"><Select disabled={!admin} value={cfg.defaultVisibility} onChange={(e) => set({ defaultVisibility: e.target.value })}>{VISIBILITIES.filter((v) => v !== 'Confidential').map((v) => <option key={v}>{v}</option>)}</Select></FormField>
          <FormField label="Bin retention (days)" hint="Deleted documents can be restored until then, then are removed for good."><Input type="number" min="1" max="365" disabled={!admin} value={cfg.retentionDays} onChange={(e) => set({ retentionDays: e.target.value })} /></FormField>
          <FormField label="Longest share (days)"><Input type="number" min="1" max="365" disabled={!admin} value={cfg.shareMaxDays} onChange={(e) => set({ shareMaxDays: e.target.value })} /></FormField>
          <FormField label="“Review needed” window (days)"><Input type="number" min="1" max="90" disabled={!admin} value={cfg.reviewWarnDays} onChange={(e) => set({ reviewWarnDays: e.target.value })} /></FormField>
        </div>
        {admin && <div className="mt-5 flex gap-2"><Button icon={Save} loading={busy} onClick={save}>Save settings</Button><Button variant="ghost" onClick={() => setCfg({ ...cfg, allowedExtensions: DEFAULT_DOC_CONFIG.allowedExtensions, maxSizeMb: DEFAULT_DOC_CONFIG.maxSizeMb, maxFilesPerUpload: DEFAULT_DOC_CONFIG.maxFilesPerUpload, retentionDays: DEFAULT_DOC_CONFIG.retentionDays, shareMaxDays: DEFAULT_DOC_CONFIG.shareMaxDays, reviewWarnDays: DEFAULT_DOC_CONFIG.reviewWarnDays, defaultVisibility: DEFAULT_DOC_CONFIG.defaultVisibility })}>Reset to defaults</Button></div>}
      </div>

      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Who can do what</h2>
        <p className="mt-1 text-sm text-ink-500">Document capabilities by role. These combine with the Documents row in Roles &amp; Permissions, each document’s visibility, and the person’s access to the CRM record it belongs to.</p>
        <div className="mt-4 overflow-x-auto"><table className="crm-table w-full text-xs"><thead><tr className="border-b border-ink-100 text-left dark:border-ink-800"><th className="pb-2 pr-3 font-semibold text-ink-500">Capability</th>{ROLES.map((r) => <th key={r} className="px-1.5 pb-2 text-center font-semibold text-ink-500"><span className="block w-14 truncate" title={r}>{r}</span></th>)}</tr></thead>
          <tbody>{DOC_PERMISSIONS.map(([k, label]) => <tr key={k} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-1.5 pr-3 text-ink-700 dark:text-ink-200">{label}</td>{ROLES.map((r) => <td key={r} className="px-1.5 text-center">{DOC_ROLE_CAPS[r].includes(k) ? <Check size={14} className="mx-auto text-emerald-500" aria-label="Allowed" /> : <Minus size={14} className="mx-auto text-ink-300" aria-label="Not allowed" />}</td>)}</tr>)}</tbody></table></div>
      </div>
    </div>
  )
}
