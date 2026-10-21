import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowLeft, Pencil, FileText, Users, Building2, Download, Printer, UploadCloud, StickyNote, CalendarPlus, ListPlus, BellRing, PhoneCall, Handshake, CheckCircle2, XCircle, Ban, Undo2, Trash2, ShieldAlert, ExternalLink, History, FileX2, Loader2, Info, ClipboardList } from 'lucide-react'
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
import { USERS, getUserById } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { todayKey } from '../../utils/invoiceRules'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { LogActivityDialog } from '../Activities/LogActivityDialog'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { ReasonDialog } from '../Invoices/InvoiceDialogs'
import { useInvoiceConfig, downloadBlob } from '../Invoices/invoiceClient'
import { fetchPayment, updatePayment, completePayment, failPayment, cancelPayment, refundPayment, deletePendingPayment, logReceipt, usePaymentConfig, payErr, payFields } from './paymentClient'
import { buildReceiptPdf } from './receiptPdf'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const money = (v) => (v === null || v === undefined ? '—' : formatCurrency(v))
const TONE = { Created: 'bg-brand-50 text-brand-600', Completed: 'bg-emerald-50 text-emerald-600', Failed: 'bg-rose-50 text-rose-600', Cancelled: 'bg-rose-50 text-rose-600', Refunded: 'bg-amber-50 text-amber-600', Updated: 'bg-ink-100 text-ink-600', ReceiptGenerated: 'bg-sky-50 text-sky-600', Note: 'bg-ink-100 text-ink-600', Task: 'bg-violet-50 text-violet-600', Document: 'bg-ink-100 text-ink-600' }

