import { useOptions } from '../../hooks/useOptions'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Eye, Plus as PlusSmall, Settings2, Paperclip } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge } from '../../components/common/Badge'
import { Button, IconButton } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Textarea, Select, DateInput } from '../../components/common/FormField'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { QUOTATION_STATUSES, DEFAULT_QUOTATION_TERMS } from '../../data/constants'
import { salesUsers, getUserById } from '../../data/users'
import { useProducts } from '../../hooks/useProducts'
import { ProductSelect } from '../../components/common/ProductSelect'
import { lineFromProduct, catalogDrift, TAX_RATES, DEFAULT_TAX_RATE } from '../../utils/productRules'
import { formatCurrency, formatDate } from '../../utils/format'
import {
  computeTotals, resolveSourceFromDeal, resolveSourceFromLead, resolveSourceFromCompany,
  findCustomerForCompany, createQuotation,
} from './quotationActions'
import { QuotationFilePicker, StagedFileCard } from './QuotationAttachmentUI'
import { uploadQuotationAttachment, apiErrorMessage } from './quotationAttachments'

function emptyRow() {
  return { productId: '', name: '', qty: 1, unitPrice: 0, discount: 0, taxRate: DEFAULT_TAX_RATE }
}

const SOURCE_TABS = [
  { value: 'deal', label: 'From Deal' },
  { value: 'lead', label: 'From Lead' },
  { value: 'company', label: 'From Company / Customer' },
]

