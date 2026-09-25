import { resetSeed, pick, randInt, randFloat, daysFromNow } from '../utils/generators'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES } from './constants'
import { CAMPAIGN_NAMES } from './campaignNames'

resetSeed(1616)

export const CAMPAIGNS = CAMPAIGN_NAMES.map((name, i) => {
  const budget = randInt(20000, 800000)
  const leadsGenerated = randInt(30, 600)
  const qualifiedLeads = Math.round(leadsGenerated * randFloat(0.2, 0.55, 2))
  const customersWon = Math.round(qualifiedLeads * randFloat(0.1, 0.35, 2))
  const revenue = customersWon * randInt(80000, 600000)
  return {
    id: `CMP-${String(13000 + i)}`,
    name,
    channel: pick(CAMPAIGN_CHANNELS),
    budget,
    startDate: daysFromNow(-randInt(10, 180)),
    endDate: daysFromNow(randInt(-30, 60)),
    leadsGenerated,
    qualifiedLeads,
    customersWon,
    revenue,
    roi: budget > 0 ? Math.round(((revenue - budget) / budget) * 100) : 0,
    status: i < 2 ? 'Planned' : pick(CAMPAIGN_STATUSES),
  }
})

export function getCampaignById(id) {
  return CAMPAIGNS.find((c) => c.id === id)
}
