import {
  resetSeed, companyName, pick, pickMany, randInt, randFloat, personName,
  companyEmail, phoneNumber, INDUSTRIES, CITIES, daysFromNow,
} from '../utils/generators'

resetSeed(101)

const STATUSES = ['Active', 'Inactive', 'Prospect']

export const COMPANIES = Array.from({ length: 28 }).map((_, i) => {
  const name = companyName()
  const contactPerson = personName()
  const website = `www.${name.toLowerCase().replace(/\s+/g, '')}.com`
  return {
    id: `CMP-${String(i + 1).padStart(4, '0')}`,
    name,
    industry: pick(INDUSTRIES),
    contactPerson,
    email: companyEmail(name, contactPerson),
    phone: phoneNumber(),
    website,
    city: pick(CITIES),
    address: `${randInt(1, 400)}, ${pick(['MG Road', 'Anna Salai', 'Park Street', 'Brigade Road', 'Sector 21', 'Marine Drive', 'Tech Park Avenue'])}, ${pick(CITIES)}`,
    revenue: randFloat(500000, 45000000, 0),
    status: i < 22 ? 'Active' : pick(STATUSES),
    createdDate: daysFromNow(-randInt(30, 900)),
    tags: pickMany(['Key Account', 'High Value', 'New', 'Repeat Client', 'Enterprise', 'SMB'], randInt(1, 2)),
  }
})

export function getCompanyById(id) {
  return COMPANIES.find((c) => c.id === id)
}
