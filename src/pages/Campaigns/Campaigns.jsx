import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, Badge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from '../../data/constants'
import { formatCurrency, formatDate } from '../../utils/format'
import { genId } from '../../utils/csv'
import { CampaignDetailDrawer } from './CampaignDetailDrawer'

const CHANNEL_TONES = {
  'Google Ads': 'info', Instagram: 'danger', Facebook: 'info', LinkedIn: 'info',
  Email: 'warning', WhatsApp: 'success', Website: 'neutral', YouTube: 'danger', Other: 'neutral',
}

export default function Campaigns() {
  const crud = useCrud('campaigns', { searchFields: ['name'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeCampaign, setActiveCampaign] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { toast } = useToast()

  const filterDefs = [
    { key: 'channel', label: 'Channels', options: CAMPAIGN_CHANNELS.map((c) => ({ value: c, label: c })) },
    { key: 'status', label: 'Statuses', options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s })) },
  ]

  const columns = [
    {
      key: 'name', header: 'Campaign', sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium text-ink-800 dark:text-ink-100">{row.name}</p>
          <p className="text-xs text-ink-400">{row.id}</p>
        </div>
      ),
    },
    { key: 'channel', header: 'Channel', render: (row) => <Badge tone={CHANNEL_TONES[row.channel] || 'neutral'}>{row.channel}</Badge> },
    { key: 'budget', header: 'Budget', sortable: true, render: (row) => formatCurrency(row.budget, { compact: true }) },
    { key: 'leadsGenerated', header: 'Leads', sortable: true },
    { key: 'qualifiedLeads', header: 'Qualified', sortable: true },
    { key: 'customersWon', header: 'Customers Won', sortable: true },
    { key: 'revenue', header: 'Revenue', sortable: true, render: (row) => formatCurrency(row.revenue, { compact: true }) },
    {
      key: 'roi', header: 'ROI', sortable: true,
      render: (row) => (
        <span className={`font-semibold ${row.roi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {row.roi >= 0 ? '+' : ''}{row.roi}%
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'dates', header: 'Duration',
      render: (row) => <span className="whitespace-nowrap text-xs">{formatDate(row.startDate, { year: undefined })} – {formatDate(row.endDate, { year: undefined })}</span>,
    },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createCampaign = (data) => {
    setSaving(true)
    crud.create({
      id: genId('CMP'),
      name: data.name,
      channel: data.channel,
      budget: Number(data.budget) || 0,
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status,
      leadsGenerated: 0,
      qualifiedLeads: 0,
      customersWon: 0,
      revenue: 0,
      roi: 0,
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Campaign created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Campaign "${deleteTarget.name}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Plan, launch, and track the performance of your marketing campaigns."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>New Campaign</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search campaigns by name…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
      </div>
      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      <DataTable
        columns={columns}
        data={crud.items}
        loading={crud.loading}
        onRowClick={(row) => setActiveCampaign(row)}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No campaigns found"
        emptyDescription="Try adjusting your search or filters, or launch a new campaign to get started."
      />

      <CampaignDetailDrawer campaign={activeCampaign} open={!!activeCampaign} onClose={() => setActiveCampaign(null)} />

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Campaign"
        description="Set up a new marketing campaign. Performance metrics start at zero and update as the campaign runs."
        submitLabel="Create Campaign"
        loading={saving}
        onSubmit={createCampaign}
        defaultValues={{ channel: CAMPAIGN_CHANNELS[0], status: CAMPAIGN_STATUSES[0] }}
        fields={[
          { name: 'name', label: 'Campaign name', required: true, span: 2 },
          { name: 'channel', label: 'Channel', type: 'select', options: CAMPAIGN_CHANNELS.map((c) => ({ value: c, label: c })), required: true, span: 1 },
          { name: 'status', label: 'Status', type: 'select', options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s })), required: true, span: 1 },
          { name: 'budget', label: 'Budget (₹)', type: 'number', required: true, span: 1 },
          { name: 'startDate', label: 'Start date', type: 'date', required: true, span: 1 },
          { name: 'endDate', label: 'End date', type: 'date', required: true, span: 1 },
        ]}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this campaign?"
        description={`"${deleteTarget?.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Campaign"
      />
    </div>
  )
}
