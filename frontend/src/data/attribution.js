import { USERS } from './users'

// Optional "where did this come from" details on an enquiry or lead. None of them is required, and the server owns the source category and how the record was created.
export const ATTRIBUTION_TEXT = [
  ['landingPage', 'Landing page / form name'], ['adName', 'Ad name'], ['adId', 'Ad ID'],
  ['utmSource', 'UTM source'], ['utmMedium', 'UTM medium'], ['utmCampaign', 'UTM campaign'], ['utmContent', 'UTM content'],
]

/** Active people who can be named as the referring employee (the server only accepts someone from the record's own branch). */
export const referrers = () => USERS.filter((u) => u.status === 'Active').map((u) => ({ value: u.id, label: u.branch ? `${u.name} (${u.branch})` : u.name }))

/** The same fields as a FormModal schema. */
export const attributionFormFields = () => [
  { type: 'heading', name: 'attributionHeading', label: 'Source details (optional)' },
  ...ATTRIBUTION_TEXT.map(([name, label]) => ({ name, label, span: 1 })),
  { name: 'referringEmployeeId', label: 'Referring employee', type: 'select', options: referrers(), span: 1, blank: 'None' },
]