function QuotationBuilderModal({ open, onClose, onCreate, saving, initialSource }) {
  const [sourceType, setSourceType] = useState('deal')
  const [deals, setDeals] = useState([])
  const [leads, setLeads] = useState([])
  const [companies, setCompanies] = useState([])
  const [contacts, setContacts] = useState([])
  const [dealId, setDealId] = useState('')
  const [leadId, setLeadId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [contactId, setContactId] = useState('')
  const [resolved, setResolved] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')

  const [validUntil, setValidUntil] = useState(() => new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10))
  const [paymentTerms, setPaymentTerms] = useState('')
  const termOptions = useOptions('payment_terms', paymentTerms)
  // a new quotation starts on the configured terms (the second suggestion when there is one, as before)
  useEffect(() => { if (!paymentTerms && termOptions.values.length) setPaymentTerms(termOptions.values[1] ?? termOptions.values[0]) }, [paymentTerms, termOptions.values])
  const [terms, setTerms] = useState(DEFAULT_QUOTATION_TERMS)
  const [requirement, setRequirement] = useState('')
  const reps = salesUsers()
  const [assignedTo, setAssignedTo] = useState(reps[0]?.id || '')
  const [rows, setRows] = useState([emptyRow()])
  const { products, byId: productById } = useProducts()
  const [attachment, setAttachment] = useState(null) // optional existing PDF/Word quotation, already validated

  const resetAll = () => {
    setSourceType('deal'); setDealId(''); setLeadId(''); setCompanyId(''); setContactId('')
    setResolved(null); setResolveError('')
    setValidUntil(new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10))
    setPaymentTerms(''); setTerms(DEFAULT_QUOTATION_TERMS)
    setRequirement(''); setAssignedTo(reps[0]?.id || ''); setRows([emptyRow()]); setAttachment(null)
  }
  const resetAndClose = () => { resetAll(); onClose() }

  useEffect(() => {
    if (!open) return
    Promise.all([
      api.get('/deals', { params: { all: true } }),
      api.get('/leads', { params: { all: true } }),
      api.get('/companies', { params: { all: true } }),
    ]).then(([d, l, c]) => { setDeals(d.data); setLeads(l.data); setCompanies(c.data) })
  }, [open])

  // Pre-select a source when opened from a Deal/Company/Contact/Customer Detail page's "Create
  // Quotation" action (see Quotations.jsx's query-param handling below).
  useEffect(() => {
    if (!open || !initialSource) return
    if (initialSource.type === 'deal' && initialSource.dealId) { setSourceType('deal'); setDealId(initialSource.dealId) }
    if (initialSource.type === 'company' && initialSource.companyId) {
      setSourceType('company'); setCompanyId(initialSource.companyId)
      if (initialSource.contactId) setContactId(initialSource.contactId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSource])

  useEffect(() => {
    if (!companyId) { setContacts([]); return }
    api.get('/contacts', { params: { all: true } }).then((res) => setContacts(res.data.filter((c) => c.companyId === companyId)))
  }, [companyId])

  const prefillFrom = (payload) => {
    setRequirement(payload.requirement || '')
    if (payload.assignedTo) setAssignedTo(payload.assignedTo)
    if (payload.items?.length) {
      setRows(payload.items.map((it) => ({ ...it, productId: it.productId || '', discount: it.discount || 0, taxRate: it.taxRate ?? DEFAULT_TAX_RATE })))
    }
  }

  useEffect(() => {
    setResolveError('')
    if (sourceType === 'deal' && dealId) {
      const deal = deals.find((d) => d.id === dealId)
      if (!deal) return
      setResolving(true)
      resolveSourceFromDeal(deal).then((payload) => { setResolved(payload); prefillFrom(payload) }).catch((e) => { setResolved(null); setResolveError(e.message) }).finally(() => setResolving(false))
    } else if (sourceType === 'lead' && leadId) {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) return
      setResolving(true)
      resolveSourceFromLead(lead).then((payload) => { setResolved(payload); prefillFrom(payload) }).catch((e) => { setResolved(null); setResolveError(e.message) }).finally(() => setResolving(false))
    } else if (sourceType === 'company' && companyId) {
      const company = companies.find((c) => c.id === companyId)
      if (!company) return
      const contact = contacts.find((c) => c.id === contactId) || null
      setResolving(true)
      findCustomerForCompany(companyId)
        .then((customer) => resolveSourceFromCompany(company, contact, customer))
        .then((payload) => { setResolved(payload); prefillFrom(payload) })
        .catch((e) => { setResolved(null); setResolveError(e.message) })
        .finally(() => setResolving(false))
    } else {
      setResolved(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, dealId, leadId, companyId, contactId])

  const updateRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  // choosing a catalog item fills name, code, category, description, unit, price, discount and tax from the master record
  const onProductChange = (idx, product) => {
    setRows((rs) => rs.map((r, i) => (i !== idx ? r : product ? lineFromProduct(product, { qty: r.qty || 1 }) : { ...emptyRow(), qty: r.qty || 1 })))
  }
  const addRow = () => setRows((rs) => [...rs, emptyRow()])
  const removeRow = (idx) => setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : rs))

  const totals = computeTotals(rows)
  const canSubmit = !!resolved && rows.some((r) => r.name)

  const handleSubmit = () => {
    if (!canSubmit) return
    const validRows = rows.filter((r) => r.name)
    const items = validRows.map((r) => ({ ...r, productId: r.productId || null, name: r.name, qty: Number(r.qty) || 0, unitPrice: Number(r.unitPrice) || 0, discount: Number(r.discount) || 0, taxRate: Number(r.taxRate ?? DEFAULT_TAX_RATE) }))
    const finalTotals = computeTotals(items)
    onCreate({
      ...resolved,
      items,
      subtotal: finalTotals.subtotal,
      tax: finalTotals.tax,
      amount: finalTotals.total,
      validUntil,
      paymentTerms,
      terms,
      requirement,
      assignedTo,
    }, resetAll, attachment)
  }

  const companyHasContacts = contacts.length > 0

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Create Quotation"
      description="Pick where this quotation is coming from — client details are pulled straight from that record."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving} disabled={!canSubmit}>Create Quotation</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-1.5 rounded-xl bg-ink-100 p-1 dark:bg-ink-800">
          {SOURCE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setSourceType(t.value)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${sourceType === t.value ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-900 dark:text-brand-400' : 'text-ink-500 dark:text-ink-400'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {sourceType === 'deal' && (
          <FormField label="Deal" required hint="The quotation's client, company and requirement are pulled from this deal.">
            <Select value={dealId} onChange={(e) => setDealId(e.target.value)}>
              <option value="">Select a deal…</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.id} — {d.name}</option>)}
            </Select>
          </FormField>
        )}
        {sourceType === 'lead' && (
          <FormField label="Lead" required hint="Only leads already linked to a company can be quoted directly.">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Select a lead…</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name} ({l.company})</option>)}
            </Select>
          </FormField>
        )}
        {sourceType === 'company' && (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Company" required>
              <Select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setContactId('') }}>
                <option value="">Select a company…</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Contact Person" hint={companyId && !companyHasContacts ? 'No contacts on file — the company\'s primary contact will be used.' : undefined}>
              <Select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!companyId || !companyHasContacts}>
                <option value="">{companyHasContacts ? 'Select a contact…' : 'None on file'}</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.designation}</option>)}
              </Select>
            </FormField>
          </div>
        )}

        {resolveError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">{resolveError}</p>}

        {resolved && !resolving && (
          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4 text-sm dark:border-ink-800 dark:bg-ink-800/40">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Client Details (auto-filled)</p>
            <p className="font-semibold text-ink-800 dark:text-ink-100">{resolved.customerName}{resolved.customerId ? ' · Existing Customer' : ''}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">{[resolved.contactName, resolved.contactPhone, resolved.contactEmail].filter(Boolean).join(' · ')}</p>
            <p className="text-xs text-ink-500 dark:text-ink-400">{resolved.billingAddress}{resolved.gstin ? ` · GSTIN ${resolved.gstin}` : ''}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <FormField label="Valid Until" required>
            <DateInput value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </FormField>
          <FormField label="Quotation Owner" required>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Payment Terms" required>
            <Select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}>
              {!termOptions.values.length && <option value="">{termOptions.placeholder}</option>}
              {termOptions.values.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </FormField>
        </div>

        <FormField label="Requirement / Scope of Work">
          <Textarea value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="What is this quotation for?" />
        </FormField>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Line Items</p>
            <Button variant="secondary" size="sm" icon={PlusSmall} onClick={addRow}>Add Item</Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-ink-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-400">
                  <th className="px-3 py-2.5">Product / Service</th>
                  <th className="w-20 px-3 py-2.5">Qty</th>
                  <th className="w-28 px-3 py-2.5">Unit Price</th>
                  <th className="w-24 px-3 py-2.5">Disc %</th>
                  <th className="w-24 px-3 py-2.5">Tax %</th>
                  <th className="w-28 px-3 py-2.5 text-right">Line Total</th>
                  <th className="w-10 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const lineTotal = (Number(row.qty) || 0) * (Number(row.unitPrice) || 0) * (1 - (Number(row.discount) || 0) / 100)
                  return (
                    <tr key={idx} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                      <td className="px-3 py-2">
                        <ProductSelect products={products} value={row.productId} onSelect={(p) => onProductChange(idx, p)} className="mb-1 h-9 text-xs" />
                        {!row.productId && <Input value={row.name} onChange={(e) => updateRow(idx, { name: e.target.value })} placeholder="Item / service name" className="h-9 text-xs" />}
                        {row.productId && <p className="text-[11px] text-ink-400">{row.productCode}{row.unit ? ` · per ${row.unit}` : ''}{productById.get(row.productId)?.status === 'Inactive' ? ' · inactive in catalog' : ''}</p>}
                        {catalogDrift(row, productById.get(row.productId)) && <button type="button" className="text-[11px] font-medium text-amber-600 hover:underline" onClick={() => onProductChange(idx, productById.get(row.productId))}>Catalog price/tax changed — update line</button>}
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="1" className="h-9 text-xs" value={row.qty} onChange={(e) => updateRow(idx, { qty: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" className="h-9 text-xs" value={row.unitPrice} onChange={(e) => updateRow(idx, { unitPrice: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min="0" max="100" className="h-9 text-xs" value={row.discount} onChange={(e) => updateRow(idx, { discount: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Select aria-label="Tax rate" className="h-9 text-xs" value={TAX_RATES.includes(Number(row.taxRate)) ? row.taxRate : DEFAULT_TAX_RATE} onChange={(e) => updateRow(idx, { taxRate: Number(e.target.value) })}>{TAX_RATES.map((t) => <option key={t} value={t}>{t}%</option>)}</Select>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(lineTotal)}</td>
                      <td className="px-2 py-2 text-center">
                        <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => removeRow(idx)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 rounded-xl bg-ink-50 p-4 text-sm dark:bg-ink-800/50">
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="flex justify-between text-ink-600 dark:text-ink-300"><span>Tax (per line)</span><span>{formatCurrency(totals.tax)}</span></div>
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
          </div>
        </div>

        <FormField label="Terms & Conditions">
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
        </FormField>

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700 dark:text-ink-200">Existing quotation document <span className="font-normal text-ink-400">(optional)</span></p>
          {attachment ? (
            <StagedFileCard staged={attachment} onClear={() => setAttachment(null)} />
          ) : (
            <QuotationFilePicker compact onStaged={setAttachment} label="Attach an existing quotation (PDF or Word)" />
          )}
          <p className="mt-1.5 text-xs text-ink-400">It is attached to this quotation and client when you create it, and can be previewed, replaced, removed and sent from the quotation page.</p>
        </div>
      </div>
    </Modal>
  )
}

export default function Quotations() {
  const crud = useCrud('quotations', { searchFields: ['number', 'customerName'], pageSize: 10 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [initialSource, setInitialSource] = useState(null)
  const { toast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const reps = salesUsers()

  // Opened from a Deal/Company/Contact/Customer Detail page's "Create Quotation" action —
  // pre-selects that record as the source instead of landing on an empty builder.
  useEffect(() => {
    const dealId = searchParams.get('dealId')
    const companyId = searchParams.get('companyId')
    const contactId = searchParams.get('contactId')
    if (dealId || companyId) {
      setInitialSource({ type: dealId ? 'deal' : 'company', dealId, companyId, contactId })
      setBuilderOpen(true)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterDefs = [
    { key: 'status', label: 'Statuses', options: QUOTATION_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'assignedTo', label: 'Staff', options: reps.map((r) => ({ value: r.id, label: r.name })) },
  ]

  const columns = [
    { key: 'number', header: 'Quotation Number', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100', render: (row) => (<span className="inline-flex items-center gap-1.5">{row.number}{row.attachmentId && <Paperclip size={12} className="text-brand-500" title="Has an attached document" />}</span>) },
    { key: 'customerName', header: 'Client', sortable: true },
    { key: 'dealId', header: 'Deal', render: (row) => row.dealId || '—' },
    { key: 'amount', header: 'Amount', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'createdDate', header: 'Created Date', sortable: true, render: (row) => formatDate(row.createdDate) },
    { key: 'validUntil', header: 'Valid Until', sortable: true, render: (row) => formatDate(row.validUntil) },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'assignedTo', header: 'Owner', render: (row) => getUserById(row.assignedTo)?.name.split(' ')[0] || '—' },
    {
      key: 'actions', header: '', headerClassName: 'w-16',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton icon={Eye} size="sm" onClick={() => navigate(`/quotations/${row.id}`)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const handleCreate = (payload, _reset, attachment) => {
    if (saving) return // one quotation per submit, however many times the button is hit
    setSaving(true)
    createQuotation(payload, { by: user.id }).then(async (quotation) => {
      let attachError = ''
      if (attachment) {
        // Attached to the quotation that was just created — never a second record.
        try { await uploadQuotationAttachment(quotation.id, attachment) } catch (err) { attachError = apiErrorMessage(err, 'The document could not be attached.') }
      }
      setSaving(false)
      setBuilderOpen(false)
      setInitialSource(null)
      crud.refresh()
      toast(`Quotation ${quotation.number} created${attachment && !attachError ? ' with the document attached' : ''}.`, { type: 'success' })
      if (attachError) toast(`${attachError} Attach it again from the quotation page.`, { type: 'warning' })
      navigate(`/quotations/${quotation.id}`)
    }).catch((err) => {
      setSaving(false)
      toast(err.message || 'Could not create the quotation.', { type: 'error' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Quotation "${deleteTarget.number}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Create, send and track quotations for your customers."
        actions={
          <>
            <Button variant="secondary" icon={Settings2} onClick={() => navigate('/quotation-templates')}>Manage Templates</Button>
            <Button icon={Plus} onClick={() => setBuilderOpen(true)}>Create Quotation</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search by quotation number or client…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        {selected.length > 0 && <span className="text-xs text-ink-500 dark:text-ink-400">{selected.length} selected</span>}
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
        onRowClick={(row) => navigate(`/quotations/${row.id}`)}
        selectable
        selected={selected}
        onSelectChange={setSelected}
        sort={crud.sort}
        onSortChange={crud.setSort}
        page={crud.page}
        totalPages={crud.totalPages}
        onPageChange={crud.setPage}
        total={crud.total}
        pageSize={10}
        emptyTitle="No quotations found"
        emptyDescription="Try adjusting your search or filters, or create a new quotation to get started."
      />

      <QuotationBuilderModal
        open={builderOpen}
        onClose={() => { setBuilderOpen(false); setInitialSource(null) }}
        onCreate={handleCreate}
        saving={saving}
        initialSource={initialSource}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this quotation?"
        description={`"${deleteTarget?.number}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Quotation"
      />
    </div>
  )
}
