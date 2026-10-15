import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Plus, Pencil, Trash2, Save, Check, Minus } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { useToast } from '../../context/ToastContext'
import { EXPENSE_PERMISSIONS, EXPENSE_ROLE_CAPS } from '../../utils/expenseRules'
import { formatCurrency } from '../../utils/format'
import { useExpenseConfig, useVendors, saveVendor, deleteVendor, saveCategory, deleteCategory, saveExpenseSettings, expErr, expFields } from './expenseClient'

const box = 'rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900'

export function VendorsTab() {
  const { toast } = useToast()
  const { perms } = useExpenseConfig()
  const { vendors } = useVendors()
  const [edit, setEdit] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const save = () => { setBusy(true); setErrors({}); saveVendor(edit.id, edit).then((v) => { toast(`Vendor ${v.name} saved.`, { type: 'success' }); setEdit(null) }).catch((e) => setErrors({ ...expFields(e), _: expErr(e) })).finally(() => setBusy(false)) }
  const remove = (v) => deleteVendor(v.id).then(() => toast('Vendor deleted.', { type: 'success' })).catch((e) => toast(expErr(e), { type: 'error' }))
  const F = (k, label, props = {}) => <FormField label={label} error={errors[k]} required={k === 'name'}><Input aria-label={label} value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...props} /></FormField>
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-ink-500">One record per real vendor — expenses link to it, so a vendor is never duplicated.</p>{perms.manageVendors && <Button icon={Plus} onClick={() => { setErrors({}); setEdit({ name: '' }) }}>Add vendor</Button>}</div>
      {!vendors ? null : !vendors.length ? <EmptyState title="No vendors yet" description="Add the suppliers you pay." /> : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2.5">Vendor</th><th className="px-3">Contact</th><th className="px-3">GSTIN</th><th className="px-3 text-right">Expenses</th><th className="px-3 text-right">Approved cost</th><th className="px-3 text-right">Outstanding</th><th className="px-3">Status</th><th className="w-20" /></tr></thead>
          <tbody>{vendors.map((v) => <tr key={v.id} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-4 py-3"><p className="font-medium text-ink-800 dark:text-ink-100">{v.name}</p><p className="text-[11px] text-ink-400">{v.id}</p></td><td className="px-3 text-xs text-ink-500">{[v.contactName, v.email, v.phone].filter(Boolean).join(' · ') || '—'}</td><td className="px-3 font-mono text-xs">{v.gstin || '—'}</td><td className="px-3 text-right">{v.expenseCount}</td><td className="px-3 text-right">{formatCurrency(v.approved)}</td><td className="px-3 text-right">{formatCurrency(v.outstanding)}</td><td className="px-3"><Badge tone={v.active ? 'success' : 'neutral'}>{v.active ? 'Active' : 'Inactive'}</Badge></td>
            <td className="px-3 text-right">{v.perms.edit && <><button type="button" aria-label={`Edit ${v.name}`} onClick={() => { setErrors({}); setEdit(v) }} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><Pencil size={14} /></button>{v.expenseCount === 0 && <button type="button" aria-label={`Delete ${v.name}`} onClick={() => remove(v)} className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>}</>}</td></tr>)}</tbody></table></div>
      )}
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add vendor'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>{edit.id && <Button variant="secondary" onClick={() => setEdit({ ...edit, active: !edit.active })}>{edit.active ? 'Mark inactive' : 'Mark active'}</Button>}<Button loading={busy} onClick={save}>Save vendor</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">{errors._ && !Object.keys(errors).filter((k) => k !== '_').length && <p className="text-sm text-rose-500 sm:col-span-2">{errors._}</p>}{F('name', 'Vendor name')}{F('contactName', 'Contact person')}{F('email', 'Email')}{F('phone', 'Phone')}{F('gstin', 'GSTIN')}{F('address', 'Address')}<FormField label="Notes" className="sm:col-span-2"><Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="min-h-[50px]" /></FormField></div>
      </Modal>}
    </div>
  )
}

