import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, Send, CheckCircle2, XCircle, Ban, Trash2, Undo2, Banknote, UploadCloud, StickyNote, CalendarPlus, ListPlus, BellRing, ClipboardList, FileX2, ShieldAlert, ExternalLink, History, Info, PhoneCall, Eye, RotateCcw } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Dropdown, DropdownItem, DropdownDivider } from '../../components/common/Dropdown'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { KIND_LABEL, todayKey } from '../../utils/expenseRules'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { LogActivityDialog } from '../Activities/LogActivityDialog'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { ReasonDialog } from '../Invoices/InvoiceDialogs'
import { ExpenseFormDialog } from './ExpenseFormDialog'
import { fetchExpense, expenseAction, deleteExpense, useExpenseConfig, expErr, expFields } from './expenseClient'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const money = (v) => (v === null || v === undefined ? '—' : formatCurrency(v))
const TONE = { Created: 'bg-brand-50 text-brand-600', Submitted: 'bg-sky-50 text-sky-600', Reviewed: 'bg-amber-50 text-amber-600', Approved: 'bg-emerald-50 text-emerald-600', Rejected: 'bg-rose-50 text-rose-600', PaymentRecorded: 'bg-emerald-50 text-emerald-600', Reimbursed: 'bg-emerald-50 text-emerald-600', Cancelled: 'bg-rose-50 text-rose-600', Updated: 'bg-ink-100 text-ink-600', Note: 'bg-ink-100 text-ink-600', Task: 'bg-violet-50 text-violet-600', Document: 'bg-ink-100 text-ink-600' }

