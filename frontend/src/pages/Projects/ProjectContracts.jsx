import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Unlink, CalendarClock, FileCheck, ListPlus } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { logProjectActivity, emitProjectsChanged } from '../../hooks/useProjects'
import { daysUntil } from '../../utils/projectRules'
import { effectiveStatus } from '../../utils/contractRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { errText } from './projectActions'

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)

/** Contracts linked to the project, with renewal tasks. The link is the contract's projectId; the server records a link / unlink on the contract's audit trail. */
export function ProjectContracts({ project, data, perms, user, onChanged }) {
  const { toast } = useToast()
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const linked = data.contracts.filter((c) => c.projectId === project.id)
  const candidates = data.contracts.filter((c) => c.customerId === project.customerId && !linked.some((l) => l.id === c.id) && (!c.projectId || c.projectId === project.id))
  const done = (m) => { toast(m, { type: 'success' }); emitProjectsChanged(); onChanged?.() }
  const fail = (e) => toast(errText(e), { type: 'error' })

  const link = () => {
    const c = data.contracts.find((x) => x.id === pick)
    if (!c) return
    setBusy(true)
    api.put(`/contracts/${c.id}`, { projectId: project.id })
      .then(() => { setPick(''); done(`${c.number} linked to the project.`) }).catch(fail).finally(() => setBusy(false))
  }
  const unlink = (c) => {
    api.put(`/contracts/${c.id}`, { projectId: null })
      .then(() => done(`${c.number} unlinked.`)).catch(fail)
  }
  const renewalTask = (c) => data.tasks.find((t) => t.id === c.renewalTaskId && !['Cancelled'].includes(t.status)) || data.tasks.find((t) => t.automationKey === `contractRenewal:${c.id}`)
  const createRenewal = (c) => {
    const due = c.renewalDate && c.renewalDate >= today() ? c.renewalDate : c.endDate && addDays(c.endDate, -30) >= today() ? addDays(c.endDate, -30) : addDays(today(), 7)
    setBusy(true)
    api.post('/tasks', {
      title: `Renew contract ${c.number}`, taskType: 'Follow-up', priority: 'High', dueDate: due, reminderMinutes: '1440', assignees: [c.owner || project.manager], relatedType: 'Contract', relatedId: c.id, automationKey: 'contractRenewal:' + c.id,
      description: `Contract ${c.number} (${project.customerName}) ends ${formatDate(c.endDate)}${c.renewalDate ? `; renewal date ${formatDate(c.renewalDate)}` : ''}. Agree the renewal with the client.`, links: {},
    }).then((r) => api.put(`/contracts/${c.id}`, { renewalTaskId: r.data.id }).then(() => logProjectActivity(project, user.id, { type: 'Updated', subject: `Renewal task created for ${c.number}`, taskId: r.data.id, contractId: c.id })))
      .then(() => done(`Renewal task created — due ${formatDate(due)} (it also appears on the Calendar).`)).catch(fail).finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4">
      {perms.edit && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <Select aria-label="Contract to link" value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 !w-auto min-w-[16rem] flex-1 text-sm"><option value="">Link a contract of {project.customerName}…</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.number} · {formatCurrency(c.value, { compact: true })} · ends {formatDate(c.endDate)}</option>)}</Select>
          <Button icon={Link2} disabled={!pick} loading={busy} onClick={link}>Link contract</Button>
          {!candidates.length && <p className="w-full text-xs text-ink-400">No unlinked contracts for this customer. Contracts already tied to another project can’t be linked here.</p>}
        </div>
      )}
      {!linked.length ? <EmptyState icon={FileCheck} title="No contracts linked" description="Link the signed contract so its value, term and renewal date are tracked with the project." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {linked.map((c) => { const left = daysUntil(c.endDate); const t = renewalTask(c); const st = effectiveStatus(c); const expiring = c.endDate && left <= 30 && ['Active', 'Expiring Soon'].includes(st)
            return (
              <section key={c.id} className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-start justify-between gap-2"><div><Link to={`/contracts/${c.id}`} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">{c.number}</Link><p className="text-xs text-ink-400">{c.contractType || c.type || 'Contract'}</p></div><StatusBadge status={st} /></div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[['Contract value', formatCurrency(c.value)], ['Start date', formatDate(c.startDate)], ['End date', formatDate(c.endDate)], ['Renewal date', c.renewalDate ? formatDate(c.renewalDate) : '—']].map(([k, v]) => <div key={k}><dt className="text-xs text-ink-400">{k}</dt><dd className="font-medium text-ink-900 dark:text-ink-50">{v}</dd></div>)}
                </dl>
                {expiring && <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><CalendarClock size={13} />{left < 0 ? `Expired ${-left} day(s) ago` : `Expires in ${left} day(s)`}{t ? '' : ' — no renewal task yet.'}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {t ? <Link to={`/tasks/${t.id}`}><Badge tone="info"><ListPlus size={11} className="mr-1" />Renewal task {t.id} · {t.status}</Badge></Link> : perms.createTasks && ['Active', 'Expiring Soon', 'Expired'].includes(st) && <Button size="sm" variant="secondary" icon={ListPlus} loading={busy} onClick={() => createRenewal(c)}>Create renewal task</Button>}
                  {perms.edit && <Button size="sm" variant="ghost" icon={Unlink} onClick={() => unlink(c)}>Unlink</Button>}
                </div>
              </section>
            ) })}
        </div>
      )}
    </div>
  )
}
