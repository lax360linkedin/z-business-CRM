import { api } from '../../api/mockServer'
import { genId } from '../../utils/csv'
import { initials as makeInitials, avatarColor } from '../../utils/generators'
import { salesUsers } from '../../data/users'
import { createNotification } from '../../utils/notify'
import { findDuplicates, logLeadActivity } from './leadActions'

const ROUND_ROBIN_KEY = 'business_crm_lead_roundrobin_v1'

// Simple round-robin across active sales reps — one of the assignment methods the spec asks
// for (§9 "Round-robin assignment if already implemented"). The index persists in localStorage
// so it keeps advancing across page reloads instead of always starting from the same rep.
function nextRoundRobinRep() {
  const reps = salesUsers()
  if (!reps.length) return null
  let idx = 0
  try { idx = Number(localStorage.getItem(ROUND_ROBIN_KEY)) || 0 } catch { /* storage unavailable */ }
  const rep = reps[idx % reps.length]
  try { localStorage.setItem(ROUND_ROBIN_KEY, String(idx + 1)) } catch { /* storage unavailable */ }
  return rep
}

/**
 * The real automatic-capture pipeline the spec describes in §4/§24:
 *   Source → Capture Service → Validation → Duplicate Check → Lead Creation → Assignment → Notification
 * This is exercised for real by the "Simulate Incoming Lead" action on a Connected Lead Source
 * (src/pages/LeadSources/LeadSources.jsx) — the incoming payload there is generated data
 * standing in for a genuine webhook/form/API submission (there's no real external service to
 * receive from in this frontend-only build), but every step AFTER that — validation, duplicate
 * matching against live Leads/Enquiries/Customers, Lead creation, round-robin assignment,
 * notification — runs through the exact same code a real submission would hit. This is also the
 * single function any future real integration (an actual webhook handler, a form POST endpoint)
 * would call directly instead of needing its own capture logic.
 */
export function captureLead(payload, { captureMethod = 'API' } = {}) {
  const { name, phone, email, company, source, sourceDetail, service, requirement, campaign } = payload

  // Step: validate required fields — a capture with no way to reach the prospect is rejected
  // rather than silently creating an unusable Lead.
  if (!name || !phone || !source) {
    return Promise.reject(new Error('A captured lead needs at minimum a name, phone number and source.'))
  }

  // Step: duplicate check against live Enquiries/Leads/Customers — an automatic capture never
  // silently creates a duplicate any more than a manually-entered one does.
  return findDuplicates({ name, phone, email, company }).then((matches) => {
    if (matches.length) {
      return { captured: false, duplicate: true, matches }
    }

    // Step: assignment (round-robin) — then create + notify.
    const rep = nextRoundRobinRep()
    const id = genId('LD')
    const now = new Date().toISOString()
    return api.post('/leads', {
      id,
      name,
      company: company || '',
      designation: '',
      email: email || '',
      phone,
      website: '',
      industry: '',
      location: '',
      source,
      sourceDetail: sourceDetail || '',
      captureMethod,
      capturedAt: now,
      service: service || '',
      requirement: requirement || `Enquiry received via ${source}.`,
      budget: 0,
      expectedPurchaseDate: null,
      campaign: campaign || '',
      assignedTo: rep?.id || null,
      assignedBy: null,
      assignedAt: rep ? now : null,
      status: 'New',
      priority: 'Medium',
      score: 40,
      qualification: null,
      nextFollowUp: null,
      lastContactedDate: null,
      notes: '',
      createdDate: now.slice(0, 10),
      createdBy: null,
      convertedAt: null, convertedBy: null, dealId: null, customerId: null, contactId: null, companyId: null,
      sourceEnquiryId: null,
      lostReason: null, lostDate: null, lostBy: null,
      initials: makeInitials(name),
      avatarColor: avatarColor(name),
    }).then((res) => {
      logLeadActivity({
        type: 'Created',
        leadId: id,
        leadName: name,
        subject: `Lead automatically captured from ${source}${sourceDetail ? ` (${sourceDetail})` : ''}`,
        by: null,
      })
      createNotification({
        type: 'New Lead',
        message: `New lead: ${name} (${company || source}) — captured automatically from ${source}.`,
        relatedType: 'Lead',
        relatedId: id,
      })
      if (rep) {
        logLeadActivity({ type: 'Assignment', leadId: id, leadName: name, subject: `Auto-assigned to ${rep.name} (round-robin)`, by: null })
        createNotification({ type: 'Lead Assignment', message: `${name} was auto-assigned to you from ${source}.`, relatedType: 'Lead', relatedId: id })
      }
      return { captured: true, lead: res.data }
    })
  })
}
