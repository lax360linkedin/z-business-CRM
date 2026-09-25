import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ArrowRight, Loader2 } from 'lucide-react'
import { Modal } from '../common/Modal'
import { api } from '../../api/mockServer'

const ROUTE_BY_TYPE = {
  Lead: '/leads', Contact: '/contacts', Company: '/companies', Customer: '/customers',
  Deal: '/deals', Project: '/projects', Invoice: '/invoices', Ticket: '/tickets',
}

export function GlobalSearchModal({ open, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) { setQ(''); setResults([]) }
  }, [open])

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      api.get('/search', { params: { q } }).then((res) => setResults(res.data)).finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const go = (item) => {
    navigate(`${ROUTE_BY_TYPE[item.type] || '/dashboard'}?open=${item.id}`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="-mx-6 -mt-5 flex items-center gap-3 border-b border-ink-100 px-6 pb-4 dark:border-ink-800">
        <Search size={18} className="text-ink-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leads, deals, customers, invoices…"
          className="flex-1 bg-transparent text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none dark:text-ink-100"
        />
        {loading && <Loader2 size={15} className="animate-spin text-ink-400" />}
        <kbd className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-400 dark:border-ink-700 dark:bg-ink-800">Esc</kbd>
      </div>
      <div className="max-h-96 overflow-y-auto pt-2">
        {!q && <p className="py-10 text-center text-sm text-ink-400">Start typing to search across your CRM…</p>}
        {q && !loading && results.length === 0 && <p className="py-10 text-center text-sm text-ink-400">No results for "{q}"</p>}
        {results.map((r) => (
          <button
            key={`${r.type}-${r.id}`}
            onClick={() => go(r)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-50 dark:hover:bg-ink-800"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{r.title}</p>
              <p className="truncate text-xs text-ink-400">{r.subtitle}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-400">
              <span className="rounded-full bg-ink-100 px-2 py-0.5 dark:bg-ink-800">{r.type}</span>
              <ArrowRight size={13} />
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
