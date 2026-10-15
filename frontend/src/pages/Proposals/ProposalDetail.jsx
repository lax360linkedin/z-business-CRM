import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Pencil, ArrowLeft, FileText, Phone, Mail, MessageCircle, CalendarClock, StickyNote, Paperclip, Download, Printer, Eye, Send, GitBranch,
  ArrowRightLeft, Handshake, Building2, User, Users, Inbox, Target, Receipt, CreditCard, ClipboardList, Clock, Trash2, IndianRupee, AlertTriangle, RefreshCw, CheckCircle2, History,
} from 'lucide-react'
import clsx from 'clsx'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button, IconButton } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { StatCard } from '../../components/common/StatCard'
import { Modal } from '../../components/common/Modal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { formatBytes, dataUrlToBytes } from '../../utils/quotationAttachmentRules'
import { PR_EDITABLE, PR_REVISABLE, PR_TRANSITIONS, NARRATIVE_SECTIONS, computeCommercial, proposalLabel } from '../../utils/proposalCalc'
import { pdfBytesToBlobUrl } from '../Quotations/quotationPdf'
import { DocumentDialog } from '../SalesOrders/SalesOrderDialogs'
import { buildProposalPdf } from './proposalPdf'
import { StatusDialog, ReviseDialog, ClientRefreshDialog, ActivityDialog, SendProposalDialog, QuotationDialog } from './ProposalDialogs'
import { loadProposalLinks, attachProposalDocument, removeProposalDocument, sweepExpired, getClientDiff, deleteProposal, pickTemplate, prError } from './proposalClient'

const STEPS = ['Draft', 'Internal Review', 'Sent', 'Viewed', 'Accepted']
const stepOf = (s) => (s === 'Revision Requested' ? 3 : s === 'Rejected' || s === 'Expired' ? 3 : STEPS.indexOf(s))

