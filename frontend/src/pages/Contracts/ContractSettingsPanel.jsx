import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, X, Save, FileText } from 'lucide-react'
import { FormField, Input } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useContractSettings, saveContractTypes as saveTypes, saveContractConfig as saveConfig } from '../../hooks/useContracts'
import { DEFAULT_CONTRACT_TYPES, DEFAULT_CONTRACT_CONFIG } from '../../utils/contractRules'

const REMINDER_CHOICES = [120, 90, 60, 45, 30, 15, 7, 3]

/** Admin settings for the Contracts module: contract types, the approval step, renewal reminders and the expiring-soon window. */
export function ContractSettingsPanel() {
  const { toast } = useToast()
  const fail = (e) => toast(e?.response?.data?.message || 'The settings could not be saved.', { type: 'error' })
  const saveContractTypes = (t, message) => saveTypes(t).then(() => { if (message) toast(message, { type: 'success' }) }).catch(fail)
  const saveContractConfig = (c, message) => saveConfig(c).then(() => { if (message) toast(message, { type: 'success' }) }).catch(fail)
  const { user } = useAuth()
  const { types, config } = useContractSettings()
  const admin = ['Super Admin', 'Admin'].includes(user?.role)
  const [draft, setDraft] = useState('')
  const [cfg, setCfg] = useState(config)
  useEffect(() => { setCfg(config) }, [config])
  const set = (p) => setCfg((c) => ({ ...c, ...p }))

  const addType = () => {
    const t = draft.trim()
    if (!t) return
    if (types.some((x) => x.toLowerCase() === t.toLowerCase())) { toast(`“${t}” already exists.`, { type: 'error' }); return }
    saveContractTypes([...types, t], `“${t}” added.`); setDraft('')
  }
  const removeType = (t) => { if (types.length <= 1) return; saveContractTypes(types.filter((x) => x !== t), `“${t}” removed — existing contracts keep their type.`) }
  const toggleDay = (d) => set({ reminderDays: cfg.reminderDays.includes(d) ? cfg.reminderDays.filter((x) => x !== d) : [...cfg.reminderDays, d].sort((a, b) => b - a) })
  const save = () => {
    if (!cfg.reminderDays.length) { toast('Pick at least one reminder.', { type: 'error' }); return }
    const n = (v, lo, hi, fb) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : fb }
    saveContractConfig({ ...cfg, expiringSoonDays: n(cfg.expiringSoonDays, 7, 365, DEFAULT_CONTRACT_CONFIG.expiringSoonDays), renewalTaskDays: n(cfg.renewalTaskDays, 7, 180, DEFAULT_CONTRACT_CONFIG.renewalTaskDays) }, 'Contract settings saved.')
  }

  const box = 'rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900'
  return (
    <div className="space-y-5">
      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Contract types</h2>
        <p className="mt-1 text-sm text-ink-500">Types offered when creating a contract and filtering the list. {admin ? '' : 'Only an Admin can change them.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {types.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">{t}{admin && <button type="button" aria-label={`Remove ${t}`} onClick={() => removeType(t)} className="text-ink-400 hover:text-rose-500"><X size={12} /></button>}</span>
          ))}
        </div>
        {admin && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addType()} placeholder="Add a contract type…" aria-label="New contract type" className="max-w-xs" />
            <Button variant="secondary" icon={Plus} onClick={addType}>Add</Button>
            <Button variant="ghost" onClick={() => saveContractTypes(DEFAULT_CONTRACT_TYPES)}>Restore defaults</Button>
          </div>
        )}
      </div>

      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Workflow &amp; renewals</h2>
        <div className="mt-4 space-y-5">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600" disabled={!admin} checked={cfg.approvalRequired} onChange={(e) => set({ approvalRequired: e.target.checked })} />
            <span><b className="text-ink-900 dark:text-ink-50">Require approval before sending</b><span className="block text-xs text-ink-500">On: Draft → Internal Review → Pending Approval → Approved. Off: a draft can be approved directly by someone with approval rights.</span></span>
          </label>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-800 dark:text-ink-100">Renewal reminders (days before expiry)</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Reminder days">
              {REMINDER_CHOICES.map((d) => <button key={d} type="button" disabled={!admin} aria-pressed={cfg.reminderDays.includes(d)} onClick={() => toggleDay(d)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${cfg.reminderDays.includes(d) ? 'bg-brand-600 text-white ring-brand-600' : 'text-ink-600 ring-ink-200 dark:text-ink-300 dark:ring-ink-700'}`}>{d} days</button>)}
            </div>
            <p className="mt-1.5 text-xs text-ink-500">The contract owner (and project manager) get an in-app reminder at each point. No email or WhatsApp is sent.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Expiring Soon window (days)" hint="A live contract shows as Expiring Soon this many days before its end date."><Input type="number" min="7" max="365" disabled={!admin} value={cfg.expiringSoonDays} onChange={(e) => set({ expiringSoonDays: e.target.value })} /></FormField>
            <FormField label="Create renewal task (days before expiry)" hint="A Renewal Follow-up task and calendar reminder are created automatically."><Input type="number" min="7" max="180" disabled={!admin} value={cfg.renewalTaskDays} onChange={(e) => set({ renewalTaskDays: e.target.value })} /></FormField>
          </div>
          {admin && <Button icon={Save} onClick={save}>Save settings</Button>}
        </div>
      </div>

      <div className={box}>
        <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">Contract templates</h2>
        <p className="mt-1 text-sm text-ink-500">Reusable wording with {'{{CRM fields}}'} — upload a Word or PDF file or write your own.</p>
        <Link to="/contracts/templates" className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700"><FileText size={15} />Manage templates</Link>
      </div>
    </div>
  )
}
