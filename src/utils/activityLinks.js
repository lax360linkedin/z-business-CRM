// Resolves the full chain of CRM records an activity touches from the ONE record it was logged on.
// Log a call on a Payment and it is also linked to that invoice, sales order, quotation, proposal,
// deal, lead, enquiry, company, contact and customer — read from the stored records, never typed.
// Pure: takes a `find(collection, id)` lookup so the mock server and the data migration can share it.
import { RELATED_BY_TYPE, RELATED_TYPES, LINK_KEYS } from './activityRules'

// How a stored record names the others (field on the record → link key).
const ALIASES = { convertedLeadId: 'leadId', sourceEnquiryId: 'enquiryId' }

function absorb(links, rec) {
  if (!rec) return false
  let changed = false
  const put = (key, id) => { if (id && !links[key]) { links[key] = id; changed = true } }
  LINK_KEYS.forEach((k) => put(k, rec[k]))
  Object.entries(ALIASES).forEach(([field, key]) => put(key, rec[field]))
  return changed
}

export function resolveActivityLinks(find, relatedType, relatedId) {
  const def = RELATED_BY_TYPE[relatedType]
  const links = {}
  if (def && relatedId) links[def.linkKey] = relatedId
  else if (relatedType === 'Project' && relatedId) {
    const p = find('projects', relatedId)
    if (p?.customerId) links.customerId = p.customerId
  }
  // walk the chain until nothing new is learned (payment → invoice → order → quotation → proposal → deal → lead → enquiry …)
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    RELATED_TYPES.forEach((r) => {
      const id = links[r.linkKey]
      if (!id) return
      const rec = find(r.collection, id)
      if (rec && absorb(links, rec)) changed = true
    })
    if (!changed) break
  }
  const contact = links.contactId && find('contacts', links.contactId)
  if (!links.companyId && contact?.companyId) links.companyId = contact.companyId
  const customer = links.customerId && find('customers', links.customerId)
  if (!links.companyId && customer?.companyId) links.companyId = customer.companyId
  // drop anything that does not exist (stale ids on old records)
  RELATED_TYPES.forEach((r) => { if (links[r.linkKey] && !find(r.collection, links[r.linkKey])) delete links[r.linkKey] })
  return links
}

/** Does this activity belong on the timeline of the given record? Manual activities appear on every record they are linked to; system events stay on their own record (modules mirror those themselves). */
export function belongsTo(activity, relatedType, id) {
  if (activity.relatedType === relatedType && activity.relatedId === id) return true
  const key = RELATED_BY_TYPE[relatedType]?.linkKey
  return !!key && (activity.source === 'manual' || activity.source === 'task') && activity.links?.[key] === id
}
