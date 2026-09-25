import { resetSeed, pick, randInt, randFloat, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { PROJECTS, projectsByCustomer } from './projects'
import { CONTRACT_STATUSES } from './constants'

resetSeed(1111)

export const CONTRACTS = Array.from({ length: 16 }).map((_, i) => {
  const customer = pick(CUSTOMERS)
  const projects = projectsByCustomer(customer.id)
  const project = projects.length ? pick(projects) : pick(PROJECTS)
  const start = daysFromNow(-randInt(30, 400))
  const end = daysFromNow(randInt(-20, 300))
  const status = i < 2 ? 'Draft' : pick(CONTRACT_STATUSES)
  return {
    id: `CN-${String(7000 + i)}`,
    number: `CNT-2026-${String(7000 + i)}`,
    customerId: customer.id,
    customerName: customer.name,
    projectId: project?.id ?? null,
    value: randFloat(200000, 6000000, 0),
    startDate: start,
    endDate: end,
    renewalDate: daysFromNow(randInt(-15, 60)),
    status,
  }
})

export function getContractById(id) {
  return CONTRACTS.find((c) => c.id === id)
}
