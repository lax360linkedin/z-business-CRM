import clsx from 'clsx'
import { Link } from 'react-router-dom'
import {
  Phone, Mail, MessageCircle, Users, Monitor, Clock, StickyNote, CheckSquare, FileText, IndianRupee,
  UserPlus, ArrowRightLeft, UserCog, ClipboardCheck, Handshake, Share2, Paperclip, Receipt, Pencil, History,
  MessageSquare, MapPin, FileSignature, CheckCircle2, TrendingUp, Sparkles, CalendarClock,
} from 'lucide-react'
import { timeAgo, formatDate } from '../../utils/format'
import { Avatar } from './Avatar'
import { getUserById } from '../../data/users'
import { relatedHref, effectiveStatus } from '../../utils/activityRules'

const ICONS = {
  Call: Phone, Email: Mail, WhatsApp: MessageCircle, Meeting: Users, Demo: Monitor,
  'Follow-up': Clock, Note: StickyNote, Task: CheckSquare, Quotation: FileText,
  Payment: IndianRupee, Created: UserPlus, StatusChange: ArrowRightLeft,
  Assignment: UserCog, Qualification: ClipboardCheck, Conversion: Handshake,
  MeetingShared: Share2, Attachment: Paperclip, Invoice: Receipt, Updated: Pencil, Revision: History,
  SMS: MessageSquare, 'Demo / Presentation': Monitor, 'Site Visit': MapPin, 'Proposal Sent': FileSignature, 'Quotation Sent': FileText,
  'Quotation Accepted / Rejected': CheckCircle2, 'Deal Stage Changed': TrendingUp, 'Status Changed': ArrowRightLeft, 'Document Uploaded': Paperclip,
  'Payment Follow-up': IndianRupee, 'Customer Interaction': Users, 'Other / Custom Activity': Sparkles,
}
const TONES = {
  Call: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  Email: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  WhatsApp: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  Meeting: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  Demo: 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400',
  'Follow-up': 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
  Note: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  Task: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400',
  StatusChange: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  Assignment: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  Qualification: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  Conversion: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  MeetingShared: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400',
  Attachment: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
  Invoice: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  Payment: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  Updated: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  Revision: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  SMS: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  'Demo / Presentation': 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400',
  'Site Visit': 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  'Proposal Sent': 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  'Quotation Sent': 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  'Quotation Accepted / Rejected': 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  'Deal Stage Changed': 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  'Status Changed': 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
  'Document Uploaded': 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
  'Payment Follow-up': 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
  'Customer Interaction': 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400',
  'Other / Custom Activity': 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
}

/**
 * Structured extra fields per activity type (Call outcome/duration, Email to/subject/status,
 * WhatsApp to/status, Meeting date/link/status, Meeting-share channel/recipient) — additive
 * only. An activity from any other module that never sets these fields renders exactly as
 * before (subject/notes/who/when), so this never touches Deals/Customers/Enquiries timelines.
 */