function Card({ title, icon: Icon, action, children, className }) {
  return (
    <section className={clsx('rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">{Icon && <Icon size={15} className="text-brand-500" />} {title}</h2>{action}
      </div>
      {children}
    </section>
  )
}
function Info({ label, children }) {
  return <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</dt><dd className="mt-0.5 break-words text-sm text-ink-800 dark:text-ink-100">{children || '—'}</dd></div>
}
function Related({ icon: Icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-800/50">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><Icon size={14} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] uppercase tracking-wide text-ink-400">{label}</span><span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value}</span></span>
    </button>
  )
}
function Prose({ text }) {
  return <div className="space-y-2 text-sm leading-relaxed text-ink-700 dark:text-ink-200">{String(text).split(/\n+/).filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}</div>
}

export default function ProposalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user, hasPermission } = useAuth()
  const canEdit = hasPermission('Proposals', 'edit')
  const canDelete = hasPermission('Proposals', 'delete')

  const [proposal, setProposal] = useState(null)
  const [links, setLinks] = useState({})
  const [activities, setActivities] = useState([])
  const [diffCount, setDiffCount] = useState(0)
  const [viewVersion, setViewVersion] = useState(null) // null = current
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadActivities = useCallback(() => api.get('/activities', { params: { all: true } }).then((r) => {
    setActivities(r.data.filter((a) => belongsTo(a, 'Proposal', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  }), [id])
  const load = useCallback(() => api.get(`/proposals/${id}`).then(async (r) => {
    setProposal(r.data)
    setLinks(await loadProposalLinks(r.data))
    getClientDiff(id).then((d) => setDiffCount(d.changes.length)).catch(() => setDiffCount(0))
  }).catch(() => setProposal(null)), [id])
  const refresh = useCallback(() => Promise.all([load(), loadActivities()]), [load, loadActivities])
  useEffect(() => { setLoading(true); setViewVersion(null); sweepExpired().then(() => refresh()).finally(() => setLoading(false)) }, [refresh])

  const owner = getUserById(proposal?.ownerId)
  // What is on screen: the current version, or a frozen earlier one.
  const shown = useMemo(() => {
    if (!proposal) return null
    if (viewVersion == null) return proposal
    const v = (proposal.versions || []).find((x) => x.version === viewVersion)
    return v ? { ...proposal, ...v, versionView: true } : proposal
  }, [proposal, viewVersion])
  const content = shown?.content
  const calc = useMemo(() => (content ? computeCommercial(content.items) : null), [content])

  if (loading) return <div className="space-y-4"><CardSkeleton className="h-24" /><CardSkeleton className="h-64" /></div>
  if (!proposal) return <EmptyState title="Proposal not found" description="This proposal may have been deleted." action={<Button onClick={() => navigate('/proposals')}>Back to Proposals</Button>} />

  const { deal, company, contact, customer, enquiry, lead, quotations = [], orders = [], invoices = [], payments = [] } = links
  const client = shown.clientSnapshot || {}
  const readOnlyView = !!shown.versionView
  const editable = canEdit && PR_EDITABLE.includes(proposal.status) && !readOnlyView
  const canRevise = canEdit && PR_REVISABLE.includes(proposal.status) && !readOnlyView
  const nextStatuses = (PR_TRANSITIONS[proposal.status] || []).filter((s) => s !== 'Sent')
  const expiringIn = Math.ceil((new Date(proposal.validUntil) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
  const phone = client.phone

  const pdfBytes = async () => {
    const sent = readOnlyView ? shown.sentDocument : (!PR_EDITABLE.includes(proposal.status) ? proposal.sentDocument : null)
    if (sent?.dataUrl) return dataUrlToBytes(sent.dataUrl) // the exact document that went to the client
    const template = await pickTemplate(proposal)
    return buildProposalPdf({ proposal: shown, template, ownerName: owner?.name, ownerEmail: owner?.email })
  }
  const pdf = async (mode) => {
    setPdfBusy(true)
    try {
      const bytes = await pdfBytes()
      const url = pdfBytesToBlobUrl(bytes)
      if (mode === 'preview') setPreviewUrl(url)
      else if (mode === 'print') { if (!window.open(url, '_blank')) toast('Allow pop-ups to open the print view.', { type: 'warning' }) } else {
        const a = document.createElement('a'); a.href = url; a.download = `${proposal.number}-v${shown.version}.pdf`; document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch { toast('Could not generate the PDF.', { type: 'error' }) } finally { setPdfBusy(false) }
  }
  const downloadDoc = (d) => {
    const url = URL.createObjectURL(new Blob([dataUrlToBytes(d.dataUrl)], { type: d.mimeType || 'application/octet-stream' }))
    const a = document.createElement('a'); a.href = url; a.download = d.fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  const confirmDelete = () => { setBusy(true); deleteProposal(proposal.id).then(() => { toast(`${proposal.number} deleted.`, { type: 'success' }); navigate('/proposals') }).catch((e) => { toast(prError(e), { type: 'error' }); setBusy(false); setDialog(null) }) }

  const timeline = (rows) => rows.length ? rows : null
  const followUps = activities.filter((a) => a.type === 'Follow-up')
  const meetings = activities.filter((a) => a.type === 'Meeting')
  const notes = activities.filter((a) => a.type === 'Note')
  const progress = stepOf(proposal.status)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Proposals', href: '/proposals' }, { label: proposal.number }]} />

      <div className="mb-4 mt-1 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{proposal.title}</h1>
            <StatusBadge status={proposal.status} />
            {expiringIn < 0 && PR_REVISABLE.includes(proposal.status) && proposal.status !== 'Expired' && <Badge tone="danger">Past validity</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{proposalLabel(proposal)} · {client.companyName} · {formatCurrency(proposal.value)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/proposals')}>Back</Button>
          {editable && <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/proposals/${proposal.id}/edit`)}>Edit Proposal</Button>}
          {canEdit && proposal.status === 'Draft' && !readOnlyView && <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setDialog('status')}>Submit for Review</Button>}
          {canEdit && proposal.status === 'Internal Review' && !readOnlyView && <Button icon={Send} onClick={() => setDialog('send')}>Send Proposal</Button>}
          {canRevise && <Button variant="secondary" icon={GitBranch} onClick={() => setDialog('revise')}>Create Revision</Button>}
          {canEdit && nextStatuses.length > 0 && !readOnlyView && proposal.status !== 'Draft' && <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setDialog('status')}>Change Status</Button>}
          {hasPermission('Quotations', 'create') && !['Rejected', 'Expired'].includes(proposal.status) && <Button variant="secondary" icon={FileText} onClick={() => setDialog('quotation')}>Create Quotation</Button>}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {canEdit && <Button size="sm" variant="ghost" icon={Phone} onClick={() => setDialog('Call')}>Call</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={Mail} onClick={() => setDialog('Email')} disabled={!client.email}>Email</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => setDialog('WhatsApp')} disabled={!phone}>WhatsApp</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={CalendarClock} onClick={() => setDialog('Meeting')}>Schedule Meeting</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={StickyNote} onClick={() => setDialog('Note')}>Add Note</Button>}
        {canEdit && <Button size="sm" variant="ghost" icon={Clock} onClick={() => setDialog('Follow-up')}>Add Follow-up</Button>}
        {canEdit && <LogActivityButton size="sm" variant="ghost" type="Proposal" id={proposal.id} label={`${proposal.number} · ${proposal.title}`} onLogged={loadActivities} />}
          <RecordTasksButton size="sm" variant="ghost" type="Proposal" id={proposal.id} label={`${proposal.number} · ${proposal.title}`} />
        {canEdit && <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => setDialog('doc')}>Upload Attachment</Button>}
        <Button size="sm" variant="ghost" icon={Eye} loading={pdfBusy} onClick={() => pdf('preview')}>Preview / Generate PDF</Button>
        <Button size="sm" variant="ghost" icon={Download} onClick={() => pdf('download')}>Download</Button>
        <Button size="sm" variant="ghost" icon={Printer} onClick={() => pdf('print')}>Print</Button>
        {canDelete && proposal.status === 'Draft' && proposal.version === 1 && !readOnlyView && <Button size="sm" variant="ghost" icon={Trash2} className="text-rose-600" onClick={() => setDialog('delete')}>Delete draft</Button>}
      </div>

      {readOnlyView && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-800/50 dark:bg-violet-900/20 dark:text-violet-200">
          <span className="flex items-center gap-2"><History size={15} /> Viewing {proposal.number} – Version {shown.version} (read-only, as it was). The active version is Version {proposal.version}.</span>
          <Button size="sm" variant="secondary" onClick={() => setViewVersion(null)}>Back to current version</Button>
        </div>
      )}
      {!readOnlyView && diffCount > 0 && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="flex items-center gap-2"><AlertTriangle size={15} /> {diffCount} client detail{diffCount === 1 ? '' : 's'} changed on the master Company / Contact record since this version was written.</span>
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setDialog('client')}>Review</Button>
        </div>
      )}
      {proposal.status === 'Revision Requested' && proposal.revisionRequest && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200"><b>Client requested:</b> {proposal.revisionRequest}</div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Proposal value" value={formatCurrency(shown.value ?? proposal.value)} icon={IndianRupee} tone="brand" />
        <StatCard label="Version" value={`v${shown.version}${readOnlyView ? '' : ` of ${proposal.version}`}`} icon={GitBranch} tone="violet" />
        <StatCard label="Valid until" value={formatDate(shown.validUntil)} icon={CalendarClock} tone={expiringIn < 0 ? 'rose' : 'amber'} />
        <StatCard label="Quotations" value={quotations.length} icon={FileText} tone="sky" />
      </div>

      <div className="mb-5 rounded-2xl border border-ink-100 bg-white px-6 py-5 dark:border-ink-800 dark:bg-ink-900">
        <ol className="flex items-center">
          {STEPS.map((s, i) => {
            const done = i < progress
            const active = i === progress
            const label = active && ['Revision Requested', 'Rejected', 'Expired'].includes(proposal.status) ? proposal.status : s
            return (
              <li key={s} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <span className={clsx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-emerald-500 text-white' : active ? (['Rejected', 'Expired'].includes(proposal.status) ? 'bg-rose-500 text-white' : 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-900/40') : 'bg-ink-100 text-ink-400 dark:bg-ink-800')}>{done || (active && proposal.status === 'Accepted') ? <CheckCircle2 size={15} /> : i + 1}</span>
                  <span className={clsx('text-[11px] font-medium', active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400')}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <span className={clsx('mx-2 mb-4 h-0.5 flex-1 rounded-full', i < progress ? 'bg-emerald-400' : 'bg-ink-100 dark:bg-ink-800')} />}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Proposal information" icon={FileText}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              <Info label="Proposal number">{proposalLabel(shown)}</Info>
              <Info label="Status">{proposal.status}</Info>
              <Info label="Created">{formatDate(proposal.createdDate)}</Info>
              <Info label="Expiry">{formatDate(shown.validUntil)}</Info>
              <Info label="Linked deal">{deal ? `${deal.name} · ${deal.stage}` : proposal.dealId}</Info>
              <Info label="Owner">{owner?.name}</Info>
              <Info label="Sent">{proposal.sentAt && !readOnlyView ? formatDateTime(proposal.sentAt) : shown.sentAt ? formatDateTime(shown.sentAt) : 'Not sent'}</Info>
              <Info label="Source">{proposal.source}{proposal.sourceDetail ? ` — ${proposal.sourceDetail}` : ''}</Info>
            </dl>
          </Card>

          <Card title="Client" icon={Building2} action={!readOnlyView && <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setDialog('client')}>Compare with master</Button>}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
              <Info label="Company">{client.companyName}</Info>
              <Info label="Contact person">{client.contactName}</Info>
              <Info label="Designation">{client.designation}</Info>
              <Info label="Industry">{client.industry}</Info>
              <Info label="Phone">{client.phone}</Info>
              <Info label="Email">{client.email}</Info>
              <Info label="GSTIN">{client.gstin}</Info>
              <Info label="Website">{client.website}</Info>
              <div className="col-span-2"><Info label="Billing address">{client.billingAddress}</Info></div>
              <div className="col-span-2"><Info label="Shipping / service address">{client.shippingAddress}</Info></div>
            </dl>
          </Card>

          {NARRATIVE_SECTIONS.slice(0, 5).map((s) => (content[s.key] ? <Card key={s.key} title={s.label}><Prose text={content[s.key]} /></Card> : null))}

          {content.modules.length > 0 && (
            <Card title="Modules / features">
              <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800"><table className="w-full text-sm"><tbody>{content.modules.map((m, i) => <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="w-1/3 px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{m.name}</td><td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{m.description}</td></tr>)}</tbody></table></div>
            </Card>
          )}
          {content.deliverables.length > 0 && <Card title="Deliverables"><ul className="list-disc space-y-1 pl-5 text-sm text-ink-700 dark:text-ink-200">{content.deliverables.map((d, i) => <li key={i}>{d}</li>)}</ul></Card>}
          {NARRATIVE_SECTIONS.slice(5, 7).map((s) => (content[s.key] ? <Card key={s.key} title={s.label}><Prose text={content[s.key]} /></Card> : null))}
          {content.timeline.length > 0 && (
            <Card title="Project timeline">
              <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800"><table className="w-full text-sm"><thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2">Phase</th><th className="px-4 py-2">Activities</th><th className="px-4 py-2">Duration</th></tr></thead><tbody>{content.timeline.map((t, i) => <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{t.phase}</td><td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{t.description}</td><td className="px-4 py-2.5 text-ink-500">{t.duration}</td></tr>)}</tbody></table></div>
            </Card>
          )}
          {(content.responsibilities.company || content.responsibilities.client) && (
            <Card title="Responsibilities"><div className="grid grid-cols-1 gap-4 md:grid-cols-2">{content.responsibilities.company && <div><p className="mb-1 text-xs font-semibold uppercase text-ink-400">Our responsibilities</p><Prose text={content.responsibilities.company} /></div>}{content.responsibilities.client && <div><p className="mb-1 text-xs font-semibold uppercase text-ink-400">Client responsibilities</p><Prose text={content.responsibilities.client} /></div>}</div></Card>
          )}
          {NARRATIVE_SECTIONS.slice(7, 10).map((s) => (content[s.key] ? <Card key={s.key} title={s.label}><Prose text={content[s.key]} /></Card> : null))}

          <Card title="Commercial summary" icon={IndianRupee}>
            <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-4 py-2.5">Item / service</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Unit price</th><th className="px-3 py-2.5 text-right">Disc</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead>
                <tbody>{content.items.map((it, i) => <tr key={i} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60"><td className="px-4 py-3"><p className="font-medium text-ink-800 dark:text-ink-100">{it.name}{it.productCode && <span className="ml-2 font-mono text-[11px] font-normal text-ink-400">{it.productCode}</span>}</p>{it.description && <p className="text-xs text-ink-400">{it.description}</p>}</td><td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.qty}</td><td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{formatCurrency(it.unitPrice)}</td><td className="px-3 py-3 text-right text-ink-600 dark:text-ink-300">{it.discount}%</td><td className="px-4 py-3 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(calc.lines[i].net)}</td></tr>)}</tbody>
              </table>
            </div>
            <dl className="ml-auto mt-3 w-full max-w-xs space-y-1.5 text-sm">
              {calc.discount > 0 && <div className="flex justify-between text-ink-600 dark:text-ink-300"><dt>Discount</dt><dd>− {formatCurrency(calc.discount)}</dd></div>}
              <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><dt>Proposal value</dt><dd>{formatCurrency(calc.value)}</dd></div>
              <div className="flex justify-between text-xs text-ink-500"><dt>Est. GST (per line rate)</dt><dd>{formatCurrency(calc.estimatedTax)}</dd></div>
              <div className="flex justify-between text-xs text-ink-500"><dt>Est. total</dt><dd>{formatCurrency(calc.estimatedTotal)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-400">Indicative figures. The binding price offer is a separate Quotation.</p>
          </Card>
          {NARRATIVE_SECTIONS.slice(10).map((s) => (content[s.key] ? <Card key={s.key} title={s.label}><Prose text={content[s.key]} /></Card> : null))}

          {proposal.notes && <Card title="Internal notes"><Prose text={proposal.notes} /></Card>}

          <Card title="Sent document" icon={Paperclip}>
            {!shown.sentDocument ? <p className="text-sm text-ink-400">No attachments.</p> : (
              <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
                {shown.sentDocument && <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{shown.sentDocument.fileName} <Badge tone="info">Sent to client</Badge></p><p className="text-xs text-ink-400">Exact document sent · Version {shown.sentDocument.version} · {formatBytes(shown.sentDocument.size)} · {formatDateTime(shown.sentDocument.sentAt)}</p></div><IconButton icon={Download} size="sm" aria-label="Download sent document" onClick={() => downloadDoc({ ...shown.sentDocument, mimeType: 'application/pdf' })} /></li>}
              </ul>
            )}
          </Card>
          <Card title="Documents" icon={Paperclip}><DocumentsPanel relatedType="Proposal" relatedId={proposal.id} defaultCategory="Proposals" /></Card>

          <Card title="Version history" icon={GitBranch}>
            <ul className="space-y-2">
              <li className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm', !readOnlyView ? 'border-brand-300 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/10' : 'border-ink-100 dark:border-ink-800')}>
                <span className="font-medium text-ink-800 dark:text-ink-100">{proposal.number} – Version {proposal.version} <Badge tone="success">Active</Badge> <span className="ml-1 text-xs text-ink-400">{proposal.status} · {formatCurrency(proposal.value)}</span></span>
                {readOnlyView && <Button size="sm" variant="secondary" onClick={() => setViewVersion(null)}>View</Button>}
              </li>
              {(proposal.versions || []).map((v) => (
                <li key={v.version} className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm', viewVersion === v.version ? 'border-violet-300 bg-violet-50/50 dark:border-violet-700' : 'border-ink-100 dark:border-ink-800')}>
                  <span><span className="font-medium text-ink-800 dark:text-ink-100">{proposal.number} – Version {v.version}</span> <span className="text-xs text-ink-400">{v.status}{v.sentAt ? ` · sent ${formatDate(v.sentAt)}` : ''} · {formatCurrency(v.value)}</span>{v.reason && <span className="block text-xs text-ink-400">Revised: {v.reason} — {v.revisedByName}</span>}</span>
                  <div className="flex gap-1.5">{v.sentDocument && <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadDoc({ ...v.sentDocument, mimeType: 'application/pdf' })}>Sent PDF</Button>}<Button size="sm" variant="secondary" onClick={() => { setViewVersion(v.version); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>View</Button></div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title="Related records">
            <div className="-mx-1.5 space-y-0.5">
              {enquiry && <Related icon={Inbox} label="Enquiry" value={`${enquiry.id}`} onClick={() => navigate(`/enquiries/${enquiry.id}`)} />}
              {lead && <Related icon={Target} label="Lead" value={`${lead.id} · ${lead.status}`} onClick={() => navigate(`/leads/${lead.id}`)} />}
              {deal && <Related icon={Handshake} label="Deal" value={`${deal.name} · ${deal.stage}`} onClick={() => navigate(`/deals/${deal.id}`)} />}
              {contact && <Related icon={User} label="Contact" value={contact.name} onClick={() => navigate(`/contacts/${contact.id}`)} />}
              {company && <Related icon={Building2} label="Company" value={company.name} onClick={() => navigate(`/companies/${company.id}`)} />}
              {customer && <Related icon={Users} label="Customer" value={customer.name} onClick={() => navigate(`/customers/${customer.id}`)} />}
              {quotations.map((q) => <Related key={q.id} icon={FileText} label="Quotation" value={`${q.number} · ${q.status} · v${q.proposalVersion || 1}`} onClick={() => navigate(`/quotations/${q.id}`)} />)}
              {orders.map((o) => <Related key={o.id} icon={ClipboardList} label="Sales order" value={`${o.number} · ${o.status}`} onClick={() => navigate(`/sales-orders/${o.id}`)} />)}
              {invoices.map((i) => <Related key={i.id} icon={Receipt} label="Invoice" value={`${i.number} · ${i.status}`} onClick={() => navigate(`/invoices/${i.id}`)} />)}
              {payments.length > 0 && <Related icon={CreditCard} label="Payments" value={`${payments.length} · ${formatCurrency(payments.reduce((s, p) => s + p.amount, 0))}`} onClick={() => navigate('/payments')} />}
              {followUps.length > 0 && <Related icon={Clock} label="Follow-ups" value={`${followUps.length}${proposal.nextFollowUp ? ` · next ${formatDate(proposal.nextFollowUp)}` : ''}`} />}
              {meetings.length > 0 && <Related icon={CalendarClock} label="Meetings" value={`${meetings.length}`} onClick={meetings[0].meetingLink ? () => navigate(meetings[0].meetingLink) : undefined} />}
              {notes.length > 0 && <Related icon={StickyNote} label="Notes" value={`${notes.length}`} />}
            </div>
          </Card>
          <Card title="Activity timeline" icon={Clock}><ActivityTimeline items={activities} /></Card>
        </aside>
      </div>

      <StatusDialog open={dialog === 'status'} onClose={() => setDialog(null)} proposal={proposal} onChanged={refresh} />
      <ReviseDialog open={dialog === 'revise'} onClose={() => setDialog(null)} proposal={proposal} onRevised={refresh} />
      <ClientRefreshDialog open={dialog === 'client'} onClose={() => setDialog(null)} proposal={proposal} onRefreshed={refresh} />
      {['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Follow-up'].map((k) => <ActivityDialog key={k} open={dialog === k} kind={k} onClose={() => setDialog(null)} proposal={proposal} onLogged={refresh} />)}
      <SendProposalDialog open={dialog === 'send'} onClose={() => setDialog(null)} proposal={proposal} onSent={refresh} />
      <QuotationDialog open={dialog === 'quotation'} onClose={() => setDialog(null)} proposal={proposal} onCreated={refresh} navigate={navigate} />
      <DocumentDialog open={dialog === 'doc'} onClose={() => setDialog(null)} order={{ number: proposal.number }} categories={['Supporting Document', 'Case Study', 'Technical Spec', 'Other']} uploadFn={(payload) => attachProposalDocument(proposal.id, payload)} onSaved={refresh} />
      <ConfirmDialog open={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={confirmDelete} loading={busy} title="Delete this draft?" description={`${proposal.number} will be permanently removed from the deal.`} confirmLabel="Delete draft" />
      <Modal open={!!previewUrl} onClose={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }} title={`${proposal.number} – Version ${shown.version}`} description={shown.sentDocument || (readOnlyView ? false : proposal.sentDocument && !editable) ? 'The exact document sent to the client.' : 'Generated from the selected template with live CRM data.'} size="xl">
        {previewUrl && <iframe src={previewUrl} title="Proposal PDF preview" className="h-[70vh] w-full rounded-lg border border-ink-100 dark:border-ink-800" />}
      </Modal>
    </div>
  )
}
