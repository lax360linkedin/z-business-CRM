import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, LifeBuoy } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { StatusBadge, PriorityBadge, Badge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Select, Textarea } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Skeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { api } from '../../api/mockServer'
import { TICKET_STATUSES } from '../../data/constants'
import { getUserById } from '../../data/users'
import { getCustomerById } from '../../data/customers'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate, formatDateTime } from '../../utils/format'

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
  const [sending, setSending] = useState(false)

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
    api.put(`/tickets/${id}`, { status })
      .then((res) => {
        setTicket(res.data)
        toast(`Ticket status updated to "${status}".`, { type: 'success' })
      })
      .finally(() => setStatusSaving(false))
  }

  const handleSend = () => {
    if (!reply.trim() || !ticket) return
    setSending(true)
    const newMsg = { by: user?.name || 'Support Staff', from: 'staff', text: reply.trim(), date: new Date().toISOString() }
    const messages = [...(ticket.messages || []), newMsg]
    api.put(`/tickets/${id}`, { messages })
      .then((res) => {
        setTicket(res.data)
        setReply('')
      })
      .finally(() => setSending(false))
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

  const assignedUser = getUserById(ticket.assignedStaff)
  const customer = getCustomerById(ticket.customerId)
  const messages = ticket.messages || []

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Tickets', href: '/tickets' }, { label: ticket.subject }]} />

      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            {ticket.id} · Raised by {ticket.customerName} on {formatDate(ticket.createdDate)}
          </p>
        </div>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/tickets')} className="shrink-0">Back</Button>
      </div>

      <div className="mb-5 rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-ink-400">Category</p>
              <Badge tone="info" className="mt-1">{ticket.category}</Badge>
            </div>
            <div>
              <p className="text-xs text-ink-400">Priority</p>
              <PriorityBadge priority={ticket.priority} className="mt-1" />
            </div>
            <div>
              <p className="text-xs text-ink-400">Customer</p>
              <p className="mt-1 text-sm font-medium text-ink-800 dark:text-ink-100">{customer?.name || ticket.customerName}</p>
            </div>
            <div>
              <p className="text-xs text-ink-400">Assigned to</p>
              {assignedUser ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <Avatar name={assignedUser.name} size="xs" />
                  <span className="text-sm font-medium text-ink-800 dark:text-ink-100">{assignedUser.name}</span>
                </div>
              ) : <p className="mt-1 text-sm text-ink-400">Unassigned</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={ticket.status} />
            <div className="w-44">
              <Select value={ticket.status} onChange={handleStatusChange} disabled={statusSaving}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="border-b border-ink-100 px-5 py-4 dark:border-ink-800">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Conversation</h3>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{messages.length} message{messages.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="scrollbar-thin max-h-[480px] space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 && <p className="py-8 text-center text-sm text-ink-400">No messages yet. Start the conversation below.</p>}
          {messages.map((m, i) => {
            const isStaff = m.from === 'staff'
            return (
              <div key={i} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${isStaff ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200'}`}>
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

        <div className="border-t border-ink-100 p-4 dark:border-ink-800">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply to the customer…"
            className="min-h-[84px]"
          />
          <div className="mt-2.5 flex justify-end">
            <Button icon={Send} onClick={handleSend} loading={sending} disabled={!reply.trim()}>Send Reply</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
