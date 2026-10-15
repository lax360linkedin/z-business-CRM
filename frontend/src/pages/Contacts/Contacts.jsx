import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Mail, Phone, Building2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { Avatar } from '../../components/common/Avatar'
import { Badge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { Pagination } from '../../components/common/Pagination'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { COMPANIES } from '../../data/companies'
import { useCollections } from '../../api/store'

const DESIGNATIONS = ['CEO', 'CTO', 'CFO', 'VP Sales', 'Procurement Head', 'Operations Manager', 'HR Manager', 'Marketing Head', 'IT Manager', 'Founder']
const GROUPS = ['Decision Maker', 'Influencer', 'Technical Contact', 'Billing Contact', 'Primary Contact']

export default function Contacts() {
  useCollections('companies')
  const crud = useCrud('contacts', { searchFields: ['name', 'companyName', 'email', 'phone'], pageSize: 12 })
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    if (searchParams.get('create') === '1') { setCreateOpen(true); searchParams.delete('create'); setSearchParams(searchParams, { replace: true }) }
    // Every deep link that used to open the drawer now opens the full Contact Detail page
    // instead, matching the Lead/Enquiry pattern — kept as `?open=` so existing call sites work.
    const openId = searchParams.get('open')
    if (openId) { navigate(`/contacts/${openId}`, { replace: true }) }
  }, [searchParams, setSearchParams, navigate])

  const filterDefs = [
    { key: 'companyId', label: 'Companies', options: COMPANIES.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'designation', label: 'Designations', options: DESIGNATIONS.map((d) => ({ value: d, label: d })) },
  ]

  const createContact = (data) => {
    setSaving(true)
    const company = COMPANIES.find((c) => c.id === data.companyId)
    crud.create({
      name: data.name,
      designation: data.designation,
      email: data.email,
      phone: data.phone,
      whatsapp: data.whatsapp,
      companyId: data.companyId,
      companyName: company?.name || '',
      groups: data.groups ? data.groups.split(',').map((g) => g.trim()).filter(Boolean) : ['Primary Contact'],
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Contact added successfully.', { type: 'success' })
    }).catch(() => setSaving(false))
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Contact "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Your business contact directory across every company."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Contact</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search contacts by name, company, email…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      {crud.loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : crud.items.length === 0 ? (
        <EmptyState title="No contacts found" description="Try adjusting your search or filters, or add a new contact to get started." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {crud.items.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/contacts/${c.id}`)}
              className="group cursor-pointer rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} size="lg" />
                  <div>
                    <p className="font-semibold text-ink-800 dark:text-ink-100">{c.name}</p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">{c.designation}</p>
                  </div>
                </div>
                <IconButton
                  icon={Trash2}
                  size="sm"
                  className="opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-900/20"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(c) }}
                />
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
                <Building2 size={13} /> {c.companyName}
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-ink-500 dark:text-ink-400">
                <div className="flex items-center gap-1.5"><Mail size={12} /> {c.email}</div>
                <div className="flex items-center gap-1.5"><Phone size={12} /> {c.phone}</div>
              </div>
              {c.groups?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.groups.map((g) => <Badge key={g} tone="info">{g}</Badge>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!crud.loading && crud.items.length > 0 && (
        <div className="mt-2 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900">
          <Pagination page={crud.page} totalPages={crud.totalPages} onChange={crud.setPage} total={crud.total} pageSize={12} />
        </div>
      )}

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Contact"
        description="Add a contact and link them to a company."
        submitLabel="Add Contact"
        loading={saving}
        onSubmit={createContact}
        defaultValues={{ companyId: COMPANIES[0]?.id, designation: DESIGNATIONS[0] }}
        fields={[
          { name: 'name', label: 'Full name', required: true, span: 1 },
          { name: 'companyId', label: 'Company', type: 'select', options: COMPANIES.map((c) => ({ value: c.id, label: c.name })), required: true, span: 1 },
          { name: 'designation', label: 'Designation', type: 'select', options: DESIGNATIONS.map((d) => ({ value: d, label: d })), required: true, span: 1 },
          { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
          { name: 'phone', label: 'Phone', required: true, span: 1 },
          { name: 'whatsapp', label: 'WhatsApp', span: 1 },
          { name: 'groups', label: 'Groups (comma-separated)', placeholder: GROUPS.join(', '), span: 2 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this contact?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Contact"
      />
    </div>
  )
}