export function CategoriesTab({ expenses }) {
  const { toast } = useToast()
  const { categories, perms } = useExpenseConfig()
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const used = (id) => (expenses || []).filter((e) => e.categoryId === id).length
  const save = () => saveCategory(edit.id, edit).then(() => { toast('Category saved.', { type: 'success' }); setEdit(null) }).catch((e) => setError(expErr(e)))
  const toggle = (c) => saveCategory(c.id, { active: !c.active }).then(() => toast(c.active ? `${c.name} deactivated.` : `${c.name} reactivated.`, { type: 'success' })).catch((e) => toast(expErr(e), { type: 'error' }))
  const remove = (c) => deleteCategory(c.id).then(() => toast('Category deleted.', { type: 'success' })).catch((e) => toast(expErr(e), { type: 'error' }))
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-ink-500">Deactivating a category hides it from new expenses; existing expenses keep it.</p>{perms.manageCategories && <Button icon={Plus} onClick={() => { setError(''); setEdit({ name: '', color: '#6366f1' }) }}>Add category</Button>}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categories.map((c) => <div key={c.id} className={clsx(box, '!p-4 flex items-center gap-3', !c.active && 'opacity-60')}><span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: c.color }} /><div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-800 dark:text-ink-100">{c.name}</p><p className="text-[11px] text-ink-400">{used(c.id)} expense{used(c.id) === 1 ? '' : 's'}{c.active ? '' : ' · inactive'}</p></div>
        {perms.manageCategories && <div className="flex gap-1"><button type="button" aria-label={`Edit ${c.name}`} onClick={() => { setError(''); setEdit(c) }} className="rounded p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"><Pencil size={14} /></button>{!c.system && <button type="button" aria-label={`${c.active ? 'Deactivate' : 'Activate'} ${c.name}`} onClick={() => toggle(c)} className="rounded p-1.5 text-xs text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">{c.active ? 'Off' : 'On'}</button>}{!c.system && used(c.id) === 0 && <button type="button" aria-label={`Delete ${c.name}`} onClick={() => remove(c)} className="rounded p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>}</div>}</div>)}</div>
      {edit && <Modal open onClose={() => setEdit(null)} size="sm" title={edit.id ? 'Edit category' : 'Add category'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="space-y-3">{error && <p className="text-sm text-rose-500">{error}</p>}<FormField label="Name" required><Input aria-label="Category name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></FormField><FormField label="Colour"><input type="color" aria-label="Category colour" className="h-9 w-full rounded-lg border border-ink-200 dark:border-ink-700" value={edit.color || '#6366f1'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></FormField><FormField label="Description"><Input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></FormField></div>
      </Modal>}
    </div>
  )
}

export function PolicyTab() {
  const { toast } = useToast()
  const { config, ready, user, reload } = useExpenseConfig()
  const [cfg, setCfg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const admin = ['Super Admin', 'Admin', 'Accounts'].includes(user?.role)
  useEffect(() => { if (ready) setCfg({ ...config, approvalLimits: { ...(config.approvalLimits || {}) } }) }, [ready, config])
  if (!cfg) return null
  const save = () => { setBusy(true); setError(''); saveExpenseSettings(cfg).then(() => { toast('Expense policy saved.', { type: 'success' }); reload() }).catch((e) => setError(expErr(e))).finally(() => setBusy(false)) }
  const roles = Object.keys(EXPENSE_ROLE_CAPS)
  return (
    <div className="space-y-5">
      {!admin && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">You can see the policy, but only finance administrators can change it.</p>}
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Approval policy</h2>
        {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Number prefix" hint={`Next number: ${cfg.prefix}-${new Date().getFullYear()}-00001 style`}><Input aria-label="Expense prefix" disabled={!admin} value={cfg.prefix} onChange={(e) => setCfg({ ...cfg, prefix: e.target.value.toUpperCase() })} /></FormField>
          <FormField label="Approval due (days)"><Input aria-label="Approval due days" type="number" min="0" disabled={!admin} value={cfg.approvalDueDays} onChange={(e) => setCfg({ ...cfg, approvalDueDays: e.target.value })} /></FormField>
          <FormField label="Reimbursement due (days)"><Input aria-label="Reimbursement days" type="number" min="0" disabled={!admin} value={cfg.reimbursementDays} onChange={(e) => setCfg({ ...cfg, reimbursementDays: e.target.value })} /></FormField>
          <FormField label="Receipt required above (₹)" hint="0 turns the rule off."><Input aria-label="Receipt threshold" type="number" min="0" disabled={!admin} value={cfg.receiptRequiredAbove} onChange={(e) => setCfg({ ...cfg, receiptRequiredAbove: e.target.value })} /></FormField>
          <label className="mt-6 flex items-center gap-2 text-sm text-ink-700 sm:col-span-2 dark:text-ink-200"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" disabled={!admin} checked={!!cfg.allowSelfApproval} onChange={(e) => setCfg({ ...cfg, allowSelfApproval: e.target.checked })} />Allow people to approve / pay their own expenses (not recommended)</label>
        </div>
        <p className="mb-2 mt-5 text-sm font-medium text-ink-800 dark:text-ink-100">Approval limits per approver role</p>
        <div className="grid gap-3 sm:grid-cols-3">{['Sales Manager', 'Project Manager', 'Accounts', 'MD'].map((r) => <FormField key={r} label={r} hint="Blank = no limit"><Input aria-label={`${r} limit`} type="number" min="0" disabled={!admin} value={cfg.approvalLimits[r] ?? ''} onChange={(e) => setCfg({ ...cfg, approvalLimits: { ...cfg.approvalLimits, [r]: e.target.value } })} /></FormField>)}</div>
        {admin && <div className="mt-5"><Button icon={Save} loading={busy} onClick={save}>Save policy</Button></div>}
      </div>
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Who can do what</h2>
        <p className="mt-1 text-sm text-ink-500">Capabilities by role. They combine with the Expenses row in Roles &amp; Permissions and each person’s data scope (own, team or organisation), and are enforced by the API.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-ink-100 text-left dark:border-ink-800"><th className="pb-2 pr-3 font-semibold text-ink-500">Capability</th>{roles.map((r) => <th key={r} className="px-1.5 pb-2 text-center font-semibold text-ink-500"><span className="block w-14 truncate" title={r}>{r}</span></th>)}</tr></thead>
          <tbody>{EXPENSE_PERMISSIONS.map(([k, label]) => <tr key={k} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-1.5 pr-3 text-ink-700 dark:text-ink-200">{label}</td>{roles.map((r) => <td key={r} className="px-1.5 text-center">{EXPENSE_ROLE_CAPS[r].includes(k) ? <Check size={14} className="mx-auto text-emerald-500" aria-label="Allowed" /> : <Minus size={14} className="mx-auto text-ink-300" aria-label="Not allowed" />}</td>)}</tr>)}</tbody></table></div>
      </div>
    </div>
  )
}
