import { resetSeed, pick, randInt, randFloat } from '../utils/generators'
import { SERVICES } from './constants'

resetSeed(505)

const CATEGORIES = ['Development', 'Design', 'Marketing', 'Consulting', 'Support & Maintenance', 'Infrastructure']

export const PRODUCTS = SERVICES.map((name, i) => ({
  id: `PRD-${String(i + 1).padStart(3, '0')}`,
  name,
  category: pick(CATEGORIES),
  type: i % 4 === 0 ? 'Package' : i % 5 === 0 ? 'Add-on' : 'Service',
  description: `Professional ${name.toLowerCase()} delivered by our certified specialists, tailored to your business goals.`,
  price: randFloat(15000, 500000, 0),
  billingCycle: pick(['One-time', 'Monthly', 'Quarterly', 'Annual']),
  status: randInt(0, 9) > 1 ? 'Active' : 'Inactive',
}))

export function getProductById(id) {
  return PRODUCTS.find((p) => p.id === id)
}
