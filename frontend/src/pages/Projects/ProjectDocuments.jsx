import { DocumentsPanel } from '../Documents/DocumentsPanel'

/** A project's documents are the central document records linked to it (and to its customer, contracts and orders) — see DocumentsPanel. */
export function ProjectDocuments({ project, perms }) {
  return <DocumentsPanel relatedType="Project" relatedId={project.id} defaultCategory="Project Documents" canUploadHere={!!perms?.uploadDocuments} />
}
