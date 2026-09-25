import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { COMPANIES } from './companies'
import { DEALS } from './deals'
import { salesUsers } from './users'

resetSeed(707)
const reps = salesUsers()

// Customers are companies with at least one Closed Won deal
const wonCompanyIds = [...new Set(DEALS.filter((d) => d.stage === 'Closed Won').map((d) => d.companyId))]
const customerCompanies = wonCompanyIds.length >= 14 ? wonCompanyIds : COMPANIES.slice(0, 16).map((c) => c.id)

export const CUSTOMERS = customerCompanies.map((companyId, i) => {
  const company = COMPANIES.find((c) => c.id === companyId)
  const accountManager = pick(reps)
  return {
    id: `CUS-${String(3000 + i)}`,
    companyId: company.id,
    name: company.name,
    industry: company.industry,
    contactPerson: company.contactPerson,
    email: company.email,
    phone: company.phone,
    accountManager: accountManager.id,
    since: daysFromNow(-randInt(30, 800)),
    status: randInt(0, 9) > 1 ? 'Active' : 'Inactive',
    lifetimeValue: DEALS.filter((d) => d.companyId === company.id && d.stage === 'Closed Won').reduce((s, d) => s + d.value, 0) || randInt(200000, 1500000),
    tier: pick(['Standard', 'Premium', 'Enterprise']),
  }
})

export function getCustomerById(id) {
  return CUSTOMERS.find((c) => c.id === id)
}
export function getCustomerByCompanyId(companyId) {
  return CUSTOMERS.find((c) => c.companyId === companyId)
}
