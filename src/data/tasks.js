import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { TASK_STATUSES, PRIORITIES } from './constants'
import { LEADS } from './leads'
import { DEALS } from './deals'
import { PROJECTS } from './projects'
import { USERS } from './users'

resetSeed(1919)

const TASK_TITLES = [
  'Send follow-up email', 'Prepare quotation', 'Schedule demo call', 'Review contract terms',
  'Update CRM notes', 'Coordinate internal kickoff', 'Collect client documents', 'Confirm payment receipt',
  'Prepare project status report', 'Follow up on overdue invoice', 'Schedule renewal discussion', 'Draft proposal document',
]

function relatedEntity(i) {
  const pool = [
    ...LEADS.slice(0, 20).map((l) => ({ type: 'Lead', id: l.id, name: l.name })),
    ...DEALS.slice(0, 15).map((d) => ({ type: 'Deal', id: d.id, name: d.name })),
    ...PROJECTS.slice(0, 10).map((p) => ({ type: 'Project', id: p.id, name: p.name })),
  ]
  return pool[i % pool.length]
}

export const TASKS = Array.from({ length: 34 }).map((_, i) => {
  const related = relatedEntity(i)
  const status = i < 5 ? 'Pending' : pick(TASK_STATUSES)
  return {
    id: `TSK-${String(16000 + i)}`,
    title: pick(TASK_TITLES),
    relatedType: related.type,
    relatedId: related.id,
    relatedName: related.name,
    assignedTo: pick(USERS).id,
    priority: pick(PRIORITIES),
    dueDate: daysFromNow(randInt(-10, 30)),
    status,
    description: `${pick(TASK_TITLES)} for ${related.name} and update the record accordingly.`,
  }
})

export function getTaskById(id) {
  return TASKS.find((t) => t.id === id)
}
