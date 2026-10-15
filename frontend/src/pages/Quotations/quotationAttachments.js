import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import mammoth from 'mammoth'
import { api } from '../../api/mockServer'
import {
  checkFileMeta, checkSignature, kindFromExtension, sanitizeFileName, sha256Hex, dataUrlToBytes, formatBytes,
} from '../../utils/quotationAttachmentRules'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const MAX_PDF_PAGES = 100

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Full client-side validation of a file picked as a quotation attachment: the shared structural
 * rules (name, extension/MIME agreement, size, file signature) plus parser-level checks that a
 * file really opens — a PDF that is corrupt, password-protected or oversized in pages, a .docx
 * that isn't a readable Word package or is blank. Throws an Error with a user-facing message;
 * resolves with the staged payload the upload endpoint takes. The mock server re-checks the
 * structural rules on write, so this is never the only line of defence.
 */
export async function validateQuotationFile(file, { activeAttachment = null } = {}) {
  if (!file) throw new Error('Choose a file to upload.')
  const metaError = checkFileMeta({ name: file.name, mimeType: file.type, size: file.size })
  if (metaError) throw new Error(metaError)
  const fileName = sanitizeFileName(file.name)
  const kind = kindFromExtension(fileName)

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const sigError = checkSignature(bytes.slice(0, 1024), kind)
  if (sigError) throw new Error(sigError)

  let pages = null
  if (kind === 'pdf') {
    try {
      // slice(): pdf.js transfers the buffer to its worker, which would detach the copy we still need.
      const task = pdfjsLib.getDocument({ data: buffer.slice(0) })
      const pdf = await task.promise
      pages = pdf.numPages
      task.destroy()
    } catch (err) {
      if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password and upload it again.')
      throw new Error('This PDF could not be opened — it may be corrupt. Re-export it and try again.')
    }
    if (!pages) throw new Error('This PDF has no pages.')
    if (pages > MAX_PDF_PAGES) throw new Error(`This PDF has ${pages} pages — the limit is ${MAX_PDF_PAGES}.`)
  } else if (kind === 'docx') {
    try {
      const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer.slice(0) })
      if (!value.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(value)) throw new Error('empty')
    } catch (err) {
      if (err?.message === 'empty') throw new Error('This Word document appears to be empty.')
      throw new Error('This Word document could not be read — it may be corrupt or password-protected. Re-save it in Word and try again.')
    }
  }

  const hash = await sha256Hex(buffer)
  if (activeAttachment && activeAttachment.hash === hash) throw new Error('This exact file is already attached to this quotation.')
  const dataUrl = await readAsDataUrl(file)
  return { fileName, mimeType: file.type || '', size: file.size, kind, hash, dataUrl, pages }
}

/** Attach a validated file to a quotation (or replace the current one). Resolves with the updated quotation. */
export function uploadQuotationAttachment(quotationId, staged, { replace = false } = {}) {
  return api
    .post(`/quotations/${quotationId}/attachments`, { fileName: staged.fileName, mimeType: staged.mimeType, hash: staged.hash, dataUrl: staged.dataUrl, replace })
    .then((res) => res.data.quotation)
}

export function removeQuotationAttachment(quotationId, attachmentId) {
  return api.delete(`/quotations/${quotationId}/attachments/${attachmentId}`).then((res) => res.data.quotation)
}

export function sendQuotationToClient(quotationId, payload) {
  return api.post(`/quotations/${quotationId}/send`, payload).then((res) => res.data)
}

export function apiErrorMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback
}

/** True only when the stored attachment really belongs to this quotation and its client — the guard behind every preview/send. */
export function isAttachmentLinked(attachment, quotation) {
  return !!attachment
    && attachment.quotationId === quotation.id
    && (attachment.companyId ?? null) === (quotation.companyId ?? null)
    && (attachment.customerId ?? null) === (quotation.customerId ?? null)
}

export function getActiveAttachment(quotation) {
  return (quotation?.attachments || []).find((a) => a.status === 'Active') || null
}

export function attachmentBlob(attachment) {
  const mime = attachment.kind === 'pdf' ? 'application/pdf' : attachment.kind === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  return new Blob([dataUrlToBytes(attachment.dataUrl)], { type: mime })
}

export function downloadAttachment(attachment) {
  const url = URL.createObjectURL(attachmentBlob(attachment))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', attachment.fileName)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * What the preview modal should show for an attachment: a PDF is shown as-is; a .docx is converted
 * to HTML (an approximation of the Word layout — the file sent to the client is the untouched
 * original); a legacy .doc can't be rendered in a browser at all.
 */
export async function buildAttachmentPreview(attachment) {
  if (attachment.kind === 'pdf') return { type: 'pdf', url: URL.createObjectURL(attachmentBlob(attachment)) }
  if (attachment.kind === 'docx') {
    const bytes = dataUrlToBytes(attachment.dataUrl)
    const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
    const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.55 Helvetica,Arial,sans-serif;color:#1f2937;margin:28px;max-width:760px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:6px}img{max-width:100%}</style>${value}`
    return { type: 'html', html }
  }
  return { type: 'none' }
}

export { formatBytes }
