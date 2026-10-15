import { live } from '../api/store'

// Leads come from the server (see api/store.js); only the per-source detail options - a fixed lookup - live here.
export const LEADS = live('leads')
export const getLeadById = (id) => LEADS.find((l) => l.id === id)

// Sub-detail options per capture source (kept as a lookup rather than free text so every lead from the same channel is described the same way).
export const SOURCE_DETAILS = {
  Website: ['Contact Form', 'Chat Widget', 'Pricing Page Form'],
  'Contact Form': ['Homepage Form', 'Product Page Form'],
  Google: ['Google Ads', 'Organic Search'],
  Facebook: ['Lead Ad', 'Page Message', 'Comment Reply'],
  Instagram: ['Lead Ad', 'DM', 'Story Reply'],
  LinkedIn: ['InMail', 'Company Page', 'Sponsored Content'],
  WhatsApp: ['Business Chat', 'Click-to-WhatsApp Ad'],
  Referral: ['Existing Customer', 'Partner Referral'],
  Phone: ['Inbound Call'],
  Email: ['Inbound Email'],
  'Walk-in': ['Office Visit'],
  Campaign: ['Email Campaign', 'SMS Campaign'],
  'Manual Entry': ['Entered by Sales Team'],
  Import: ['CSV Import'],
}
