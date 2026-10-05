import { useEffect, useState } from 'react'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MessageCircle, StickyNote, CalendarClock,
  Building2, IndianRupee, Gauge, Clock, Globe, Briefcase, MapPin,
  Pencil, UserCog, ClipboardCheck, UserSquare2, Contact2, Inbox, Radio,
  MoreVertical, Handshake, Video, ArrowRightLeft, ShieldAlert, XCircle, Ban,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { Dropdown, DropdownItem, DropdownDivider, DropdownLabel } from '../../components/common/Dropdown'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { logAuditEvent } from '../../utils/auditLog'
import { LEAD_STATUSES } from '../../data/constants'
import { canTransition } from '../../data/leadWorkflow'
import { reassignLead, saveLeadQualification, changeLeadStatus, overrideLeadStatus, markLeadUnqualified, markLeadLost } from './leadActions'
import { LeadFormModal } from './LeadFormModal'
import { QualifyLeadModal } from './QualifyLeadModal'
import { ConvertToDealModal } from './ConvertToDealModal'
import { MarkUnqualifiedModal } from './MarkUnqualifiedModal'
import { MarkLeadLostModal } from './MarkLeadLostModal'
import { AssignLeadModal } from './AssignLeadModal'
import { CallActionModal } from './CallActionModal'
import { EmailActionModal } from './EmailActionModal'
import { WhatsAppActionModal } from './WhatsAppActionModal'
import { MeetingSchedulerModal } from './MeetingSchedulerModal'
import { MeetingOutcomeModal } from '../../components/common/MeetingOutcomeModal'
import { AddNoteModal } from './AddNoteModal'
import { FollowUpModal } from './FollowUpModal'

// Roles allowed to force a Lead past the enforced LEAD_STATUS_FLOW graph — same pattern as
// QuotationDetail's APPROVER_ROLES. Every use is written to the permanent audit log.
const OVERRIDE_ROLES = ['Super Admin', 'Admin', 'MD']

// One next-action hint per status, shown as a banner right under the header. Primary path:
// New → Contacted → Qualified → Converted. Unqualified and Lost are the two alternative
// terminal outcomes (see LEAD_STATUS_FLOW) — every downstream sales stage past a successful
// conversion (Quotation, Negotiation, the Deal's own Won/Lost) lives on the Deal instead.
const NEXT_STAGE = {
  New: { label: 'Next Stage: Contact', hint: 'Use Call, Email, WhatsApp or Meeting below — the lead moves to Contacted automatically once a successful contact activity is recorded.' },
  Contacted: { label: 'Next Stage: Qualify', hint: 'Capture qualification details to move this lead to Qualified, or use More Actions if it turns out not to be a fit.' },
  Qualified: { label: 'Next Stage: Convert to Deal', hint: 'This lead is qualified — convert it to a Deal when ready. The Lead lifecycle ends here; the Deal takes over from this point.' },
  Converted: { label: 'Converted', hint: 'This lead successfully became a Deal — see the linked Deal below for everything that happens next.' },
  Unqualified: { label: 'Unqualified', hint: 'This lead was reviewed and does not meet the qualification criteria — see the reason below. It stays in the CRM for reporting.' },
  Lost: { label: 'Lost', hint: 'This lead was a genuine opportunity, but the business is no longer progressing — see the reason below. It stays in the CRM for reporting.' },
}