function ReceiptDialog({ payment, onClose, onEvent }) {
  const { config } = useInvoiceConfig()
  const [url, setUrl] = useState('')
  const frame = useRef(null)
  const blobRef = useRef(null)
  useEffect(() => {
    let dead = false; let made = ''
    buildReceiptPdf({ payment, config }).then((b) => { if (dead) return; const blob = new Blob([b], { type: 'application/pdf' }); blobRef.current = blob; made = URL.createObjectURL(blob); setUrl(made) })
    return () => { dead = true; if (made) URL.revokeObjectURL(made) }
  }, [payment.id, payment.updatedAt, payment.timeline?.length, config]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open onClose={onClose} size="xl" title={`Receipt ${payment.number}`} description="The same PDF that is downloaded and printed."
      footer={<>
        {payment.perms.printReceipt && <Button variant="secondary" icon={Printer} disabled={!url} onClick={() => { frame.current?.contentWindow?.print(); onEvent('print') }}>Print</Button>}
        {payment.perms.downloadReceipt && <Button variant="secondary" icon={Download} disabled={!url} onClick={() => { downloadBlob(blobRef.current, `${payment.number}-receipt.pdf`); onEvent('download') }}>Download PDF</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </>}>
      {!url ? <div className="flex h-[50vh] items-center justify-center text-ink-400"><Loader2 className="animate-spin" /></div> : <iframe ref={frame} title={`Receipt ${payment.number}`} src={url} className="h-[62vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
    </Modal>
  )
}

function EditDialog({ payment, onClose, onDone }) {
  const { toast } = useToast()
  const { methods, accounts } = usePaymentConfig()
  const pending = payment.status === 'Pending'
  const [f, setF] = useState({ amount: payment.amount, date: payment.date, method: payment.method, reference: payment.reference, bankAccount: payment.bankAccount || '', receivedBy: payment.receivedBy || '', notes: payment.notes || '' })
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const go = () => { setBusy(true); setError(''); const patch = pending ? { ...f, amount: Number(f.amount) } : { bankAccount: f.bankAccount, receivedBy: f.receivedBy, notes: f.notes }; updatePayment(payment.id, patch).then((d) => { toast('Payment updated.', { type: 'success' }); onDone(d); onClose() }).catch((e) => { setErrors(payFields(e)); setError(payErr(e)) }).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="md" title={`Edit ${payment.number}`} description={pending ? 'A pending payment can be corrected until it is completed.' : 'This payment is complete — its amount, date, method and reference are final. Cancel it or record a refund to correct money.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save changes</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
        {pending && <><FormField label="Amount" error={errors.amount}><Input type="number" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></FormField><FormField label="Date" error={errors.date}><Input type="date" max={todayKey()} value={f.date} onChange={(e) => set({ date: e.target.value })} /></FormField>
          <FormField label="Method"><Select value={f.method} onChange={(e) => set({ method: e.target.value })}>{methods.map((m) => <option key={m}>{m}</option>)}</Select></FormField><FormField label="Reference" error={errors.reference}><Input value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></FormField></>}
        <FormField label="Bank / account"><Select value={f.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })}><option value="">Not specified</option>{accounts.map((a) => <option key={a}>{a}</option>)}</Select></FormField>
        <FormField label="Received by"><Select value={f.receivedBy} onChange={(e) => set({ receivedBy: e.target.value })}>{USERS.filter((u) => u.status === 'Active' || u.id === f.receivedBy).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[70px]" /></FormField>
      </div>
    </Modal>
  )
}

function RefundDialog({ payment, onClose, onDone }) {
  const { toast } = useToast()
  const left = payment.netAmount
  const [f, setF] = useState({ amount: String(left), date: todayKey(), reason: '' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const go = () => { setBusy(true); setError(''); refundPayment(payment.id, { ...f, amount: Number(f.amount) }).then((r) => { toast('Refund recorded — the invoice balance has been updated.', { type: 'success' }); onDone(r); onClose() }).catch((e) => setError(payErr(e))).finally(() => setBusy(false)) }
  return (
    <Modal open onClose={onClose} size="sm" title={`Refund ${payment.number}`} description={`${money(left)} can still be refunded.`} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant="danger" loading={busy} disabled={f.reason.trim().length < 5} onClick={go}>Record refund</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-ink-500">The original payment is kept; the refund is recorded against it and the invoice balance goes back up by the refunded amount.</p>
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        <FormField label="Refund amount" required><Input type="number" step="0.01" max={left} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
        <FormField label="Refund date" required><Input type="date" min={payment.date} max={todayKey()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="Reason" required hint="At least 5 characters."><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-h-[70px]" /></FormField>
      </div>
    </Modal>
  )
}

export default function PaymentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { caps } = usePaymentConfig()
  const [pay, setPay] = useState(null)
  const [state, setState] = useState('loading')
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [dlg, setDlg] = useState(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const { docs } = useDocuments({ relatedType: 'Payment', relatedId: id })

  const load = useCallback(() => {
    fetchPayment(id).then((d) => { setPay(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data.filter((a) => (a.relatedType === 'Payment' && a.relatedId === id) || a.links?.paymentId === id))).catch(() => {})
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks((r.data.items || r.data).filter((t) => t.links?.paymentId === id || (t.relatedType === 'Payment' && t.relatedId === id)))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const h = () => load(); ['crm:invoices-changed', 'crm:tasks-changed', 'crm:documents-changed'].forEach((e) => window.addEventListener(e, h)); return () => ['crm:invoices-changed', 'crm:tasks-changed', 'crm:documents-changed'].forEach((e) => window.removeEventListener(e, h)) }, [load])

  const timeline = useMemo(() => {
    if (!pay) return []
    const out = (pay.timeline || []).map((e) => ({ key: e.id, at: e.at, type: e.type, text: e.text, note: e.details, by: e.by, byName: e.byName }))
    activities.filter((a) => !a.paymentEvent && a.source !== 'task').forEach((a) => out.push({ key: a.id, at: a.date, type: a.attachmentAction ? 'Document' : a.type === 'Note' ? 'Note' : 'Task', text: a.subject || a.type, note: a.notes, by: a.by }))
    tasks.forEach((t) => out.push({ key: `t-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy, href: `/tasks/${t.id}` }))
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [pay, activities, tasks])

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !pay) return <EmptyState icon={FileX2} title="Payment not found" description="It may have been removed, or you may not have access to it." action={<Button variant="secondary" onClick={() => navigate('/payments')}>Back to payments</Button>} />

  const p = pay.perms
  const fin = !pay.financialHidden
  const done = (m, d) => { if (m) toast(m, { type: 'success' }); if (d?.payment) setPay(d.payment); else if (d?.id) setPay(d); load() }
  const fail = (e) => toast(payErr(e), { type: 'error' })
  const close = () => setDlg(null)
  const link = (type) => pay.related.find((r) => r.type === type)
  const taskPreset = (title, extra = {}) => ({ title: `${title} — ${pay.number}`, description: `${pay.customerName} · invoice ${pay.invoiceNumber}`, dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), assignees: [pay.ownerId].filter(Boolean), ...extra })
  const relatedRef = { type: 'Payment', id: pay.id, label: `${pay.number} · ${pay.customerName}` }
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'refunds', label: 'Refunds', count: (pay.refunds || []).length }, { value: 'documents', label: 'Proof & documents', count: docs?.length || 0 }, { value: 'tasks', label: 'Tasks & follow-ups', count: tasks.length }, { value: 'timeline', label: 'Timeline', count: timeline.length }]
  const tone = pay.status === 'Completed' ? 'text-emerald-600' : ['Failed', 'Cancelled'].includes(pay.status) ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50'
  const backFwd = [['Deal', 'dealId'], ['Quotation', 'quotationId'], ['Sales Order', 'salesOrderId'], ['Invoice', 'invoiceId'], ['Payment', null]]

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Payments', href: '/payments' }, { label: pay.number || pay.id }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Link to="/payments" aria-label="Back to payments" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{pay.number}</h1><StatusBadge status={pay.status} /><Badge>{pay.method}</Badge>{pay.refundedAmount > 0 && <Badge tone="warning">Refunded {money(pay.refundedAmount)}</Badge>}</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-500">
              <span>Customer <Link to={`/customers/${pay.customerId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{pay.customerName}</Link></span>
              {pay.companyId && <span>Company <Link to={`/companies/${pay.companyId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{pay.companyName}</Link></span>}
              <span>Invoice <Link to={`/invoices/${pay.invoiceId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{pay.invoiceNumber}</Link></span>
              <span>Date <b className="font-medium text-ink-800 dark:text-ink-100">{formatDate(pay.date)}</b></span>
              <span>Reference <b className="font-mono font-medium text-ink-800 dark:text-ink-100">{pay.reference || '—'}</b></span>
            </div>
          </div>
          {fin && <div className="w-full rounded-2xl border border-ink-100 bg-white px-5 py-3 text-right shadow-card sm:w-auto dark:border-ink-800 dark:bg-ink-900"><p className="text-[11px] uppercase tracking-wide text-ink-400">Payment amount</p><p className={clsx('text-2xl font-bold', tone)}>{money(pay.amount)}</p>{pay.refundedAmount > 0 && <p className="text-xs text-ink-500">net {money(pay.netAmount)}</p>}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.edit && <Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button>}
          {p.complete && <Button icon={CheckCircle2} onClick={() => completePayment(pay.id).then((r) => done('Payment completed — the invoice balance is updated.', r)).catch(fail)}>Mark completed</Button>}
          {p.fail && <Button variant="ghost" icon={XCircle} onClick={() => setDlg('fail')}>Mark failed</Button>}
          <Button variant="secondary" icon={FileText} onClick={() => navigate(`/invoices/${pay.invoiceId}`)}>View invoice</Button>
          <Button variant="secondary" icon={Users} onClick={() => navigate(`/customers/${pay.customerId}`)}>View customer</Button>
          {pay.companyId && <Button variant="secondary" icon={Building2} onClick={() => navigate(`/companies/${pay.companyId}`)}>View company</Button>}
          {(p.downloadReceipt || p.printReceipt) && <Button icon={Download} onClick={() => setDlg('receipt')}>Receipt</Button>}
          {p.printReceipt && <Button variant="secondary" icon={Printer} onClick={() => setDlg('receipt')}>Print receipt</Button>}
          {p.uploadProof && <Button variant="secondary" icon={UploadCloud} onClick={() => { setTab('documents'); setUploadOpen(true) }}>Upload proof</Button>}
          <Button variant="ghost" icon={StickyNote} onClick={() => setDlg({ kind: 'log', type: 'Note' })}>Add note</Button>
          <Button variant="ghost" icon={CalendarPlus} onClick={() => setDlg({ kind: 'log', type: 'Follow-up' })}>Add follow-up</Button>
          <Dropdown width="w-60" trigger={<Button variant="secondary" icon={ListPlus}>Create task</Button>}>
            <DropdownItem icon={BellRing} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Payment follow-up', { taskType: 'Payment Follow-up' }) })}>Payment follow-up</DropdownItem>
            <DropdownItem icon={ClipboardList} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Reminder', { reminderMinutes: '1440' }) })}>Reminder task</DropdownItem>
            <DropdownItem icon={ListPlus} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Finance task', { taskType: 'General' }) })}>Internal finance task</DropdownItem>
            <DropdownDivider />
            <DropdownItem icon={PhoneCall} onClick={() => setDlg({ kind: 'log', type: 'Call' })}>Collection call</DropdownItem>
            <DropdownItem icon={Handshake} onClick={() => setDlg({ kind: 'log', type: 'Meeting' })}>Customer meeting</DropdownItem>
          </Dropdown>
          {p.refund && <Button variant="ghost" icon={Undo2} onClick={() => setDlg('refund')}>Refund</Button>}
          {p.cancel && <Button variant="ghost" icon={Ban} onClick={() => setDlg('cancel')}>Cancel payment</Button>}
          {p.deleteDraft && <Button variant="ghost" icon={Trash2} aria-label="Delete pending payment" onClick={() => setDlg('delete')} />}
        </div>
        {pay.status === 'Pending' && <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><Info size={15} />Pending — this payment does not count towards the invoice until it is marked completed.</p>}
        {['Failed', 'Cancelled'].includes(pay.status) && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">This payment is {pay.status.toLowerCase()}{pay.failReason || pay.cancelReason ? `: ${pay.failReason || pay.cancelReason}` : ''}. It stays on record and is not counted as money received.</p>}
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Card title="Payment details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
              <KV k="Payment number"><span className="font-mono">{pay.number}</span></KV><KV k="Status">{pay.status}</KV><KV k="Payment date">{formatDate(pay.date)}</KV><KV k="Method">{pay.method}</KV><KV k="Transaction reference"><span className="font-mono">{pay.reference || '—'}</span></KV><KV k="Bank / account">{pay.bankAccount}</KV>
              <KV k="Received by">{pay.receivedByName}</KV><KV k="Created by">{pay.createdByName || '—'}</KV><KV k="Created">{formatDateTime(pay.createdAt)}</KV>{pay.notes && <KV k="Notes">{pay.notes}</KV>}
            </dl></Card>
            {fin && <Card title="Effect on the invoice"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60"><KV k="Invoice total">{money(pay.invoiceTotal)}</KV><KV k="Balance before this payment">{money(pay.previousBalance)}</KV><KV k="Amount received (net)">{money(pay.netAmount)}</KV><KV k="Balance after this payment">{money(pay.balanceAfter)}</KV><KV k="Invoice balance now">{money(pay.invoiceBalance)} <StatusBadge status={pay.invoiceStatus} /></KV></dl>
              {(pay.siblings || []).length > 0 && <div className="mt-3 border-t border-ink-50 pt-3 dark:border-ink-800/60"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Other payments on this invoice</p><ul className="space-y-1 text-sm">{pay.siblings.map((s) => <li key={s.id}><Link to={`/payments/${s.id}`} className="flex justify-between hover:underline"><span>{s.number} · {formatDate(s.date)} <StatusBadge status={s.status} /></span><span className="font-medium">{money(s.amount)}</span></Link></li>)}</ul></div>}
            </Card>}
          </div>
          <div className="min-w-0 space-y-5">
            <Card title="Sales trace" action={<span className="text-[11px] text-ink-400">click to navigate</span>}>
              <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                {backFwd.map(([type, key], i) => { const r = key ? link(type) : { type: 'Payment', label: pay.number }; if (!r) return null; return (
                  <li key={type} className="flex items-center gap-1.5">{i > 0 && <span className="text-ink-300">→</span>}{!key ? <span className="rounded-full bg-brand-600 px-2.5 py-1 font-medium text-white">{type} {r.label}</span> : r.restricted ? <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-ink-400 dark:bg-ink-800"><ShieldAlert size={11} />{type}</span> : <Link to={r.href || '#'} className="rounded-full bg-ink-100 px-2.5 py-1 text-ink-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{type}</span> <span className="font-medium">{r.label}</span></Link>}</li>) })}
              </ol>
            </Card>
            <Card title="Related records"><ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{pay.related.map((r) => <li key={r.type} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-ink-400">{r.type}</span>{r.restricted ? <span className="inline-flex items-center gap-1 text-xs text-ink-400"><ShieldAlert size={12} />Restricted</span> : r.missing ? <span className="text-xs text-ink-400">{r.label}</span> : <Link to={r.href} className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-brand-700 hover:underline dark:text-brand-300">{r.label}<ExternalLink size={11} /></Link>}</li>)}</ul></Card>
          </div>
        </div>
      )}

      {tab === 'refunds' && (
        <Card title="Refund history" action={p.refund ? <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setDlg('refund')}>Refund</Button> : null}>
          {!(pay.refunds || []).length ? <EmptyState icon={Undo2} title="No refunds" description="A refund references this payment, keeps the original on record and puts the amount back on the invoice balance." /> : (
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{pay.refunds.map((r) => <li key={r.id} className="py-3 text-sm"><div className="flex justify-between"><span className="font-medium">{r.id}</span><span className="font-semibold text-amber-600">{money(r.amount)}</span></div><p className="text-xs text-ink-500">{formatDate(r.date)} · {r.status} · by {getUserById(r.by)?.name || '—'}</p><p className="text-sm text-ink-600 dark:text-ink-300">{r.reason}</p></li>)}</ul>
          )}
        </Card>
      )}
      {tab === 'documents' && <Card title="Payment proof & documents"><DocumentsPanel relatedType="Payment" relatedId={pay.id} defaultCategory="Receipts" autoOpen={uploadOpen} canUploadHere={!!p.uploadProof} uploadHint="Bank transfer screenshots, transaction receipts, cheque copies and other proof. Stored privately; only people allowed to see this payment can open them." /></Card>}
      {tab === 'tasks' && (
        <div className="space-y-5">
          <Card title="Tasks about this payment">{!tasks.length ? <EmptyState icon={ClipboardList} title="No tasks yet" description="Create a follow-up or reminder — it is linked to this payment, the invoice and the customer, and appears on the Calendar." /> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul>}</Card>
          <Card title="Calls, meetings & notes">{activities.filter((a) => !a.paymentEvent).length === 0 ? <p className="text-sm text-ink-400">Nothing logged yet.</p> : <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{activities.filter((a) => !a.paymentEvent).map((a) => <li key={a.id} className="py-2.5 text-sm"><p className="font-medium">{a.subject}</p><p className="text-xs text-ink-400">{a.type} · {getUserById(a.by)?.name || '—'} · {timeAgo(a.date)}</p></li>)}</ul>}</Card>
        </div>
      )}
      {tab === 'timeline' && (
        <Card title="Payment timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span><div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{(e.by && getUserById(e.by)?.name) || e.byName || '—'} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div></li>)}
          </ol>
        </Card>
      )}

      {dlg === 'edit' && <EditDialog payment={pay} onClose={close} onDone={(d) => done(null, d)} />}
      {dlg === 'refund' && <RefundDialog payment={pay} onClose={close} onDone={(r) => done(null, r)} />}
      {dlg === 'receipt' && <ReceiptDialog payment={pay} onClose={close} onEvent={(a) => logReceipt(pay.id, a).then((d) => setPay(d)).catch(() => {})} />}
      <ReasonDialog open={dlg === 'cancel'} onClose={close} title={`Cancel ${pay.number}?`} description="For a payment recorded by mistake." confirmLabel="Cancel payment" hint="It stays on record as Cancelled, stops counting towards the invoice, and the invoice balance goes back up." onConfirm={(r) => cancelPayment(pay.id, r).then((x) => { close(); done('Payment cancelled.', x) })} />
      <ReasonDialog open={dlg === 'fail'} onClose={close} title={`Mark ${pay.number} as failed?`} confirmLabel="Mark failed" hint="E.g. a bounced cheque or declined transfer. It stays on record and never counts as received." onConfirm={(r) => failPayment(pay.id, r).then((x) => { close(); done('Marked as failed.', x) })} />
      <ConfirmDialog open={dlg === 'delete'} onClose={close} title={`Delete pending ${pay.number}?`} description="Only a pending payment can be deleted; a record of the deletion stays in the audit log." confirmLabel="Delete" onConfirm={() => deletePendingPayment(pay.id).then(() => { toast('Pending payment deleted.', { type: 'success' }); navigate('/payments') }).catch((e) => { close(); fail(e) })} />
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={close} related={relatedRef} preset={dlg.preset} onSaved={() => { toast('Task created and linked to the payment.', { type: 'success' }); close(); load() }} />}
      {dlg?.kind === 'log' && <LogActivityDialog open onClose={close} presetType={dlg.type} related={relatedRef} onLogged={() => { close(); load() }} />}
      <span className="hidden">{caps.length}</span>
    </div>
  )
}
