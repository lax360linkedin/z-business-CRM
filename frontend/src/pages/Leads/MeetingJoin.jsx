import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Video, Users, CalendarClock, Info, Handshake } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { api } from '../../api/mockServer'
import { formatDate } from '../../utils/format'
import { MeetingOutcomeModal } from '../../components/common/MeetingOutcomeModal'

const SOURCE = {
  Lead: { listLabel: 'Leads', listHref: '/leads', detailHref: (id) => `/leads/${id}`, viewLabel: 'View Lead' },
  Enquiry: { listLabel: 'Enquiries', listHref: '/enquiries', detailHref: (id) => `/enquiries/${id}`, viewLabel: 'View Enquiry' },
  Contact: { listLabel: 'Contacts', listHref: '/contacts', detailHref: (id) => `/contacts/${id}`, viewLabel: 'View Contact' },
  Deal: { listLabel: 'Deals', listHref: '/deals', detailHref: (id) => `/deals/${id}`, viewLabel: 'View Deal' },
  Proposal: { listLabel: 'Proposals', listHref: '/proposals', detailHref: (id) => `/proposals/${id}`, viewLabel: 'View Proposal' },
  Contract: { listLabel: 'Contracts', listHref: '/contracts', detailHref: (id) => `/contracts/${id}`, viewLabel: 'View Contract' },
  Project: { listLabel: 'Projects', listHref: '/projects', detailHref: (id) => `/projects/${id}`, viewLabel: 'View Project' },
}

/**
 * The route a generated Meeting Link actually opens (spec §14). This build has no real
 * third-party video provider connected, so "Join" opens an internal CRM meeting room — clearly
 * labeled as such rather than pretending Zoom/Google Meet is behind it.
 */
export default function MeetingJoin() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joined, setJoined] = useState(false)
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  // Silent background refetch — `onUpdated={load}` from MeetingOutcomeModal must not flash the
  // whole page back to the loading skeleton (see LeadDetail.jsx for the same fix/reasoning).
  const load = () => api.get(`/activities/${id}`).then((res) => setMeeting(res.data.type === 'Meeting' ? res.data : null)).catch(() => setMeeting(null))

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
    setJoined(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!meeting) return <EmptyState title="Meeting not found" description="This meeting link is invalid or has been removed." action={<Button onClick={() => navigate('/leads')}>Back to Leads</Button>} />

  const source = SOURCE[meeting.relatedType] || SOURCE.Lead

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumbs items={[{ label: source.listLabel, href: source.listHref }, { label: meeting.relatedName, href: source.detailHref(meeting.relatedId) }, { label: 'Meeting' }]} />
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{meeting.title}</h1>
        </div>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(source.detailHref(meeting.relatedId))}>Back to {meeting.relatedType || 'Lead'}</Button>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-8 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <StatusBadge status={meeting.meetingStatus} />
          <span className="text-xs text-ink-400">Meeting ID: {meeting.id}</span>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div><p className="text-xs text-ink-400">Client/{meeting.relatedType || 'Lead'}</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{meeting.relatedName}</p></div>
          <div><p className="text-xs text-ink-400">Date &amp; Time</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{formatDate(meeting.meetingDate)} · {meeting.meetingStartTime}{meeting.meetingEndTime ? ` – ${meeting.meetingEndTime}` : ''}</p></div>
          <div><p className="text-xs text-ink-400">Meeting Type</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{meeting.meetingType}</p></div>
        </div>

        {meeting.participants && (
          <div className="mb-6 flex items-start gap-2 text-sm text-ink-600 dark:text-ink-300">
            <Users size={15} className="mt-0.5 shrink-0" /> {meeting.participants}
          </div>
        )}

        {meeting.meetingStatus === 'Scheduled' && !joined && (
          <Button icon={Video} onClick={() => setJoined(true)}>Join Meeting</Button>
        )}

        {joined && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 text-center dark:border-brand-800/50 dark:bg-brand-900/20">
            <Video size={28} className="mx-auto mb-2 text-brand-600 dark:text-brand-400" />
            <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">You're in the CRM meeting room for "{meeting.title}"</p>
            <p className="mx-auto mt-2 flex max-w-md items-start gap-1.5 text-left text-xs text-brand-700 dark:text-brand-300">
              <Info size={13} className="mt-0.5 shrink-0" />
              This is an internal CRM meeting room — no third-party video provider (Zoom, Google Meet, etc.) is connected in this build.
            </p>
          </div>
        )}

        {meeting.meetingStatus !== 'Scheduled' && (
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-800/50">
            <p className="text-sm font-medium text-ink-700 dark:text-ink-200">Meeting {meeting.meetingStatus.toLowerCase()}{meeting.outcome ? ` — ${meeting.outcome}` : ''}</p>
            {meeting.meetingNotes && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{meeting.meetingNotes}</p>}
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 border-t border-ink-100 pt-6 dark:border-ink-800">
          <CalendarClock size={15} className="text-ink-400" />
          <Button variant="secondary" size="sm" onClick={() => setOutcomeOpen(true)}>Update Meeting Outcome</Button>
          <Button variant="ghost" size="sm" icon={Handshake} onClick={() => navigate(source.detailHref(meeting.relatedId))}>{source.viewLabel}</Button>
        </div>
      </div>

      <MeetingOutcomeModal open={outcomeOpen} onClose={() => setOutcomeOpen(false)} meeting={meeting} relatedType={meeting.relatedType || 'Lead'} relatedId={meeting.relatedId} onUpdated={load} />
    </div>
  )
}
