import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Save, Plus, Trash2, Building2, User, Handshake, Users, AlertTriangle, Info } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { Button, IconButton } from '../../components/common/Button'
import { FormField, Input, Textarea, Select, DateInput } from '../../components/common/FormField'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { salesUsers } from '../../data/users'
import { useProducts } from '../../hooks/useProducts'
import { ProductSelect } from '../../components/common/ProductSelect'
import { lineFromProduct, catalogDrift, TAX_RATES, DEFAULT_TAX_RATE } from '../../utils/productRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { NARRATIVE_SECTIONS, normalizeContent, validateProposalInput, computeCommercial, PR_EDITABLE } from '../../utils/proposalCalc'
import { getProposalDraft, createProposal, updateProposal, prError, prFieldErrors } from './proposalClient'

function Section({ title, description, children, action }) {
  return (
    <section className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</h2>{description && <p className="mt-0.5 text-xs text-ink-400">{description}</p>}</div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Chip({ icon: Icon, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-ink-100 px-3 py-2 text-left hover:border-brand-400 disabled:cursor-default dark:border-ink-800">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400"><Icon size={15} /></span>
      <span className="min-w-0"><span className="block text-[11px] uppercase tracking-wide text-ink-400">{label}</span><span className="block truncate text-sm font-medium text-ink-800 dark:text-ink-100">{value || '—'}</span></span>
    </button>
  )
}

export default function ProposalForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const dealId = params.get('dealId')
  const isNew = !id
  const navigate = useNavigate()
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const { products, byId: productById } = useProducts()
  const reps = salesUsers()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [base, setBase] = useState(null)
  const [form, setForm] = useState(null)
  const [contacts, setContacts] = useState([])
  const [templates, setTemplates] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true); setLoadError(null)
    const load = isNew ? (dealId ? getProposalDraft(dealId) : Promise.reject(Object.assign(new Error('x'), { response: { data: { message: 'Open a deal and choose Create Proposal.' } } }))) : api.get(`/proposals/${id}`).then((r) => r.data)
    load.then((p) => {
      setBase(p)
      setForm({
        title: p.title, validUntil: p.validUntil, ownerId: p.ownerId, contactId: p.contactId || '', notes: p.notes || '', templateId: p.templateId || '',
        content: normalizeContent(p.content),
        deliverablesText: (p.content.deliverables || []).join('\n'),
        modules: p.content.modules?.length ? p.content.modules : [], timeline: p.content.timeline?.length ? p.content.timeline : [],
      })
    }).catch((e) => setLoadError(prError(e, 'Could not open this proposal.'))).finally(() => setLoading(false))
  }, [id, dealId, isNew])

  useEffect(() => {
    if (!base?.companyId) return
    api.get('/contacts', { params: { all: true } }).then((r) => setContacts(r.data.filter((c) => c.companyId === base.companyId)))
    api.get('/proposalTemplates', { params: { all: true } }).then((r) => setTemplates(r.data.filter((t) => t.isActive))).catch(() => {})
  }, [base?.companyId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setContent = (patch) => setForm((f) => ({ ...f, content: { ...f.content, ...patch } }))
  const setItem = (i, patch) => setForm((f) => ({ ...f, content: { ...f.content, items: f.content.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } }))
  const rowSet = (key, i, patch) => setForm((f) => ({ ...f, [key]: f[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const assembled = useMemo(() => form && ({
    ...form, createdDate: base?.createdDate,
    content: normalizeContent({ ...form.content, modules: form.modules, timeline: form.timeline, deliverables: form.deliverablesText.split('\n') }),
  }), [form, base])
  const commercial = useMemo(() => (assembled ? computeCommercial(assembled.content.items) : null), [assembled])

  const submit = () => {
    if (saving) return
    const e = validateProposalInput(assembled)
    setErrors(e)
    if (Object.keys(e).length) { toast('Please fix the highlighted fields.', { type: 'error' }); return }
    setSaving(true)
    const payload = { title: assembled.title, validUntil: assembled.validUntil, ownerId: assembled.ownerId, contactId: assembled.contactId || undefined, notes: assembled.notes, templateId: assembled.templateId || null, content: assembled.content }
    const req = isNew ? createProposal(base.dealId, payload) : updateProposal(base.id, payload)
    req.then((p) => { toast(isNew ? `Proposal ${p.number} created.` : 'Proposal updated.', { type: 'success' }); navigate(`/proposals/${p.id}`) })
      .catch((err) => { setSaving(false); setErrors((x) => ({ ...x, ...prFieldErrors(err) })); toast(prError(err, 'Could not save the proposal.'), { type: 'error' }) })
  }

  if (loading) return <CardSkeleton className="h-60" />
  if (loadError || !base) {
    return <EmptyState icon={AlertTriangle} title="Can't open the proposal form" description={loadError || 'Not found.'} action={<Button onClick={() => navigate(dealId ? `/deals/${dealId}` : '/proposals')}>Go back</Button>} />
  }
  if (!hasPermission('Proposals', isNew ? 'create' : 'edit')) return <EmptyState title="Not authorized" description="Your role can't create or edit proposals." action={<Button onClick={() => navigate('/proposals')}>Back</Button>} />
  if (!isNew && !PR_EDITABLE.includes(base.status)) {
    return <EmptyState icon={Info} title={`This proposal is ${base.status}`} description="A sent proposal can't be edited — create a revision from its page; the sent version stays exactly as the client received it." action={<Button onClick={() => navigate(`/proposals/${base.id}`)}>Open proposal</Button>} />
  }
  const fe = (k) => errors[k]
  const client = base.clientSnapshot || {}

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Proposals', href: '/proposals' }, { label: isNew ? 'New' : base.number }]} />
      <div className="mb-5 mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50">{isNew ? 'Create Proposal' : `Edit ${base.number} – Version ${base.version}`}</h1>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">{isNew ? 'Pre-filled from the deal — review, refine the solution and save.' : 'Changes apply to this draft version only.'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(isNew ? `/deals/${base.dealId}` : `/proposals/${base.id}`)}>Cancel</Button>
          <Button icon={Save} loading={saving} onClick={submit}>{isNew ? 'Save Proposal' : 'Save Changes'}</Button>
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> Some fields need attention — they're marked below.</div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Section title="Linked records" description="Taken from the deal — fixed, so the proposal always belongs to the right client.">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <Chip icon={Handshake} label="Deal" value={`${base.dealId} · ${base.dealName}`} onClick={() => navigate(`/deals/${base.dealId}`)} />
              <Chip icon={Building2} label="Company" value={client.companyName} onClick={() => navigate(`/companies/${base.companyId}`)} />
              <Chip icon={Users} label="Customer" value={base.customerId ? client.companyName : 'Not a customer yet'} onClick={base.customerId ? () => navigate(`/customers/${base.customerId}`) : undefined} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Contact person" hint="Client details below follow this contact.">
                <Select value={form.contactId} onChange={(e) => set({ contactId: e.target.value })}>
                  {!contacts.length && <option value="">{client.contactName || '—'}</option>}
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.designation ? ` · ${c.designation}` : ''}</option>)}
                </Select>
              </FormField>
              <div className="rounded-xl bg-ink-50 px-3 py-2.5 text-xs text-ink-600 dark:bg-ink-800/50 dark:text-ink-300">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><User size={12} /> Client details (from master record)</p>
                <p>{client.contactName}{client.designation ? `, ${client.designation}` : ''} · {client.email} · {client.phone}</p>
                <p>{client.billingAddress}{client.gstin ? ` · GSTIN ${client.gstin}` : ''}{client.website ? ` · ${client.website}` : ''}</p>
              </div>
            </div>
          </Section>

          <Section title="Proposal details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><FormField label="Proposal title" required error={fe('title')}><Input value={form.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} error={!!fe('title')} /></FormField></div>
              <FormField label="Owner" required error={fe('ownerId')}><Select value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
              <FormField label="Valid until" required error={fe('validUntil')} hint={`Created ${formatDate(base.createdDate)}`}><DateInput value={form.validUntil} min={base.createdDate} onChange={(e) => set({ validUntil: e.target.value })} error={!!fe('validUntil')} /></FormField>
              <FormField label="Proposal template" hint="Header, footer, watermark and layout used for the PDF."><Select value={form.templateId} onChange={(e) => set({ templateId: e.target.value })}><option value="">Default / built-in</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
              {base.budget > 0 && <FormField label="Client budget (from deal)"><Input value={formatCurrency(base.budget)} readOnly className="bg-ink-50 dark:bg-ink-800/50" /></FormField>}
            </div>
          </Section>

          {NARRATIVE_SECTIONS.slice(0, 5).map((s) => (
            <Section key={s.key} title={s.label} description={s.hint}>
              <FormField label="" error={fe(s.key)}><Textarea value={form.content[s.key]} onChange={(e) => setContent({ [s.key]: e.target.value })} error={!!fe(s.key)} className="min-h-[110px]" /></FormField>
            </Section>
          ))}

          <Section title="Modules / features" action={<Button size="sm" variant="secondary" icon={Plus} onClick={() => set({ modules: [...form.modules, { name: '', description: '' }] })}>Add module</Button>}>
            {!form.modules.length ? <p className="text-xs text-ink-400">No modules added.</p> : form.modules.map((m, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_2fr_auto] gap-2"><Input value={m.name} onChange={(e) => rowSet('modules', i, { name: e.target.value })} placeholder="Module name" /><Input value={m.description} onChange={(e) => rowSet('modules', i, { description: e.target.value })} placeholder="What it does" /><IconButton icon={Trash2} size="sm" aria-label="Remove module" onClick={() => set({ modules: form.modules.filter((_, j) => j !== i) })} /></div>
            ))}
          </Section>

          <Section title="Deliverables" description="One deliverable per line."><Textarea value={form.deliverablesText} onChange={(e) => set({ deliverablesText: e.target.value })} className="min-h-[100px]" /></Section>

          {NARRATIVE_SECTIONS.slice(5, 7).map((s) => (
            <Section key={s.key} title={s.label} description={s.hint}><Textarea value={form.content[s.key]} onChange={(e) => setContent({ [s.key]: e.target.value })} className="min-h-[90px]" /></Section>
          ))}

          <Section title="Project timeline" action={<Button size="sm" variant="secondary" icon={Plus} onClick={() => set({ timeline: [...form.timeline, { phase: '', description: '', duration: '' }] })}>Add phase</Button>}>
            {!form.timeline.length ? <p className="text-xs text-ink-400">No phases added.</p> : form.timeline.map((t, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_2fr_120px_auto] gap-2"><Input value={t.phase} onChange={(e) => rowSet('timeline', i, { phase: e.target.value })} placeholder="Phase" /><Input value={t.description} onChange={(e) => rowSet('timeline', i, { description: e.target.value })} placeholder="Activities" /><Input value={t.duration} onChange={(e) => rowSet('timeline', i, { duration: e.target.value })} placeholder="2 weeks" /><IconButton icon={Trash2} size="sm" aria-label="Remove phase" onClick={() => set({ timeline: form.timeline.filter((_, j) => j !== i) })} /></div>
            ))}
          </Section>

          <Section title="Responsibilities">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Our responsibilities"><Textarea value={form.content.responsibilities.company} onChange={(e) => setContent({ responsibilities: { ...form.content.responsibilities, company: e.target.value } })} className="min-h-[90px]" /></FormField>
              <FormField label="Client responsibilities"><Textarea value={form.content.responsibilities.client} onChange={(e) => setContent({ responsibilities: { ...form.content.responsibilities, client: e.target.value } })} className="min-h-[90px]" /></FormField>
            </div>
          </Section>

          {NARRATIVE_SECTIONS.slice(7, 10).map((s) => (
            <Section key={s.key} title={s.label} description={s.hint}><Textarea value={form.content[s.key]} onChange={(e) => setContent({ [s.key]: e.target.value })} className="min-h-[80px]" /></Section>
          ))}

          <Section title="Commercial summary" description="Indicative pricing shown in the proposal. The binding offer is a separate Quotation." action={<Button size="sm" variant="secondary" icon={Plus} onClick={() => setContent({ items: [...form.content.items, { productId: null, name: '', description: '', qty: 1, unitPrice: 0, discount: 0, taxRate: DEFAULT_TAX_RATE }] })}>Add line</Button>}>
            {fe('items') && <p role="alert" className="mb-2 text-xs text-rose-600">{fe('items')}</p>}
            <div className="overflow-x-auto rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-ink-100 bg-ink-50/60 text-left text-xs font-semibold uppercase text-ink-500 dark:border-ink-800 dark:bg-ink-800/40"><th className="px-3 py-2.5">Product / service</th><th className="w-20 px-3 py-2.5">Qty</th><th className="w-28 px-3 py-2.5">Unit price</th><th className="w-20 px-3 py-2.5">Disc %</th><th className="w-24 px-3 py-2.5">Tax %</th><th className="w-28 px-3 py-2.5 text-right">Amount</th><th className="w-10" /></tr></thead>
                <tbody>
                  {form.content.items.map((it, i) => (
                    <tr key={i} className="border-b border-ink-50 align-top last:border-0 dark:border-ink-800/60">
                      <td className="px-3 py-2">
                        <ProductSelect products={products} value={it.productId || ''} onSelect={(p) => setItem(i, p ? lineFromProduct(p, { qty: it.qty || 1 }) : { productId: null, productCode: null, category: null, unit: null, billingCycle: null })} className="mb-1 h-9 text-xs" />
                        {it.productId && <p className="mb-1 text-[11px] text-ink-400">{it.productCode}{it.unit ? ` · per ${it.unit}` : ''}{productById.get(it.productId)?.status === 'Inactive' ? ' · inactive in catalog' : ''}</p>}
                        {catalogDrift(it, productById.get(it.productId)) && <button type="button" className="mb-1 block text-[11px] font-medium text-amber-600 hover:underline" onClick={() => setItem(i, lineFromProduct(productById.get(it.productId), { qty: it.qty }))}>Catalog price/tax changed — update line</button>}
                        <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Name" className="mb-1 h-9 text-xs" error={!!fe(`item-${i}-name`)} />
                        <Input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Description" className="h-9 text-xs" />
                      </td>
                      <td className="px-3 py-2"><Input type="number" min="1" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} className="h-9 text-xs" error={!!fe(`item-${i}-qty`)} /></td>
                      <td className="px-3 py-2"><Input type="number" min="0" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className="h-9 text-xs" /></td>
                      <td className="px-3 py-2"><Input type="number" min="0" max="100" value={it.discount} onChange={(e) => setItem(i, { discount: e.target.value })} className="h-9 text-xs" error={!!fe(`item-${i}-discount`)} /></td>
                      <td className="px-3 py-2"><Select aria-label="Tax rate" value={TAX_RATES.includes(Number(it.taxRate)) ? it.taxRate : DEFAULT_TAX_RATE} onChange={(e) => setItem(i, { taxRate: Number(e.target.value) })} className="h-9 text-xs">{TAX_RATES.map((t) => <option key={t} value={t}>{t}%</option>)}</Select></td>
                      <td className="px-3 py-2 text-right font-medium text-ink-800 dark:text-ink-100">{formatCurrency(commercial.lines[i]?.net || 0)}</td>
                      <td className="px-1 py-2 text-center">{form.content.items.length > 1 && <IconButton icon={Trash2} size="sm" aria-label="Remove line" onClick={() => setContent({ items: form.content.items.filter((_, j) => j !== i) })} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {NARRATIVE_SECTIONS.slice(10).map((s) => (
            <Section key={s.key} title={s.label} description={s.hint}><Textarea value={form.content[s.key]} onChange={(e) => setContent({ [s.key]: e.target.value })} className="min-h-[80px]" /></Section>
          ))}

          <Section title="Internal notes" description="Not printed in the proposal."><Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-[70px]" /></Section>
        </div>

        <aside className="min-w-0">
          <div className="space-y-4 xl:sticky xl:top-20">
            <div className="rounded-2xl border border-ink-100 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <h2 className="text-sm font-semibold text-ink-800 dark:text-ink-100">Commercial summary</h2>
              <dl className="mt-3 space-y-2 text-sm text-ink-600 dark:text-ink-300">
                <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCurrency(commercial.subtotal)}</dd></div>
                {commercial.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {formatCurrency(commercial.discount)}</dd></div>}
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><dt>Proposal value</dt><dd>{formatCurrency(commercial.value)}</dd></div>
                <div className="flex justify-between text-xs"><dt>Est. GST @ 18%</dt><dd>{formatCurrency(commercial.estimatedTax)}</dd></div>
              </dl>
              {base.dealValue > 0 && Math.abs(base.dealValue - commercial.value) > 1 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">Deal value is {formatCurrency(base.dealValue)}.</p>}
            </div>
            <div className="rounded-2xl border border-ink-100 bg-white p-5 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
              <p className="mb-1.5 font-semibold text-ink-700 dark:text-ink-200">Deal stage</p>
              <p>The deal stays in <b>{base.dealStage || 'its current stage'}</b>. Saving or sending a proposal never moves the deal — change the stage on the deal itself.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
