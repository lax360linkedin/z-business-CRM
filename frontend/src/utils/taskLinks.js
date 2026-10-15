// Which CRM record a task is "about" and the whole chain it touches. Built on the activity link
// resolver (enquiry → lead → deal → proposal → quotation → customer → sales order → invoice → payment,
// plus contact and company) and extended with Project, Product and Campaign. Pure: takes a
// `find(collection, id)` lookup so the mock server and the data migration share it.
import { RELATED_TYPES, RELATED_BY_TYPE } from './activityRules'
import { resolveActivityLinks } from './activityLinks'

export const TASK_RELATED_TYPES = [
  ...RELATED_TYPES,
  { type: 'Contract', collection: 'contracts', linkKey: 'contractId', route: (id) => `/contracts/${id}`, label: (r) => `${r.number} · ${r.title || r.customerName}` },
  { type: 'Document', collection: 'documents', linkKey: 'documentId', route: (id) => `/documents/${id}`, label: (r) => `${r.id} · ${r.name}` },
  { type: 'Project', collection: 'projects', linkKey: 'projectId', route: (id) => `/projects/${id}`, label: (r) => r.name },
  { type: 'Product', collection: 'products', linkKey: 'productId', route: (id) => `/products/${id}`, label: (r) => `${r.code ? `${r.code} · ` : ''}${r.name}` },
]
export const TASK_RELATED_BY_TYPE = Object.fromEntries(TASK_RELATED_TYPES.map((r) => [r.type, r]))
export const TASK_RELATED_BY_KEY = Object.fromEntries(TASK_RELATED_TYPES.map((r) => [r.linkKey, r]))
export const TASK_LINK_ORDER = ['enquiryId', 'leadId', 'contactId', 'companyId', 'dealId', 'proposalId', 'quotationId', 'customerId', 'salesOrderId', 'invoiceId', 'paymentId', 'expenseId', 'contractId', 'projectId', 'documentId', 'productId', 'campaignId']

export function taskRelatedHref(type, id) { return id && TASK_RELATED_BY_TYPE[type] ? TASK_RELATED_BY_TYPE[type].route(id) : null }

/** The chain of records for a task attached to `relatedType`/`relatedId`. `list(collection)` returns every record of a collection. */
export function resolveTaskLinks(find, relatedType, relatedId, list) {
  let links = {}
  if (RELATED_BY_TYPE[relatedType]) links = resolveActivityLinks(find, relatedType, relatedId)
  else if (relatedType === 'Contract' && relatedId) {
    // a task on a contract carries the contract's whole chain: customer, company, contact, deal, proposal, quotation, order, project
    const c = find('contracts', relatedId)
    if (c) {
      links.contractId = c.id
      ;['customerId', 'companyId', 'contactId', 'dealId', 'proposalId', 'quotationId', 'salesOrderId', 'projectId'].forEach((k) => {
        const def = TASK_RELATED_BY_KEY[k]
        if (c[k] && find(def.collection, c[k])) links[k] = c[k]
      })
    }
  } else if (relatedType === 'Document' && relatedId) {
    // a task on a document carries the document's whole chain (customer, company, contact, deal, quotation, order, project, contract …)
    const d = find('documents', relatedId)
    if (d) {
      links.documentId = d.id
      ;['enquiryId', 'leadId', 'contactId', 'companyId', 'dealId', 'proposalId', 'quotationId', 'customerId', 'salesOrderId', 'invoiceId', 'paymentId', 'expenseId', 'contractId', 'projectId'].forEach((k) => {
        const def = TASK_RELATED_BY_KEY[k]
        if (d[k] && def && find(def.collection, d[k])) links[k] = d[k]
      })
    }
  } else if (relatedType === 'Project' && relatedId) {
    links = resolveActivityLinks(find, 'Project', relatedId)
    if (find('projects', relatedId)) links.projectId = relatedId
  } else if ((relatedType === 'Product' || relatedType === 'Campaign') && relatedId) {
    const def = TASK_RELATED_BY_TYPE[relatedType]
    if (find(def.collection, relatedId)) links[def.linkKey] = relatedId
  }
  // project / campaign hang off the records in the chain (invoice.projectId, lead.campaign name …)
  if (!links.projectId || !links.campaignId) {
    for (const r of RELATED_TYPES) {
      const rec = links[r.linkKey] && find(r.collection, links[r.linkKey])
      if (!rec) continue
      if (!links.projectId && rec.projectId && find('projects', rec.projectId)) links.projectId = rec.projectId
      if (!links.campaignId) {
        if (rec.campaignId && find('campaigns', rec.campaignId)) links.campaignId = rec.campaignId
        else if (rec.campaign) {
          const hits = (list ? list('campaigns') : []).filter((c) => String(c.name).toLowerCase() === String(rec.campaign).trim().toLowerCase())
          if (hits.length === 1) links.campaignId = hits[0].id
        }
      }
    }
  }
  return links
}

/** The user that owns a record — used to pre-fill the assignee of a task created from it. */
export function ownerOfRecord(type, rec) {
  if (!rec) return null
  return rec.assignedTo || rec.assignedUser || rec.salesperson || rec.accountManager || rec.manager || rec.ownerId || rec.owner || rec.createdBy || null
}
