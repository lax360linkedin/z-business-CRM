import { AttributionCard } from '../../components/common/AttributionCard'
import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { useEffect, useState } from 'react'
import { LogActivityButton } from '../Activities/LogActivityButton'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { belongsTo } from '../../utils/activityLinks'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MessageCircle, StickyNote, CalendarClock,
  Building2, Gauge, Clock, MapPin, Pencil, UserCog, ClipboardCheck, Search,
  UserSquare2, Inbox, Radio, MoreVertical, Handshake, Video, Copy,
  AlertOctagon, XCircle, Ban, Tag,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { Dropdown, DropdownItem, DropdownLabel } from '../../components/common/Dropdown'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getUserById } from '../../data/users'
import { formatDate, formatDateTime } from '../../utils/format'
import { canTransition, isQualificationComplete } from '../../data/enquiryWorkflow'
import { assignEnquiry, saveEnquiryQualification, closeEnquiry, startEnquiryReview } from './enquiryActions'
import { EnquiryFormModal } from './EnquiryFormModal'
import { AssignEnquiryModal } from './AssignEnquiryModal'
import { QualifyEnquiryModal } from './QualifyEnquiryModal'
import { DispositionEnquiryModal } from './DispositionEnquiryModal'
import { ConvertEnquiryToLeadModal } from './ConvertEnquiryToLeadModal'
import { CallActionModal } from './CallActionModal'
import { EmailActionModal } from './EmailActionModal'
import { WhatsAppActionModal } from './WhatsAppActionModal'
import { MeetingSchedulerModal } from './MeetingSchedulerModal'
import { MeetingOutcomeModal } from '../../components/common/MeetingOutcomeModal'
import { AddNoteModal } from './AddNoteModal'
import { FollowUpModal } from './FollowUpModal'

// Only Converted/Duplicate/Spam are truly terminal — Unqualified/Not Interested/Closed
// deliberately keep Quick Actions (Note/Follow-up etc.) available, matching spec §8's
// "Unqualified: Reopen/Note/Follow-up only" and the pre-existing EnquiryDetailDrawer behavior.
const TERMINAL_STATUSES = ['Converted', 'Duplicate', 'Spam']