function DetailLines({ item }) {
  const rows = []
  if (item.type === 'Call') {
    if (item.callType) rows.push(['Call Type', item.callType])
    if (item.callOutcome) rows.push(['Outcome', item.callOutcome])
    if (item.duration) rows.push(['Duration', item.duration])
    if (item.nextFollowUp) rows.push(['Next Follow-up', formatDate(item.nextFollowUp)])
  } else if (item.type === 'Email') {
    if (item.emailTo) rows.push(['To', item.emailTo])
    if (item.emailSubject) rows.push(['Subject', item.emailSubject])
    if (item.emailStatus) rows.push(['Status', item.emailStatus])
    if (item.attachmentName) rows.push(['Attachment', item.attachmentName])
  } else if (item.type === 'WhatsApp') {
    if (item.waTo) rows.push(['To', item.waTo])
    if (item.waStatus) rows.push(['Status', item.waStatus])
  } else if (item.type === 'Meeting') {
    if (item.meetingDate) rows.push(['Date/Time', `${formatDate(item.meetingDate)}${item.meetingStartTime ? `, ${item.meetingStartTime}` : ''}`])
    if (item.meetingType) rows.push(['Type', item.meetingType])
    if (item.meetingStatus) rows.push(['Status', item.meetingStatus])
  } else if (['Demo / Presentation', 'Site Visit'].includes(item.type)) {
    if (item.meetingDate) rows.push(['Date/Time', `${formatDate(item.meetingDate)}${item.meetingStartTime ? `, ${item.meetingStartTime}` : ''}`])
    if (item.location) rows.push(['Location', item.location])
    if (item.meetingStatus) rows.push(['Status', item.meetingStatus])
  } else if (item.type === 'Customer Interaction') {
    if (item.channel) rows.push(['Channel', item.channel])
  } else if (item.type === 'Payment Follow-up') {
    if (item.dueDate) rows.push(['Follow up by', formatDate(item.dueDate)])
  } else if (item.type === 'Task') {
    if (item.dueDate) rows.push(['Due', formatDate(item.dueDate)])
    if (item.assignedTo) rows.push(['Assigned to', getUserById(item.assignedTo)?.name || item.assignedTo])
  } else if (item.type === 'Quotation Accepted / Rejected') {
    if (item.outcome) rows.push(['Outcome', item.outcome])
  } else if (['Deal Stage Changed', 'Status Changed'].includes(item.type)) {
    if (item.toStatus) rows.push(['Now', item.toStatus])
  } else if (item.type === 'Document Uploaded') {
    if (item.attachmentName) rows.push(['Document', item.attachmentName])
  } else if (item.type === 'Other / Custom Activity') {
    if (item.customType) rows.push(['Kind', item.customType])
  } else if (item.type === 'MeetingShared') {
    if (item.channel) rows.push(['Channel', item.channel])
    if (item.recipient) rows.push(['Recipient', item.recipient])
  } else if (item.type === 'Payment') {
    if (item.paymentAmount) rows.push(['Amount', `₹${Math.abs(item.paymentAmount).toLocaleString('en-IN')}`])
  } else if (item.type === 'Attachment') {
    if (item.attachmentName) rows.push(['File', item.attachmentName])
    if (item.attachmentAction) rows.push(['Action', item.attachmentAction])
    if (item.attachmentVersion) rows.push(['Version', `v${item.attachmentVersion}`])
  } else if (item.type === 'StatusChange') {
    if (item.fromStatus && item.toStatus) rows.push(['Change', `${item.fromStatus} → ${item.toStatus}`])
  }
  if (!rows.length) return null
  return (
    <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-500 dark:text-ink-400 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-1"><dt className="shrink-0 text-ink-400">{label}:</dt><dd className="truncate font-medium text-ink-600 dark:text-ink-300">{value}</dd></div>
      ))}
    </dl>
  )
}

const STATUS_CHIP = { Scheduled: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300', Overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', Cancelled: 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400' }

export function ActivityTimeline({ items, showRelated = false }) {
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-ink-400">No activity recorded yet.</p>
  }
  return (
    <ol className="relative space-y-0">
      {items.map((item, idx) => {
        const Icon = ICONS[item.type] || StickyNote
        const user = item.by ? getUserById(item.by) : null
        return (
          <li key={item.id} className="relative flex gap-3 pb-6 last:pb-0">
            {idx !== items.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-ink-100 dark:bg-ink-800" />}
            <span className={clsx('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONES[item.type] || TONES.Note)}>
              <Icon size={15} />
            </span>
            <div className="flex-1 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
                  {item.subject}
                  {STATUS_CHIP[effectiveStatus(item)] && <span className={clsx('ml-2 rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold', STATUS_CHIP[effectiveStatus(item)])}>{effectiveStatus(item)}</span>}
                </p>
                <span className="text-xs text-ink-400">{timeAgo(item.date)}</span>
              </div>
              {item.notes && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{item.notes}</p>}
              {showRelated && relatedHref(item.relatedType, item.relatedId) && (
                <Link to={relatedHref(item.relatedType, item.relatedId)} className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"><span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] uppercase text-ink-500 dark:bg-ink-800">{item.relatedType}</span><span className="truncate">{item.relatedName}</span></Link>
              )}
              <DetailLines item={item} />
              {item.type === 'Meeting' && item.meetingLink && (
                <Link to={item.meetingLink} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Join Meeting</Link>
              )}
              {user && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Avatar name={user.name} size="xs" />
                  <span className="text-xs text-ink-500 dark:text-ink-400">{user.name}</span>
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
