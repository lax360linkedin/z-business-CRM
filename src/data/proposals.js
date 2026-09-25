import { resetSeed, pick, randInt, randFloat, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { SERVICES, PROPOSAL_STATUSES } from './constants'
import { salesUsers } from './users'

resetSeed(909)
const reps = salesUsers()

export const PROPOSALS = Array.from({ length: 18 }).map((_, i) => {
  const customer = pick(CUSTOMERS)
  const service = pick(SERVICES)
  return {
    id: `PRP-${String(5000 + i)}`,
    title: `${service} Proposal — ${customer.name}`,
    customerId: customer.id,
    customerName: customer.name,
    service,
    value: randFloat(100000, 4000000, 0),
    sections: [
      { heading: 'Executive Summary', body: `This proposal outlines our recommended approach to deliver ${service.toLowerCase()} for ${customer.name}, aligned with your growth objectives and timeline.` },
      { heading: 'Scope of Work', body: `Discovery, design, implementation, testing and go-live support for ${service.toLowerCase()}, delivered by a dedicated project team.` },
      { heading: 'Timeline', body: `Estimated delivery within ${pick([4, 6, 8, 10, 12])} weeks from kickoff, in ${pick([2, 3, 4])} milestone-based phases.` },
      { heading: 'Investment', body: 'Detailed pricing is available in the attached commercial quotation.' },
    ],
    assignedTo: pick(reps).id,
    createdDate: daysFromNow(-randInt(1, 100)),
    validUntil: daysFromNow(randInt(-5, 30)),
    status: i < 2 ? 'Draft' : pick(PROPOSAL_STATUSES),
  }
})

export function getProposalById(id) {
  return PROPOSALS.find((p) => p.id === id)
}
