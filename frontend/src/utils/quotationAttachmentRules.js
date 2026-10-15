// Validation rules for an existing quotation document (PDF / Word) attached to a quotation.
//
// Shared by BOTH sides of the mock backend boundary: the upload UI runs them first for instant
// feedback (plus deeper, parser-based checks in quotationAttachments.js), and the mock server
// re-runs the structural ones (type, size, name, signature, link integrity, duplicates) on every
// write — so an attachment that bypasses the UI still can't be stored malformed or against the
// wrong record. Pure functions, no DOM/parser dependencies, so they're safe to import anywhere.

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 // stored in the browser-backed mock DB, so kept deliberately modest
export const MAX_FILENAME_LENGTH = 150
export const MAX_ATTACHMENT_VERSIONS = 25 // history entries kept per quotation

export const ATTACHMENT_KINDS = {
  pdf: { label: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'] },
  docx: { label: 'Word (.docx)', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], extensions: ['docx'] },
  doc: { label: 'Word (.doc)', mimes: ['application/msword'], extensions: ['doc'] },
}
export const ACCEPT_ATTR = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Statuses in which the quotation's documents are frozen: the commercial outcome is already decided.
export const LOCKED_STATUSES = ['Accepted', 'Rejected', 'Expired']

const EXECUTABLE_EXT = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ps1|sh|jar|app|dll|lnk|hta|html?|svg|php)(\.|$)/i
const GENERIC_MIMES = ['', 'application/octet-stream', 'binary/octet-stream']

export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

export function kindFromExtension(name) {
  const ext = extensionOf(name)
  return Object.keys(ATTACHMENT_KINDS).find((k) => ATTACHMENT_KINDS[k].extensions.includes(ext)) || null
}

/** Strips path segments / control characters so a stored file name can never carry a path or markup. */
export function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/]+/g, '_')
    .replace(/[\u0000-\u001f<>:"|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Name / type / size rules that only need the File's own metadata. Returns an error string, or null when fine. */
export function checkFileMeta({ name, mimeType, size }) {
  const clean = sanitizeFileName(name)
  if (!clean) return 'The file has no name.'
  if (clean.length > MAX_FILENAME_LENGTH) return `The file name is too long (maximum ${MAX_FILENAME_LENGTH} characters).`
  if (EXECUTABLE_EXT.test(clean)) return 'This file name looks like an executable or web file. Only PDF and Word quotation documents are allowed.'
  const kind = kindFromExtension(clean)
  if (!kind) {
    const ext = extensionOf(clean)
    return ext ? `".${ext}" files are not allowed. Upload a PDF or Word (.doc / .docx) quotation.` : 'The file has no extension. Upload a PDF or Word (.doc / .docx) quotation.'
  }
  const mime = String(mimeType || '').toLowerCase()
  if (!GENERIC_MIMES.includes(mime) && !ATTACHMENT_KINDS[kind].mimes.includes(mime)) {
    return `The file's content type (${mime}) does not match its ".${extensionOf(clean)}" extension. Rename-only conversions are not accepted — re-save the document in the right format.`
  }
  if (!size || size <= 0) return 'The file is empty.'
  if (size > MAX_ATTACHMENT_BYTES) return `The file is too large (${(size / 1048576).toFixed(1)} MB). The maximum size is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`
  return null
}

/** The file's leading bytes must match its claimed format — catches a renamed .exe/.png/.txt masquerading as a PDF or Word file. */
export function checkSignature(bytes, kind) {
  const startsWith = (sig) => sig.every((b, i) => bytes[i] === b)
  if (kind === 'pdf') {
    // The %PDF- header may legally be preceded by a few junk bytes; scan the first 1 KiB like readers do.
    const head = String.fromCharCode(...Array.from(bytes.slice(0, 1024)))
    return head.includes('%PDF-') ? null : 'This file is not a valid PDF (missing PDF header).'
  }
  if (kind === 'docx') return startsWith([0x50, 0x4b, 0x03, 0x04]) ? null : 'This file is not a valid .docx document (it is not a Word package).'
  if (kind === 'doc') return startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ? null : 'This file is not a valid .doc document (it is not a Word 97-2003 file).'
  return 'Unsupported document type.'
}

export function dataUrlToBytes(dataUrl, max = Infinity) {
  const base64 = String(dataUrl || '').split(',')[1] || ''
  const slice = Number.isFinite(max) ? base64.slice(0, Math.ceil((max * 4) / 3) + 4) : base64
  const bin = atob(slice)
  const out = new Uint8Array(Math.min(bin.length, max))
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Approximate decoded byte length of a base64 data URL — never trust the client-declared `size`. */
export function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || ''
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - pad
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
