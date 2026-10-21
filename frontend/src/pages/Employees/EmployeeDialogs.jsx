import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { EMPLOYEE_STATUSES, isWorking, todayKey } from '../../utils/employeeRules'
import { changeStatus, grantAccess, bulkAction, orgErr, orgFields } from './employeeClient'
import { genTempPassword } from '../../utils/password'
import { AccessSetup, initialAccess, accessToAccount } from '../UserManagement/AccessSetup'
import { CredentialsCard } from '../UserManagement/AddUserModal'

export function StatusDialog({ employee, onClose, onDone }) {
  const { toast } = useToast()
  const [status, setStatus] = useState(''); const [reason, setReason] = useState(''); const [date, setDate] = useState(todayKey())
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const leaving = status && !isWorking(status)
  const go = () => { setBusy(true); setError(''); changeStatus(employee.id, { status, reason, effectiveDate: date }).then((e) => { toast(`${employee.fullName} is now ${status}.`, { type: 'success' }); (e.warnings || []).forEach((w) => toast(w, { type: 'warning' })); onDone?.(e); onClose() }).catch((x) => setError(orgErr(x))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title={`Change status — ${employee.fullName}`} description={`Currently ${employee.status}. The change is recorded with date, reason and your name. People who leave stay on record; deleting someone for good is a separate action.`} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={leaving ? 'danger' : 'primary'} loading={busy} disabled={!status || (leaving && reason.trim().length < 3)} onClick={go}>Change status</Button></>}>
      <div className="space-y-3">{error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <FormField label="New status" required><Select aria-label="New status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Select a status</option>{EMPLOYEE_STATUSES.filter((s) => s !== employee.status).map((s) => <option key={s}>{s}</option>)}</Select></FormField>
        {['Resigned', 'Terminated', 'Inactive'].includes(status) && <FormField label="Effective date"><Input aria-label="Effective date" type="date" max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} /></FormField>}
        <FormField label={leaving ? 'Reason' : 'Note (optional)'} required={leaving}><Textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[60px]" /></FormField>
        {leaving && employee.crmAccess && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Their CRM login will be deactivated. Existing tasks, deals, leads, projects and tickets keep their name.</p>}</div>
    </Modal>
  )
}

export function AccessDialog({ employee, onClose, onDone }) {
  const [access, setAccess] = useState(() => initialAccess('Employee', 'Employee', employee.branch || ''))
  const [username, setUsername] = useState((employee.officialEmail || '').split('@')[0] || '')
  const [password, setPassword] = useState(() => genTempPassword())
  const [showPw, setShowPw] = useState(true)
  const [force, setForce] = useState(true)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null)
  const go = () => {
    setBusy(true); setError('')
    const a = accessToAccount(access)
    grantAccess(employee.id, { accessLevel: a.accessLevel, branch: a.branch, role: a.role, permissions: a.permissions, username, password, forcePasswordChange: force }).then((r) => { setDone(r); onDone?.(r) }).catch((x) => setError(orgErr(x))).finally(() => setBusy(false))
  }
  if (done?.account) return <CredentialsCard account={done.account} onClose={onClose} />
  return (
    <Modal open onClose={onClose} size="xl" title={`CRM login - ${employee.fullName}`} description="Only the Super Admin can do this: choose the role, tick exactly which modules the person may use, and issue their login. It is active immediately - there is no verification step." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!username || password.length < 8 || !access.branch} onClick={go}>Create login</Button></>}>
      <div className="space-y-5">
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <AccessSetup value={access} onChange={setAccess} />
        <div className="grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 dark:border-ink-800">
          <FormField label="Username" required hint="They can sign in with this or their official email."><Input aria-label="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} /></FormField>
          <FormField label="Password" required hint="At least 8 characters.">
            <div className="flex gap-2"><Input aria-label="Password" autoComplete="new-password" type={showPw ? 'text' : 'password'} className="flex-1 font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="button" variant="secondary" onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</Button><Button type="button" variant="secondary" onClick={() => setPassword(genTempPassword())}>Generate</Button></div>
          </FormField>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" /> Ask for a new password at first sign-in</label>
        </div>
      </div>
    </Modal>
  )
}

