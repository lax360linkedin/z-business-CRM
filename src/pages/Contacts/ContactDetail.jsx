import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MessageCircle, StickyNote, CalendarClock, Building2, Briefcase,
  Pencil, Video, Handshake, FolderKanban, UserSquare2, Inbox,
} from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { ActivityTimeline } from '../../components/common/ActivityTimeline'
import { FormModal } from '../../components/common/FormModal'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getCompanyById, COMPANIES } from '../../data/companies'
import { dealsByCompany } from '../../data/deals'
import { getCustomerByCompanyId } from '../../data/customers'
import { projectsByCustomer } from '../../data/projects'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { CallActionModal } from './CallActionModal'
import { EmailActionModal } from './EmailActionModal'
import { WhatsAppActionModal } from './WhatsAppActionModal'
import { MeetingSchedulerModal } from './MeetingSchedulerModal'
import { MeetingOutcomeModal } from '../../components/common/MeetingOutcomeModal'
import { AddNoteModal } from './AddNoteModal'
import { FollowUpModal } from './FollowUpModal'

const DESIGNATIONS = ['CEO', 'CTO', 'CFO', 'VP Sales', 'Procurement Head', 'Operations Manager', 'HR Manager', 'Marketing Head', 'IT Manager', 'Founder']
const GROUPS = ['Decision Maker', 'Influencer', 'Technical Contact', 'Billing Contact', 'Primary Contact']

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
 * Full-page Contact Detail, mirroring LeadDetail.jsx's overall structure: Contact Information
 * card, real Quick Actions (Call/Email/WhatsApp/Meeting/Note/Follow-up — same honest tel:/
 * wa.me/mailto: pattern as Lead/Enquiry, never simulated), Meetings, Activity Timeline, and a
 * right column surfacing every related CRM record (Company, Deals, Projects, Customer, and any
 * Leads this contact is linked to via Lead.contactId — e.g. from an Enquiry→Lead conversion).
 * A Contact has no lifecycle status, so there's no status badge / status history here.
 */
