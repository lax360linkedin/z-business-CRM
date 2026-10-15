import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Info } from 'lucide-react'
import { api } from '../../api/http'
import { DETAIL_COLLECTION } from '../../data/branches'
import { useBranch } from '../../context/BranchContext'
import { BranchBadge } from './BranchSelector'

/**
 * Shown above record detail pages (/leads/LD-1001, /deals/DL-2001 ...): the branch the open record belongs to, so a related record
 * reached through a link never looks like it belongs to another branch than it does.
 */
export function RecordBranchBar() {
  const { pathname } = useLocation()
  const { scope, isAll, isGlobal } = useBranch()
  const [, segment, id] = pathname.split('/')
  const collection = id ? DETAIL_COLLECTION[segment] : null
  const [record, setRecord] = useState(null)
  useEffect(() => {
    setRecord(null)
    if (!collection || !id) return undefined
    let alive = true
    api.get(`/${collection}/${encodeURIComponent(decodeURIComponent(id))}`).then((res) => { if (alive) setRecord(res.data) }).catch(() => null)
    return () => { alive = false }
  }, [collection, id])
  if (!record || record.branch === undefined) return null
  const elsewhere = isGlobal && !isAll && record.branch && record.branch !== scope
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
      <span>Branch</span>
      <BranchBadge branch={record.branch} />
      {elsewhere && (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Info size={12} /> This record belongs to {record.branch}; you are currently viewing {scope}.
        </span>
      )}
    </div>
  )
}
