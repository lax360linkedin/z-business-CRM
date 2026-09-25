import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { createNotification } from '../../utils/notify'
import { canTransition, isDealClosed, isDealLost, probabilityForStage } from '../../data/dealWorkflow'

/**
 * Thin, shared wrapper so every Deal action logs to /activities in the exact same shape as
 * Lead/Enquiry/Contact — see src/components/common/ActivityTimeline.jsx for the icon/tone each
 * `type` renders as. Callers pass `id` explicitly for types that need a stable,
 * independently-addressable id (Meeting — reuses the same MTG-prefixed id as the Lead/Enquiry/
 * Contact modules' `/meetings/:id` join route).
 */
export function logDealActivity(fields) {
  return api.post('/activities', {
    id: fields.id || genId('ACT'),
    relatedType: 'Deal',
    date: new Date().toISOString(),
    status: 'Completed',
    ...fields,
  }).then((res) => res.data)
}

/**
 * The single choke point for moving a Deal between pipeline stages — validates the transition
 * against DEAL_STAGE_FLOW (rejects if illegal, e.g. moving out of an already-closed stage),
 * derives probability from the stage itself (never accepted from the caller — spec: "Users
 * should not manually enter probability"), stamps closedAt/closedBy the moment a deal reaches
 * ANY closed stage, appends a stageHistory entry, and logs a StatusChange timeline activity.
 * Closed Lost / Closed Lost – Competition must go through markDealLost() instead of calling
 * this directly, since those require a reason. Closed Won triggers the Deal → Customer workflow
 * automatically once the stage write succeeds.
 */
export function changeDealStage(deal, newStage, { by, note, extra = {}, update }) {
  if (!canTransition(deal.stage, newStage)) {
    return Promise.reject(new Error(`Cannot move a deal from "${deal.stage}" to "${newStage}".`))
  }
  const closing = isDealClosed(newStage)
  const historyEntry = { stage: newStage, changedAt: new Date().toISOString(), changedBy: by, note: note || null }
  const patch = {
    stage: newStage,
    probability: probabilityForStage(newStage),
    stageHistory: [...(deal.stageHistory || []), historyEntry],
    ...(closing ? { closedAt: new Date().toISOString(), closedBy: by } : {}),
    ...extra,
  }
  return update(deal.id, patch).then((updated) => {
    logDealActivity({
      type: 'StatusChange',
      relatedId: deal.id,
      relatedName: deal.name,
      subject: `Stage changed from ${deal.stage} to ${newStage}`,
      notes: note,
      fromStatus: deal.stage,
      toStatus: newStage,
      by,
    })
    if (newStage === 'Closed Won') {
      createNotification({ type: 'Deal Won', message: `${deal.name} was marked as Closed Won.`, relatedType: 'Deal', relatedId: deal.id })
      return convertDealToCustomer(updated, { by, update }).then(() => updated)
    }
    if (isDealLost(newStage)) {
      createNotification({
        type: 'Deal Lost',
        message: `${deal.name} was marked as ${newStage}${extra.lostReason ? ` — ${extra.lostReason}` : ''}.`,
        relatedType: 'Deal',
        relatedId: deal.id,
      })
    }
    return updated
  })
}

/**
 * Closed Lost / Closed Lost – Competition, requiring a reason + optional notes (spec §11).
 * `stage` must be one of the two Lost variants — the calling UI (ChangeStageModal) is
 * responsible for only offering this path for those two stages.
 */
export function markDealLost(deal, { stage, reason, notes, by, update }) {
  if (!reason) return Promise.reject(new Error('A Lost Reason is required before this deal can be closed.'))
  return changeDealStage(deal, stage, {
    by,
    note: `Reason: ${reason}${notes ? ` — ${notes}` : ''}`,
    extra: { lostReason: reason, lostNotes: notes || null, lostDate: new Date().toISOString(), lostBy: by },
    update,
  })
}

/**
 * Deal → Customer, per spec §10. A Deal already carries companyId (set either at creation via
 * the company picker, or carried forward from convertLead()) and usually already carries
 * contactId/customerId too if it came from a converted Lead — this only fills in whichever of
 * Contact/Customer is still missing, by finding an existing match on the company first (never
 * duplicating), and is a no-op patch-wise if the Deal already has a customerId. Never touches
 * or re-creates the Company itself, since the Deal's companyId is always already valid.
 */
