import { resetSeed, pick, randInt, daysFromNow } from '../utils/generators'
import { CUSTOMERS } from './customers'
import { DOCUMENT_CATEGORIES } from './constants'
import { USERS } from './users'

resetSeed(1212)

const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'zip']
const NAME_BY_CATEGORY = {
  Contracts: ['Master Service Agreement', 'NDA', 'Statement of Work', 'Renewal Contract'],
  Proposals: ['Project Proposal', 'Technical Proposal', 'Commercial Proposal'],
  Quotations: ['Price Quotation', 'Revised Quotation'],
  Invoices: ['Tax Invoice', 'Proforma Invoice'],
  'Project Files': ['Requirements Document', 'Architecture Diagram', 'Sprint Report', 'UAT Checklist'],
  'Client Documents': ['GST Certificate', 'Company PAN Card', 'Authorization Letter'],
  Other: ['Meeting Notes', 'Onboarding Checklist', 'Miscellaneous'],
}

export const DOCUMENTS = Array.from({ length: 34 }).map((_, i) => {
  const category = pick(DOCUMENT_CATEGORIES)
  const customer = pick(CUSTOMERS)
  const fileType = pick(FILE_TYPES)
  const baseName = pick(NAME_BY_CATEGORY[category])
  return {
    id: `DOC-${String(8000 + i)}`,
    name: `${baseName} — ${customer.name}.${fileType}`,
    category,
    fileType,
    sizeKb: randInt(80, 8200),
    relatedTo: customer.name,
    relatedCustomerId: customer.id,
    uploadedBy: pick(USERS).id,
    uploadedDate: daysFromNow(-randInt(0, 300)),
  }
})

export function getDocumentById(id) {
  return DOCUMENTS.find((d) => d.id === id)
}
