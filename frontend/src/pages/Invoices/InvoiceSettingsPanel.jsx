import { useEffect, useState } from 'react'
import { Plus, Trash2, Save, Check, Minus } from 'lucide-react'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useToast } from '../../context/ToastContext'
import { INVOICE_PERMISSIONS, INVOICE_ROLE_CAPS, PAYMENT_PERMISSIONS, PAYMENT_ROLE_CAPS } from '../../utils/invoiceRules'
import { useInvoiceConfig, saveInvoiceSettings, invErr, invFields } from './invoiceClient'

const box = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'
const ROLES = Object.keys(INVOICE_ROLE_CAPS)

/** Invoice settings: numbering, seller details shown on the PDF, default terms, additional taxes, footer and bank details — stored and validated by the invoice API. */
export function InvoiceSettingsPanel() {
  const { toast } = useToast()
  const { config, ready, me, reload } = useInvoiceConfig()
  const [cfg, setCfg] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const admin = ['Super Admin', 'Admin', 'Accounts'].includes(me?.role)
  useEffect(() => { if (ready) setCfg(JSON.parse(JSON.stringify(config))) }, [ready, config])
  if (!cfg) return <div className={box}><p className="text-sm text-ink-400">Loading…</p></div>
  const set = (p) => setCfg((c) => ({ ...c, ...p }))
  const setOrg = (p) => setCfg((c) => ({ ...c, org: { ...c.org, ...p } }))
  const save = () => {
    setBusy(true); setErrors({})
    saveInvoiceSettings(cfg).then(() => { toast('Invoice settings saved.', { type: 'success' }); reload() }).catch((e) => { setErrors(invFields(e)); toast(invErr(e), { type: 'error' }) }).finally(() => setBusy(false))
  }
  const year = new Date().getFullYear()
  return (
    <div className="space-y-5">
      {!admin && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">You can see these settings, but only finance administrators can change them.</p>}
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Numbering &amp; defaults</h2>
        <p className="mt-1 text-sm text-ink-500">Numbers are unique and never reused, even for cancelled or void invoices. Next number looks like <b>{cfg.prefix}-{year}-00001</b>.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Number prefix" error={errors.prefix}><Input aria-label="Number prefix" disabled={!admin} value={cfg.prefix} onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} /></FormField>
          <FormField label="Default payment terms (days)" error={errors.defaultTermsDays}><Input aria-label="Default payment terms" type="number" min="0" max="180" disabled={!admin} value={cfg.defaultTermsDays} onChange={(e) => set({ defaultTermsDays: e.target.value })} /></FormField>
          <label className="mt-6 flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600" disabled={!admin} checked={cfg.roundOff} onChange={(e) => set({ roundOff: e.target.checked })} />Round grand totals to the nearest rupee</label>
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between"><p className="text-sm font-medium text-ink-800 dark:text-ink-100">Additional taxes</p>{admin && <Button size="sm" variant="secondary" icon={Plus} onClick={() => set({ extraTaxes: [...cfg.extraTaxes, { name: '', rate: '' }] })}>Add tax</Button>}</div>
          <p className="mb-2 text-xs text-ink-500">Applied to the taxable amount of every new invoice, on top of GST (e.g. a cess). Leave empty for none.</p>
          {errors.extraTaxes && <p className="mb-1 text-xs text-rose-500">{errors.extraTaxes}</p>}
          {cfg.extraTaxes.map((t, i) => (
            <div key={i} className="mb-2 flex gap-2"><Input aria-label={`Additional tax ${i + 1} name`} className="max-w-[12rem]" disabled={!admin} value={t.name} placeholder="Name" onChange={(e) => set({ extraTaxes: cfg.extraTaxes.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} /><Input aria-label={`Additional tax ${i + 1} rate`} className="max-w-[7rem]" type="number" disabled={!admin} value={t.rate} placeholder="%" onChange={(e) => set({ extraTaxes: cfg.extraTaxes.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)) })} />{admin && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove additional tax ${i + 1}`} onClick={() => set({ extraTaxes: cfg.extraTaxes.filter((_, k) => k !== i) })} />}</div>
          ))}
        </div>
      </div>
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Seller details (shown on every invoice PDF)</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Company name"><Input disabled={!admin} value={cfg.org.name} onChange={(e) => setOrg({ name: e.target.value })} /></FormField>
          <FormField label="GSTIN" error={errors.gstin}><Input disabled={!admin} value={cfg.org.gstin} onChange={(e) => setOrg({ gstin: e.target.value.toUpperCase() })} /></FormField>
          <FormField label="Address" className="sm:col-span-2"><Textarea disabled={!admin} value={cfg.org.address} onChange={(e) => setOrg({ address: e.target.value })} className="min-h-[60px]" /></FormField>
          <FormField label="PAN"><Input disabled={!admin} value={cfg.org.pan} onChange={(e) => setOrg({ pan: e.target.value })} /></FormField>
          <FormField label="Accounts email"><Input disabled={!admin} value={cfg.org.email} onChange={(e) => setOrg({ email: e.target.value })} /></FormField>
          <FormField label="Phone"><Input disabled={!admin} value={cfg.org.phone} onChange={(e) => setOrg({ phone: e.target.value })} /></FormField>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Bank details"><Textarea disabled={!admin} value={cfg.bankDetails} onChange={(e) => set({ bankDetails: e.target.value })} className="min-h-[90px]" /></FormField>
          <FormField label="Default terms & conditions"><Textarea disabled={!admin} value={cfg.terms} onChange={(e) => set({ terms: e.target.value })} className="min-h-[90px]" /></FormField>
          <FormField label="Footer note" className="sm:col-span-2"><Input disabled={!admin} value={cfg.footer} onChange={(e) => set({ footer: e.target.value })} /></FormField>
        </div>
        {admin && <div className="mt-5"><Button icon={Save} loading={busy} onClick={save}>Save settings</Button></div>}
      </div>
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Payments</h2>
        <p className="mt-1 text-sm text-ink-500">Payment numbers look like <b>{cfg.paymentPrefix}-{year}-00001</b> and are never reused. Methods and bank accounts below are offered when recording a payment.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <FormField label="Payment number prefix" error={errors.paymentPrefix}><Input aria-label="Payment number prefix" disabled={!admin} value={cfg.paymentPrefix} onChange={(e) => set({ paymentPrefix: e.target.value.toUpperCase() })} /></FormField>
        </div>
        {[['paymentMethods', 'Payment methods', 'e.g. Cash, UPI, NEFT'], ['bankAccounts', 'Bank / receiving accounts', 'e.g. HDFC Current ••4521']].map(([key, label, ph]) => (
          <div key={key} className="mt-5">
            <div className="flex items-center justify-between"><p className="text-sm font-medium text-ink-800 dark:text-ink-100">{label}</p>{admin && <Button size="sm" variant="secondary" icon={Plus} onClick={() => set({ [key]: [...(cfg[key] || []), ''] })}>Add</Button>}</div>
            {errors[key] && <p className="mb-1 text-xs text-rose-500">{errors[key]}</p>}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">{(cfg[key] || []).map((v, i) => <div key={i} className="flex gap-2"><Input aria-label={`${label} ${i + 1}`} disabled={!admin} value={v} placeholder={ph} onChange={(e) => set({ [key]: cfg[key].map((x, k) => (k === i ? e.target.value : x)) })} />{admin && <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${label} ${i + 1}`} onClick={() => set({ [key]: cfg[key].filter((_, k) => k !== i) })} />}</div>)}</div>
          </div>
        ))}
        {admin && <div className="mt-5"><Button icon={Save} loading={busy} onClick={save}>Save settings</Button></div>}
        <div className="mt-6 overflow-x-auto"><p className="mb-2 text-sm font-medium text-ink-800 dark:text-ink-100">Who can do what with payments</p><table className="crm-table w-full text-xs"><thead><tr className="border-b border-ink-100 text-left dark:border-ink-800"><th className="pb-2 pr-3 font-semibold text-ink-500">Capability</th>{Object.keys(PAYMENT_ROLE_CAPS).map((r) => <th key={r} className="px-1.5 pb-2 text-center font-semibold text-ink-500"><span className="block w-14 truncate" title={r}>{r}</span></th>)}</tr></thead>
          <tbody>{PAYMENT_PERMISSIONS.map(([k, label]) => <tr key={k} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-1.5 pr-3 text-ink-700 dark:text-ink-200">{label}</td>{Object.keys(PAYMENT_ROLE_CAPS).map((r) => <td key={r} className="px-1.5 text-center">{PAYMENT_ROLE_CAPS[r].includes(k) ? <Check size={14} className="mx-auto text-emerald-500" aria-label="Allowed" /> : <Minus size={14} className="mx-auto text-ink-300" aria-label="Not allowed" />}</td>)}</tr>)}</tbody></table></div>
      </div>
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Who can do what</h2>
        <p className="mt-1 text-sm text-ink-500">Invoice capabilities by role. They combine with the Invoices and Payments rows in Roles &amp; Permissions and each person’s data scope (own, team or organisation). Enforced by the API, not just hidden in the screens.</p>
        <div className="mt-4 overflow-x-auto"><table className="crm-table w-full text-xs"><thead><tr className="border-b border-ink-100 text-left dark:border-ink-800"><th className="pb-2 pr-3 font-semibold text-ink-500">Capability</th>{ROLES.map((r) => <th key={r} className="px-1.5 pb-2 text-center font-semibold text-ink-500"><span className="block w-14 truncate" title={r}>{r}</span></th>)}</tr></thead>
          <tbody>{INVOICE_PERMISSIONS.map(([k, label]) => <tr key={k} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-1.5 pr-3 text-ink-700 dark:text-ink-200">{label}</td>{ROLES.map((r) => <td key={r} className="px-1.5 text-center">{INVOICE_ROLE_CAPS[r].includes(k) ? <Check size={14} className="mx-auto text-emerald-500" aria-label="Allowed" /> : <Minus size={14} className="mx-auto text-ink-300" aria-label="Not allowed" />}</td>)}</tr>)}</tbody></table></div>
      </div>
    </div>
  )
}
