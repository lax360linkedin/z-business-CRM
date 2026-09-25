import { resetSeed, randInt, randFloat } from '../utils/generators'

resetSeed(3030)

const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']

export const MONTHLY_PERFORMANCE = MONTHS.map((month, i) => {
  const base = 1800000 + i * 140000
  const revenue = Math.round(base * randFloat(0.85, 1.18, 2))
  const target = Math.round(base * 1.05)
  return {
    month,
    revenue,
    target,
    deals: randInt(8, 26),
    leads: randInt(60, 160),
    customers: 120 + i * randInt(4, 12),
  }
})
