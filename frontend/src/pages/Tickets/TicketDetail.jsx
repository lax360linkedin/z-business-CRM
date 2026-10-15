import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Send, LifeBuoy, Phone, Mail, MessageCircle, CheckSquare, Lock } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Select, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { api } from '../../api/mockServer'
import { TICKET_STATUSES, PRIORITIES } from '../../data/constants'
import { getUserById } from '../../data/users'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate, formatDateTime } from '../../utils/format'
import { RecordTasksButton } from '../Tasks/RecordTasksButton'
import { DocumentsPanel } from '../Documents/DocumentsPanel'

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [reply, setReply] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [activeTab, setActiveTab] = useState('conversation') // conversation, notes, timeline

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    api.get(`/tickets/${id}`)
      .then((res) => setTicket(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [id])

  const handleStatusChange = (e) => {
    const status = e.target.value
    setStatusSaving(true)
    // the server records the change on the ticket's timeline, with who and when
    api.put(`/tickets/${id}`, { status })
      .then((res) => {
        setTicket(res.data)
        toast(`Ticket status updated to "${status}".`, { type: 'success' })
      })
      .catch(() => {})
      .finally(() => setStatusSaving(false))
  }

  const handlePriorityChange = (e) => {
    const priority = e.target.value
    setStatusSaving(true)
    api.put(`/tickets/${id}`, { priority })
      .then((res) => {
        setTicket(res.data)
        toast(`Ticket priority updated to "${priority}".`, { type: 'success' })
      })
      .catch(() => {})
      .finally(() => setStatusSaving(false))
  }

  const handleSendReply = () => {
    if (!reply.trim() || !ticket) return
    setSendingReply(true)
    api.post(`/tickets/${id}/messages`, { kind: 'reply', text: reply.trim() })
      .then((res) => {
        setTicket(res.data)
        setReply('')
        // no e-mail / WhatsApp service is connected: the reply is recorded on the ticket, and the screen says so
        toast('Reply recorded on the ticket. It has not been e-mailed — no outgoing mail service is connected.', { type: 'info' })
      })
      .catch(() => {})
      .finally(() => setSendingReply(false))
  }

  const handleSaveNote = () => {
    if (!internalNote.trim() || !ticket) return
    setSavingNote(true)
    api.post(`/tickets/${id}/messages`, { kind: 'note', text: internalNote.trim() })
      .then((res) => {
        setTicket(res.data)
        setInternalNote('')
        toast('Internal note saved.', { type: 'success' })
      })
      .catch(() => {})
      .finally(() => setSavingNote(false))
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  if (notFound || !ticket) {
    return (
      <EmptyState
        icon={LifeBuoy}
        title="Ticket not found"
        description="This ticket may have been removed or the link is incorrect."
        action={<Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/tickets')}>Back to Tickets</Button>}
      />
    )
  }

  const openExternal = (url) => window.open(url, '_blank', 'noopener')
  const assignedUser = getUserById(ticket.assignedStaff)
  const messages = ticket.messages || []
  const internalNotesList = ticket.internalNotes || []
  const timeline = ticket.timeline || []

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Tickets', href: '/tickets' }, { label: ticket.subject }]} />

      <div className="mb-5 flex flex-col md:flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
             <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{ticket.id}</h1>
             <Badge tone={ticket.slaStatus === 'Breached' ? 'danger' : ticket.slaStatus === 'Warning' ? 'warning' : 'success'}>
               SLA: {ticket.slaStatus}
             </Badge>
          </div>
          <h2 className="text-lg text-ink-700 dark:text-ink-200">{ticket.subject}</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Source: {ticket.source} · Created: {formatDate(ticket.createdDate)} · Last Updated: {formatDate(ticket.updatedDate)}
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2">
           <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/tickets')} className="shrink-0">Back</Button>
           {ticket.status !== 'Closed' && <Button variant="secondary" icon={CheckSquare} onClick={() => handleStatusChange({ target: { value: 'Closed' } })}>Close Ticket</Button>}
           {ticket.status === 'Closed' && <Button variant="secondary" onClick={() => handleStatusChange({ target: { value: 'Reopened' } })}>Reopen Ticket</Button>}
        </div>
      </div>

      {/* Quick actions: these open the person's own phone / mail / WhatsApp app with the contact's details - nothing is sent from the CRM. */}
      <div className="mb-5 flex flex-wrap gap-2 p-3 bg-white dark:bg-ink-900 rounded-xl border border-ink-100 dark:border-ink-800 shadow-sm">
         <Button variant="ghost" size="sm" icon={Phone} disabled={!ticket.contactPhone} onClick={() => openExternal(`tel:${ticket.contactPhone}`)}>Call</Button>
         <Button variant="ghost" size="sm" icon={Mail} disabled={!ticket.contactEmail} onClick={() => openExternal(`mailto:${ticket.contactEmail}?subject=${encodeURIComponent(`Re: ${ticket.subject} (${ticket.id})`)}`)}>Email</Button>
         <Button variant="ghost" size="sm" icon={MessageCircle} disabled={!ticket.contactPhone} onClick={() => openExternal(`https://wa.me/${String(ticket.contactPhone).replace(/\D/g, '')}`)}>WhatsApp</Button>
         <RecordTasksButton type="Ticket" id={ticket.id} label={ticket.subject} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
         <div className="lg:col-span-2 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
             <h3 className="text-sm font-semibold mb-3">Ticket Details</h3>
             <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                <div>
                  <p className="text-xs text-ink-400">Status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={ticket.status} />
                    <Select value={ticket.status} onChange={handleStatusChange} disabled={statusSaving} className="text-sm py-1 h-8 w-32">
                      {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-ink-400">Priority</p>
                  <div className="mt-1 flex items-center gap-2">
                    <PriorityBadge priority={ticket.priority} />
                    <Select value={ticket.priority} onChange={handlePriorityChange} disabled={statusSaving} className="text-sm py-1 h-8 w-32">
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-ink-400">Category</p>
                  <p className="mt-1 text-sm text-ink-800 dark:text-ink-100">{ticket.category} / {ticket.subCategory}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-400">Due Date</p>
                  <p className="mt-1 text-sm text-ink-800 dark:text-ink-100">{formatDate(ticket.dueDate)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-ink-400">Description</p>
                  <p className="mt-1 text-sm text-ink-700 dark:text-ink-200 whitespace-pre-wrap">{ticket.description || 'No description provided.'}</p>
                </div>
                {ticket.tags && ticket.tags.length > 0 && (
                   <div className="col-span-2 flex gap-2">
                      {ticket.tags.map(t => <Badge key={t} tone="neutral">{t}</Badge>)}
                   </div>
                )}
             </div>
         </div>

         <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
             <h3 className="text-sm font-semibold mb-3">Customer & Assignment</h3>
             <div className="space-y-4">
                <div>
                   <p className="text-xs text-ink-400">Customer</p>
                   {ticket.customerId ? (
                      <Link to={`/customers/${ticket.customerId}`} className="mt-1 text-sm font-medium text-brand-600 hover:underline">{ticket.customerName}</Link>
                   ) : <span className="text-sm">N/A</span>}
                </div>
                <div>
                   <p className="text-xs text-ink-400">Company</p>
                   {ticket.companyId ? (
                      <Link to={`/companies/${ticket.companyId}`} className="mt-1 text-sm font-medium text-brand-600 hover:underline">{ticket.companyName}</Link>
                   ) : <span className="text-sm">N/A</span>}
                </div>
                <div>
                   <p className="text-xs text-ink-400">Contact Person</p>
                   {ticket.contactId ? (
                      <Link to={`/contacts/${ticket.contactId}`} className="mt-1 text-sm font-medium text-brand-600 hover:underline">{ticket.contactName}</Link>
                   ) : <span className="text-sm">{ticket.contactName || 'N/A'}</span>}
                   {ticket.contactPhone && <p className="text-xs text-ink-500 mt-0.5">{ticket.contactPhone}</p>}
                   {ticket.contactEmail && <p className="text-xs text-ink-500 mt-0.5">{ticket.contactEmail}</p>}
                </div>
                <div>
                   <p className="text-xs text-ink-400">Assigned To</p>
                   {assignedUser ? (
                     <div className="mt-1 flex items-center gap-1.5">
                       <Avatar name={assignedUser.name} size="xs" />
                       <span className="text-sm font-medium text-ink-800 dark:text-ink-100">{assignedUser.name}</span>
                     </div>
                   ) : <p className="mt-1 text-sm text-ink-400">Unassigned</p>}
                </div>
             </div>
         </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-4 border-b border-ink-200 dark:border-ink-700">
         <button onClick={() => setActiveTab('conversation')} className={`pb-2 text-sm font-medium border-b-2 ${activeTab === 'conversation' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500'}`}>Customer Communication</button>
         <button onClick={() => setActiveTab('notes')} className={`pb-2 text-sm font-medium border-b-2 ${activeTab === 'notes' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500'}`}>Internal Notes</button>
         <button onClick={() => setActiveTab('timeline')} className={`pb-2 text-sm font-medium border-b-2 ${activeTab === 'timeline' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500'}`}>Timeline</button>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        
        {activeTab === 'conversation' && (
           <>
              <div className="scrollbar-thin max-h-[480px] space-y-4 overflow-y-auto px-5 py-5 bg-ink-50 dark:bg-ink-900 rounded-t-2xl">
                {messages.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No communication history. Reply to customer below.</p>}
                {messages.map((m, i) => {
                  const isStaff = m.from === 'staff'
                  return (
                    <div key={i} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isStaff ? 'bg-brand-600 text-white' : 'bg-white border border-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:border-ink-700'}`}>
                        <div className={`mb-1 flex items-center gap-2 text-xs ${isStaff ? 'text-brand-100' : 'text-ink-400 dark:text-ink-500'}`}>
                          <span className="font-semibold">{m.by}</span>
                          <span>{formatDateTime(m.date)}</span>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="border-t border-ink-100 p-4 dark:border-ink-800 bg-white rounded-b-2xl">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply to record on the ticket (it is not e-mailed — no mail service is connected)..."
                  className="min-h-[84px]"
                />
                <div className="mt-2.5 flex items-center justify-between">
                  <p className="text-xs text-ink-500">This message will be sent to the customer.</p>
                  <Button icon={Send} onClick={handleSendReply} loading={sendingReply} disabled={!reply.trim()}>Send Reply</Button>
                </div>
              </div>
           </>
        )}

        {activeTab === 'notes' && (
           <>
              <div className="scrollbar-thin max-h-[480px] space-y-4 overflow-y-auto px-5 py-5 bg-amber-50 dark:bg-amber-900/10 rounded-t-2xl">
                {internalNotesList.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No internal notes yet. Add one below.</p>}
                {internalNotesList.map((m, i) => (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl px-4 py-3 text-sm shadow-sm bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100 border border-yellow-200 dark:border-yellow-800/50">
                      <div className="mb-1 flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-400">
                        <Lock size={12} />
                        <span className="font-semibold">{m.by}</span>
                        <span>{formatDateTime(m.date)}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-ink-100 p-4 dark:border-ink-800 bg-white rounded-b-2xl">
                <Textarea
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Add a private note (customers cannot see this)..."
                  className="min-h-[84px] bg-yellow-50/50 dark:bg-yellow-900/10"
                />
                <div className="mt-2.5 flex items-center justify-between">
                  <p className="text-xs text-ink-500 flex items-center gap-1"><Lock size={12} /> Internal view only. Clients have no access.</p>
                  <Button icon={CheckSquare} onClick={handleSaveNote} loading={savingNote} disabled={!internalNote.trim()} variant="secondary">Save Note</Button>
                </div>
              </div>
           </>
        )}

        {activeTab === 'timeline' && (
           <div className="p-5">
              <div className="space-y-6">
                 {timeline.length === 0 && <p className="text-sm text-ink-500">No timeline events recorded.</p>}
                 {timeline.sort((a,b) => new Date(b.date) - new Date(a.date)).map((ev, i) => (
                    <div key={i} className="flex gap-4 relative">
                       {i !== timeline.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-24px] w-0.5 bg-ink-100 dark:bg-ink-800"></div>}
                       <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center shrink-0 z-10 border-2 border-white dark:border-ink-900">
                          <div className="w-2 h-2 rounded-full bg-brand-500"></div>
                       </div>
                       <div className="pt-0.5 pb-2">
                          <p className="text-sm font-medium text-ink-900 dark:text-ink-50">{ev.action}</p>
                          {ev.details && <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">{ev.details}</p>}
                          <p className="text-xs text-ink-400 mt-1">{getUserById(ev.by)?.name || ev.by} · {formatDateTime(ev.date)}</p>
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        )}

      </div>

      <div className="mt-5">
        <DocumentsPanel relatedType="Ticket" relatedId={ticket.id} />
      </div>
    </div>
  )
}
