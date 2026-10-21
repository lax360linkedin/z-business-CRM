import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, Trash2, ShieldAlert, FileSignature, Send, CheckCircle2, XCircle, RotateCcw, RefreshCcw, Play, Ban, Undo2, FileText, ClipboardList, CalendarPlus, Phone, ExternalLink, History, Briefcase, CalendarDays, Plus, AlertTriangle, Wand2, MessageSquare, Wallet, Receipt, BellRing, ListChecks } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Dropdown, DropdownItem } from '../../components/common/Dropdown'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { useContractsData, useContractAccess, useContractSettings, emitContractsChanged } from '../../hooks/useContracts'
import { allowedTransitions, isRejection, renewalState, contractBilling, nextBillingDate, noticeDeadline, daysUntil, addDaysKey, todayKey } from '../../utils/contractRules'
import { taskStats } from '../../utils/projectRules'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { localDate } from '../../utils/calendarRules'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { useTaskActions } from '../Tasks/TaskActions'
import { TaskMenu, StatusSelect } from '../Tasks/TaskViews'
import { DueLabel, AssigneeStack, PriorityMark } from '../Tasks/TaskBits'
import { Countdown } from './Contracts'
import { ContractFormDialog } from './ContractFormDialog'
import { ContractStatusDialog } from './ContractStatusDialog'
import { ContractDocuments } from './ContractDocuments'
import { GenerateContractDialog } from './GenerateContractDialog'
import { ContractActivityDialog } from './ContractActivityDialog'
import { renewContract, saveContract, errText } from './contractActions'
import { logContractActivity } from '../../hooks/useContracts'


