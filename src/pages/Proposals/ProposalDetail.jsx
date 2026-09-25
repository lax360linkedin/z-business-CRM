import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Pencil, ArrowLeft, Printer, IndianRupee, User, Calendar, Clock } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button, IconButton } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { EmptyState } from '../../components/common/EmptyState'
import { Avatar } from '../../components/common/Avatar'
import { Logo } from '../../components/common/Logo'
import { api } from '../../api/mockServer'
import { useToast } from '../../context/ToastContext'
import { getCustomerById } from '../../data/customers'
import { getUserById } from '../../data/users'
import { formatCurrency, formatDate } from '../../utils/format'

const NEXT_STATUS = {
  Draft: ['Sent'],
  Sent: ['Viewed'],
  Viewed: ['Accepted', 'Rejected', 'Expired'],
  Accepted: [],
  Rejected: [],
  Expired: [],
}

export default function ProposalDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [editIdx, setEditIdx] = useState(null)
  const [editHeading, setEditHeading] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const load = () => {
    setLoading(true)
    api.get(`/proposals/${id}`).then((res) => setProposal(res.data)).catch(() => setProposal(null)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const transition = (status) => {
    setUpdating(true)
    api.put(`/proposals/${id}`, { status }).then((res) => {
      setProposal(res.data)
      setUpdating(false)
      toast(`Proposal marked as ${status}.`, { type: 'success' })
    })
  }

  const openEdit = (idx) => {
    setEditIdx(idx)
    setEditHeading(proposal.sections[idx].heading)
    setEditBody(proposal.sections[idx].body)
  }

  const saveSection = () => {
    setSaving(true)
    const sections = proposal.sections.map((s, i) => (i === editIdx ? { heading: editHeading, body: editBody } : s))
    api.put(`/proposals/${id}`, { sections }).then((res) => {
      setProposal(res.data)
      setSaving(false)
      setEditIdx(null)
      toast('Section updated.', { type: 'success' })
    })
  }

  if (loading) {
    return <div><CardSkeleton className="h-40" /></div>
  }

  if (!proposal) {
    return <EmptyState title="Proposal not found" description="This proposal may have been deleted." action={<Button onClick={() => navigate('/proposals')}>Back to Proposals</Button>} />
  }

  const customer = getCustomerById(proposal.customerId)
  const owner = getUserById(proposal.assignedTo)
  const nextOptions = NEXT_STATUS[proposal.status] || []

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <Breadcrumbs items={[{ label: 'Proposals', href: '/proposals' }, { label: proposal.id }]} />
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{proposal.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/proposals')}>Back</Button>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-500 dark:text-ink-400">Status</span>
          <StatusBadge status={proposal.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {nextOptions.map((status) => (
            <Button key={status} variant={status === 'Rejected' || status === 'Expired' ? 'danger' : status === 'Accepted' ? 'primary' : 'secondary'} size="sm" loading={updating} onClick={() => transition(status)}>
              Mark as {status}
            </Button>
          ))}
          {!nextOptions.length && <span className="text-xs text-ink-400">No further transitions available.</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="rounded-2xl border border-ink-100 bg-white p-8 shadow-card dark:border-ink-800 dark:bg-ink-900 print:border-0 print:shadow-none">
          <div className="mb-8 border-b border-ink-100 pb-6 dark:border-ink-800">
            <div className="flex items-center gap-3">
              <Logo imgClassName="h-11" />
              <div>
                <h2 className="text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">LAX360 Business CRM</h2>
                <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">Business Proposal · {proposal.id}</p>
              </div>
            </div>
            <h3 className="mt-4 text-lg font-bold text-ink-900 dark:text-ink-50">{proposal.title}</h3>
          </div>

          <div className="space-y-8">
            {proposal.sections.map((section, idx) => (
              <div key={idx} className="group">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{section.heading}</h4>
                  <IconButton icon={Pencil} size="sm" className="opacity-0 transition-opacity group-hover:opacity-100 print:hidden" onClick={() => openEdit(idx)} />
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-200">{section.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 print:hidden">
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Summary</p>
            <div className="mb-4 flex items-center gap-2 text-2xl font-bold text-ink-900 dark:text-ink-50">
              <IndianRupee size={18} className="text-emerald-600" />
              {formatCurrency(proposal.value).replace('₹', '')}
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5">
                <Avatar name={customer?.name || proposal.customerName} size="sm" />
                <div>
                  <p className="text-xs text-ink-400">Customer</p>
                  <p className="font-medium text-ink-800 dark:text-ink-100">{proposal.customerName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"><User size={15} /></span>
                <div>
                  <p className="text-xs text-ink-400">Prepared By</p>
                  <p className="font-medium text-ink-800 dark:text-ink-100">{owner?.name || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"><Calendar size={15} /></span>
                <div>
                  <p className="text-xs text-ink-400">Created</p>
                  <p className="font-medium text-ink-800 dark:text-ink-100">{formatDate(proposal.createdDate)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400"><Clock size={15} /></span>
                <div>
                  <p className="text-xs text-ink-400">Valid Until</p>
                  <p className="font-medium text-ink-800 dark:text-ink-100">{formatDate(proposal.validUntil)}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Service</p>
            <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{proposal.service}</p>
          </div>
        </div>
      </div>

      <Modal
        open={editIdx !== null}
        onClose={() => setEditIdx(null)}
        title="Edit Section"
        footer={<>
          <Button variant="ghost" onClick={() => setEditIdx(null)}>Cancel</Button>
          <Button onClick={saveSection} loading={saving}>Save Section</Button>
        </>}
      >
        <div className="space-y-4">
          <FormField label="Heading" required>
            <Input value={editHeading} onChange={(e) => setEditHeading(e.target.value)} />
          </FormField>
          <FormField label="Body" required>
            <Textarea className="min-h-[160px]" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
          </FormField>
        </div>
      </Modal>
    </div>
  )
}
