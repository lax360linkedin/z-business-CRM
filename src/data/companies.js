import {
  resetSeed, companyName, pick, pickMany, randInt, randFloat, personName,
  companyEmail, phoneNumber, INDUSTRIES, CITIES, daysFromNow,
} from '../utils/generators'

resetSeed(101)

const STATUSES = ['Active', 'Inactive', 'Prospect']
const GST_STATE_CODES = ['06', '07', '19', '27', '29', '33', '36']

// Deterministic-looking 15-char GSTIN per company (state code + PAN-shaped body + entity/check
// chars) — not a real validated checksum, just a plausible, stable, per-company value so
// quotations have a real-looking tax ID to render instead of a blank field.
function fakeGstin(seedIndex) {
  const state = GST_STATE_CODES[seedIndex % GST_STATE_CODES.length]
  const pan = `AAACL${String(1000 + seedIndex).slice(-4)}${String.fromCharCode(65 + (seedIndex % 26))}`
  return `${state}${pan}1Z${(seedIndex % 10)}`
}

export const COMPANIES = Array.from({ length: 28 }).map((_, i) => {
  const name = companyName()
  const contactPerson = personName()
  const website = `www.${name.toLowerCase().replace(/\s+/g, '')}.com`
  const address = `${randInt(1, 400)}, ${pick(['MG Road', 'Anna Salai', 'Park Street', 'Brigade Road', 'Sector 21', 'Marine Drive', 'Tech Park Avenue'])}, ${pick(CITIES)}`
  return {
    id: `CMP-${String(i + 1).padStart(4, '0')}`,
    name,
    industry: pick(INDUSTRIES),
    contactPerson,
    email: companyEmail(name, contactPerson),
    phone: phoneNumber(),
    website,
    city: pick(CITIES),
    address,
    // Billing/shipping default to the same registered address at seed time — kept as
    // independent fields (not a derived getter) so a quotation or edit can diverge them
    // without touching the company's primary address.
    billingAddress: address,
    shippingAddress: address,
    gstin: fakeGstin(i),
    revenue: randFloat(500000, 45000000, 0),
    status: i < 22 ? 'Active' : pick(STATUSES),
    createdDate: daysFromNow(-randInt(30, 900)),
    tags: pickMany(['Key Account', 'High Value', 'New', 'Repeat Client', 'Enterprise', 'SMB'], randInt(1, 2)),
  }
})

export function getCompanyById(id) {
  return COMPANIES.find((c) => c.id === id)
}
