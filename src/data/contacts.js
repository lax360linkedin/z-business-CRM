import { resetSeed, personName, pick, pickMany, phoneNumber, companyEmail, daysFromNow, initials, avatarColor } from '../utils/generators'
import { COMPANIES } from './companies'

resetSeed(202)

const DESIGNATIONS = ['CEO', 'CTO', 'CFO', 'VP Sales', 'Procurement Head', 'Operations Manager', 'HR Manager', 'Marketing Head', 'IT Manager', 'Founder']
const GROUPS = ['Decision Maker', 'Influencer', 'Technical Contact', 'Billing Contact', 'Primary Contact']

export const CONTACTS = Array.from({ length: 40 }).map((_, i) => {
  const company = pick(COMPANIES)
  const name = personName()
  return {
    id: `CT-${String(i + 1).padStart(4, '0')}`,
    name,
    designation: pick(DESIGNATIONS),
    email: companyEmail(company.name, name),
    phone: phoneNumber(),
    whatsapp: phoneNumber(),
    companyId: company.id,
    companyName: company.name,
    groups: pickMany(GROUPS, 2),
    createdDate: daysFromNow(-Math.floor(Math.random() * 500)),
    nextFollowUp: null,
    lastContactedDate: null,
    notes: '',
    initials: initials(name),
    avatarColor: avatarColor(name),
  }
})

export function getContactById(id) {
  return CONTACTS.find((c) => c.id === id)
}
export function contactsByCompany(companyId) {
  return CONTACTS.filter((c) => c.companyId === companyId)
}
