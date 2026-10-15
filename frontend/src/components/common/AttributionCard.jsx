import { Link } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { USERS } from '../../data/users'
import { formatDate } from '../../utils/format'

const who = (id) => USERS.find((u) => u.id === id)?.name || null
const created = (r) => {
  const by = who(r.createdBy)
  if (r.createdVia === 'Integration') return 'Integration (system)'
  if (r.createdVia === 'Conversion') return by ? `${by}, by converting the enquiry` : 'Created by converting the enquiry'
  if (r.createdVia === 'Import') return by ? `${by}, from a file import` : 'File import'
  return by ? `${by}${r.createdVia ? ', entered manually' : ''}` : null
}

/** Where a record came from, shown the same way on an enquiry and on the lead made from it. Everything is read-only: the original attribution is never rewritten by a later step. */
export function AttributionCard({ record, assignedId, received }) {
  const rows = [
    ['Lead source', record.leadSourceId ? <Link key="s" to={`/lead-sources/${record.leadSourceId}`} className="text-brand-700 hover:underline dark:text-brand-300">{record.source}</Link> : record.source],
    ['Source category', record.sourceCategory], ['Campaign', record.campaignId ? <Link key="c" to={`/campaigns/${record.campaignId}`} className="text-brand-700 hover:underline dark:text-brand-300">{record.campaign}</Link> : record.campaign],
    ['Ad name', record.adName], ['Ad ID', record.adId], ['Landing page / form', record.landingPage],
    ['UTM source', record.utmSource], ['UTM medium', record.utmMedium], ['UTM campaign', record.utmCampaign], ['UTM content', record.utmContent],
    ['Branch', record.branch], ['Created by', created(record)], ['Referring employee', who(record.referringEmployeeId)], ['Assigned to', who(assignedId)], ['Enquiry received', received ? formatDate(received) : null],
  ]
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900" aria-label="Source and attribution">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400"><Radio size={12} /> Source &amp; attribution</p>
      <dl className="grid grid-cols-2 gap-3 text-xs">{rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-ink-400">{label}</dt><dd className="break-words font-medium text-ink-700 dark:text-ink-200">{value || '—'}</dd></div>)}</dl>
    </div>
  )
}