const ACTIONS = [['department', 'Assign department'], ['team', 'Assign team'], ['teamLeader', 'Change team leader'], ['status', 'Change status'], ['activate', 'Activate'], ['deactivate', 'Deactivate']]
export function BulkDialog({ ids, org, roles, perms, onClose, onDone }) {
  const { toast } = useToast()
  const { departments = [], teams = [], employees = [] } = org
  const [action, setAction] = useState(''); const [v, setV] = useState({}); const [reason, setReason] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [result, setResult] = useState(null)
  const leaders = employees.filter((e) => e.isTeamLeader && isWorking(e.status))
  const needsReason = action === 'deactivate' || (action === 'status' && v.status && !isWorking(v.status))
  const ready = action && ((action === 'department' && v.departmentId) || (action === 'team' && v.teamId) || (action === 'teamLeader' && v.leaderId) || (action === 'status' && v.status) || action === 'activate' || action === 'deactivate' || (action === 'role' && v.role)) && (!needsReason || reason.trim().length >= 3)
  const go = () => { setBusy(true); setError(''); bulkAction({ ids, action, ...v, reason, confirm: true }).then((r) => { setResult(r); toast(`${r.ok} updated${r.failed ? `, ${r.failed} could not be changed` : ''}.`, { type: r.failed ? 'warning' : 'success' }); onDone?.(r) }).catch((x) => setError(orgErr(x))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="md" title={`Bulk action — ${ids.length} employee${ids.length === 1 ? '' : 's'}`} description="Only the selected employees are changed. You will be asked to confirm." footer={result ? <Button onClick={onClose}>Close</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button>{!confirm ? <Button disabled={!ready} onClick={() => setConfirm(true)}>Review</Button> : <Button loading={busy} onClick={go}>Confirm for {ids.length}</Button>}</>}>
      {result ? <div className="space-y-2 text-sm"><p className="font-medium">{result.ok} updated · {result.failed} not changed</p>{result.results.filter((r) => !r.ok).length > 0 && <ul className="max-h-40 overflow-y-auto text-xs text-rose-600">{result.results.filter((r) => !r.ok).map((r) => <li key={r.id}>{r.id}: {r.error}</li>)}</ul>}</div> : (
        <div className="space-y-3">{error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
          <FormField label="Action"><Select aria-label="Bulk action" value={action} onChange={(e) => { setAction(e.target.value); setV({}); setConfirm(false) }}><option value="">Choose an action</option>{ACTIONS.filter(([k]) => k !== 'role' || perms.assignRole).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
          {action === 'department' && <FormField label="Department"><Select aria-label="Department" value={v.departmentId || ''} onChange={(e) => setV({ departmentId: e.target.value })}><option value="">Select</option>{departments.filter((d) => d.status === 'Active').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FormField>}
          {action === 'team' && <FormField label="Team"><Select aria-label="Team" value={v.teamId || ''} onChange={(e) => setV({ teamId: e.target.value })}><option value="">Select</option>{teams.filter((t) => t.status === 'Active' && !t.parentTeamId).map((t) => <option key={t.id} value={t.id}>{t.departmentName} · {t.name}</option>)}</Select></FormField>}
          {action === 'teamLeader' && <FormField label="New team leader" hint="Selected people move to this leader’s team and report to them."><Select aria-label="Team leader" value={v.leaderId || ''} onChange={(e) => setV({ leaderId: e.target.value })}><option value="">Select</option>{leaders.map((l) => <option key={l.id} value={l.id}>{l.fullName} · {l.ledTeams.map((t) => t.name).join(', ')}</option>)}</Select></FormField>}
          {action === 'status' && <FormField label="Status"><Select aria-label="Status" value={v.status || ''} onChange={(e) => setV({ status: e.target.value })}><option value="">Select</option>{EMPLOYEE_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></FormField>}
          {needsReason && <FormField label="Reason" required><Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>}
          {confirm && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" />This will change {ids.length} employee record{ids.length === 1 ? '' : 's'}. Each change is added to that person’s history.</p>}</div>
      )}
    </Modal>
  )
}

void orgFields
