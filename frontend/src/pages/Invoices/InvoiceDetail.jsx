import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  ArrowLeft, Pencil, Send, CreditCard, Download, Printer, Eye, Copy, Ban, FileX2, StickyNote, PhoneCall, Mail, CalendarPlus, ListPlus, BellRing, ClipboardList, UploadCloud, ShieldAlert, AlertTriangle, History,
  RefreshCcw, Trash2, Undo2, ExternalLink, Wallet, CheckCircle2, ArrowRight, Info, Receipt, Users2,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { Tabs } from '../../components/common/Tabs'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Dropdown, DropdownItem, DropdownDivider } from '../../components/common/Dropdown'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime, timeAgo } from '../../utils/format'
import { todayKey } from '../../utils/invoiceRules'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { LogActivityDialog } from '../Activities/LogActivityDialog'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useDocuments } from '../Documents/documentClient'
import { RecordPaymentModal } from '../SalesOrders/SalesOrderDialogs'
import { InvoiceFormDialog } from './InvoiceFormDialog'
import { PdfPreviewDialog, SendInvoiceDialog, ReasonDialog, doCancel, doVoid, invoicePdfBlob, invoiceFileName } from './InvoiceDialogs'
import { fetchInvoice, markInvoiceViewed, duplicateInvoice, deleteDraftInvoice, refreshInvoice, useInvoiceConfig, downloadBlob, invErr, emitInvoicesChanged } from './invoiceClient'