// One next-action hint per status, mirroring LeadDetail's NEXT_STAGE banner (spec §8).
const NEXT_STAGE = {
  New: { label: 'Next Stage: Contact', hint: 'Use Call, Email, WhatsApp or Meeting below — the enquiry moves to Contacted automatically once a successful contact activity is recorded.' },
  Assigned: { label: 'Next Stage: Contact', hint: 'This enquiry has been assigned. Use Call, Email, WhatsApp or Meeting below to make contact — it moves to Contacted automatically.' },
  Contacted: { label: 'Next Stage: Qualify Enquiry', hint: 'Capture qualification details to move this enquiry to Qualified, or optionally start a review first.' },
  'Under Review': { label: 'Next Stage: Qualify Enquiry', hint: 'Capture qualification details to decide whether this enquiry is Qualified or Unqualified.' },
  Qualified: { label: 'Next Stage: Convert to Lead', hint: 'This enquiry is qualified — convert it to a Lead when ready. The Lead starts fresh at status "New".' },
  Unqualified: { label: 'Unqualified', hint: 'This enquiry did not meet the qualification criteria — see the reason below. It can still be followed up or noted, but cannot be converted to a Lead.' },
  Converted: { label: 'Converted', hint: 'This enquiry successfully became a Lead — see the linked Lead below. It cannot be converted again.' },
  Duplicate: { label: 'Duplicate', hint: 'This enquiry was flagged as a duplicate of another record.' },
  Spam: { label: 'Spam', hint: 'This enquiry was flagged as spam.' },
  'Not Interested': { label: 'Not Interested', hint: 'The prospect is not proceeding — see the reason below.' },
  Closed: { label: 'Closed', hint: 'This enquiry was closed — see the reason below.' },
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
          <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{value}</a>
        ) : (
          <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Full-page Enquiry Detail (spec §5 — "Do NOT use a basic small popup"), mirroring
 * LeadDetail.jsx's overall structure and section layout exactly, adapted to the Enquiry's
 * richer field set: Enquiry Information / Contact Information / Location / Requirement
 * Information / Additional Information as separate cards (spec §6), plus Qualification,
 * Converted-Lead / Duplicate / Close-reason panels and Status History.
 */
export default function EnquiryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const { toast } = useToast()
  const canEdit = hasPermission('Enquiries', 'edit')

  const [enquiry, setEnquiry] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [qualifyOpen, setQualifyOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [dispositionTarget, setDispositionTarget] = useState(null)
  const [callOpen, setCallOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [outcomeTarget, setOutcomeTarget] = useState(null)

  // Silent background refetches — see LeadDetail.jsx's identical comment for why `loading` must
  // never be re-triggered by a quick action's onLogged/onUpdated (it would unmount whichever
  // modal is open mid-flow, e.g. MeetingSchedulerModal's share screen).
  const load = () => api.get(`/enquiries/${id}`).then((res) => setEnquiry(res.data)).catch(() => setEnquiry(null))
  const loadActivities = () => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => belongsTo(a, 'Enquiry', id)).sort((a, b) => new Date(b.date) - new Date(a.date)))
  })
  useEffect(() => {
    setLoading(true)
    Promise.all([load(), loadActivities()]).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const refresh = () => { load(); loadActivities() }

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!enquiry) return <EmptyState title="Enquiry not found" description="This enquiry may have been deleted." action={<Button onClick={() => navigate('/enquiries')}>Back to Enquiries</Button>} />

  const owner = getUserById(enquiry.assignedUser)
  const isTerminal = TERMINAL_STATUSES.includes(enquiry.status)
  const meetings = activities.filter((a) => a.type === 'Meeting' && a.meetingStatus)
  const statusHistory = [
    { id: 'created', label: 'Created', date: enquiry.createdDate, detail: `Enquiry received${enquiry.source ? ` via ${enquiry.source}` : ''}` },
    ...activities.filter((a) => a.type === 'StatusChange').slice().reverse().map((a) => ({ id: a.id, label: a.subject, date: a.date, detail: a.notes, by: a.by })),
  ]
  const lastActivity = activities[0]
  const nextStage = NEXT_STAGE[enquiry.status]
  const readyToConvert = enquiry.status === 'Qualified' && isQualificationComplete(enquiry.qualification)

  const doAssign = (team, userId) => {
    setSaving(true)
    const assignee = getUserById(userId)
    assignEnquiry(enquiry, { team, userId })
      .then(() => { setSaving(false); setAssignOpen(false); toast(`${enquiry.name} ${enquiry.assignedUser ? 'reassigned' : 'assigned'} to ${assignee?.name}.`, { type: 'success' }); refresh() })
  }

  const doQualify = (qualification, outcome) => {
    setSaving(true)
    saveEnquiryQualification(enquiry, qualification, { outcome })
      .then(() => { setSaving(false); setQualifyOpen(false); toast(`Qualification saved${outcome ? ` — moved to ${outcome}` : ''}.`, { type: 'success' }); refresh() })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doDisposition = (reason) => {
    setSaving(true)
    closeEnquiry(dispositionTarget.row, { targetStatus: dispositionTarget.status, reason })
      .then(() => { setSaving(false); setDispositionTarget(null); toast(`${enquiry.name} marked as ${dispositionTarget.status}.`, { type: 'success' }); refresh() })
      .catch((err) => { setSaving(false); toast(err.message, { type: 'error' }) })
  }

  const doStartReview = () => {
    startEnquiryReview(enquiry, { by: user.id }).then(() => { toast('Moved to Under Review.', { type: 'success' }); refresh() })
  }

  const saveEdit = (data) => {
    setSaving(true)
    const tags = typeof data.tags === 'string' ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : (data.tags || [])
    api.put(`/enquiries/${enquiry.id}`, { ...data, tags, quantity: Number(data.quantity) || 0 }).then(() => {
      setSaving(false); setEditOpen(false); toast('Enquiry updated.', { type: 'success' }); refresh()
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Breadcrumbs items={[{ label: 'Enquiry Management', href: '/enquiries' }, { label: enquiry.id }]} />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{enquiry.name}</h1>
            <StatusBadge status={enquiry.status} />
            <PriorityBadge priority={enquiry.priority} />
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{enquiry.id} · {enquiry.designation ? `${enquiry.designation} · ` : ''}{enquiry.company || 'No company'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/enquiries')}>Back</Button>
          {canEdit && !isTerminal && <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
          {canEdit && !isTerminal && <Button variant="secondary" icon={UserCog} onClick={() => setAssignOpen(true)}>{enquiry.assignedUser ? 'Reassign' : 'Assign'}</Button>}
          {canEdit && !isTerminal && <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Add Follow-up</Button>}
          {canEdit && <LogActivityButton type="Enquiry" id={enquiry.id} label={enquiry.name || enquiry.id} onLogged={loadActivities} />}
          <RecordTasksButton type="Enquiry" id={enquiry.id} label={enquiry.name || enquiry.id} />
          {canEdit && !isTerminal && <Button variant="secondary" icon={Video} onClick={() => setMeetingOpen(true)}>Schedule Meeting</Button>}
          {canEdit && canTransition(enquiry.status, 'Under Review') && (
            <Button variant="secondary" icon={Search} onClick={doStartReview}>Start Review</Button>
          )}
          {canEdit && (canTransition(enquiry.status, 'Qualified') || canTransition(enquiry.status, 'Unqualified')) && (
            <Button variant="secondary" icon={ClipboardCheck} onClick={() => setQualifyOpen(true)}>Qualify Enquiry</Button>
          )}
          {canEdit && canTransition(enquiry.status, 'Converted') && (
            <Button icon={Handshake} onClick={() => setConvertOpen(true)} disabled={!readyToConvert}>Convert to Lead</Button>
          )}
          {canEdit && !isTerminal && (
            <Dropdown align="right" trigger={<Button variant="secondary" icon={MoreVertical}>More Actions</Button>}>
              <DropdownLabel>Disposition</DropdownLabel>
              {canTransition(enquiry.status, 'Duplicate') && <DropdownItem icon={Copy} onClick={() => setDispositionTarget({ row: enquiry, status: 'Duplicate' })}>Mark as Duplicate</DropdownItem>}
              {canTransition(enquiry.status, 'Spam') && <DropdownItem icon={AlertOctagon} onClick={() => setDispositionTarget({ row: enquiry, status: 'Spam' })}>Mark as Spam</DropdownItem>}
              {canTransition(enquiry.status, 'Not Interested') && <DropdownItem icon={XCircle} onClick={() => setDispositionTarget({ row: enquiry, status: 'Not Interested' })}>Mark Not Interested</DropdownItem>}
              {canTransition(enquiry.status, 'Closed') && <DropdownItem icon={Ban} danger onClick={() => setDispositionTarget({ row: enquiry, status: 'Closed' })}>Close Enquiry</DropdownItem>}
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
        <div><p className="text-xs text-ink-400">Source</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{enquiry.source || '—'}</p></div>
        <div><p className="text-xs text-ink-400">Assigned Salesperson</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{owner?.name || 'Unassigned'}</p></div>
        <div><p className="text-xs text-ink-400">Enquiry Date</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{formatDate(enquiry.date)}</p></div>
        <div><p className="text-xs text-ink-400">Last Activity</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lastActivity ? formatDate(lastActivity.date) : 'None yet'}</p></div>
        <div className="col-span-2 sm:col-span-1"><p className="text-xs text-ink-400">Next Follow-up</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{enquiry.nextFollowUp ? formatDate(enquiry.nextFollowUp) : '—'}</p></div>
        <div className="col-span-2 sm:col-span-1"><p className="text-xs text-ink-400">Last Contacted</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{enquiry.lastContactedDate ? formatDateTime(enquiry.lastContactedDate) : 'Not yet contacted'}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Contact Information</p>
            <div className="flex items-center gap-3 border-b border-ink-100 pb-4 dark:border-ink-800">
              <Avatar name={enquiry.name} size="lg" />
              <div>
                <p className="text-base font-bold text-ink-900 dark:text-ink-50">{enquiry.name}</p>
                <p className="text-sm text-ink-500 dark:text-ink-400">{enquiry.designation ? `${enquiry.designation} · ` : ''}{enquiry.company || 'No company'}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <InfoRow icon={Phone} label="Phone" value={enquiry.phone} href={enquiry.phone ? `tel:${enquiry.phone.replace(/[^\d+]/g, '')}` : null} />
              <InfoRow icon={MessageCircle} label="WhatsApp" value={enquiry.whatsapp || enquiry.phone} href={(enquiry.whatsapp || enquiry.phone) ? `https://wa.me/${(enquiry.whatsapp || enquiry.phone).replace(/\D/g, '')}` : null} />
              <InfoRow icon={Mail} label="Email" value={enquiry.email} href={enquiry.email ? `mailto:${enquiry.email}` : null} />
              <InfoRow icon={Phone} label="Alternate Phone" value={enquiry.alternatePhone} />
              <InfoRow icon={Building2} label="Company" value={enquiry.company} />
              <InfoRow icon={UserCog} label="Designation" value={enquiry.designation} />
            </div>
            {enquiry.companyId && (
              <Button variant="secondary" size="sm" icon={Building2} className="mt-4" onClick={() => navigate(`/companies/${enquiry.companyId}`)}>View Company</Button>
            )}
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Enquiry Information</p>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Radio} label="Source" value={enquiry.source} />
              <InfoRow icon={Tag} label="Campaign" value={enquiry.campaign} />
              <InfoRow icon={Gauge} label="Enquiry Type" value={enquiry.enquiryType} />
              <InfoRow icon={Clock} label="Enquiry Date" value={formatDate(enquiry.date)} />
              <InfoRow icon={UserCog} label="Assigned Team" value={enquiry.assignedTeam} />
              <InfoRow icon={UserCog} label="Assigned User" value={owner?.name} />
            </div>
          </div>

          <AttributionCard record={enquiry} assignedId={enquiry.assignedUser} received={enquiry.date} />

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Location</p>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={MapPin} label="Country" value={enquiry.country} />
              <InfoRow icon={MapPin} label="State" value={enquiry.state} />
              <InfoRow icon={MapPin} label="City" value={enquiry.city} />
              <InfoRow icon={MapPin} label="Area" value={enquiry.area} />
              <InfoRow icon={MapPin} label="Address" value={enquiry.address} />
              <InfoRow icon={MapPin} label="Pincode" value={enquiry.pincode} />
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Requirement Information</p>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={Gauge} label="Interested Product" value={enquiry.interestedProduct} />
              <InfoRow icon={Gauge} label="Interested Service" value={enquiry.interestedService} />
              <InfoRow icon={Gauge} label="Category" value={enquiry.category} />
              <InfoRow icon={Gauge} label="Requirement Type" value={enquiry.requirementType} />
              <InfoRow icon={Gauge} label="Quantity" value={enquiry.quantity} />
              <InfoRow icon={Gauge} label="Budget Range" value={enquiry.budgetRange} />
              <InfoRow icon={Clock} label="Expected Purchase Date" value={enquiry.expectedPurchaseDate ? formatDate(enquiry.expectedPurchaseDate) : null} />
              <InfoRow icon={Phone} label="Preferred Contact Method" value={enquiry.preferredContactMethod} />
            </div>
            <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-400">Requirement Description</p>
            <p className="text-sm text-ink-600 dark:text-ink-300">{enquiry.requirementDescription || '—'}</p>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Additional Information</p>
            {enquiry.tags?.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {enquiry.tags.map((t) => <span key={t} className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t}</span>)}
              </div>
            )}
            <p className="text-sm text-ink-600 dark:text-ink-300">{enquiry.notes || 'No additional notes.'}</p>
          </div>

          {!isTerminal && (
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
          {enquiry.qualification && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Qualification</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-ink-400">Business Need</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.businessNeed}</p></div>
                <div><span className="text-ink-400">Budget</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.budget}</p></div>
                <div><span className="text-ink-400">Timeline</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.timeline}</p></div>
                <div><span className="text-ink-400">Purchase Intent</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.purchaseIntent}</p></div>
                <div><span className="text-ink-400">Product Interest</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.productInterest}</p></div>
                {enquiry.qualification.decisionMaker && <div><span className="text-ink-400">Decision Maker</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.decisionMaker}</p></div>}
                {enquiry.qualification.competitor && <div className="col-span-2"><span className="text-ink-400">Competitor</span><p className="font-medium text-ink-700 dark:text-ink-200">{enquiry.qualification.competitor}</p></div>}
              </div>
            </div>
          )}

          {enquiry.status === 'Unqualified' && enquiry.closeReason && (
            <div className="rounded-2xl border border-ink-200 bg-ink-50 p-5 dark:border-ink-700 dark:bg-ink-800/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Unqualified Reason</p>
              <p className="mt-1 text-sm font-semibold text-ink-800 dark:text-ink-100">{enquiry.closeReason}</p>
              <p className="mt-2 text-xs text-ink-400">{formatDateTime(enquiry.closedAt)}{enquiry.closedBy ? ` · ${getUserById(enquiry.closedBy)?.name || ''}` : ''}</p>
            </div>
          )}

          {['Duplicate', 'Spam', 'Not Interested', 'Closed'].includes(enquiry.status) && enquiry.closeReason && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-800/50 dark:bg-rose-900/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">{enquiry.status} Reason</p>
              <p className="mt-1 text-sm font-semibold text-rose-800 dark:text-rose-200">{enquiry.closeReason}</p>
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{formatDateTime(enquiry.closedAt)}{enquiry.closedBy ? ` · ${getUserById(enquiry.closedBy)?.name || ''}` : ''}</p>
              {enquiry.status === 'Duplicate' && enquiry.duplicateOfId && (
                <Button variant="secondary" size="sm" icon={Copy} className="mt-2" onClick={() => navigate(`/enquiries/${enquiry.duplicateOfId}`)}>View Original Enquiry</Button>
              )}
            </div>
          )}

          {enquiry.existingCustomerId && (
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-800/50 dark:bg-brand-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Linked to Existing Customer</p>
              <Button variant="secondary" size="sm" icon={UserSquare2} onClick={() => navigate(`/customers/${enquiry.existingCustomerId}`)}>View Customer</Button>
            </div>
          )}

          {enquiry.status === 'Converted' && enquiry.convertedLeadId && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800/50 dark:bg-emerald-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Converted — Linked Lead</p>
              <Button variant="secondary" size="sm" icon={Inbox} onClick={() => navigate(`/leads/${enquiry.convertedLeadId}`)}>View Lead {enquiry.convertedLeadId}</Button>
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Converted {formatDate(enquiry.convertedAt)} by {getUserById(enquiry.convertedBy)?.name || '—'}</p>
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

      <section id="documents" className="mt-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Documents</h2>
        <DocumentsPanel relatedType="Enquiry" relatedId={enquiry.id} defaultCategory="Customer Documents" />
      </section>
      <EnquiryFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        enquiry={enquiry}
        saving={saving}
        onSubmit={saveEdit}
      />
      <AssignEnquiryModal open={assignOpen} onClose={() => setAssignOpen(false)} enquiry={enquiry} saving={saving} onSave={doAssign} />
      <QualifyEnquiryModal open={qualifyOpen} onClose={() => setQualifyOpen(false)} enquiry={enquiry} saving={saving} onSave={doQualify} />
      <ConvertEnquiryToLeadModal open={convertOpen} onClose={() => setConvertOpen(false)} enquiry={enquiry} onConverted={refresh} />
      <DispositionEnquiryModal
        open={!!dispositionTarget}
        onClose={() => setDispositionTarget(null)}
        enquiry={dispositionTarget?.row}
        targetStatus={dispositionTarget?.status}
        saving={saving}
        onSave={doDisposition}
      />
      <CallActionModal open={callOpen} onClose={() => setCallOpen(false)} enquiry={enquiry} onLogged={refresh} />
      <EmailActionModal open={emailOpen} onClose={() => setEmailOpen(false)} enquiry={enquiry} onLogged={refresh} />
      <WhatsAppActionModal open={waOpen} onClose={() => setWaOpen(false)} enquiry={enquiry} onLogged={refresh} />
      <MeetingSchedulerModal open={meetingOpen} onClose={() => setMeetingOpen(false)} enquiry={enquiry} onLogged={refresh} />
      <MeetingOutcomeModal open={!!outcomeTarget} onClose={() => setOutcomeTarget(null)} meeting={outcomeTarget} relatedType="Enquiry" relatedId={enquiry.id} onUpdated={refresh} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} enquiry={enquiry} onLogged={refresh} />
      <FollowUpModal open={followUpOpen} onClose={() => setFollowUpOpen(false)} enquiry={enquiry} onLogged={refresh} />
    </div>
  )
}
