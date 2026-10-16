import { useEffect, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { isWorking } from '../../utils/employeeRules'
import { fetchDeleteImpact, fetchEmployeeChoices, deletePerson, orgErr } from './employeeClient'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Deleting a person, from Employees or User Management: the same dialog and the same server operation (login + employee record go together). */
export function DeletePersonDialog({ employeeId, accountId, name, onClose, onDone }) {
  const { toast } = useToast()
  const [impact, setImpact] = useState(null)
  const [choices, setChoices] = useState([])
  const [heir, setHeir] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchDeleteImpact(employeeId, accountId).then((i) => { if (alive) setImpact(i) }).catch((x) => { if (alive) setError(orgErr(x, 'Could not check what deleting this person affects.')) })
    fetchEmployeeChoices().then((all) => { if (alive) setChoices(all) }).catch(() => null)
    return () => { alive = false }
  }, [employeeId, accountId])

  const owned = impact?.owned || {}
  const kinds = Object.entries(owned)
  const heirs = choices.filter((c) => c.id !== employeeId && isWorking(c.status) && (!impact?.branch || c.branch === impact.branch))
  const go = () => {
    setBusy(true); setError('')
    deletePerson(employeeId, heir || undefined, accountId)
      .then((r) => { toast(`${r.name || name} was deleted${r.loginRemoved ? ' and can no longer sign in' : ''}.`, { type: 'success' }); onDone?.(r); onClose() })
      .catch((x) => setError(orgErr(x, 'Could not delete this person.')))
      .finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="sm" title={`Delete ${name}?`}
      description={`This permanently removes ${name}${impact?.hasLogin ? ' and their CRM login' : ''}. It cannot be undone.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!impact || !impact.allowed} onClick={go}>Delete {name}</Button></>}>
      <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        {impact && !impact.allowed && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">{impact.reason}</p>}
        {impact?.allowed && <>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {impact.hasLogin ? <li>Their {impact.accessLevel} login is removed and every session they have ends now — they can no longer sign in.</li> : <li>They have no CRM login.</li>}
            {impact.directReports > 0 && <li>{plural(impact.directReports, 'person')} reporting to them will report to their manager instead.</li>}
            <li>Leads, deals, tasks, tickets and other records are never deleted; their activity history and the audit trail are kept.</li>
          </ul>
          {kinds.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">They currently own {kinds.map(([k, n]) => `${n} ${k}`).join(', ')}. {heir ? 'These go to the colleague chosen below.' : 'Without a colleague below, these are left unassigned.'}</p>}
          {kinds.length > 0 && <FormField label="Hand their work to (optional)"><Select aria-label="Hand their work to" value={heir} onChange={(e) => setHeir(e.target.value)}><option value="">Leave unassigned</option>{heirs.map((c) => <option key={c.id} value={c.id}>{c.fullName}{c.designation ? ` — ${c.designation}` : ''}</option>)}</Select></FormField>}
        </>}
        {!impact && !error && <p className="text-xs text-ink-400">Checking what this affects…</p>}
      </div>
    </Modal>
  )
}