const Card = ({ title, action, children, className }) => (
  <section className={clsx('min-w-0 rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900', className)}>
    <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h2>{action}</header>
    <div className="p-5">{children}</div>
  </section>
)
const KV = ({ k, children }) => <div className="flex justify-between gap-4 py-2 text-sm"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="min-w-0 break-words text-right font-medium text-ink-900 dark:text-ink-50">{children ?? '—'}</dd></div>
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>
const money = (v) => (v === null || v === undefined ? '—' : formatCurrency(v))
const TONE = { Created: 'bg-brand-50 text-brand-600', Updated: 'bg-ink-100 text-ink-600', Sent: 'bg-sky-50 text-sky-600', Viewed: 'bg-sky-50 text-sky-600', PartialPayment: 'bg-amber-50 text-amber-600', FullyPaid: 'bg-emerald-50 text-emerald-600', PaymentRecorded: 'bg-emerald-50 text-emerald-600', PaymentReversed: 'bg-rose-50 text-rose-600', DueDateChanged: 'bg-amber-50 text-amber-600', Overdue: 'bg-rose-50 text-rose-600', Cancelled: 'bg-rose-50 text-rose-600', Voided: 'bg-rose-50 text-rose-600', Note: 'bg-ink-100 text-ink-600', Task: 'bg-violet-50 text-violet-600', Document: 'bg-ink-100 text-ink-600' }

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { config } = useInvoiceConfig()
  const [invoice, setInvoice] = useState(null)
  const [state, setState] = useState('loading')
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [dlg, setDlg] = useState(null) // edit | send | pay | cancel | void | reverse | preview | delete | task | log
  const [uploadOpen, setUploadOpen] = useState(false)
  const { docs } = useDocuments({ relatedType: 'Invoice', relatedId: id })

  const load = useCallback(() => {
    fetchInvoice(id).then((d) => { setInvoice(d); setState('ok') }).catch(() => setState('missing'))
    api.get('/activities', { params: { all: true } }).then((r) => setActivities(r.data.filter((a) => (a.relatedType === 'Invoice' && a.relatedId === id) || a.links?.invoiceId === id || a.invoiceId === id))).catch(() => {})
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks((r.data.items || r.data).filter((t) => t.links?.invoiceId === id || (t.relatedType === 'Invoice' && t.relatedId === id)))).catch(() => {})
    api.get('/calendar/events').then((r) => setEvents((r.data.events || []).filter((e) => (e.relatedType === 'Invoice' && e.relatedId === id) || e.related?.some((x) => x.type === 'Invoice' && x.id === id)))).catch(() => {})
  }, [id])
  useEffect(() => { setState('loading'); load() }, [load])
  useEffect(() => { const h = () => load(); window.addEventListener('crm:invoices-changed', h); window.addEventListener('crm:tasks-changed', h); window.addEventListener('crm:documents-changed', h); return () => { window.removeEventListener('crm:invoices-changed', h); window.removeEventListener('crm:tasks-changed', h); window.removeEventListener('crm:documents-changed', h) } }, [load])

  const timeline = useMemo(() => {
    if (!invoice) return []
    const out = (invoice.timeline || []).map((e) => ({ key: e.id, at: e.at, type: e.type, text: e.text, note: e.details, by: e.by, byName: e.byName }))
    activities.filter((a) => !a.invoiceEvent && a.source !== 'task' && !a.mirrorOf).forEach((a) => out.push({ key: a.id, at: a.date, type: a.attachmentAction ? 'Document' : a.type === 'Note' ? 'Note' : 'Task', text: a.subject || a.type, note: a.notes, by: a.by }))
    tasks.forEach((t) => { out.push({ key: `t-${t.id}`, at: t.createdAt, type: 'Task', text: `Task created: ${t.title}`, by: t.createdBy, href: `/tasks/${t.id}` }); if (t.completedAt) out.push({ key: `td-${t.id}`, at: t.completedAt, type: 'Task', text: `Task completed: ${t.title}`, by: t.completedBy, href: `/tasks/${t.id}` }) })
    return out.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [invoice, activities, tasks])

  const done = (m, d) => { if (m) toast(m, { type: 'success' }); if (d) setInvoice(d); emitInvoicesChanged(); load() }
  const fail = (e) => toast(invErr(e), { type: 'error' })
  const close = () => setDlg(null)

  if (state === 'loading') return <div className="space-y-4"><CardSkeleton className="h-28" /><CardSkeleton className="h-80" /></div>
  if (state === 'missing' || !invoice) return <EmptyState icon={FileX2} title="Invoice not found" description="It may have been removed, or you may not have access to it." action={<Button variant="secondary" onClick={() => navigate('/invoices')}>Back to invoices</Button>} />

  const p = invoice.perms
  const fin = !invoice.financialHidden
  const closed = ['Cancelled', 'Void'].includes(invoice.status)
  const live = (invoice.payments || []).filter((x) => x.status === 'Completed')
  const taskPreset = (title, extra = {}) => ({ title: `${title} — ${invoice.number}`, description: `${invoice.customerName}${invoice.balance ? ` — ${formatCurrency(invoice.balance)} outstanding` : ''}`, dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), priority: invoice.status === 'Overdue' ? 'High' : 'Medium', assignees: [invoice.ownerId].filter(Boolean), ...extra })
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'payments', label: 'Payments', count: live.length }, { value: 'related', label: 'Related records' }, { value: 'documents', label: 'Documents', count: docs?.length || 0 }, { value: 'tasks', label: 'Tasks & follow-ups', count: tasks.length }, { value: 'timeline', label: 'Timeline', count: timeline.length }]
  const download = () => invoicePdfBlob(invoice, config).then((b) => downloadBlob(b, invoiceFileName(invoice))).catch(() => toast('The PDF could not be generated.', { type: 'error' }))
  const nextEvents = events.filter((e) => e.date >= todayKey() && e.state !== 'done').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Invoices', href: '/invoices' }, { label: invoice.number }]} />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Link to="/invoices" aria-label="Back to invoices" className="mt-1 rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><ArrowLeft size={18} /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{invoice.number}</h1><StatusBadge status={invoice.status} />
              {invoice.paymentStatus && !['Not applicable', 'Not issued'].includes(invoice.paymentStatus) && invoice.paymentStatus !== invoice.status && <Badge tone={invoice.paymentStatus === 'Paid' ? 'success' : invoice.paymentStatus === 'Partially Paid' ? 'warning' : 'neutral'}>{invoice.paymentStatus}</Badge>}
              {invoice.overdueDays > 0 && <Badge tone="danger">{invoice.overdueDays}d overdue</Badge>}
              {invoice.duplicatedFrom && <Badge>Copy of {invoice.duplicatedFrom}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-500">
              <span>Customer <Link to={`/customers/${invoice.customerId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{invoice.customerName}</Link></span>
              {invoice.companyId && <span>Company <Link to={`/companies/${invoice.companyId}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{invoice.companyName || invoice.companyId}</Link></span>}
              <span>Invoice date <b className="font-medium text-ink-800 dark:text-ink-100">{formatDate(invoice.issueDate)}</b></span>
              <span>Due <b className={clsx('font-medium', invoice.status === 'Overdue' ? 'text-rose-600' : 'text-ink-800 dark:text-ink-100')}>{formatDate(invoice.dueDate)}</b></span>
              <span className="inline-flex items-center gap-1.5">Owner <Avatar name={invoice.ownerName} size="xs" /><b className="font-medium text-ink-800 dark:text-ink-100">{invoice.ownerName}</b></span>
            </div>
          </div>
          {fin && (
            <dl className="grid grid-cols-3 gap-4 rounded-2xl border border-ink-100 bg-white px-5 py-3 text-right shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Grand total</dt><dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{money(invoice.amount)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Paid</dt><dd className="text-lg font-bold text-emerald-600">{money(invoice.paidAmount)}</dd></div>
              <div><dt className="text-[11px] uppercase tracking-wide text-ink-400">Balance due</dt><dd className={clsx('text-lg font-bold', invoice.balance > 0 && !closed ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50')}>{closed ? '—' : money(invoice.balance)}</dd></div>
            </dl>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.edit && <Button variant="secondary" icon={Pencil} onClick={() => setDlg('edit')}>Edit</Button>}
          {p.send && <Button variant={invoice.status === 'Draft' ? 'primary' : 'secondary'} icon={Send} onClick={() => setDlg('send')}>{invoice.status === 'Draft' ? 'Send' : 'Re-send'}</Button>}
          {p.markViewed && <Button variant="ghost" icon={Eye} onClick={() => markInvoiceViewed(invoice.id).then((d) => done('Marked as viewed by the client.', d)).catch(fail)}>Mark viewed</Button>}
          {p.recordPayment && <Button icon={CreditCard} onClick={() => setDlg('pay')}>Record payment</Button>}
          {p.download && <Button variant="secondary" icon={Download} onClick={download}>Download PDF</Button>}
          {p.print && <Button variant="secondary" icon={Printer} onClick={() => setDlg('preview')}>Print</Button>}
          {(p.print || p.download) && <Button variant="ghost" icon={Eye} onClick={() => setDlg('preview')}>Preview</Button>}
          {p.duplicate && <Button variant="ghost" icon={Copy} onClick={() => duplicateInvoice(invoice.id).then((d) => { toast(`Created ${d.number} as a draft copy.`, { type: 'success' }); navigate(`/invoices/${d.id}`) }).catch(fail)}>Duplicate</Button>}
          {!closed && (
            <Dropdown width="w-60" trigger={<Button variant="secondary" icon={ListPlus}>Follow up</Button>}>
              <DropdownItem icon={BellRing} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Payment follow-up', { taskType: 'Payment Follow-up' }) })}>Payment follow-up task</DropdownItem>
              <DropdownItem icon={ClipboardList} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Collection reminder', { taskType: 'Payment Follow-up', reminderMinutes: '1440' }) })}>Collection reminder</DropdownItem>
              <DropdownItem icon={ListPlus} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Internal task', { taskType: 'General' }) })}>Internal task</DropdownItem>
              <DropdownDivider />
              <DropdownItem icon={PhoneCall} onClick={() => setDlg({ kind: 'log', type: 'Call' })}>Log a customer call</DropdownItem>
              <DropdownItem icon={Mail} onClick={() => setDlg({ kind: 'log', type: 'Email' })}>Email follow-up</DropdownItem>
              <DropdownItem icon={CalendarPlus} onClick={() => setDlg({ kind: 'log', type: 'Meeting' })}>Schedule a meeting</DropdownItem>
            </Dropdown>
          )}
          <Button variant="ghost" icon={StickyNote} onClick={() => setDlg({ kind: 'log', type: 'Note' })}>Add note</Button>
          <Button variant="ghost" icon={CalendarPlus} onClick={() => setDlg({ kind: 'log', type: 'Follow-up' })}>Add follow-up</Button>
          {p.uploadDocuments && <Button variant="ghost" icon={UploadCloud} onClick={() => { setTab('documents'); setUploadOpen(true) }}>Upload document</Button>}
          {p.cancel && <Button variant="ghost" icon={Ban} onClick={() => setDlg('cancel')}>Cancel</Button>}
          {p.void && <Button variant="ghost" icon={Undo2} onClick={() => setDlg('void')}>Void</Button>}
          {p.deleteDraft && <Button variant="ghost" icon={Trash2} aria-label="Delete draft" onClick={() => setDlg('delete')} />}
        </div>
        {invoice.status === 'Draft' && <p className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600 dark:bg-ink-800/50 dark:text-ink-300"><Info size={15} />This is a draft — it can still be edited and has not been sent. Sending makes the amounts final.{p.refreshMaster && <Button size="sm" variant="secondary" icon={RefreshCcw} onClick={() => refreshInvoice(invoice.id).then((d) => done('Refreshed from the customer, company and contact records.', d)).catch(fail)}>Refresh from customer record</Button>}</p>}
        {invoice.status === 'Overdue' && !closed && <p className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200"><AlertTriangle size={15} />Overdue by {invoice.overdueDays} day{invoice.overdueDays === 1 ? '' : 's'} — {money(invoice.balance)} outstanding.{!closed && <Button size="sm" variant="secondary" icon={BellRing} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Payment follow-up', { taskType: 'Payment Follow-up' }) })}>Create payment follow-up</Button>}</p>}
        {closed && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">This invoice is {invoice.status.toLowerCase()}{invoice.closeReason ? `: ${invoice.closeReason}` : ''}. It stays on record and its number is never reused.</p>}
        {(invoice.masterChanges || []).length > 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">The customer record has changed since this invoice was issued ({invoice.masterChanges.map((c) => `${c.field}: “${c.was}” → “${c.now}”`).join('; ')}). This invoice keeps the original details; new invoices use the current ones.</p>}
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' && (
        <div className="space-y-5">
          {fin && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Taxable amount" value={money(invoice.taxableAmount)} /><Stat label="GST" value={money(invoice.tax)} /><Stat label="Grand total" value={money(invoice.amount)} /><Stat label="Amount paid" value={money(invoice.paidAmount)} tone="emerald" /><Stat label="Balance due" value={closed ? '—' : money(invoice.balance)} tone={invoice.balance > 0 && !closed ? 'rose' : null} /></div>}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
              <Card title="Invoice">
                <div className="mb-5 grid gap-4 sm:grid-cols-2">
                  <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Bill to</p><p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{invoice.snapshot?.customerName || invoice.customerName}</p>{invoice.snapshot?.companyName && invoice.snapshot.companyName !== invoice.customerName && <p className="text-sm text-ink-600 dark:text-ink-300">{invoice.snapshot.companyName}</p>}{invoice.contactName && <p className="text-sm text-ink-600 dark:text-ink-300">Attn: {invoice.contactName}</p>}<p className="mt-1 whitespace-pre-line text-sm text-ink-600 dark:text-ink-300">{invoice.billingAddress}</p>{invoice.gstin && <p className="text-xs text-ink-500">GSTIN {invoice.gstin}</p>}<p className="text-xs text-ink-400">{[invoice.snapshot?.contactEmail, invoice.snapshot?.contactPhone].filter(Boolean).join(' · ')}</p></div>
                  <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Shipping / service address</p><p className="whitespace-pre-line text-sm text-ink-600 dark:text-ink-300">{invoice.shippingAddress || invoice.billingAddress}</p><p className="mt-2 text-xs text-ink-500">Payment terms: {invoice.paymentTerms || '—'}</p></div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
                  <table className="crm-table w-full min-w-[640px] text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2.5">Item</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Unit price</th><th className="px-3 py-2.5 text-right">Disc.</th><th className="px-3 py-2.5 text-right">GST</th><th className="px-4 py-2.5 text-right">Line total</th></tr></thead>
                    <tbody>{(invoice.items || []).map((it, i) => { const net = (it.qty || 0) * (it.unitPrice || 0) * (1 - (it.discount || 0) / 100); return (
                      <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-4 py-3"><p className="font-medium text-ink-800 dark:text-ink-100">{it.productId ? <Link to={`/products/${it.productId}`} className="hover:underline">{it.name}</Link> : it.name}</p>{it.description && <p className="text-xs text-ink-400">{it.description}</p>}</td><td className="px-3 py-3 text-right">{it.qty}{it.unit ? ` ${it.unit}` : ''}</td><td className="px-3 py-3 text-right">{fin ? money(it.unitPrice) : '—'}</td><td className="px-3 py-3 text-right">{fin ? `${it.discount || 0}%` : '—'}</td><td className="px-3 py-3 text-right">{fin ? `${it.taxRate ?? 0}%` : '—'}</td><td className="px-4 py-3 text-right font-medium">{fin ? money(net * (1 + (it.taxRate || 0) / 100)) : '—'}</td></tr>) })}</tbody></table>
                </div>
                {fin && (
                  <dl className="ml-auto mt-4 grid max-w-xs gap-1.5 text-sm">
                    <div className="flex justify-between text-ink-500"><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div>
                    {invoice.discountAmount > 0 && <div className="flex justify-between text-ink-500"><dt>Total discount</dt><dd>− {money(invoice.discountAmount)}</dd></div>}
                    <div className="flex justify-between text-ink-500"><dt>Taxable amount</dt><dd>{money(invoice.taxableAmount)}</dd></div>
                    {invoice.taxType === 'inter' ? <div className="flex justify-between text-ink-500"><dt>IGST</dt><dd>{money(invoice.igst)}</dd></div> : <><div className="flex justify-between text-ink-500"><dt>CGST</dt><dd>{money(invoice.cgst)}</dd></div><div className="flex justify-between text-ink-500"><dt>SGST</dt><dd>{money(invoice.sgst)}</dd></div></>}
                    {(invoice.extraTaxes || []).map((t) => <div key={t.name} className="flex justify-between text-ink-500"><dt>{t.name} ({t.rate}%)</dt><dd>{money(t.amount)}</dd></div>)}
                    {invoice.roundOff !== 0 && <div className="flex justify-between text-ink-500"><dt>Round off</dt><dd>{invoice.roundOff > 0 ? '+' : '−'} {money(Math.abs(invoice.roundOff))}</dd></div>}
                    <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900 dark:border-ink-800 dark:text-ink-50"><dt>Grand total</dt><dd>{money(invoice.amount)}</dd></div>
                    <div className="flex justify-between text-ink-500"><dt>Amount paid</dt><dd className="font-medium text-emerald-600">{money(invoice.paidAmount)}</dd></div>
                    <div className="flex justify-between text-base font-semibold text-ink-900 dark:text-ink-50"><dt>Balance due</dt><dd>{closed ? '—' : money(invoice.balance)}</dd></div>
                  </dl>
                )}
                {(invoice.notes || invoice.terms) && <div className="mt-5 grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2 dark:border-ink-800">{invoice.notes && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Notes</p><p className="whitespace-pre-wrap text-sm text-ink-600 dark:text-ink-300">{invoice.notes}</p></div>}{invoice.terms && <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Terms &amp; conditions</p><p className="whitespace-pre-wrap text-xs text-ink-500">{invoice.terms}</p></div>}</div>}
              </Card>
            </div>
            <div className="min-w-0 space-y-5">
              <Card title="Details"><dl className="divide-y divide-ink-50 dark:divide-ink-800/60">
                <KV k="Invoice number"><span className="font-mono">{invoice.number}</span></KV>{invoice.legacyNumber && <KV k="Previous number">{invoice.legacyNumber}</KV>}<KV k="Status">{invoice.status}</KV><KV k="Payment status">{invoice.paymentStatus}</KV><KV k="Invoice date">{formatDate(invoice.issueDate)}</KV><KV k="Due date">{formatDate(invoice.dueDate)}</KV>
                <KV k="Owner">{invoice.ownerName}</KV><KV k="Created by">{invoice.createdByName || '—'}</KV><KV k="Created">{formatDateTime(invoice.createdAt)}</KV>{invoice.sentAt && <KV k="First sent">{formatDateTime(invoice.sentAt)}</KV>}{(invoice.sends || []).length > 0 && <KV k="Sent to">{[...new Set(invoice.sends.map((s) => s.to))].join(', ')}</KV>}<KV k="Source">{invoice.source === 'sales-order' ? 'Sales order' : invoice.source === 'manual' ? 'Manual (finance)' : invoice.source}</KV>
              </dl></Card>
              <Card title="Related records" action={<button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setTab('related')}>All</button>}>
                <div className="flex flex-wrap gap-1.5">{(invoice.related || []).slice(0, 8).map((r) => r.restricted ? <span key={r.type} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-400 dark:bg-ink-800"><ShieldAlert size={11} />{r.type}</span> : <Link key={r.type} to={r.href || '#'} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:bg-brand-50 hover:text-brand-700 dark:bg-ink-800 dark:text-ink-200"><span className="text-ink-400">{r.type}</span><span className="truncate font-medium">{r.label}</span></Link>)}</div>
              </Card>
              {nextEvents.length > 0 && <Card title="Coming up" action={<Link to={`/calendar?relatedType=Invoice&relatedId=${invoice.id}`} className="text-xs font-medium text-brand-600 hover:underline">Calendar</Link>}><ul className="space-y-2">{nextEvents.map((e) => <li key={e.id} className="flex justify-between gap-2 text-sm"><span className="truncate">{e.title}</span><span className="shrink-0 text-xs text-ink-400">{formatDate(e.date)}</span></li>)}</ul></Card>}
            </div>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-5">
          {fin && <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Grand total" value={money(invoice.amount)} /><Stat label="Total paid" value={money(invoice.paidAmount)} tone="emerald" /><Stat label="Balance due" value={closed ? '—' : money(invoice.balance)} tone={invoice.balance > 0 && !closed ? 'rose' : null} /><Stat label="Payment status" value={invoice.paymentStatus} /><Stat label="Payments" value={live.length} /></div>}
          <Card title="Payment history" action={p.recordPayment ? <Button size="sm" icon={CreditCard} onClick={() => setDlg('pay')}>Record payment</Button> : null}>
            {!fin ? <p className="text-sm text-ink-400">Payment details are restricted for your role.</p> : !(invoice.payments || []).length ? <EmptyState icon={Wallet} title="No payments yet" description={invoice.status === 'Draft' ? 'Send the invoice first — payments are recorded against issued invoices.' : 'Record a payment when money is received. The balance and status update automatically.'} /> : (
              <div className="overflow-x-auto"><table className="crm-table w-full min-w-[640px] text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2">Payment</th><th className="pb-2">Date</th><th className="pb-2">Method</th><th className="pb-2">Reference</th><th className="pb-2">Recorded by</th><th className="pb-2">Status</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Balance after</th></tr></thead>
                <tbody>{invoice.payments.map((x) => (
                  <tr key={x.id} className={clsx('border-b border-ink-50 dark:border-ink-800/60', ['Cancelled', 'Failed'].includes(x.status) && 'text-ink-400')}>
                    <td className="py-2.5 font-medium"><Link to={`/payments/${x.id}`} className="text-brand-700 hover:underline dark:text-brand-300">{x.number || x.id}</Link></td><td>{formatDate(x.date)}</td><td>{x.method}</td><td className="font-mono text-xs">{x.reference || '—'}</td><td>{x.createdByName || x.recordedByName || '—'}</td><td><StatusBadge status={x.status} /></td><td className="text-right font-medium">{money(x.amount)}{x.refundedAmount > 0 && <span className="block text-[11px] font-normal text-amber-600">−{money(x.refundedAmount)} refunded</span>}</td><td className="text-right">{['Completed', 'Partially Refunded', 'Refunded'].includes(x.status) ? money(x.balanceAfter) : '—'}</td>
                  </tr>))}</tbody></table></div>
            )}
            <p className="mt-3 text-xs text-ink-400">A completed payment is never deleted or edited: cancel it or record a refund (with a reason) and the amount comes back off the invoice. Open a payment for its receipt, proof and timeline. “Paid” only ever means the received payments cover the whole total.</p>
          </Card>
        </div>
      )}

      {tab === 'related' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Linked CRM records">
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
              {(invoice.related || []).map((r) => (
                <li key={r.type} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="text-ink-400">{r.type}</span>
                  {r.restricted ? <span className="inline-flex items-center gap-1 text-xs text-ink-400"><ShieldAlert size={12} />Restricted</span> : r.missing ? <span className="text-xs text-ink-400">{r.label}</span> : <Link to={r.href} className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-brand-700 hover:underline dark:text-brand-300">{r.label}<ExternalLink size={11} /></Link>}
                </li>))}
            </ul>
            {!(invoice.related || []).length && <p className="text-sm text-ink-400">No linked records.</p>}
          </Card>
          <Card title="Payments & documents">
            <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
              <li className="flex justify-between py-2.5 text-sm"><span className="text-ink-400">Payments</span><button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab('payments')}>{live.length} recorded</button></li>
              <li className="flex justify-between py-2.5 text-sm"><span className="text-ink-400">Documents</span><button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab('documents')}>{docs?.length || 0} on file</button></li>
              <li className="flex justify-between py-2.5 text-sm"><span className="text-ink-400">Tasks</span><button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab('tasks')}>{tasks.length}</button></li>
              <li className="flex justify-between py-2.5 text-sm"><span className="text-ink-400">Activities</span><button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab('timeline')}>{activities.filter((a) => !a.invoiceEvent).length}</button></li>
            </ul>
          </Card>
        </div>
      )}

      {tab === 'documents' && <Card title="Invoice documents"><DocumentsPanel relatedType="Invoice" relatedId={invoice.id} defaultCategory="Invoices" autoOpen={uploadOpen} canUploadHere={!!p.uploadDocuments} paymentOptions={live.map((x) => ({ id: x.id, label: `Payment proof — ${x.number || x.reference}` }))} uploadHint="Invoice PDFs, supporting and tax documents, client attachments and payment proofs. Files are stored privately and only open for people allowed to see this invoice." /></Card>}

      {tab === 'tasks' && (
        <div className="space-y-5">
          <Card title="Tasks about this invoice" action={!closed && p.createTasks ? <Button size="sm" icon={BellRing} onClick={() => setDlg({ kind: 'task', preset: taskPreset('Payment follow-up', { taskType: 'Payment Follow-up' }) })}>Payment follow-up</Button> : null}>
            {!tasks.length ? <EmptyState icon={ClipboardList} title="No tasks yet" description="Create a payment follow-up or collection reminder — it is linked to this invoice and the customer, and appears on the Tasks page and the Calendar." /> : (
              <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline"><span className="truncate">{t.title}</span><span className="flex shrink-0 items-center gap-3 text-xs text-ink-400"><Badge>{t.status}</Badge>{t.dueDate ? formatDate(t.dueDate) : ''}</span></Link></li>)}</ul>
            )}
          </Card>
          <Card title="Calls, meetings & follow-ups">
            {activities.filter((a) => !a.invoiceEvent && !a.mirrorOf).length === 0 ? <p className="text-sm text-ink-400">Nothing logged yet.</p> : (
              <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">{activities.filter((a) => !a.invoiceEvent && !a.mirrorOf).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((a) => <li key={a.id} className="py-2.5 text-sm"><p className="font-medium text-ink-800 dark:text-ink-100">{a.subject}</p><p className="text-xs text-ink-400">{a.type} · {getUserById(a.by)?.name || '—'} · {timeAgo(a.date)}{a.meetingStatus ? ` · ${a.meetingStatus}` : ''}</p></li>)}</ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'timeline' && (
        <Card title="Invoice timeline" action={<span className="text-xs text-ink-400">{timeline.length} events · newest first</span>}>
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-ink-100 dark:before:bg-ink-800">
            {timeline.map((e) => (
              <li key={e.key} className="relative flex gap-3"><span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white dark:ring-ink-900', TONE[e.type] || 'bg-ink-100 text-ink-600')}><History size={13} /></span>
                <div className="min-w-0 flex-1 pt-0.5"><p className="text-sm text-ink-800 dark:text-ink-100">{e.href ? <Link to={e.href} className="hover:underline">{e.text}</Link> : e.text}</p>{e.note && <p className="text-xs text-ink-500">{e.note}</p>}<p className="text-[11px] text-ink-400" title={formatDateTime(e.at)}>{(e.by && getUserById(e.by)?.name) || e.byName || (e.by === 'SYSTEM' ? 'System' : '—')} · {timeAgo(e.at)} · {formatDateTime(e.at)}</p></div>
              </li>))}
          </ol>
        </Card>
      )}

      <InvoiceFormDialog open={dlg === 'edit'} onClose={close} invoice={invoice} onSaved={(d) => done(null, d)} />
      {dlg === 'send' && <SendInvoiceDialog invoice={invoice} onClose={close} onDone={(d) => done(null, d)} />}
      <RecordPaymentModal open={dlg === 'pay'} onClose={close} invoice={invoice} onRecorded={() => done()} />
      {dlg === 'preview' && <PdfPreviewDialog invoice={invoice} onClose={close} />}
      <ReasonDialog open={dlg === 'cancel'} onClose={close} title={`Cancel ${invoice.number}?`} description="Use this for an invoice that has not been paid." confirmLabel="Cancel invoice" hint="The invoice stays on record as Cancelled and its number is never reused. A new invoice can be raised for the sales order." onConfirm={(r) => doCancel(invoice)(r).then(() => { close(); done('Invoice cancelled.') })} />
      <ReasonDialog open={dlg === 'void'} onClose={close} title={`Void ${invoice.number}?`} description="Voids an invoice that has already been issued." confirmLabel="Void invoice" hint="Reverse any payments first. The invoice stays on record as Void for audit." onConfirm={(r) => doVoid(invoice)(r).then(() => { close(); done('Invoice voided.') })} />
      <ConfirmDialog open={dlg === 'delete'} onClose={close} title={`Delete draft ${invoice.number}?`} description="Only a draft that was never sent can be deleted; a record of the deletion is kept in the audit log." confirmLabel="Delete draft" onConfirm={() => deleteDraftInvoice(invoice.id).then(() => { toast('Draft deleted.', { type: 'success' }); navigate('/invoices') }).catch((e) => { close(); fail(e) })} />
      {dlg?.kind === 'task' && <TaskFormDialog open onClose={close} related={{ type: 'Invoice', id: invoice.id, label: `${invoice.number} · ${invoice.customerName}` }} preset={dlg.preset} onSaved={() => { toast('Task created and linked to the invoice.', { type: 'success' }); close(); load() }} />}
      {dlg?.kind === 'log' && <LogActivityDialog open onClose={close} presetType={dlg.type} related={{ type: 'Invoice', id: invoice.id, label: `${invoice.number} · ${invoice.customerName}` }} onLogged={() => { close(); load() }} />}
      <span className="hidden"><ArrowRight /><Receipt /><Users2 /><CheckCircle2 /></span>
    </div>
  )
}
