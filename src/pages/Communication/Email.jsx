import { useMemo, useState } from 'react'
import { Send, Mail } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CUSTOMERS } from '../../data/customers'
import { timeAgo, formatDateTime } from '../../utils/format'

const SUBJECTS = [
  'Follow-up on your recent inquiry', 'Proposal for Q3 engagement', 'Invoice attached for this cycle',
  'Meeting confirmation for next week', 'Update on your support request', 'Renewal reminder for your subscription',
  'Onboarding checklist for your account', 'Quick question about your requirements', 'Thanks for your business!',
  'Scope revision for the current project', 'Your quotation is ready for review', 'Checking in — any updates?',
  'Welcome aboard — next steps inside',
]

const FROM_ME = [
  'Hi, just wanted to check in on this — let us know if you have any questions.',
  'Sharing the updated proposal as discussed. Happy to hop on a call if that helps.',
  'Please find the invoice attached for this billing cycle. Let us know if you need anything else.',
  'Confirming our meeting for Thursday at 3 PM. Looking forward to it.',
  'Wanted to follow up on the pending items from our last conversation.',
  'Thanks again for choosing us — excited to get started on this.',
  'Attaching the revised scope document for your review.',
]

const FROM_CUSTOMER = [
  'Thanks for the quick response, will review and confirm by Friday.',
  'This looks good on our end. Can we schedule a call to finalize details?',
  'Received the invoice, processing payment this week.',
  'Sounds good, see you then.',
  'We are still reviewing internally, will get back to you soon.',
  'Appreciate the update. A couple of questions before we proceed.',
  'Looks great, approved from our side.',
]

function buildThreads() {
  return CUSTOMERS.slice(0, 13).map((c, i) => {
    const msgCount = 3 + (i % 4)
    const messages = Array.from({ length: msgCount }).map((_, m) => {
      const fromMe = m % 2 === 1
      const text = fromMe ? FROM_ME[(i + m) % FROM_ME.length] : FROM_CUSTOMER[(i + m) % FROM_CUSTOMER.length]
      const hoursAgo = (msgCount - m) * (5 + (i % 6))
      return {
        id: `${c.id}-MSG-${m}`,
        from: fromMe ? 'me' : 'them',
        text,
        date: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
      }
    })
    return {
      id: c.id,
      name: c.name,
      contactPerson: c.contactPerson,
      email: c.email,
      subject: SUBJECTS[i % SUBJECTS.length],
      messages,
    }
  })
}

export default function CommunicationEmail() {
  const [threads, setThreads] = useState(buildThreads)
  const [selectedId, setSelectedId] = useState(() => threads[0]?.id ?? null)
  const [draft, setDraft] = useState('')

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) || null, [threads, selectedId])

  const send = () => {
    const text = draft.trim()
    if (!text || !selected) return
    const newMsg = { id: `${selected.id}-MSG-${Date.now()}`, from: 'me', text, date: new Date().toISOString() }
    setThreads((prev) => prev.map((t) => (t.id === selected.id ? { ...t, messages: [...t.messages, newMsg] } : t)))
    setDraft('')
  }

  return (
    <div>
      <PageHeader title="Email" description="Unified email conversations with your customers. Mock data — not connected to a live inbox." />

      <div className="flex h-[calc(100vh-13rem)] min-h-[480px] overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="scrollbar-thin w-full max-w-xs shrink-0 overflow-y-auto border-r border-ink-100 dark:border-ink-800">
          {threads.map((t) => {
            const last = t.messages[t.messages.length - 1]
            const isActive = t.id === selectedId
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full items-start gap-3 border-b border-ink-50 px-4 py-3.5 text-left transition-colors last:border-0 dark:border-ink-800/60 ${
                  isActive ? 'bg-brand-50/70 dark:bg-brand-900/20' : 'hover:bg-ink-50 dark:hover:bg-ink-800/40'
                }`}
              >
                <Avatar name={t.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{t.name}</p>
                    <span className="shrink-0 text-[11px] text-ink-400">{timeAgo(last.date)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs font-medium text-ink-600 dark:text-ink-300">{t.subject}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-400">{last.from === 'me' ? 'You: ' : ''}{last.text}</p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="border-b border-ink-100 px-6 py-4 dark:border-ink-800">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{selected.subject}</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  {selected.contactPerson} · {selected.name} · <span className="text-ink-400">{selected.email}</span>
                </p>
              </div>

              <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-6 py-5">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[80%] rounded-xl border p-3.5 ${
                      m.from === 'me'
                        ? 'ml-auto border-brand-100 bg-brand-50/60 dark:border-brand-900/40 dark:bg-brand-900/20'
                        : 'border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">{m.from === 'me' ? 'You' : selected.contactPerson}</span>
                      <span className="text-[11px] text-ink-400">{formatDateTime(m.date)}</span>
                    </div>
                    <p className="text-sm text-ink-700 dark:text-ink-200">{m.text}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-ink-100 p-4 dark:border-ink-800">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                    }}
                    placeholder={`Reply to ${selected.contactPerson}…`}
                    rows={2}
                    className="min-h-[44px] flex-1 resize-none rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
                  />
                  <Button icon={Send} onClick={send} disabled={!draft.trim()}>Send</Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={Mail} title="No conversation selected" description="Choose a conversation from the list to view it." />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
