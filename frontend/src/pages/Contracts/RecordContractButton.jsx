import { useNavigate } from 'react-router-dom'
import { FileSignature, FilePlus2 } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { useContractsLite, useContractAccess } from '../../hooks/useContracts'
import { useProjectsLite } from '../../hooks/useProjects'

const SO_READY = ['Confirmed', 'Processing', 'Partially Fulfilled', 'Fulfilled']
const KEY = { deal: 'dealId', quotation: 'quotationId', order: 'salesOrderId', project: 'projectId' }

/**
 * On a Closed Won deal, an Accepted quotation, a Confirmed sales order or a project: opens the contract that was started from it, or — for
 * someone allowed to create contracts — starts one with the customer, company, contact and the whole deal → order → project chain filled in.
 */
export function RecordContractButton({ kind, record, size = 'md', variant = 'secondary' }) {
  const navigate = useNavigate()
  const { contracts } = useContractsLite()
  const { projects } = useProjectsLite()
  const { can, canView } = useContractAccess(projects)
  const key = KEY[kind]
  const existing = contracts.filter((c) => c[key] === record.id && !['Cancelled', 'Renewed'].includes(c.status) && canView(c)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  if (existing) return <Button size={size} variant={variant} icon={FileSignature} onClick={() => navigate(`/contracts/${existing.id}`)}>Contract {existing.number}</Button>
  const eligible = kind === 'deal' ? record.stage === 'Closed Won' : kind === 'quotation' ? record.status === 'Accepted' : kind === 'order' ? SO_READY.includes(record.status) : record.status !== 'Cancelled'
  if (!eligible || !can(null).create) return null
  return <Button size={size} variant={variant} icon={FilePlus2} onClick={() => navigate(`/contracts?create=1&${key}=${record.id}`)}>Create contract</Button>
}