export default function ContactDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const { toast } = useToast()
  const canEdit = hasPermission('Contacts', 'edit')

  const [contact, setContact] = useState(null)
  const [activities, setActivities] = useState([])
  const [relatedLeads, setRelatedLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [waOpen, setWaOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [outcomeTarget, setOutcomeTarget] = useState(null)

  // Silent background refetches — see LeadDetail.jsx's identical comment for why `loading`
  // must never be re-triggered by a quick action's onLogged (it would unmount whichever modal
  // is still open, e.g. MeetingSchedulerModal's share screen).
  const load = () => api.get(`/contacts/${id}`).then((res) => setContact(res.data)).catch(() => setContact(null))
  const loadActivities = () => api.get('/activities', { params: { all: true } }).then((res) => {
    setActivities(res.data.filter((a) => a.relatedType === 'Contact' && a.relatedId === id).sort((a, b) => new Date(b.date) - new Date(a.date)))
  })
  const loadRelatedLeads = () => api.get('/leads', { params: { all: true } }).then((res) => {
    setRelatedLeads(res.data.filter((l) => l.contactId === id))
  })
  useEffect(() => {
    setLoading(true)
    Promise.all([load(), loadActivities(), loadRelatedLeads()]).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const refresh = () => { load(); loadActivities(); loadRelatedLeads() }

  if (loading) return <div><CardSkeleton className="h-40" /></div>
  if (!contact) return <EmptyState title="Contact not found" description="This contact may have been deleted." action={<Button onClick={() => navigate('/contacts')}>Back to Contacts</Button>} />

  const company = getCompanyById(contact.companyId)
  const deals = dealsByCompany(contact.companyId)
  const customer = getCustomerByCompanyId(contact.companyId)
  const projects = customer ? projectsByCustomer(customer.id) : []
  const meetings = activities.filter((a) => a.type === 'Meeting' && a.meetingStatus)
  const lastActivity = activities[0]

  const saveEdit = (data) => {
    setSaving(true)
    const groups = typeof data.groups === 'string' ? data.groups.split(',').map((g) => g.trim()).filter(Boolean) : (data.groups || [])
    const newCompany = COMPANIES.find((c) => c.id === data.companyId)
    api.put(`/contacts/${contact.id}`, { ...data, groups, companyName: newCompany?.name || contact.companyName }).then(() => {
      setSaving(false); setEditOpen(false); toast('Contact updated.', { type: 'success' }); refresh()
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Breadcrumbs items={[{ label: 'Contacts', href: '/contacts' }, { label: contact.id }]} />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{contact.name}</h1>
            {contact.groups?.length > 0 && contact.groups.map((g) => <Badge key={g} tone="info">{g}</Badge>)}
          </div>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{contact.id} · {contact.designation ? `${contact.designation} · ` : ''}{contact.companyName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/contacts')}>Back</Button>
          {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>}
          {canEdit && <Button variant="secondary" icon={CalendarClock} onClick={() => setFollowUpOpen(true)}>Add Follow-up</Button>}
          {canEdit && <Button variant="secondary" icon={Video} onClick={() => setMeetingOpen(true)}>Schedule Meeting</Button>}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 sm:grid-cols-4">
        <div><p className="text-xs text-ink-400">Company</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{contact.companyName || '—'}</p></div>
        <div><p className="text-xs text-ink-400">Created Date</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{formatDate(contact.createdDate)}</p></div>
        <div><p className="text-xs text-ink-400">Last Activity</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{lastActivity ? formatDate(lastActivity.date) : 'None yet'}</p></div>
        <div><p className="text-xs text-ink-400">Next Follow-up</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{contact.nextFollowUp ? formatDate(contact.nextFollowUp) : '—'}</p></div>
        <div className="col-span-2 sm:col-span-4"><p className="text-xs text-ink-400">Last Contacted</p><p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{contact.lastContactedDate ? formatDateTime(contact.lastContactedDate) : 'Not yet contacted'}</p></div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Contact Information</p>
            <div className="flex items-center gap-3 border-b border-ink-100 pb-4 dark:border-ink-800">
              <Avatar name={contact.name} size="lg" />
              <div>
                <p className="text-base font-bold text-ink-900 dark:text-ink-50">{contact.name}</p>
                <p className="text-sm text-ink-500 dark:text-ink-400">{contact.designation ? `${contact.designation} · ` : ''}{contact.companyName}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <InfoRow icon={Phone} label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone.replace(/[^\d+]/g, '')}` : null} />
              <InfoRow icon={MessageCircle} label="WhatsApp" value={contact.whatsapp || contact.phone} href={(contact.whatsapp || contact.phone) ? `https://wa.me/${(contact.whatsapp || contact.phone).replace(/\D/g, '')}` : null} />
              <InfoRow icon={Mail} label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} />
              <InfoRow icon={Briefcase} label="Designation" value={contact.designation} />
              <InfoRow icon={Building2} label="Company" value={contact.companyName} />
            </div>
          </div>

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

          {contact.notes && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">Notes</p>
              <p className="text-sm text-ink-600 dark:text-ink-300">{contact.notes}</p>
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
          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Building2 size={12} /> Company</p>
            {company ? (
              <Button variant="secondary" size="sm" icon={Building2} onClick={() => navigate(`/companies/${company.id}`)}>{company.name}</Button>
            ) : (
              <p className="text-sm text-ink-500 dark:text-ink-400">{contact.companyName || '—'}</p>
            )}
          </div>

          {customer && (
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-800/50 dark:bg-brand-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Linked Customer</p>
              <Button variant="secondary" size="sm" icon={UserSquare2} onClick={() => navigate(`/customers/${customer.id}`)}>{customer.name}</Button>
            </div>
          )}

          {relatedLeads.length > 0 && (
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Inbox size={12} /> Related Leads ({relatedLeads.length})</p>
              <div className="space-y-2">
                {relatedLeads.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => navigate(`/leads/${l.id}`)}
                    className="flex w-full items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/50"
                  >
                    <span className="font-medium text-ink-700 dark:text-ink-200">{l.id}{l.sourceEnquiryId ? ` · from ${l.sourceEnquiryId}` : ''}</span>
                    <StatusBadge status={l.status} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Handshake size={13} /> Related Deals ({deals.length})</p>
            {deals.length === 0 ? (
              <p className="text-sm text-ink-400">No deals linked to this company yet.</p>
            ) : (
              <div className="space-y-2">
                {deals.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm dark:border-ink-800">
                    <span className="font-medium text-ink-700 dark:text-ink-200">{d.name}</span>
                    <span className="text-xs text-ink-500 dark:text-ink-400">{formatCurrency(d.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><FolderKanban size={13} /> Related Projects ({projects.length})</p>
            {projects.length === 0 ? (
              <p className="text-sm text-ink-400">No projects linked to this company yet.</p>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm dark:border-ink-800">
                    <span className="font-medium text-ink-700 dark:text-ink-200">{p.name}</span>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Contact"
        description={`Update details for ${contact.name}.`}
        submitLabel="Save Changes"
        loading={saving}
        onSubmit={saveEdit}
        defaultValues={{ ...contact, groups: (contact.groups || []).join(', ') }}
        fields={[
          { name: 'name', label: 'Full name', required: true, span: 1 },
          { name: 'companyId', label: 'Company', type: 'select', options: COMPANIES.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'designation', label: 'Designation', type: 'select', options: DESIGNATIONS.map((d) => ({ value: d, label: d })), required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'whatsapp', label: 'WhatsApp', span: 1 },
          { name: 'groups', label: 'Groups (comma-separated)', placeholder: GROUPS.join(', '), span: 2 },
        ]}
      />
      <CallActionModal open={callOpen} onClose={() => setCallOpen(false)} contact={contact} onLogged={refresh} />
      <EmailActionModal open={emailOpen} onClose={() => setEmailOpen(false)} contact={contact} onLogged={refresh} />
      <WhatsAppActionModal open={waOpen} onClose={() => setWaOpen(false)} contact={contact} onLogged={refresh} />
      <MeetingSchedulerModal open={meetingOpen} onClose={() => setMeetingOpen(false)} contact={contact} onLogged={refresh} />
      <MeetingOutcomeModal open={!!outcomeTarget} onClose={() => setOutcomeTarget(null)} meeting={outcomeTarget} relatedType="Contact" relatedId={contact.id} onUpdated={refresh} />
      <AddNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} contact={contact} onLogged={refresh} />
      <FollowUpModal open={followUpOpen} onClose={() => setFollowUpOpen(false)} contact={contact} onLogged={refresh} />
    </div>
  )
}
