import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { EXPENSE_CATEGORIES } from './constants'
import { USERS } from './users'
import { PROJECTS } from './projects'

resetSeed(1515)

const EXPENSE_NAMES = {
  Travel: ['Client site visit', 'Sales trip airfare', 'Team offsite travel'],
  'Software & Tools': ['SaaS subscription renewal', 'Design tool license', 'Cloud hosting bill'],
  'Office Supplies': ['Stationery purchase', 'Office furniture', 'Printer cartridges'],
  Marketing: ['Ad campaign spend', 'Event sponsorship', 'Content production'],
  Utilities: ['Internet bill', 'Electricity bill', 'Office rent'],
  'Client Entertainment': ['Client dinner', 'Client gift hampers'],
  Training: ['Team certification course', 'Workshop registration'],
  Other: ['Miscellaneous expense', 'Courier charges'],
}

export const EXPENSES = Array.from({ length: 26 }).map((_, i) => {
  const category = pick(EXPENSE_CATEGORIES)
  const project = pick(PROJECTS)
  return {
    id: `EXP-${String(12000 + i)}`,
    title: pick(EXPENSE_NAMES[category]),
    category,
    amount: randInt(1500, 180000),
    date: daysFromNow(-randInt(0, 200)),
    employee: pick(USERS).id,
    projectId: pick([project.id, null, null]),
    status: i < 3 ? 'Pending' : pick(['Approved', 'Pending', 'Rejected']),
  }
})

export function getExpenseById(id) {
  return EXPENSES.find((e) => e.id === id)
}
