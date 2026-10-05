// The HTML representation a CRM field takes once embedded inside a docx-derived template's
// editable content (see PageDesigner.jsx for insertion, quotationPdf.js's
// buildFromDocxContent() for how these are read back out and resolved to real quotation data).
// A single, shared vocabulary so the editor and the PDF generator can never disagree on what a
// token looks like. Inline fields (client name, GSTIN, payment terms, …) sit directly inside a
// sentence; region fields (the items table, the totals block) are their own block-level markers
// since they occupy real vertical space rather than a short run of text.
import { QUOTATION_TEMPLATE_FIELDS } from '../../data/constants'
import { PROPOSAL_TEMPLATE_FIELDS } from '../../utils/proposalCalc'

export const FIELD_TOKEN_CLASS = 'crm-field-token'

// Extra tokens that only make sense inside a header/footer (resolved per page at PDF time).
export const BAND_FIELDS = [
  { key: 'pageNumber', label: 'Page Number', sample: '1' },
  { key: 'pageCount', label: 'Total Pages', sample: '2' },
]

/** Fields offered in a header/footer: every inline quotation field plus page tokens (the items table / totals block are body-only regions). */
export const BAND_FIELD_OPTIONS = [...QUOTATION_TEMPLATE_FIELDS.filter((f) => !f.isRegion), ...BAND_FIELDS]

export function fieldDef(key) {
  return QUOTATION_TEMPLATE_FIELDS.find((f) => f.key === key) || BAND_FIELDS.find((f) => f.key === key) || PROPOSAL_TEMPLATE_FIELDS.find((f) => f.key === key) || null
}

/** The exact HTML to insert at the cursor when a user picks a field from the toolbar. */
export function buildFieldTokenHtml(key) {
  const def = fieldDef(key)
  if (!def) return ''
  const label = def.label
  if (def.isRegion) {
    return `<div class="${FIELD_TOKEN_CLASS}" data-field="${key}" contenteditable="false" style="margin:8px 0;padding:10px;border:1px dashed #a855f7;border-radius:6px;background:#faf5ff;color:#7e22ce;font-size:12px;font-weight:600;text-align:center;">[${label}]</div>`
  }
  return `<span class="${FIELD_TOKEN_CLASS}" data-field="${key}" contenteditable="false" style="display:inline-block;padding:1px 6px;border-radius:4px;background:#f3e8ff;color:#7e22ce;font-size:0.92em;font-weight:600;">{{${label}}}</span>`
}

/** Every field key currently present anywhere in a template's content — used to check "is this required field actually placed somewhere" the same way the position-mapped PDF/image templates check their `fields` array. */
export function extractFieldKeysFromHtml(html) {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll(`[data-field]`)).map((el) => el.getAttribute('data-field'))
}