function InfoRow({ icon: Icon, label, value, href }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-ink-400">{label}</p>
        {href && value ? (
          (href.startsWith('/') ? <Link to={href} className="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{value}</Link> : <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{value}</a>)
        ) : (
          <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</p>
        )}
      </div>
    </div>
  )
}

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const { toast } = useToast()
  const canEdit = hasPermission('Leads', 'edit')
  const canOverride = OVERRIDE_ROLES.includes(user?.role)

  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [qualifyOpen, setQualifyOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [unqualifyOpen, setUnqualifyOpen] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [outcomeTarget, setOutcomeTarget] = useState(null)

  // `load`/`loadActivities` are silent background refetches — they never touch `loading`.
  // Only the initial mount (the effect below) shows the skeleton; every quick-action's
  // `onLogged={refresh}` must NOT re-trigger it, since that would unmount this whole JSX
  // subtree (including whichever modal is still open) and remount it with fresh state —
  // exactly what was discarding MeetingSchedulerModal's "Meeting Scheduled" share screen the
  // instant it appeared. Same flicker class as the earlier Settings→Appearance bug.
  const load = () => api.get(`/leads/${id}`).then((res) => setLead(res.data)).catch(() => setLead(null))
  const loadActivities = () => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => belongsTo(a, 'Lead', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  })
  useEffect(() => {
    setLoading(true)
    Promise.all([load(), loadActivities()]).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const refresh = () => { load(); loadActivities() }

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!lead) return <EmptyState title="Lead not found" description="This lead may have been deleted." action={<Button onClick={() => navigate('/leads')}>Back to Leads</Button>} />

  const owner = getUserById(lead.assignedTo)
  const isClosed = ['Converted', 'Unqualified', 'Lost'].includes(lead.status)
  // Only real scheduled meetings (from MeetingSchedulerModal, which sets `meetingStatus`) —
  // some seed activity data predates that feature and only has the generic subject/notes shape,
  // which would otherwise render as blank dashes in the Meetings card below.
  const meetings = activities.filter((a) => a.type === 'Meeting' && a.meetingStatus)
  const statusHistory = [
    { id: 'created', label: 'Created', date: lead.createdDate, detail: `Lead created${lead.source ? ` via ${lead.source}` : ''}` },
    ...activities.filter((a) => a.type === 'StatusChange').slice().reverse().map((a) => ({ id: a.id, label: a.subject, date: a.date, detail: a.notes, by: a.by })),
  ]
  const lastActivity = activities[0]
  const nextStage = NEXT_STAGE[lead.status]

  const doAssign = (newAssigneeId) => {
    setSaving(true)
    const newAssignee = getUserById(newAssigneeId)
    reassignLead(lead, { newAssigneeId, by: user.id, byName: user.name, newAssigneeName: newAssignee?.name || 'a salesperson' })
      .then(() => { setSaving(false); setAssignOpen(false); toast(`${lead.name} ${lead.assignedTo ? 'reassigned' : 'assigned'} to ${newAssignee?.name}.`, { type: 'success' }); refresh() })
  }

  const doQualify = (qualification, outcome) => {
    setSaving(true)
    saveLeadQualification(lead, qualification, { by: user.id, outcome })
      .then(() => { setSaving(false); setQualifyOpen(false); toast(`Qualification saved${outcome ? ` — moved to ${outcome}` : ''}.`, { type: 'success' }); refresh() })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doMarkUnqualified = ({ reason, notes }) => {
    setSaving(true)
    markLeadUnqualified(lead, { reason, notes, by: user.id })
      .then(() => { setSaving(false); setUnqualifyOpen(false); toast(`${lead.name} marked as Unqualified.`, { type: 'success' }); refresh() })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doMarkLost = ({ reason, notes }) => {
    setSaving(true)
    markLeadLost(lead, { reason, notes, by: user.id })
      .then(() => { setSaving(false); setLostOpen(false); toast(`${lead.name} marked as Lost.`, { type: 'success' }); refresh() })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doChangeStatus = (newStatus) => {
    if (newStatus === lead.status) return
    if (canTransition(lead.status, newStatus)) {
      changeLeadStatus(lead, newStatus, { by: user.id })
        .then(() => { toast(`Status changed to ${newStatus}.`, { type: 'success' }); refresh() })
        .catch((err) => toast(err.message, { type: 'error' }))
      return
    }
    if (!canOverride) {
      toast(`Cannot move a lead from "${lead.status}" to "${newStatus}" — this transition isn't allowed by the sales workflow.`, { type: 'error' })
      return
    }
    overrideLeadStatus(lead, newStatus, { by: user.id, note: `Administrative override by ${user.name} (${user.role}).` }).then(() => {
      logAuditEvent({ user, action: 'Override Lead Status', module: 'Leads', record: lead.id, previousValue: lead.status, newValue: newStatus })
      toast(`Status overridden to ${newStatus}.`, { type: 'warning' })
      refresh()
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Breadcrumbs items={[{ label: 'Lead Management', href: '/leads' }, { label: lead.id }]} />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{lead.name}</h1>
            <StatusBadge status={lead.status} />
            <PriorityBadge priority={lead.priority} />
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{lead.id} · {lead.designation ? `${lead.designation} · ` : ''}{lead.company}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/leads')}>Back</Button>
          {canEdit && !isClosed && <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
          {canEdit && !isClosed && <Button variant="secondary" icon={UserCog} onClick={() => setAssignOpen(true)}>{lead.assignedTo ? 'Reassign' : 'Assign'}</Button>}
          {canEdit && !isClosed && <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Add Follow-up</Button>}
          {canEdit && <LogActivityButton type="Lead" id={lead.id} label={lead.name} onLogged={loadActivities} />}
          <RecordTasksButton type="Lead" id={lead.id} label={lead.name} />
          {canEdit && !isClosed && <Button variant="secondary" icon={Video} onClick={() => setMeetingOpen(true)}>Schedule Meeting</Button>}
          {/* Qualified is the only stage where Convert to Deal is the primary next action — it
              never competes with Qualify Lead (mutually exclusive by canTransition) or with any
              other action as a peer button. */}
          {canEdit && canTransition(lead.status, 'Qualified') && (
            <Button variant="secondary" icon={ClipboardCheck} onClick={() => setQualifyOpen(true)}>Qualify Lead</Button>
          )}
          {canEdit && canTransition(lead.status, 'Converted') && (
            <Button icon={Handshake} onClick={() => setConvertOpen(true)}>Convert to Deal</Button>
          )}
          {canEdit && !isClosed && (
            <Dropdown align="right" trigger={<Button variant="secondary" icon={MoreVertical}>More Actions</Button>}>
              {(canTransition(lead.status, 'Unqualified') || canTransition(lead.status, 'Lost')) && (
                <>
                  <DropdownLabel>Alternative Outcome</DropdownLabel>
                  {canTransition(lead.status, 'Unqualified') && (
                    <DropdownItem icon={XCircle} onClick={() => setUnqualifyOpen(true)}>Mark Unqualified</DropdownItem>
                  )}
                  {canTransition(lead.status, 'Lost') && (
                    <DropdownItem icon={Ban} danger onClick={() => setLostOpen(true)}>Mark Lost</DropdownItem>
                  )}
                </>
              )}
              {canOverride && (
                <>
                  <DropdownDivider />
                  <DropdownLabel>Change Status (Override)</DropdownLabel>
                  {LEAD_STATUSES.filter((s) => s !== lead.status).map((s) => (
                    <DropdownItem key={s} icon={canTransition(lead.status, s) ? ArrowRightLeft : ShieldAlert} onClick={() => doChangeStatus(s)}>
                      {s}{!canTransition(lead.status, s) ? ' (override)' : ''}
                    </DropdownItem>
                  ))}
                </>
              )}
            </Dropdown>
          )}
        </div>
      </div>

      {nextStage && (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-800/50 dark:bg-brand-900/20">
          <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">{nextStage.label}</p>
          <p className="mt-0.5 text-xs text-brand-700 dark:text-brand-300">{nextStage.hint}</p>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 sm:grid-cols-4">
        <div><p className="text-xs text-ink-400">Lead Source</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lead.source || '—'}</p></div>
        <div><p className="text-xs text-ink-400">Assigned Salesperson</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{owner?.name || 'Unassigned'}</p></div>
        <div><p className="text-xs text-ink-400">Created Date</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{formatDate(lead.createdDate)}</p></div>
        <div><p className="text-xs text-ink-400">Last Activity</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lastActivity ? formatDate(lastActivity.date) : 'None yet'}</p></div>
        <div className="col-span-2 sm:col-span-1"><p className="text-xs text-ink-400">Next Follow-up</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lead.nextFollowUp ? formatDate(lead.nextFollowUp) : '—'}</p></div>
        <div className="col-span-2 sm:col-span-1"><p className="text-xs text-ink-400">Lead Score</p><p className="text-sm font-semibold text-brand-600 dark:text-brand-400">{lead.score}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Contact Information</p>
            <div className="flex items-center gap-3 border-b border-ink-100 pb-4 dark:border-ink-800">
              <Avatar name={lead.name} size="lg" />
              <div>
                <p className="text-base font-bold text-ink-900 dark:text-ink-50">{lead.name}</p>
                <p className="text-sm text-ink-500 dark:text-ink-400">{lead.designation ? `${lead.designation} · ` : ''}{lead.company}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <InfoRow icon={Phone} label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : null} />
              <InfoRow icon={MessageCircle} label="WhatsApp" value={lead.whatsapp || lead.phone} href={lead.phone ? `https://wa.me/${(lead.whatsapp || lead.phone).replace(/\D/g, '')}` : null} />
              <InfoRow icon={Mail} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : null} />
              <InfoRow icon={Building2} label="Company" value={lead.company} />
              <InfoRow icon={Briefcase} label="Industry" value={lead.industry} />
              <InfoRow icon={MapPin} label="Location" value={lead.location} />
              <InfoRow icon={Globe} label="Website" value={lead.website} href={lead.website ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`) : null} />
              <InfoRow icon={Gauge} label="Interested Service" value={lead.service} href={lead.productId ? `/products/${lead.productId}` : null} />
              <InfoRow icon={IndianRupee} label="Budget" value={formatCurrency(lead.budget)} />
              <InfoRow icon={Clock} label="Last Contacted" value={lead.lastContactedDate ? formatDateTime(lead.lastContactedDate) : 'Not yet contacted'} />
            </div>
          </div>

          {!isClosed && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Quick Actions</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={Phone} onClick={() => setCallOpen(true)}>Call</Button>
                <Button variant="secondary" icon={Mail} onClick={() => setEmailOpen(true)}>Email</Button>
                <Button variant="secondary" icon={MessageCircle} onClick={() => setWaOpen(true)}>WhatsApp</Button>
                <Button variant="secondary" icon={Video} onClick={() => setMeetingOpen(true)}>Meeting</Button>
                <Button variant="secondary" icon={StickyNote} onClick={() => setNoteOpen(true)}>Add Note</Button>
                <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Follow-up</Button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Requirement</p>
            <p className="text-sm text-ink-600 dark:text-ink-300">{lead.requirement}</p>
            {lead.notes && (
              <>
                <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Notes</p>
                <p className="text-sm text-ink-600 dark:text-ink-300">{lead.notes}</p>
              </>
            )}
          </div>

          {meetings.length > 0 && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Meetings</p>
              <div className="space-y-2.5">
                {meetings.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                    <div>
                      <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{m.title}</p>
                      <p className="text-xs text-ink-400">{formatDate(m.meetingDate)} · {m.meetingStartTime} · {m.meetingType}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={m.meetingStatus} />
                      {m.meetingLink && <Button variant="ghost" size="sm" onClick={() => navigate(m.meetingLink)}>Open</Button>}
                      {m.meetingStatus === 'Scheduled' && <Button variant="secondary" size="sm" onClick={() => setOutcomeTarget(m)}>Update</Button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Activity Timeline</p>
            <ActivityTimeline items={activities} />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Radio size={12} /> Lead Source</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-ink-400">Source</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.source || '—'}</p></div>
              <div><span className="text-ink-400">Source Detail</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.sourceDetail || '—'}</p></div>
              <div><span className="text-ink-400">Campaign</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.campaign || '—'}</p></div>
              <div><span className="text-ink-400">Capture Method</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.captureMethod || '—'}</p></div>
              <div className="col-span-2"><span className="text-ink-400">Captured At</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.capturedAt ? formatDateTime(lead.capturedAt) : formatDate(lead.createdDate)}</p></div>
            </div>
            {lead.sourceEnquiryId && (
              <Button variant="secondary" size="sm" icon={Inbox} className="mt-3 w-full" onClick={() => navigate(`/enquiries?open=${lead.sourceEnquiryId}`)}>View Source Enquiry {lead.sourceEnquiryId}</Button>
            )}
            {lead.contactId && (
              <Button variant="secondary" size="sm" icon={Contact2} className="mt-2 w-full" onClick={() => navigate(`/contacts/${lead.contactId}`)}>View Linked Contact</Button>
            )}
            {lead.companyId && (
              <Button variant="secondary" size="sm" icon={Building2} className="mt-2 w-full" onClick={() => navigate(`/companies/${lead.companyId}`)}>View Company</Button>
            )}
          </div>

          {lead.qualification && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Qualification</p>
                <Badge tone={lead.qualification.qualificationScore >= 60 ? 'success' : 'warning'}>{lead.qualification.qualificationScore}/100</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-ink-400">Decision Maker?</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.qualification.decisionMakerIdentified}</p></div>
                <div><span className="text-ink-400">Timeline</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.qualification.timeline}</p></div>
                <div><span className="text-ink-400">Company Size</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.qualification.companySize}</p></div>
                <div><span className="text-ink-400">Purchase Probability</span><p className="font-medium text-ink-700 dark:text-ink-200">{lead.qualification.purchaseProbability}%</p></div>
              </div>
            </div>
          )}

          {lead.status === 'Unqualified' && lead.unqualifiedReason && (
            <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5 dark:border-ink-700 dark:bg-ink-800/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Unqualified Reason</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{lead.unqualifiedReason}</p>
              {lead.unqualifiedNotes && <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{lead.unqualifiedNotes}</p>}
              <p className="mt-2 text-xs text-ink-400">{formatDateTime(lead.unqualifiedDate)}{lead.unqualifiedBy ? ` · ${getUserById(lead.unqualifiedBy)?.name || ''}` : ''}</p>
            </div>
          )}

          {lead.status === 'Lost' && lead.lostReason && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-800/50 dark:bg-rose-900/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Lost Reason</p>
              <p className="mt-1 text-sm font-semibold text-rose-800 dark:text-rose-200">{lead.lostReason}</p>
              {lead.lostNotes && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{lead.lostNotes}</p>}
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{formatDateTime(lead.lostDate)}{lead.lostBy ? ` · ${getUserById(lead.lostBy)?.name || ''}` : ''}</p>
            </div>
          )}

          {lead.status === 'Converted' && lead.dealId && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/50 dark:bg-emerald-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Converted — Linked Deal</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={Handshake} onClick={() => navigate(`/deals?open=${lead.dealId}`)}>{lead.dealId}</Button>
                {lead.customerId && <Button variant="secondary" size="sm" icon={UserSquare2} onClick={() => navigate(`/customers/${lead.customerId}`)}>View Customer</Button>}
                {lead.contactId && <Button variant="secondary" size="sm" icon={Contact2} onClick={() => navigate(`/contacts/${lead.contactId}`)}>View Contact</Button>}
              </div>
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Converted {formatDate(lead.convertedAt)} by {getUserById(lead.convertedBy)?.name || '—'}</p>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Status History</p>
            <ol className="space-y-3">
              {statusHistory.map((h, idx) => (
                <li key={h.id} className="relative pl-4">
                  <span className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${idx === statusHistory.length - 1 ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-600'}`} />
                  <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{h.label}</p>
                  <p className="text-xs text-ink-400">{formatDateTime(h.date)}{h.by ? ` · ${getUserById(h.by)?.name || ''}` : ''}</p>
                  {h.detail && <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{h.detail}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <LeadFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Lead"
        description={`Update details for ${lead.name}.`}
        submitLabel="Save Changes"
        loading={saving}
        defaultValues={lead}
        onSubmit={(data) => {
          setSaving(true)
          api.put(`/leads/${lead.id}`, { ...data, budget: Number(data.budget) || 0 }).then(() => {
            setSaving(false); setEditOpen(false); toast('Lead updated.', { type: 'success' }); refresh()
          })
        }}
      />
      <AssignLeadModal open={assignOpen} onClose={() => setAssignOpen(false)} lead={lead} saving={saving} onSave={doAssign} />
      <QualifyLeadModal open={qualifyOpen} onClose={() => setQualifyOpen(false)} lead={lead} saving={saving} onSave={doQualify} />
      <ConvertToDealModal open={convertOpen} onClose={() => setConvertOpen(false)} lead={lead} onConverted={refresh} />
      <MarkUnqualifiedModal open={unqualifyOpen} onClose={() => setUnqualifyOpen(false)} lead={lead} saving={saving} onSave={doMarkUnqualified} />
      <MarkLeadLostModal open={lostOpen} onClose={() => setLostOpen(false)} lead={lead} saving={saving} onSave={doMarkLost} />
      <CallActionModal open={callOpen} onClose={() => setCallOpen(false)} lead={lead} onLogged={refresh} />
      <EmailActionModal open={emailOpen} onClose={() => setEmailOpen(false)} lead={lead} onLogged={refresh} />
      <WhatsAppActionModal open={waOpen} onClose={() => setWaOpen(false)} lead={lead} onLogged={refresh} />
      <MeetingSchedulerModal open={meetingOpen} onClose={() => setMeetingOpen(false)} lead={lead} onLogged={refresh} />
      <MeetingOutcomeModal open={!!outcomeTarget} onClose={() => setOutcomeTarget(null)} meeting={outcomeTarget} relatedType="Lead" relatedId={lead.id} onUpdated={refresh} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} lead={lead} onLogged={refresh} />
      <FollowUpModal open={followUpOpen} onClose={() => setFollowUpOpen(false)} lead={lead} onLogged={refresh} />
    </div>
  )
}