const Card = ({ title, action, children, className }) => (
  <section className={clsx("min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900", className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const Chip = ({ to, label, value }) => value ? <Link to={to} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{label}</span><span className="truncate font-medium">{value}</span></Link> : null
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>
const Link2 = ({ to, children }) => <Link to={to} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{children}</Link>
const Linked = ({ title, to, rows, empty }) => (
  <Card title={title} action={to && <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><ExternalLink size={12} />Open</Link>}>
    {rows ? <dl className="divide-y divide-ink-50 dark:divide-ink-800/60">{rows.map(([k, v]) => <KV key={k} k={k}>{v}</KV>)}</dl> : <p className="text-sm text-ink-400">{empty}</p>}
  </Card>
)

const TASK_PRESETS = [
  ['Review Contract', 'Review the contract wording', 2], ['Obtain Client Signature', 'Obtain the client’s signature', 7], ['Send Contract', 'Send the contract to the client', 1],
  ['Follow up for Signature', 'Follow up with the client for the signature', 5], ['Renewal Follow-up', 'Renewal follow-up', 0], ['Collect Required Documents', 'Collect the documents needed for this contract', 3],
]
const ACTIVITY_TONE = { Meeting: 'bg-emerald-50 text-emerald-600', Call: 'bg-sky-50 text-sky-600', Email: 'bg-brand-50 text-brand-600', WhatsApp: 'bg-emerald-50 text-emerald-600', Note: 'bg-ink-100 text-ink-600', StatusChange: 'bg-violet-50 text-violet-600', Created: 'bg-brand-50 text-brand-600', Attachment: 'bg-ink-100 text-ink-600', Task: 'bg-amber-50 text-amber-600', Invoice: 'bg-sky-50 text-sky-600', Payment: 'bg-emerald-50 text-emerald-600', Audit: 'bg-violet-50 text-violet-600', Reminder: 'bg-amber-50 text-amber-600' }
const LABEL = { 'Internal Review': 'Submit for review', 'Pending Approval': 'Submit for approval', Approved: 'Approve', Sent: 'Mark as sent', Signed: 'Record signature', Active: 'Activate', Terminated: 'Terminate', Cancelled: 'Cancel', Draft: 'Return to draft' }
const ICON = { 'Internal Review': ClipboardList, 'Pending Approval': ClipboardList, Approved: CheckCircle2, Sent: Send, Signed: FileSignature, Active: Play, Terminated: Ban, Cancelled: XCircle, Draft: Undo2 }

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data, error, reload } = useContractsData()
  const { user, can, canView } = useContractAccess(data?.projects)
  const { config } = useContractSettings()
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [calEvents, setCalEvents] = useState([])
  const [edit, setEdit] = useState(false)
  const [statusTo, setStatusTo] = useState(null)
  const [logOpen, setLogOpen] = useState(null)
  const [genOpen, setGenOpen] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [taskForm, setTaskForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const taskActions = useTaskActions({ onChanged: () => reload() })

  const contract = data?.contracts.find((c) => c.id === id)
  const loadExtra = useCallback(() => {
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data)).catch(() => {})
    api.get('/calendar/events').then((r) => setCalEvents(r.data.events)).catch(() => {})
  }, [])
  useEffect(() => { loadExtra() }, [loadExtra, id])
  useEffect(() => { const h = () => loadExtra(); window.addEventListener('crm:contracts-changed', h); window.addEventListener('crm:tasks-changed', h); return () => { window.removeEventListener('crm:contracts-changed', h); window.removeEventListener('crm:tasks-changed', h) } }, [loadExtra])

  const view = useMemo(() => {
    if (!data || !contract) return null
    const f = (col, rid) => (rid ? data[col].find((x) => x.id === rid) : null)
    const perms = can(contract)
    const tasks = data.tasks.filter((t) => t.links?.contractId === id || (t.relatedType === 'Contract' && t.relatedId === id))
    const project = f('projects', contract.projectId)
    const projectTasks = project ? data.tasks.filter((t) => t.links?.projectId === project.id || (t.relatedType === 'Project' && t.relatedId === project.id)) : []
    const rs = renewalState(contract, { tasks: data.tasks, contracts: data.contracts, config })
    return {
      perms, tasks, project, projectTasks, rs, status: rs.status, billing: perms.viewFinancial ? contractBilling(contract, data.invoices, data.payments, data.contracts) : null,
      customer: f('customers', contract.customerId), company: f('companies', contract.companyId), contact: f('contacts', contract.contactId), deal: f('deals', contract.dealId), proposal: f('proposals', contract.proposalId),
      quotation: f('quotations', contract.quotationId), salesOrder: f('salesOrders', contract.salesOrderId), docs: data.documents.filter((d) => d.contractId === id),
    }
  }, [data, contract, id, user?.id, config]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => activities.filter((a) => (a.relatedType === 'Contract' && a.relatedId === id) || a.links?.contractId === id), [activities, id])
  const events = useMemo(() => calEvents.filter((e) => (e.relatedType === 'Contract' && e.relatedId === id) || e.related?.some((r) => r.type === 'Contract' && r.id === id)).filter((e) => e.kind !== 'deadline' || e.state !== 'done'), [calEvents, id])

  const timeline = useMemo(() => {
    if (!view) return []
    const out = []
    const sys = mine.filter((a) => a.source === 'system')
    mine.filter((a) => a.source !== 'task').forEach((a) => out.push({ key: a.id, at: a.date, type: a.type, text: a.subject || a.type, by: a.by, note: a.notes }))
    ;(contract.audit || []).forEach((a) => {
      const near = sys.some((s) => s.by === a.by && Math.abs(new Date(s.date) - new Date(a.at)) < 6000)
      if (!near) out.push({ key: a.id, at: a.at, type: 'Audit', text: `${a.action}${a.field ? ` — ${a.field}` : ''}${a.from ? `: ${a.from} → ${a.to ?? '—'}` : a.to ? `: ${a.to}` : ''}`, by: a.by, note: a.note })
    })
    view.tasks.forEach((t) => {
      out.push({ key: `tc-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy, href: `/tasks/${t.id}` })
      if (t.completedAt) out.push({ key: `td-${t.id}`, at: t.completedAt, type: 'Task', text: `Task completed: ${t.title}`, by: t.completedBy, href: `/tasks/${t.id}` })
    })
    if (view.billing) {
      view.billing.issued.forEach((i) => out.push({ key: `iv-${i.id}`, at: i.createdAt || `${i.issueDate}T09:00:00Z`, type: 'Invoice', text: `Invoice raised: ${i.number} (${formatCurrency(i.amount)})`, by: i.createdBy, href: `/invoices/${i.id}` }))
      view.billing.payments.forEach((p) => out.push({ key: `pm-${p.id}`, at: p.date && p.date.length === 10 ? `${p.date}T12:00:00Z` : p.date, type: 'Payment', text: `Payment recorded: ${formatCurrency(p.amount)} on ${p.invoiceNumber}`, by: p.recordedBy, href: `/invoices/${p.invoiceId}` }))
    }
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [view, mine, contract])

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load the contract" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />
  if (!data) return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (!contract) return <EmptyState icon={FileSignature} title="Contract not found" description={`${id} doesn’t exist — it may have been deleted.`} action={<Button variant="secondary" onClick={() => navigate('/contracts')}>Back to contracts</Button>} />
  if (!canView(contract)) return <EmptyState icon={ShieldAlert} title="You don’t have access to this contract" description="Contracts are visible to their owner, team and the roles your organisation has granted. Ask the contract owner to add you." action={<Button variant="secondary" onClick={() => navigate('/contracts')}>Back to contracts</Button>} />

  const { perms, tasks, project, projectTasks, rs, status, billing, customer, company, contact, deal, proposal, quotation, salesOrder, docs } = view
  const done = (m) => { if (m) toast(m, { type: 'success' }); emitContractsChanged(); reload(); loadExtra() }
  const fail = (e) => toast(errText(e), { type: 'error' })
  const transitions = allowedTransitions(contract, perms, config)
  const related = { customer, company, contact, owner: getUserById(contract.owner), project, deal, quotation, salesOrder }
  const stats = taskStats(tasks)
  const pStats = taskStats(projectTasks)
  const left = daysUntil(contract.endDate)
  const reminders = [...config.reminderDays].sort((a, b) => b - a).map((d) => ({ days: d, date: addDaysKey(contract.endDate.slice(0, 10), -d) }))
  const chain = (() => {
    const back = []; let c = contract
    while (c?.renewedFromId) { c = data.contracts.find((x) => x.id === c.renewedFromId); if (c) back.unshift(c) }
    const fwd = []; c = contract
    while (c?.renewedToId) { c = data.contracts.find((x) => x.id === c.renewedToId); if (c) fwd.push(c) }
    return [...back, contract, ...fwd]
  })()

  const doRenew = () => {
    setBusy(true)
    renewContract(contract, { perms }).then((c) => { setRenewOpen(false); toast(`Renewal contract ${c.number} created as a draft.`, { type: 'success' }); emitContractsChanged(); navigate(`/contracts/${c.id}`) }).catch((e) => { setRenewOpen(false); fail(e) }).finally(() => setBusy(false))
  }
  const remove = () => {
    const blockers = [docs.length && `${docs.length} document(s)`, view.billing?.invoices.length && `${view.billing.invoices.length} invoice(s)`, tasks.length && `${tasks.length} task(s)`, contract.renewedFromId && 'a renewal link'].filter(Boolean)
    if (blockers.length) { setDelOpen(false); toast(`This contract has ${blockers.join(', ')} — cancel it instead of deleting so the history is kept.`, { type: 'error' }); return }
    api.delete(`/contracts/${contract.id}`)
      .then(() => { toast('Contract deleted.', { type: 'success' }); emitContractsChanged(); navigate('/contracts') }).catch(fail)
  }
  const notRenewing = () => saveContract(contract, { renewalDecision: 'not-renewing' }, user.id, [{ action: 'Renewal decision', field: 'Renewal', from: rs.label, to: 'Not renewing' }], { type: 'Updated', subject: 'Marked as not renewing' }).then(() => done('Marked as not renewing.')).catch(fail)
  const reconsider = () => saveContract(contract, { renewalDecision: null }, user.id, [{ action: 'Renewal decision', field: 'Renewal', from: 'Not renewing', to: 'Open' }], { type: 'Updated', subject: 'Renewal decision reopened' }).then(() => done('Renewal reopened.')).catch(fail)
  const afterTask = (task, preset) => {
    if (!task?.id) return
    logContractActivity(contract, user.id, { type: 'Task', subject: `Task created: ${task.title}`, taskId: task.id })
    if (preset === 'Renewal Follow-up' && !contract.renewalTaskId) saveContract(contract, { renewalTaskId: task.id }, user.id, [{ action: 'Renewal task created', field: 'Renewal task', to: task.title }]).then(() => done())
    else done()
  }
  const startTask = ([key, title, offset]) => setTaskForm({ key, preset: { title: `${title} — ${contract.number}`, description: `${contract.title} (${contract.customerName})`, dueDate: key === 'Renewal Follow-up' ? (noticeDeadline(contract) && noticeDeadline(contract) >= todayKey() ? noticeDeadline(contract) : todayKey()) : addDaysKey(todayKey(), offset), assignees: [contract.owner] } })

  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'details', label: 'Contract details' }, { value: 'documents', label: 'Documents', count: docs.length }, { value: 'parties', label: 'Customer & contact' },
    { value: 'linked', label: 'Deal · Quotation · Order' }, { value: 'project', label: 'Project' }, { value: 'tasks', label: 'Tasks', count: stats.total }, { value: 'activities', label: 'Activities', count: mine.length }, { value: 'calendar', label: 'Calendar', count: events.length },
    ...(billing ? [{ value: 'billing', label: 'Invoices & payments', count: billing.invoices.length }] : []), { value: 'renewals', label: 'Renewals' }, { value: 'timeline', label: 'Timeline' }]
  const next = events.filter((e) => e.date >= localDate(new Date()) && e.state !== 'done').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Contracts', href: '/contracts' }, { label: contract.number }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/contracts" aria-label="Back to contracts" className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{contract.number}</span>
            <StatusBadge status={status} /><Badge>{contract.contractType}</Badge>
            {status === 'Expired' && <Badge tone="danger">Expired {-left}d ago</Badge>}
            {status === 'Expiring Soon' && <Badge tone="warning">{left}d left</Badge>}
            {contract.renewedFromId && <Badge tone="info">Renewal</Badge>}
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{contract.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-500">
            <span>Customer <Link2 to={`/customers/${contract.customerId}`}>{contract.customerName}</Link2></span>
            {company && <span>Company <Link2 to={`/companies/${company.id}`}>{company.name}</Link2></span>}
            <span className="inline-flex items-center gap-1.5">Owner <Avatar name={getUserById(contract.owner)?.name} size="xs" /><b className="font-medium text-ink-800 dark:text-ink-100">{getUserById(contract.owner)?.name}</b></span>
            {billing && <span>Value <b className="font-semibold text-ink-900 dark:text-ink-50">{formatCurrency(billing.value)}</b></span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-500">
            <span>Start <b className="font-medium text-ink-800 dark:text-ink-100">{formatDate(contract.startDate)}</b></span><span className="inline-flex items-center gap-1.5">End <Countdown contract={contract} status={status} className="!flex-row !gap-1.5" /></span>
            <span>Renewal <b className="font-medium text-ink-800 dark:text-ink-100">{contract.renewalDate ? formatDate(contract.renewalDate) : '—'}</b></span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {perms.edit && <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>}
          {transitions.map((s) => {
            const rej = isRejection(status, s)
            const Icon = rej ? XCircle : ICON[s]
            return <Button key={s} variant={['Cancelled', 'Terminated'].includes(s) ? 'ghost' : ['Approved', 'Signed', 'Active', 'Sent'].includes(s) ? 'primary' : 'secondary'} icon={Icon} onClick={() => setStatusTo(s)}>{rej ? (s === 'Draft' ? 'Reject' : 'Return for review') : LABEL[s]}</Button>
          })}
          {perms.renew && !contract.renewedToId && ['Active', 'Expiring Soon', 'Expired'].includes(status) && !rs.renewal && <Button variant="secondary" icon={RefreshCcw} onClick={() => setRenewOpen(true)}>Renew</Button>}
          {perms.generate && <Button variant="secondary" icon={Wand2} onClick={() => setGenOpen(true)}>Generate</Button>}
          {perms.createTasks && (
            <Dropdown width="w-60" trigger={<Button variant="secondary" icon={Plus}>Task</Button>}>
              {TASK_PRESETS.map((p) => <DropdownItem key={p[0]} onClick={() => startTask(p)}>{p[0]}</DropdownItem>)}
              <DropdownItem onClick={() => setTaskForm({ key: 'custom', preset: { assignees: [contract.owner] } })}>Other task…</DropdownItem>
            </Dropdown>
          )}
          {perms.edit && <Button variant="secondary" icon={CalendarPlus} onClick={() => setLogOpen('Meeting')}>Log activity</Button>}
          {perms.delete && <Button variant="ghost" icon={Trash2} onClick={() => setDelOpen(true)} aria-label="Delete contract" />}
        </div>
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {billing ? <><Stat label="Contract value" value={formatCurrency(billing.value, { compact: true })} /><Stat label="Invoiced" value={formatCurrency(billing.invoiced, { compact: true })} /><Stat label="Paid" value={formatCurrency(billing.paid, { compact: true })} tone="emerald" /><Stat label="Outstanding" value={formatCurrency(billing.outstanding, { compact: true })} tone={billing.outstanding > 0 ? 'rose' : null} /></> : <><Stat label="Billing frequency" value={contract.billingFrequency} /><Stat label="Payment terms" value={contract.paymentTerms || '—'} /></>}
            <Stat label="Days to expiry" value={['Renewed', 'Terminated', 'Cancelled'].includes(status) ? '—' : left < 0 ? `Expired ${-left}d` : left} tone={left < 0 ? 'rose' : left <= 60 ? 'amber' : null} /><Stat label="Renewal" value={rs.label} />
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
              <Card title="Scope"><p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{contract.scope || 'No scope recorded.'}</p></Card>
              {contract.approval?.rejectionReason && ['Draft', 'Internal Review'].includes(status) && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Returned by {getUserById(contract.approval.rejectedBy)?.name || 'an approver'} {contract.approval.rejectedAt ? timeAgo(contract.approval.rejectedAt) : ''}: {contract.approval.rejectionReason}</p>}
              <div className="grid gap-5 sm:grid-cols-2">
                <Card title="Coming up" action={<Link to={`/calendar?relatedType=Contract&relatedId=${contract.id}`} className="text-xs font-medium text-brand-600 hover:underline">Calendar</Link>}>
                  {next.length ? <ul className="space-y-2">{next.map((e) => <li key={e.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{e.title}</span><span className="shrink-0 text-xs text-ink-400">{formatDate(e.date)}</span></li>)}</ul> : <p className="text-sm text-ink-400">Nothing scheduled.</p>}
                </Card>
                <Card title="Open tasks" action={<button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setTab('tasks')}>All</button>}>
                  {stats.open ? <ul className="space-y-2">{tasks.filter((t) => !['Completed', 'Cancelled'].includes(t.status)).slice(0, 4).map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 text-sm hover:underline"><span className="truncate">{t.title}</span><span className={clsx('shrink-0 text-xs', t.overdue ? 'font-semibold text-rose-600' : 'text-ink-400')}>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul> : <p className="text-sm text-ink-400">No open tasks.</p>}
                </Card>
              </div>
            </div>
            <div className="min-w-0 space-y-5">
              <Card title="Key details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
                <KV k="Owner">{getUserById(contract.owner)?.name}</KV><KV k="Type">{contract.contractType}</KV><KV k="Start date">{formatDate(contract.startDate)}</KV><KV k="End date">{formatDate(contract.endDate)}</KV>
                <KV k="Renewal date">{contract.renewalDate ? formatDate(contract.renewalDate) : '—'}</KV><KV k="Notice period">{contract.noticePeriodDays ? `${contract.noticePeriodDays} days` : '—'}</KV><KV k="Auto-renewal">{contract.autoRenew ? 'Yes' : 'No'}</KV>
                <KV k="Billing">{contract.billingFrequency}</KV>{billing && <KV k="Next billing">{billing.nextBillingDate ? formatDate(billing.nextBillingDate) : '—'}</KV>}
              </dl></Card>
              <Card title="Linked records"><div className="flex flex-wrap gap-1.5">
                <Chip to={`/customers/${contract.customerId}`} label="Customer" value={contract.customerName} /><Chip to={`/companies/${contract.companyId}`} label="Company" value={company?.name} /><Chip to={`/contacts/${contract.contactId}`} label="Contact" value={contact?.name} />
                <Chip to={`/deals/${contract.dealId}`} label="Deal" value={deal?.name} /><Chip to={`/proposals/${contract.proposalId}`} label="Proposal" value={proposal?.number} /><Chip to={`/quotations/${contract.quotationId}`} label="Quotation" value={quotation?.number} />
                <Chip to={`/sales-orders/${contract.salesOrderId}`} label="Order" value={salesOrder?.number} /><Chip to={`/projects/${contract.projectId}`} label="Project" value={project?.name} />
                {contract.renewedFromId && <Chip to={`/contracts/${contract.renewedFromId}`} label="Renews" value={data.contracts.find((c) => c.id === contract.renewedFromId)?.number} />}
                {contract.renewedToId && <Chip to={`/contracts/${contract.renewedToId}`} label="Renewed as" value={data.contracts.find((c) => c.id === contract.renewedToId)?.number} />}
              </div></Card>
              <Card title="Team"><div className="flex flex-wrap gap-2">{[...new Set([contract.owner, ...(contract.team || [])])].map((u) => <span key={u} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs dark:bg-ink-800"><Avatar name={getUserById(u)?.name} size="xs" />{getUserById(u)?.name}{u === contract.owner && <span className="text-ink-400">· owner</span>}</span>)}</div></Card>
            </div>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Terms"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
            <KV k="Number">{contract.number}</KV><KV k="Title">{contract.title}</KV><KV k="Type">{contract.contractType}</KV>{billing && <KV k="Value">{formatCurrency(billing.value)}</KV>}<KV k="Billing frequency">{contract.billingFrequency}</KV><KV k="Payment terms">{contract.paymentTerms}</KV>
            <KV k="Start date">{formatDate(contract.startDate)}</KV><KV k="End date">{formatDate(contract.endDate)}</KV><KV k="Renewal date">{contract.renewalDate ? formatDate(contract.renewalDate) : '—'}</KV><KV k="Notice period">{contract.noticePeriodDays ? `${contract.noticePeriodDays} days` : '—'}</KV>
            <KV k="Auto-renewal">{contract.autoRenew ? 'Yes' : 'No'}</KV><KV k="Renewal terms">{contract.renewalTerms}</KV>
          </dl></Card>
          <Card title="Approval & signature"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
            <KV k="Created by">{getUserById(contract.createdBy)?.name}</KV><KV k="Created">{contract.createdAt ? formatDateTime(contract.createdAt) : '—'}</KV>
            <KV k="Submitted by">{contract.approval?.submittedBy ? `${getUserById(contract.approval.submittedBy)?.name} · ${formatDate(contract.approval.submittedAt)}` : '—'}</KV>
            <KV k="Approved by">{contract.approval?.approvedBy ? `${getUserById(contract.approval.approvedBy)?.name} · ${formatDate(contract.approval.approvedAt)}` : '—'}</KV>
            <KV k="Approval comments">{contract.approval?.comments}</KV><KV k="Last rejection">{contract.approval?.rejectionReason}</KV>
            <KV k="Sent">{contract.sentAt ? `${formatDate(contract.sentAt)} via ${contract.sentVia}` : '—'}</KV><KV k="Signed">{contract.signedAt ? formatDate(contract.signedAt) : '—'}</KV><KV k="Activated">{contract.activatedAt ? formatDate(contract.activatedAt) : '—'}</KV>
            {contract.terminatedAt && <KV k="Terminated">{formatDate(contract.terminatedAt)} — {contract.terminationReason}</KV>}{contract.cancelledAt && <KV k="Cancelled">{formatDate(contract.cancelledAt)} — {contract.cancelReason}</KV>}
          </dl>
            {(contract.approval?.history || []).length > 0 && <div className="mt-3 border-t border-ink-50 pt-3 dark:border-ink-800/60"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Rejection history</p><ul className="space-y-1 text-xs text-ink-600 dark:text-ink-300">{contract.approval.history.map((h) => <li key={h.at}>{formatDate(h.at)} · {getUserById(h.by)?.name}: {h.reason}</li>)}</ul></div>}
          </Card>
          <Card title="Scope of work"><p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{contract.scope || '—'}</p></Card>
          <Card title="Terms & conditions"><p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{contract.terms || '—'}</p></Card>
          <Card title="Internal notes" className="lg:col-span-2"><p className="whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{contract.notes || '—'}</p><p className="mt-2 text-xs text-ink-400">Internal only — never included in generated contract documents.</p></Card>
        </div>
      )}

      {tab === 'documents' && <ContractDocuments contract={contract} data={data} perms={perms} user={user} onChanged={() => done()} />}

      {tab === 'parties' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Linked title="Customer" to={customer && `/customers/${customer.id}`} rows={customer && [['Name', customer.name], ['Email', customer.email], ['Phone', customer.phone], ['Status', customer.status]]} empty="Customer record not found." />
          <Linked title="Company" to={company && `/companies/${company.id}`} rows={company && [['Name', company.name], ['Industry', company.industry], ['GSTIN', company.gstin], ['City', company.city]]} empty="No company linked." />
          <Linked title="Primary contact" to={contact && `/contacts/${contact.id}`} rows={contact && [['Name', contact.name], ['Designation', contact.designation], ['Email', contact.email], ['Phone', contact.phone]]} empty="No contact linked." />
        </div>
      )}

      {tab === 'linked' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Linked title="Deal" to={deal && `/deals/${deal.id}`} rows={deal && [['Name', deal.name], ['Stage', <StatusBadge key="s" status={deal.stage} />], ['Value', billing ? formatCurrency(deal.value ?? deal.amount ?? 0) : '—'], ['Expected close', deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : '—']]} empty="Not linked to a deal." />
          <Linked title="Proposal" to={proposal && `/proposals/${proposal.id}`} rows={proposal && [['Number', proposal.number], ['Title', proposal.title || proposal.name], ['Status', <StatusBadge key="s" status={proposal.status} />]]} empty="Not linked to a proposal." />
          <Linked title="Quotation" to={quotation && `/quotations/${quotation.id}`} rows={quotation && [['Number', quotation.number], ['Status', <StatusBadge key="s" status={quotation.status} />], ['Total', billing ? formatCurrency(quotation.total ?? quotation.amount ?? 0) : '—'], ['Valid until', quotation.validUntil ? formatDate(quotation.validUntil) : '—']]} empty="Not linked to a quotation." />
          <Linked title="Sales order" to={salesOrder && `/sales-orders/${salesOrder.id}`} rows={salesOrder && [['Number', salesOrder.number], ['Status', <StatusBadge key="s" status={salesOrder.status} />], ['Amount', billing ? formatCurrency(salesOrder.amount ?? 0) : '—'], ['Items', `${(salesOrder.items || []).length} line(s)`]]} empty="Not linked to a sales order." />
        </div>
      )}

      {tab === 'project' && (
        project ? (
          <div className="min-w-0 space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Status" value={project.status} /><Stat label="Progress" value={`${project.progress ?? 0}%`} /><Stat label="Tasks done" value={`${pStats.done}/${pStats.total}`} /><Stat label="Milestones" value={`${pStats.milestonesDone}/${pStats.milestones}`} /><Stat label="Overdue tasks" value={pStats.overdue} tone={pStats.overdue ? 'rose' : null} /></div>
            <Linked title="Project" to={`/projects/${project.id}`} rows={[['Name', project.name], ['Status', <StatusBadge key="s" status={project.status} />], ['Manager', getUserById(project.manager)?.name], ['Start', formatDate(project.startDate)], ['Deadline', project.deadline ? formatDate(project.deadline) : '—'], ...(billing ? [['Project value', formatCurrency(project.value ?? project.budget ?? 0)]] : [])]} />
            <Card title="Milestones">
              {projectTasks.filter((t) => t.taskType === 'Milestone').length ? <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{projectTasks.filter((t) => t.taskType === 'Milestone').sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex items-center gap-3"><StatusBadge status={t.status} /><span className="text-xs text-ink-400">{t.dueDate ? formatDate(t.dueDate) : ''}</span></span></Link></li>)}</ul> : <p className="text-sm text-ink-400">No milestones on the project yet.</p>}
            </Card>
          </div>
        ) : <EmptyState icon={Briefcase} title="No project linked" description="Link a project when you edit the contract, or create one from the confirmed sales order." action={perms.edit && <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit contract</Button>} />
      )}

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Tasks" value={stats.total} /><Stat label="Completed" value={stats.done} /><Stat label="Open" value={stats.open} /><Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'rose' : null} /></div>
          {perms.createTasks && <div className="flex flex-wrap gap-2">{TASK_PRESETS.map((p) => <Button key={p[0]} size="sm" variant="secondary" icon={Plus} onClick={() => startTask(p)}>{p[0]}</Button>)}</div>}
          {!tasks.length ? <EmptyState icon={ListChecks} title="No tasks yet" description="Create tasks to review, send, follow up for signature or renew this contract. They also appear on the Tasks page and the Calendar." /> : (
            <ul className="space-y-2">
              {[...tasks].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
                  <div className="min-w-0 flex-1"><Link to={`/tasks/${t.id}`} className={clsx('truncate text-sm font-medium hover:underline', ['Completed', 'Cancelled'].includes(t.status) ? 'text-ink-400 line-through' : 'text-ink-900 dark:text-ink-50')}>{t.title}</Link>{t.id === contract.renewalTaskId && <Badge tone="info" className="ml-2">Renewal</Badge>}</div>
                  <div className="hidden items-center gap-4 sm:flex"><AssigneeStack ids={t.assignees} max={2} /><PriorityMark priority={t.priority} label={false} /><DueLabel task={t} /></div>
                  <StatusSelect task={t} run={taskActions.run} /><TaskMenu task={t} run={taskActions.run} canLog={taskActions.canLog} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-400">Contract tasks carry the contract, customer, company, contact and deal — they’re the same records as on the Tasks page.</p>
        </div>
      )}

      {tab === 'activities' && (
        <div className="space-y-4">
          {perms.edit && <div className="flex flex-wrap gap-2"><Button icon={CalendarPlus} onClick={() => setLogOpen('Meeting')}>Signature / review meeting</Button><Button variant="secondary" icon={Phone} onClick={() => setLogOpen('Call')}>Log client communication</Button><Button variant="secondary" icon={MessageSquare} onClick={() => setLogOpen('Note')}>Add note</Button></div>}
          {!mine.length ? <EmptyState icon={MessageSquare} title="No activity yet" description="Meetings, calls, emails, notes and system events on this contract appear here." /> : (
            <ul className="divide-y divide-ink-50 rounded-2xl border border-ink-100 bg-white shadow-card dark:divide-ink-800/60 dark:border-ink-800 dark:bg-ink-900">
              {[...mine].sort((a, b) => new Date(b.meetingDate ? `${b.meetingDate}T${b.meetingStartTime || '00:00'}` : b.date) - new Date(a.meetingDate ? `${a.meetingDate}T${a.meetingStartTime || '00:00'}` : a.date)).map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3"><span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', ACTIVITY_TONE[a.type] || 'bg-ink-100 text-ink-600')}><Briefcase size={14} /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink-900 dark:text-ink-50">{a.subject}</p>{a.notes && <p className="text-xs text-ink-500">{a.notes}</p>}<p className="mt-0.5 text-xs text-ink-400">{a.type}{a.meetingDate ? ` · ${formatDate(a.meetingDate)} ${a.meetingStartTime || ''}` : ''} · {getUserById(a.by)?.name || '—'} · {timeAgo(a.date)}{a.meetingStatus ? ` · ${a.meetingStatus}` : ''}</p></div>
                  {a.meetingLink && a.meetingStatus === 'Scheduled' && <Link to={a.meetingLink}><Button size="sm" variant="secondary">Join</Button></Link>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <Card title="Contract calendar" action={<Link to={`/calendar?relatedType=Contract&relatedId=${contract.id}`}><Button size="sm" variant="secondary" icon={ExternalLink}>Open in Calendar</Button></Link>}>
          <p className="mb-3 text-xs text-ink-400">Start, end, renewal and notice-deadline dates, plus follow-up tasks and meetings — read live from the Calendar, so a changed date here changes everywhere.</p>
          {!events.length ? <p className="text-sm text-ink-400">Nothing on the calendar for this contract.</p> : (
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
              {[...events].sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)).map((e) => (
                <li key={e.id}><Link to={e.href || '#'} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="flex min-w-0 items-center gap-2"><CalendarDays size={14} className="shrink-0 text-brand-500" /><span className="truncate">{e.title}</span><Badge>{e.kind}</Badge></span><span className={clsx('shrink-0 text-xs', e.state === 'overdue' ? 'font-semibold text-rose-600' : 'text-ink-500')}>{formatDate(e.date)}{e.time ? ` · ${e.time}` : ''}</span></Link></li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'billing' && billing && (
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Contract value" value={formatCurrency(billing.value, { compact: true })} /><Stat label="Invoiced" value={formatCurrency(billing.invoiced, { compact: true })} /><Stat label="Paid" value={formatCurrency(billing.paid, { compact: true })} tone="emerald" />
            <Stat label="Outstanding" value={formatCurrency(billing.outstanding, { compact: true })} tone={billing.outstanding > 0 ? 'rose' : null} /><Stat label="Payment status" value={billing.paymentStatus} /><Stat label="Next billing" value={billing.nextBillingDate ? formatDate(billing.nextBillingDate) : '—'} />
          </div>
          <p className="text-xs text-ink-400">Billing frequency: {contract.billingFrequency}. “Paid” counts only payments actually recorded against the invoices — raising an invoice never marks anything as paid.</p>
          <Card title={`Invoices (${billing.invoices.length})`} action={salesOrder && <Link to={`/sales-orders/${salesOrder.id}`}><Button size="sm" variant="secondary" icon={Receipt}>Sales order</Button></Link>}>
            {billing.invoices.length ? <table className="crm-table w-full text-sm"><thead><tr className="text-left text-xs font-semibold uppercase text-ink-400"><th className="pb-2">Invoice</th><th className="pb-2">Status</th><th className="pb-2">Due</th><th className="pb-2 text-right">Amount</th></tr></thead><tbody>{billing.invoices.map((i) => <tr key={i.id} className="border-t border-ink-50 dark:border-ink-800/60"><td className="py-2.5"><Link2 to={`/invoices/${i.id}`}>{i.number}</Link2></td><td><StatusBadge status={i.status} /></td><td className="text-ink-500">{formatDate(i.dueDate)}</td><td className="text-right font-medium">{formatCurrency(i.amount)}</td></tr>)}</tbody></table> : <p className="text-sm text-ink-400">No invoices raised against this contract yet.</p>}
          </Card>
          <Card title={`Payments (${billing.payments.length})`}>
            {billing.payments.length ? <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{billing.payments.map((p) => <li key={p.id}><Link to={`/invoices/${p.invoiceId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="flex items-center gap-2"><Wallet size={14} className="text-emerald-500" />{p.reference} · {p.invoiceNumber}<span className="text-xs text-ink-400">{p.method}</span></span><span className="flex items-center gap-3"><span className="text-xs text-ink-400">{formatDate(p.date)}</span><b>{formatCurrency(p.amount)}</b></span></Link></li>)}</ul> : <p className="text-sm text-ink-400">No payments recorded yet.</p>}
          </Card>
        </div>
      )}

      {tab === 'renewals' && (
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Renewal date" value={contract.renewalDate ? formatDate(contract.renewalDate) : '—'} /><Stat label="Days remaining" value={['Renewed', 'Terminated', 'Cancelled'].includes(status) ? '—' : left < 0 ? `Expired ${-left}d` : left} tone={left < 0 ? 'rose' : left <= 60 ? 'amber' : null} />
            <Stat label="Notice deadline" value={rs.noticeDeadline ? formatDate(rs.noticeDeadline) : '—'} /><Stat label="Auto-renewal" value={contract.autoRenew ? 'On' : 'Off'} /><Stat label="Renewal status" value={rs.label} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Renewal actions">
              <div className="space-y-3 text-sm text-ink-600 dark:text-ink-300">
                {contract.renewalTerms && <p><b className="text-ink-800 dark:text-ink-100">Renewal terms:</b> {contract.renewalTerms}</p>}
                {rs.task && <p>Renewal task: <Link2 to={`/tasks/${rs.task.id}`}>{rs.task.title}</Link2> <span className="text-xs text-ink-400">({rs.task.status})</span></p>}
                {rs.renewal && <p>Renewal contract: <Link2 to={`/contracts/${rs.renewal.id}`}>{rs.renewal.number}</Link2> <StatusBadge status={rs.renewal.status} /></p>}
                {contract.renewalDecision === 'not-renewing' && <p className="rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-800/50">This contract is marked as <b>not renewing</b>.</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {perms.renew && !contract.renewedToId && ['Active', 'Expiring Soon', 'Expired'].includes(status) && !rs.renewal && <Button icon={RefreshCcw} onClick={() => setRenewOpen(true)}>Renew contract</Button>}
                  {perms.createTasks && ['Active', 'Expiring Soon', 'Expired'].includes(status) && !rs.task && <Button variant="secondary" icon={BellRing} onClick={() => startTask(TASK_PRESETS[4])}>Create renewal task</Button>}
                  {perms.renew && ['Active', 'Expiring Soon'].includes(status) && !rs.renewal && (contract.renewalDecision === 'not-renewing' ? <Button variant="ghost" onClick={reconsider}>Reopen renewal</Button> : <Button variant="ghost" onClick={notRenewing}>Mark as not renewing</Button>)}
                </div>
                <p className="text-xs text-ink-400">Renewing creates a new draft contract with the same terms and keeps this one — with its documents, invoices and history — as Renewed.</p>
              </div>
            </Card>
            <Card title="Reminder schedule">
              <ul className="space-y-2 text-sm">{reminders.map((r) => { const passed = r.date <= todayKey(); return <li key={r.days} className="flex items-center justify-between"><span>{r.days} days before expiry</span><span className={clsx('text-xs', passed ? 'text-ink-400' : 'font-medium text-ink-700 dark:text-ink-200')}>{formatDate(r.date)}{passed ? ' · due' : ''}</span></li> })}</ul>
              <p className="mt-3 text-xs text-ink-400">In-app reminders go to the owner at these points; a renewal task and calendar reminder are created {config.renewalTaskDays} days before expiry. Change them in Settings → Contracts.</p>
            </Card>
          </div>
          <Card title="Renewal history">
            <ol className="space-y-2">{chain.map((c, i) => <li key={c.id} className={clsx('flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm', c.id === contract.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'bg-ink-50 dark:bg-ink-800/40')}><span className="flex items-center gap-2"><span className="text-xs text-ink-400">#{i + 1}</span>{c.id === contract.id ? <b>{c.number}</b> : <Link2 to={`/contracts/${c.id}`}>{c.number}</Link2>}<span className="text-xs text-ink-500">{formatDate(c.startDate)} → {formatDate(c.endDate)}</span></span><StatusBadge status={c.id === contract.id ? status : c.status} /></li>)}</ol>
          </Card>
        </div>
      )}

      {tab === 'timeline' && (
        <Card title="Contract timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => (
              <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', ACTIVITY_TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span>
                <div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{getUserById(e.by)?.name || (e.by === 'SYSTEM' ? 'Automation' : '—')} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ContractFormDialog open={edit} onClose={() => setEdit(false)} contract={contract} data={data} onSaved={() => done()} />
      <ContractStatusDialog contract={statusTo ? contract : null} to={statusTo} perms={perms} config={config} contact={contact} onClose={() => setStatusTo(null)} onDone={() => done()} />
      <GenerateContractDialog open={genOpen} onClose={() => setGenOpen(false)} contract={contract} related={related} user={user} onDone={() => { done(); setTab('documents') }} />
      <ContractActivityDialog open={!!logOpen} presetType={logOpen || 'Meeting'} onClose={() => setLogOpen(null)} contract={contract} userId={user.id} onSaved={() => done()} />
      <TaskFormDialog open={!!taskForm} onClose={() => setTaskForm(null)} related={{ type: 'Contract', id: contract.id, label: `${contract.number} · ${contract.title}` }} preset={taskForm?.preset} onSaved={(t) => afterTask(t, taskForm?.key)} />
      {taskActions.dialogs}
      <ConfirmDialog open={renewOpen} onClose={() => setRenewOpen(false)} loading={busy} onConfirm={doRenew} tone="primary" title={`Renew ${contract.number}?`} description="A new draft contract is created with the same terms and the next period’s dates. This contract becomes Renewed and keeps its history, documents and invoices." confirmLabel="Create renewal" />
      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} onConfirm={remove} title={`Delete ${contract.number}?`} description="Only a draft or cancelled contract with no documents, tasks or invoices can be deleted — otherwise cancel it so its history is kept." confirmLabel="Delete contract" />
    </div>
  )
}
