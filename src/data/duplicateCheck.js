// Shared duplicate-detection logic — used by both Lead creation (src/pages/Leads/leadActions.js)
// and Enquiry creation (src/pages/Enquiries/enquiryActions.js) so "same phone/email/company"
// matching behaves identically everywhere a new record can be created, per the spec's
// "check against existing Leads, Enquiries and Customers" requirement. Pure — no api import —
// callers supply the live collections themselves (see findDuplicates() in each actions file).

function norm(str) {
  return String(str || '').trim().toLowerCase()
}

function normPhone(str) {
  return String(str || '').replace(/[^\d]/g, '').slice(-10)
}

/**
 * Matches `candidate` (a {name, phone, email, company} shaped object) against Enquiries,
 * Leads and Customers by phone, email, company name or contact name. Returns an array of
 * { source: 'Enquiry'|'Lead'|'Customer', id, name, phone, email, company, status, matchedOn }
 * so the UI can show exactly why each candidate was flagged. `excludeId` skips a record
 * matching itself (e.g. when re-checking an existing record being edited).
 */
export function findDuplicateMatches(candidate, { enquiries = [], leads = [], customers = [] } = {}, excludeId = null) {
  const phone = normPhone(candidate.phone)
  const email = norm(candidate.email)
  const company = norm(candidate.company)
  const name = norm(candidate.name)
  const matches = []

  const check = (record, source, phoneField, emailField, companyField, nameField, idField = 'id') => {
    if (excludeId && record[idField] === excludeId) return
    const matchedOn = []
    if (phone && normPhone(record[phoneField]) === phone) matchedOn.push('Phone')
    if (email && norm(record[emailField]) === email) matchedOn.push('Email')
    if (company && companyField && norm(record[companyField]) === company) matchedOn.push('Company')
    if (name && nameField && norm(record[nameField]) === name && !matchedOn.length) matchedOn.push('Name')
    if (matchedOn.length) {
      matches.push({
        source,
        id: record[idField],
        name: record[nameField] || record.name || record.contactPerson,
        phone: record[phoneField],
        email: record[emailField],
        company: record[companyField] || record.company || record.name,
        status: record.status,
        matchedOn,
      })
    }
  }

  enquiries.forEach((e) => check(e, 'Enquiry', 'phone', 'email', 'company', 'name'))
  leads.forEach((l) => check(l, 'Lead', 'phone', 'email', 'company', 'name'))
  customers.forEach((c) => check(c, 'Customer', 'phone', 'email', 'name', 'contactPerson'))

  return matches
}
