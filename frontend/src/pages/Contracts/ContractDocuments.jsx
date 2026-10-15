import { DocumentsPanel } from '../Documents/DocumentsPanel'
import { uploadDocument } from '../Documents/documentClient'

/**
 * Stores a generated contract PDF as a central document linked to the contract (and, through it, the customer, company, deal, order and project).
 * It goes through the same validated upload endpoint as any other file.
 */
export async function saveContractDocument(contract, { name, dataUrl, note = '', source = 'upload', templateId = null, category = 'Contracts' }) {
  const blob = await (await fetch(dataUrl)).blob()
  const file = new File([blob], name, { type: blob.type || 'application/pdf' })
  return uploadDocument(file, { relatedType: 'Contract', relatedId: contract.id, category, categoryFallback: 'Other', kind: 'Contract', note, source, templateId, subCategory: 'Draft Contract' })
}

/**
 * Contract → Documents. Same central records as the Documents module: versions, replace protection (a signed or active contract needs a reason and
 * confirmation — enforced by the document API), sharing and audit all live there.
 */
export function ContractDocuments({ contract, perms }) {
  return <DocumentsPanel relatedType="Contract" relatedId={contract.id} defaultCategory="Contracts" canUploadHere={!!perms?.uploadDocuments} uploadHint="Files uploaded here are linked to this contract, its customer, company, deal, order and project." />
}