function DecisionDialog({ expense, mode, onClose, onDone }) {
  const approve = mode === 'approve'
  const [amount, setAmount] = useState(String(expense.total)); const [comments, setComments] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const go = () => { setBusy(true); setError(''); expenseAction(expense.id, approve ? 'approve' : 'reject', approve ? { approvedAmount: Number(amount), comments } : { reason: comments }).then((d) => { onDone(approve ? 'Expense approved.' : 'Expense rejected.', d); onClose() }).catch((e) => setError(expErr(e))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title={`${approve ? 'Approve' : 'Reject'} ${expense.number}`} description={`${expense.description} · claim ${money(expense.total)}`} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={approve ? 'primary' : 'danger'} loading={busy} onClick={go} disabled={!approve && comments.trim().length < 5}>{approve ? 'Approve' : 'Reject'}</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        {approve && <FormField label="Approved amount" hint="Approve less than the claim to cap what is paid out; say why below."><Input aria-label="Approved amount" type="number" step="0.01" max={expense.total} value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>}
        <FormField label={approve ? 'Comments' : 'Reason for rejecting'} required={!approve} hint={approve ? 'Optional unless you approve less than the claim.' : 'At least 5 characters. The submitter sees this.'}><Textarea aria-label={approve ? 'Comments' : 'Reason'} value={comments} onChange={(e) => setComments(e.target.value)} className="min-h-[70px]" /></FormField>
      </div>
    </Modal>
  )
}

function PayDialog({ expense, onClose, onDone }) {
  const { methods } = useExpenseConfig()
  const emp = expense.kind === 'Employee'
  const [f, setF] = useState({ amount: String(expense.remaining), date: todayKey(), method: '', reference: '', note: '' })
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [requestId] = useState(`REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`)
  useEffect(() => { if (!f.method && methods.length) setF((x) => ({ ...x, method: methods[0] })) }, [methods]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => { setBusy(true); setError(''); setErrors({}); expenseAction(expense.id, emp ? 'reimburse' : 'pay', { ...f, amount: Number(f.amount), requestId }).then((d) => { onDone(emp ? 'Reimbursement recorded.' : 'Payment recorded.', d); onClose() }).catch((e) => { setErrors(expFields(e)); setError(expErr(e)) }).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="md" title={`${emp ? 'Reimburse' : 'Record payment for'} ${expense.number}`} description={`${emp ? 'Reimbursement' : 'Balance'} due ${money(expense.remaining)}${emp ? ` to ${expense.employeeName}` : expense.vendorName ? ` to ${expense.vendorName}` : ''}. This is a business cost payment — it is not a customer payment.`} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button loading={busy} onClick={go}>{emp ? 'Record reimbursement' : 'Record payment'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
        <FormField label="Amount" required error={errors.amount}><Input aria-label="Amount" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
        <FormField label="Date" required error={errors.date}><Input aria-label="Payment date" type="date" max={todayKey()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="Method" required error={errors.method}><Select aria-label="Payment method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{methods.map((m) => <option key={m}>{m}</option>)}</Select></FormField>
        <FormField label="Transaction reference" error={errors.reference} hint="Required except for cash."><Input aria-label="Reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></FormField>
        <FormField label="Note" className="sm:col-span-2"><Input aria-label="Payment note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>
      </div>
    </Modal>
  )
}

export default function ExpenseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [x, setX] = useState(null)
  const [state, setState] = useState('loading')
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [dlg, setDlg] = useState(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const { docs } = useDocuments({ relatedType: 'Expense', relatedId: id })

  const load = useCallback(() => {
    fetchExpense(id).then((d) => { setX(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data.filter((a) => (a.relatedType === 'Expense' && a.relatedId === id) || a.links?.expenseId === id))).catch(() => {})
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks((r.data.items || r.data).filter((t) => t.links?.expenseId === id || (t.relatedType === 'Expense' && t.relatedId === id)))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const ev = ['crm:expenses-changed', 'crm:tasks-changed', 'crm:documents-changed']; const h = () => load(); ev.forEach((e) => window.addEventListener(e, h)); return () => ev.forEach((e) => window.removeEventListener(e, h)) }, [load])

  const timeline = useMemo(() => {
    if (!x) return []
    const out = (x.timeline || []).map((e) => ({ key: e.id, at: e.at, type: e.type, text: e.text, note: e.details, by: e.by, byName: e.byName }))
    activities.filter((a) => !a.expenseEvent && a.source !== 'task').forEach((a) => out.push({ key: a.id, at: a.date, type: a.attachmentAction ? 'Document' : a.type === 'Note' ? 'Note' : 'Task', text: a.subject || a.type, note: a.notes, by: a.by }))
    tasks.forEach((t) => out.push({ key: `t-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy === 'SYSTEM' ? null : t.createdBy, byName: t.createdBy === 'SYSTEM' ? 'Workflow automation' : null, href: `/tasks/${t.id}` }))
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [x, activities, tasks])

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !x) return <EmptyState icon={FileX2} title="Expense not found" description="It may have been removed, or you may not have access to it." action={<Button variant="secondary" onClick={() => navigate('/expenses')}>Back to expenses</Button>} />

  const p = x.perms
  const fin = !x.financialHidden
  const emp = x.kind === 'Employee'
  const done = (m, d) => { if (m) toast(m, { type: 'success' }); if (d) setX(d); load() }
  const fail = (e) => toast(expErr(e), { type: 'error' })
  const close = () => setDlg(null)
  const act = (a, msg) => expenseAction(x.id, a).then((d) => done(msg, d)).catch(fail)
  const relatedRef = { type: 'Expense', id: x.id, label: `${x.number} · ${x.description}` }
  const taskPreset = (title, extra = {}) => ({ title: `${title} — ${x.number}`, description: `${x.description}${fin ? ` (${formatCurrency(x.total)})` : ''}`, dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), assignees: [x.createdBy].filter(Boolean), ...extra })
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'approval', label: 'Approval', count: (x.approvals || []).length }, { value: 'payments', label: emp ? 'Reimbursement' : 'Payments', count: x.payments.length }, { value: 'documents', label: 'Bills & documents', count: docs?.length || 0 }, { value: 'tasks', label: 'Tasks & follow-ups', count: tasks.length }, { value: 'timeline', label: 'Timeline', count: timeline.length }]
  const flow = emp ? ['Draft', 'Submitted', 'Approved', 'Reimbursed'] : x.kind === 'Company' ? ['Draft', 'Approved', 'Paid'] : ['Draft', 'Submitted', 'Approved', 'Paid']
  const stepIdx = flow.indexOf(x.status === 'Under Review' ? 'Submitted' : x.status)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Expenses', href: '/expenses' }, { label: x.number }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Link to="/expenses" aria-label="Back to expenses" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{x.number}</h1><StatusBadge status={x.status} /><Badge>{KIND_LABEL[x.kind]}</Badge>{x.paymentStatus && !['Not approved yet', 'Not payable'].includes(x.paymentStatus) && x.paymentStatus !== x.status && <StatusBadge status={x.paymentStatus} />}</div>
            <p className="mt-1 text-sm text-ink-700 dark:text-ink-200">{x.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-500">
              <span className="inline-flex items-center gap-1.5">Category <i className="h-2.5 w-2.5 rounded-full" style={{ background: x.categoryColor }} /><b className="font-medium text-ink-800 dark:text-ink-100">{x.categoryName}</b></span>
              <span>Date <b className="font-medium text-ink-800 dark:text-ink-100">{formatDate(x.date)}</b></span>
              {x.vendorName && <span>Vendor <b className="font-medium text-ink-800 dark:text-ink-100">{x.vendorName}</b></span>}
              {x.employeeName && <span>Employee <b className="font-medium text-ink-800 dark:text-ink-100">{x.employeeName}</b></span>}
              {x.customerName && <span>Customer <Link to={`/customers/${x.customerId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{x.customerName}</Link></span>}
              {x.projectName && <span>Project <Link to={`/projects/${x.projectId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{x.projectName}</Link></span>}
              {x.dealName && <span>Deal <Link to={`/deals/${x.dealId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{x.dealName}</Link></span>}
              <span>Created by <b className="font-medium text-ink-800 dark:text-ink-100">{x.createdByName || '—'}</b></span>
            </div>
          </div>
          {fin && <dl className="grid w-full grid-cols-3 gap-4 rounded-2xl border border-ink-100 bg-white px-5 py-3 text-right shadow-card sm:w-auto dark:border-ink-800 dark:bg-ink-900"><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Amount</dt><dd className="text-lg font-bold">{money(x.amount)}</dd></div><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Tax</dt><dd className="text-lg font-bold">{money(x.tax)}</dd></div><div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Total</dt><dd className="text-lg font-bold text-brand-700 dark:text-brand-300">{money(x.total)}</dd></div></dl>}
        </div>
        {!['Rejected', 'Cancelled'].includes(x.status) && <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Workflow">{flow.map((s, i) => <li key={s} className="flex items-center gap-2"><span className={clsx('rounded-full px-2.5 py-1 font-medium', i <= stepIdx ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500 dark:bg-ink-800')}>{s}</span>{i < flow.length - 1 && <span className="text-ink-300">→</span>}</li>)}</ol>}
        <div className="flex flex-wrap gap-2">
          {p.edit && <Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button>}
          {p.submit && <Button icon={Send} onClick={() => act('submit', 'Submitted for approval.')}>Submit</Button>}
          {p.withdraw && <Button variant="ghost" icon={Undo2} onClick={() => act('withdraw', 'Withdrawn to draft.')}>Withdraw</Button>}
          {p.review && <Button variant="ghost" icon={Eye} onClick={() => act('review', 'Marked as under review.')}>Start review</Button>}
          {p.approve && <Button icon={CheckCircle2} onClick={() => setDlg('approve')}>Approve</Button>}
          {p.reject && <Button variant="secondary" icon={XCircle} onClick={() => setDlg('reject')}>Reject</Button>}
          {p.pay && <Button icon={Banknote} onClick={() => setDlg('pay')}>{emp ? 'Mark reimbursed' : 'Mark paid'}</Button>}
          {p.revise && <Button variant="secondary" icon={RotateCcw} onClick={() => act('revise', 'Reopened as a draft.')}>Reopen to revise</Button>}
          {p.uploadDocuments && <Button variant="secondary" icon={UploadCloud} onClick={() => { setTab('documents'); setUploadOpen(true) }}>Upload document</Button>}
          {docs?.length > 0 && <Button variant="ghost" icon={Eye} onClick={() => setTab('documents')}>Attachments ({docs.length})</Button>}
          <Button variant="ghost" icon={StickyNote} onClick={() => setDlg({ kind: 'log', type: 'Note' })}>Add note</Button>
          <Button variant="ghost" icon={CalendarPlus} onClick={() => setDlg({ kind: 'log', type: 'Follow-up' })}>Add follow-up</Button>
          {p.createTasks && <Dropdown width="w-64" trigger={<Button variant="secondary" icon={ListPlus}>Create task</Button>}>
            <DropdownItem icon={BellRing} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Expense approval', { taskType: 'Review' }) })}>Expense approval</DropdownItem>
            <DropdownItem icon={ClipboardList} onClick={() => setDlg({ kind: 'task', preset: taskPreset(emp ? 'Reimbursement follow-up' : 'Vendor payment follow-up', { taskType: 'Payment Follow-up' }) })}>{emp ? 'Reimbursement follow-up' : 'Vendor payment follow-up'}</DropdownItem>
            <DropdownItem icon={ListPlus} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Collect documents', { taskType: 'Document' }) })}>Document collection</DropdownItem>
            <DropdownDivider /><DropdownItem icon={PhoneCall} onClick={() => setDlg({ kind: 'log', type: 'Call' })}>Log a call</DropdownItem>
          </Dropdown>}
          {p.cancel && <Button variant="ghost" icon={Ban} onClick={() => setDlg('cancel')}>Cancel</Button>}
          {p.deleteDraft && <Button variant="ghost" icon={Trash2} aria-label="Delete draft" onClick={() => setDlg('delete')} />}
        </div>
        {p.approveBlockedReason && <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><ShieldAlert size={15} />{p.approveBlockedReason}</p>}
        {x.status === 'Approved' && x.remaining > 0 && <p className="flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-900/20 dark:text-sky-200"><Info size={15} />Approved{x.approvedByName ? ` by ${x.approvedByName}` : ''} — {emp ? `${money(x.remaining)} still to reimburse` : `${money(x.remaining)} still to pay`}{x.dueDate && !emp ? ` by ${formatDate(x.dueDate)}` : ''}. Nothing is marked paid until a payment is recorded.</p>}
        {x.status === 'Rejected' && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Rejected{x.rejectReason ? `: ${x.rejectReason}` : ''}. It stays on record; reopen it to revise and resubmit.</p>}
        {x.status === 'Cancelled' && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Cancelled{x.cancelReason ? `: ${x.cancelReason}` : ''}. It stays on record and is not counted as a cost.</p>}
        {x.migrated && <p className="rounded-xl bg-ink-50 px-4 py-3 text-xs text-ink-500 dark:bg-ink-800/50">This record was imported from the earlier expense log — some details (such as the approver) were not captured.</p>}
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Card title="Expense details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
              <KV k="Expense number"><span className="font-mono">{x.number}</span></KV><KV k="Type">{KIND_LABEL[x.kind]}</KV><KV k="Category">{x.categoryName}</KV><KV k="Expense date">{formatDate(x.date)}</KV><KV k="Status">{x.status}</KV><KV k="Payment status">{x.paymentStatus}</KV>
              <KV k="Paid by">{x.paidBy}</KV><KV k="Payment method">{x.paymentMethod || '—'}</KV><KV k="Payment reference">{x.paymentReference || '—'}</KV>{x.notes && <KV k="Notes">{x.notes}</KV>}
              <KV k="Created by">{x.createdByName || '—'}</KV><KV k="Created">{formatDateTime(x.createdAt)}</KV>{x.submittedAt && <KV k="Submitted">{formatDateTime(x.submittedAt)} by {x.submittedByName}</KV>}{x.approvedAt && <KV k="Approved">{formatDateTime(x.approvedAt)} by {x.approvedByName}</KV>}
            </dl></Card>
            {x.kind === 'Vendor' && <Card title="Vendor bill"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Vendor">{x.vendor?.name}</KV><KV k="Vendor contact">{[x.vendor?.contactName, x.vendor?.email, x.vendor?.phone].filter(Boolean).join(' · ') || '—'}</KV><KV k="Bill / invoice number">{x.vendorBillNumber || '—'}</KV><KV k="Bill date">{x.vendorBillDate ? formatDate(x.vendorBillDate) : '—'}</KV><KV k="Payment due">{x.dueDate ? formatDate(x.dueDate) : '—'}</KV><KV k="Payment status">{x.paymentStatus}</KV></dl></Card>}
            {emp && <Card title="Employee claim"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Employee">{x.employeeName}</KV><KV k="Claim amount">{money(x.total)}</KV><KV k="Approved amount">{x.approvedAmount === null || x.approvedAmount === undefined ? 'Not approved yet' : money(x.approvedAmount)}</KV><KV k="Reimbursed amount">{money(x.reimbursedAmount)}</KV><KV k="Reimbursement date">{x.reimbursedDate ? formatDate(x.reimbursedDate) : '—'}</KV>{x.reimbursementDueDate && x.status === 'Approved' && <KV k="Reimbursement due">{formatDate(x.reimbursementDueDate)}</KV>}</dl></Card>}
          </div>
          <div className="min-w-0 space-y-5">
            {fin && <Card title="Cost"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Amount">{money(x.amount)}</KV><KV k={`Tax (${x.taxRate}%)`}>{money(x.tax)}</KV><KV k="Total">{money(x.total)}</KV><KV k="Counted as business cost">{money(x.cost)}</KV><KV k={emp ? 'Reimbursed' : 'Paid'}>{money(x.paidAmount)}</KV><KV k="Balance">{money(x.remaining)}</KV></dl><p className="mt-3 text-xs text-ink-400">An expense is a company cost. It never changes invoices, customer payments or deal revenue.</p></Card>}
            <Card title="Linked records"><ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{(x.related || []).length === 0 && <li className="py-2 text-sm text-ink-400">Not linked to a customer, project or deal.</li>}{(x.related || []).map((r) => <li key={r.type} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-ink-400">{r.type}</span>{r.restricted ? <span className="inline-flex items-center gap-1 text-xs text-ink-400"><ShieldAlert size={12} />Restricted</span> : r.missing ? <span className="text-xs text-ink-400">{r.label}</span> : <Link to={r.href} className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-brand-700 hover:underline dark:text-brand-300">{r.label}<ExternalLink size={11} /></Link>}</li>)}</ul></Card>
          </div>
        </div>
      )}

      {tab === 'approval' && (
        <Card title="Approval history" action={x.approverId ? <span className="text-xs text-ink-400">Assigned to {getUserById(x.approverId)?.name}</span> : null}>
          {!(x.approvals || []).length ? <EmptyState icon={ShieldAlert} title="No decisions yet" description={x.status === 'Draft' ? 'Submit the expense to start the approval.' : x.migrated ? 'Imported record — approval details were not captured.' : 'Waiting for an approver.'} /> : (
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{[...x.approvals].reverse().map((a) => <li key={a.id} className="py-3 text-sm"><div className="flex justify-between"><span className="font-medium"><StatusBadge status={a.decision} /></span>{a.amount !== undefined && <span className="font-semibold">{money(a.amount)}</span>}</div><p className="mt-1 text-xs text-ink-500">{a.byName} · {formatDateTime(a.at)}</p>{a.comments && <p className="text-sm text-ink-700 dark:text-ink-200">{a.comments}</p>}</li>)}</ul>
          )}
        </Card>
      )}
      {tab === 'payments' && (
        <Card title={emp ? 'Reimbursements' : 'Payments to the vendor / supplier'} action={p.pay ? <Button size="sm" icon={Banknote} onClick={() => setDlg('pay')}>{emp ? 'Reimburse' : 'Record payment'}</Button> : null}>
          {!x.payments.length ? <EmptyState icon={Banknote} title={emp ? 'Not reimbursed yet' : 'No payment recorded'} description="Only an approved expense can be paid. These are business cost payments — separate from customer payments." /> : (
            <div className="overflow-x-auto"><table className="crm-table w-full min-w-[560px] text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2">Payment</th><th className="pb-2">Date</th><th className="pb-2">Method</th><th className="pb-2">Reference</th><th className="pb-2">Recorded by</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Balance after</th></tr></thead>
              <tbody>{x.payments.map((y) => <tr key={y.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2.5 font-mono text-xs">{y.number}</td><td>{formatDate(y.date)}</td><td>{y.method}</td><td className="font-mono text-xs">{y.reference || '—'}</td><td>{y.byName}</td><td className="text-right font-medium">{money(y.amount)}</td><td className="text-right">{money(y.balanceAfter)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}
      {tab === 'documents' && <Card title="Bills, receipts & supporting documents"><DocumentsPanel relatedType="Expense" relatedId={x.id} defaultCategory="Receipts" autoOpen={uploadOpen} canUploadHere={!!p.uploadDocuments} uploadHint="Bills, vendor invoices, travel / hotel / fuel receipts, payment proof and approval documents. Files are stored privately and only open for people allowed to see this expense." /></Card>}
      {tab === 'tasks' && (
        <div className="space-y-5">
          <Card title="Tasks about this expense">{!tasks.length ? <EmptyState icon={ClipboardList} title="No tasks yet" description="Submitting creates the approval task; approving creates the payment task. You can add follow-ups too." /> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul>}</Card>
          <Card title="Calls, notes & follow-ups">{activities.filter((a) => !a.expenseEvent).length === 0 ? <p className="text-sm text-ink-400">Nothing logged yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{activities.filter((a) => !a.expenseEvent).map((a) => <li key={a.id} className="py-2.5 text-sm"><p className="font-medium">{a.subject}</p><p className="text-xs text-ink-400">{a.type} · {getUserById(a.by)?.name || '—'} · {timeAgo(a.date)}</p></li>)}</ul>}</Card>
        </div>
      )}
      {tab === 'timeline' && (
        <Card title="Expense timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span><div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{(e.by && getUserById(e.by)?.name) || e.byName || '—'} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div></li>)}
          </ol>
        </Card>
      )}

      <ExpenseFormDialog open={dlg === 'edit'} onClose={close} expense={x} onSaved={(d) => done(null, d)} />
      {(dlg === 'approve' || dlg === 'reject') && <DecisionDialog expense={x} mode={dlg} onClose={close} onDone={done} />}
      {dlg === 'pay' && <PayDialog expense={x} onClose={close} onDone={done} />}
      <ReasonDialog open={dlg === 'cancel'} onClose={close} title={`Cancel ${x.number}?`} confirmLabel="Cancel expense" hint="It stays on record as Cancelled and is not counted as a cost. Open tasks about it are closed." onConfirm={(r) => expenseAction(x.id, 'cancel', { reason: r }).then((d) => { close(); done('Expense cancelled.', d) })} />
      <ConfirmDialog open={dlg === 'delete'} onClose={close} title={`Delete draft ${x.number}?`} description="Only a draft can be deleted; a record of the deletion stays in the audit log." confirmLabel="Delete draft" onConfirm={() => deleteExpense(x.id).then(() => { toast('Draft deleted.', { type: 'success' }); navigate('/expenses') }).catch((e) => { close(); fail(e) })} />
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={close} related={relatedRef} preset={dlg.preset} onSaved={() => { toast('Task created and linked to the expense.', { type: 'success' }); close(); load() }} />}
      {dlg?.kind === 'log' && <LogActivityDialog open onClose={close} presetType={dlg.type} related={relatedRef} onLogged={() => { close(); load() }} />}
    </div>
  )
}
