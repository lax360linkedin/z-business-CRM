import { useNavigate } from 'react-router-dom'
import { FolderKanban, FolderPlus } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { useProjectsLite, useProjectAccess } from '../../hooks/useProjects'

const SO_READY = ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled']

/**
 * On a Sales Order or a Closed Won deal: opens the project that was started from it, or — for someone allowed to create projects —
 * starts one with the customer, deal, quotation, order and products already filled in.
 */
export function RecordProjectButton({ kind, record, size = 'md', variant = 'secondary' }) {
  const navigate = useNavigate()
  const { projects } = useProjectsLite()
  const { can, canView } = useProjectAccess()
  const key = kind === 'order' ? 'salesOrderId' : 'dealId'
  const existing = projects.find((p) => p[key] === record.id && p.status !== 'Cancelled')
  if (existing) return canView(existing) ? <Button size={size} variant={variant} icon={FolderKanban} onClick={() => navigate(`/projects/${existing.id}`)}>Project {existing.id}</Button> : null
  const eligible = kind === 'order' ? SO_READY.includes(record.status) : record.stage === 'Closed Won'
  if (!eligible || !can(null).create) return null
  return <Button size={size} variant={variant} icon={FolderPlus} onClick={() => navigate(`/projects?create=1&${key}=${record.id}`)}>Create project</Button>
}
