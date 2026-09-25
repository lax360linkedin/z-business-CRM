import { resetSeed, pick, pickMany, randInt, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { SERVICES, PROJECT_STATUSES } from './constants'
import { projectManagers, salesUsers, USERS } from './users'

resetSeed(1010)
const pms = projectManagers()

export const PROJECTS = Array.from({ length: 22 }).map((_, i) => {
  const customer = pick(CUSTOMERS)
  const status = i < 3 ? 'Not Started' : pick(PROJECT_STATUSES)
  const progress = status === 'Completed' ? 100 : status === 'Not Started' ? 0 : randInt(10, 90)
  const start = daysFromNow(-randInt(10, 180))
  return {
    id: `PRJ-${String(6000 + i)}`,
    name: `${pick(SERVICES)} — ${customer.name}`,
    customerId: customer.id,
    customerName: customer.name,
    manager: pick(pms).id,
    team: pickMany(USERS.map((u) => u.id), randInt(2, 5)),
    startDate: start,
    deadline: daysFromNow(randInt(15, 150)),
    progress,
    status,
    budget: randInt(150000, 5000000),
    milestones: [
      { name: 'Discovery & Planning', dueDate: daysFromNow(-randInt(0, 40)), status: 'Completed' },
      { name: 'Design & Architecture', dueDate: daysFromNow(randInt(-10, 20)), status: progress > 30 ? 'Completed' : 'In Progress' },
      { name: 'Development', dueDate: daysFromNow(randInt(10, 60)), status: progress > 60 ? 'Completed' : progress > 30 ? 'In Progress' : 'Pending' },
      { name: 'Testing & QA', dueDate: daysFromNow(randInt(40, 90)), status: progress > 85 ? 'Completed' : 'Pending' },
      { name: 'Go Live', dueDate: daysFromNow(randInt(60, 120)), status: progress >= 100 ? 'Completed' : 'Pending' },
    ],
  }
})

export function getProjectById(id) {
  return PROJECTS.find((p) => p.id === id)
}
export function projectsByCustomer(customerId) {
  return PROJECTS.filter((p) => p.customerId === customerId)
}
