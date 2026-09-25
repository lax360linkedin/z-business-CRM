// Page-local config store for "Lead Sources" (Settings → Lead Sources) — persisted to
// localStorage since there is no dedicated backend/mock-API resource for this. Seeded from the
// canonical LEAD_SOURCES list with honest defaults: a source is only ever marked `connected`
// when this frontend-only build can genuinely originate a lead from it without pretending to
// talk to a real external API (see captureLead() in src/pages/Leads/leadCaptureService.js and
// the spec's "do NOT fake a successful external integration" requirement). Sources that would
// need a real ad-platform/webhook integration (Google, Facebook, Instagram, LinkedIn, WhatsApp,
// Campaign, API/Integration) are seeded `connected: false` — "Not Connected" — until a real
// backend exists to wire them up.
const STORAGE_KEY = 'business_crm_lead_sources_v2'

function pad(n) {
  return String(n).padStart(3, '0')
}

// name → { sourceType, captureMethod, connected }
const SOURCE_DEFAULTS = {
  Website: { sourceType: 'Digital', captureMethod: 'Form', connected: true },
  'Contact Form': { sourceType: 'Digital', captureMethod: 'Form', connected: true },
  Google: { sourceType: 'Digital', captureMethod: 'API', connected: false },
  Facebook: { sourceType: 'Digital', captureMethod: 'API', connected: false },
  Instagram: { sourceType: 'Digital', captureMethod: 'API', connected: false },
  LinkedIn: { sourceType: 'Digital', captureMethod: 'API', connected: false },
  WhatsApp: { sourceType: 'Digital', captureMethod: 'Webhook', connected: false },
  Phone: { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  Email: { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  Referral: { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  'Walk-in': { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  Campaign: { sourceType: 'Digital', captureMethod: 'Webhook', connected: false },
  Advertisement: { sourceType: 'Digital', captureMethod: 'API', connected: false },
  Partner: { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  'Manual Entry': { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  Import: { sourceType: 'Offline', captureMethod: 'Manual', connected: true },
  'API / Integration': { sourceType: 'Integration', captureMethod: 'API', connected: false },
}
const DEFAULT_FALLBACK = { sourceType: 'Digital', captureMethod: 'Manual', connected: false }

export function getLeadSourceConfig(seedNames = []) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {
    // fall through to reseed
  }
  const seeded = seedNames.map((name, i) => {
    const defaults = SOURCE_DEFAULTS[name] || DEFAULT_FALLBACK
    return {
      id: `LS-${pad(i + 1)}`,
      name,
      active: true,
      createdDate: new Date().toISOString().slice(0, 10),
      ...defaults,
    }
  })
  saveLeadSourceConfig(seeded)
  return seeded
}

export function saveLeadSourceConfig(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  return list
}
