import { useMemo, useState } from 'react'
import { Send, MessageCircle, Phone, Video, MoreVertical } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Avatar } from '../../components/common/Avatar'
import { EmptyState } from '../../components/common/EmptyState'
import { CONTACTS } from '../../data/contacts'
import { timeAgo, formatDateTime } from '../../utils/format'

const FROM_ME = [
  'Hi! Just checking in — did you get a chance to look at the quote?',
  'Sure, I can share the pricing sheet right away.',
  'Perfect, locking in that slot for Thursday 👍',
  'Sending the demo link now, let me know how it goes.',
  'No worries, take your time. We are here whenever you are ready.',
  'Great, I will get the contract sent over today.',
  'Happy to jump on a quick call if that is easier.',
]

const FROM_CONTACT = [
  'Yes got it, looks reasonable. Let me check with my team.',
  'Can you also include the AMC details?',
  'Works for us, thanks! 🙌',
  'Just tried it out, works well. A few tweaks needed though.',
  'Appreciate it, will confirm by tomorrow.',
  'Thanks, received the contract. Reviewing now.',
  'Sounds good, talk soon.',
]

function buildThreads() {
  return CONTACTS.slice(0, 12).map((c, i) => {
    const msgCount = 3 + (i % 4)
    const messages = Array.from({ length: msgCount }).map((_, m) => {
      const fromMe = m % 2 === 1
      const text = fromMe ? FROM_ME[(i + m) % FROM_ME.length] : FROM_CONTACT[(i + m) % FROM_CONTACT.length]
      const minutesAgo = (msgCount - m) * (35 + (i % 5) * 15)
      return {
        id: `${c.id}-WA-${m}`,
        from: fromMe ? 'me' : 'them',
        text,
        date: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
      }
    })
    return { id: c.id, name: c.name, companyName: c.companyName, whatsapp: c.whatsapp, messages }
  })
}

export default function CommunicationWhatsApp() {
  const [threads, setThreads] = useState(buildThreads)
  const [selectedId, setSelectedId] = useState(() => threads[0]?.id ?? null)
  const [draft, setDraft] = useState('')

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) || null, [threads, selectedId])

  const send = () => {
    const text = draft.trim()
    if (!text || !selected) return
    const newMsg = { id: `${selected.id}-WA-${Date.now()}`, from: 'me', text, date: new Date().toISOString() }
    setThreads((prev) => prev.map((t) => (t.id === selected.id ? { ...t, messages: [...t.messages, newMsg] } : t)))
    setDraft('')
  }

  return (
    <div>
      <PageHeader title="WhatsApp" description="Unified WhatsApp conversations with your contacts. Mock data — not connected to a live number." />

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
                  isActive ? 'bg-emerald-50/70 dark:bg-emerald-900/20' : 'hover:bg-ink-50 dark:hover:bg-ink-800/40'
                }`}
              >
                <Avatar name={t.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-800 dark:text-ink-100">{t.name}</p>
                    <span className="shrink-0 text-[11px] text-ink-400">{timeAgo(last.date)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-400">{t.companyName}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">{last.from === 'me' ? 'You: ' : ''}{last.text}</p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-emerald-700/20 bg-emerald-600 px-5 py-3.5 text-white dark:bg-emerald-800">
                <div className="flex items-center gap-3">
                  <Avatar name={selected.name} size="sm" className="!bg-white/20 !text-white" />
                  <div>
                    <p className="text-sm font-semibold">{selected.name}</p>
                    <p className="text-xs text-emerald-50/80">{selected.companyName} · {selected.whatsapp}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-emerald-50">
                  <Phone size={17} />
                  <Video size={17} />
                  <MoreVertical size={17} />
                </div>
              </div>

              <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto bg-emerald-50/40 px-5 py-5 dark:bg-ink-950/40">
                {selected.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        m.from === 'me'
                          ? 'rounded-br-sm bg-emerald-500 text-white'
                          : 'rounded-bl-sm bg-white text-ink-800 dark:bg-ink-800 dark:text-ink-100'
                      }`}
                    >
                      <p>{m.text}</p>
                      <p className={`mt-1 text-right text-[10px] ${m.from === 'me' ? 'text-emerald-50/80' : 'text-ink-400'}`}>{formatDateTime(m.date)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-ink-100 bg-white p-3.5 dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()}
                    placeholder="Type a message…"
                    className="h-10 flex-1 rounded-full border border-ink-200 bg-ink-50 px-4 text-sm text-ink-800 placeholder:text-ink-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={MessageCircle} title="No conversation selected" description="Choose a conversation from the list to view it." />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