export function convertDealToCustomer(deal, { by, update }) {
  if (deal.customerId) return Promise.resolve(deal)
  return api.get('/companies', { params: { all: true } }).then((res) => {
    const company = res.data.find((c) => c.id === deal.companyId)
    if (!company) return deal
    return Promise.all([
      api.get('/contacts', { params: { all: true } }),
      api.get('/customers', { params: { all: true } }),
    ]).then(([contactsRes, customersRes]) => {
      const existingContact = deal.contactId
        ? contactsRes.data.find((c) => c.id === deal.contactId)
        : contactsRes.data.find((c) => c.companyId === company.id)
      const contactPromise = existingContact
        ? Promise.resolve(existingContact)
        : api.post('/contacts', {
          id: genId('CT'),
          name: deal.contactName || company.contactPerson,
          designation: '',
          email: company.email,
          phone: company.phone,
          whatsapp: company.phone,
          companyId: company.id,
          companyName: company.name,
          groups: ['Primary Contact'],
          createdDate: new Date().toISOString().slice(0, 10),
          nextFollowUp: null,
          lastContactedDate: null,
          notes: '',
        }).then((r) => r.data)

      return contactPromise.then((contact) => {
        const existingCustomer = customersRes.data.find((c) => c.companyId === company.id)
        const customerPromise = existingCustomer
          ? Promise.resolve(existingCustomer)
          : api.post('/customers', {
            id: genId('CUS'),
            companyId: company.id,
            name: company.name,
            industry: company.industry,
            contactPerson: contact.name,
            email: company.email,
            phone: company.phone,
            accountManager: deal.salesperson,
            since: new Date().toISOString().slice(0, 10),
            status: 'Active',
            lifetimeValue: 0,
            tier: 'Standard',
            leadId: deal.leadId || null,
          }).then((r) => r.data)

        return customerPromise.then((customer) =>
          update(deal.id, { customerId: customer.id, contactId: contact.id }).then((updatedDeal) => {
            logDealActivity({
              type: 'Conversion',
              relatedId: deal.id,
              relatedName: deal.name,
              subject: existingCustomer ? `Linked to existing Customer ${customer.id}` : `Closed Won → Customer ${customer.id} created`,
              by,
            })
            createNotification({
              type: 'Deal Won',
              message: `${deal.name} is now linked to Customer ${customer.name}.`,
              relatedType: 'Customer',
              relatedId: customer.id,
            })
            return updatedDeal
          }),
        )
      })
    })
  })
}

/** Live existing-customer lookup for a Deal's company — never the frozen static CUSTOMERS import, so a customer created moments ago in this session (e.g. from converting the source Lead) is always found instead of triggering a duplicate create downstream. */
export function findCustomerForDeal(deal) {
  return api.get('/customers', { params: { all: true } }).then((res) => res.data.find((c) => c.companyId === deal.companyId) || null)
}

/**
 * Create Quotation from Deal (spec §12) — reuses the existing Customer/Contact/Company (never
 * duplicates), carries dealId/leadId/source/sourceDetail forward, and — unlike the drawer this
 * replaced — actually stores the new Quotation's id back onto the Deal's own quotationIds list
 * and logs a Deal-timeline activity, so "Deal Detail should show Quotation number/status/value/
 * date" has something real to read from.
 */
export function createQuotationFromDeal(deal, { by, update }) {
  return findCustomerForDeal(deal).then((customer) => {
    const id = genId('QT')
    return api.post('/quotations', {
      id,
      number: `QUO-${new Date().getFullYear()}-${id.split('-').pop()}`,
      customerId: customer?.id ?? deal.customerId ?? null,
      customerName: customer?.name ?? deal.companyName,
      dealId: deal.id,
      leadId: deal.leadId,
      source: deal.source,
      sourceDetail: deal.sourceDetail,
      items: [],
      subtotal: 0,
      tax: 0,
      amount: deal.value || 0,
      status: 'Draft',
      assignedTo: deal.salesperson,
      createdDate: new Date().toISOString().slice(0, 10),
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      terms: 'Payment due within 15 days of acceptance. Prices are exclusive of applicable taxes unless noted. Quotation valid until the date specified above.',
    }).then((res) => {
      const quotation = res.data
      return update(deal.id, { quotationIds: [...(deal.quotationIds || []), quotation.id] }).then(() => {
        logDealActivity({
          type: 'Quotation',
          relatedId: deal.id,
          relatedName: deal.name,
          subject: `Quotation ${quotation.number} created`,
          by,
        })
        createNotification({ type: 'Quotation Created', message: `A quotation was created for ${deal.companyName}.`, relatedType: 'Quotation', relatedId: quotation.id })
        return quotation
      })
    })
  })
}
