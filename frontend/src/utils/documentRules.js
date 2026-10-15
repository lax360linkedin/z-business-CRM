// Shared rules for the Documents module: configuration defaults, file validation and the permission model.
// Pure functions only (no storage, no React) — the same file checks run in the browser before upload (for fast feedback) and again in the
// mock API (src/api/documentApi.js), which is the enforcement point: nothing the browser says about a file is trusted there.

// ---- categories -----------------------------------------------------------------------------------------------------
export const DEFAULT_CATEGORY_NAMES = ['Contracts', 'Agreements', 'Proposals', 'Quotations', 'Sales Orders', 'Invoices', 'Receipts', 'Bills & Vendor Invoices', 'HR Documents', 'Project Documents', 'Customer Documents', 'KYC / Business Documents', 'Technical Documents', 'Legal Documents', 'Internal Documents', 'Reports', 'Other']
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const DEFAULT_CATEGORIES = DEFAULT_CATEGORY_NAMES.map((name) => ({ id: `CAT-${slug(name)}`, name, active: true, system: name === 'Other' }))
/** Old category names written by earlier modules → the configurable set. */
export const LEGACY_CATEGORY_MAP = {
  'Project Files': 'Project Documents', 'Client Documents': 'Customer Documents', 'Signed Contract': 'Contracts', 'Draft Contract': 'Contracts', Amendment: 'Agreements', 'Annexure / SOW': 'Agreements', NDA: 'Legal Documents',
  Contract: 'Contracts', Invoice: 'Invoices', Quotation: 'Quotations', Proposal: 'Proposals', 'Sales Order': 'Sales Orders', General: 'Other',
}

// ---- file types -----------------------------------------------------------------------------------------------------
export const FILE_TYPES = {
  pdf: { label: 'PDF', mimes: ['application/pdf'], family: 'pdf', previewable: true },
  doc: { label: 'Word (legacy)', mimes: ['application/msword'], family: 'word', previewable: false },
  docx: { label: 'Word', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], family: 'word', previewable: false },
  xls: { label: 'Excel (legacy)', mimes: ['application/vnd.ms-excel'], family: 'excel', previewable: false },
  xlsx: { label: 'Excel', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], family: 'excel', previewable: false },
  csv: { label: 'CSV', mimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'], family: 'excel', previewable: true },
  ppt: { label: 'PowerPoint (legacy)', mimes: ['application/vnd.ms-powerpoint'], family: 'slides', previewable: false },
  pptx: { label: 'PowerPoint', mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], family: 'slides', previewable: false },
  jpg: { label: 'JPEG image', mimes: ['image/jpeg'], family: 'image', previewable: true },
  jpeg: { label: 'JPEG image', mimes: ['image/jpeg'], family: 'image', previewable: true },
  png: { label: 'PNG image', mimes: ['image/png'], family: 'image', previewable: true },
  webp: { label: 'WebP image', mimes: ['image/webp'], family: 'image', previewable: true },
}
export const ALL_EXTENSIONS = Object.keys(FILE_TYPES)
export const FAMILY_LABEL = { pdf: 'PDF', word: 'Word', excel: 'Spreadsheet', slides: 'Presentation', image: 'Image' }
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1] || '').toLowerCase()
export const familyOf = (ext) => FILE_TYPES[ext]?.family || 'other'
export const mimeFor = (ext) => FILE_TYPES[ext]?.mimes[0] || 'application/octet-stream'

export const VISIBILITIES = ['Private', 'Assigned User', 'Team', 'Department', 'Related CRM Users', 'Organization', 'Confidential']
export const VISIBILITY_HELP = {
  Private: 'Only the uploader (and administrators with full access).',
  'Assigned User': 'The uploader and the user the document is assigned to.',
  Team: 'The uploader’s team (colleagues in the same department).',
  Department: 'Everyone in the uploader’s department.',
  'Related CRM Users': 'Anyone who can open the CRM record the document belongs to.',
  Organization: 'Everyone who can view documents.',
  Confidential: 'Only the uploader, people it is explicitly shared with, and roles cleared for confidential documents.',
}
export const DOC_STATUSES = ['Active', 'Archived', 'Deleted']

export const DEFAULT_DOC_CONFIG = {
  categories: DEFAULT_CATEGORIES,
  allowedExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'webp'],
  maxSizeMb: 10,
  maxFilesPerUpload: 10,
  retentionDays: 30,
  defaultVisibility: 'Related CRM Users',
  maxVersions: 50,
  reviewWarnDays: 14,
  shareMaxDays: 90,
}

// ---- file name ------------------------------------------------------------------------------------------------------
const DANGEROUS_EXT = new Set(['exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'js', 'jse', 'mjs', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'php', 'phtml', 'jsp', 'asp', 'aspx', 'cgi', 'jar', 'war', 'py', 'pl', 'rb', 'hta', 'lnk', 'reg', 'html', 'htm', 'xhtml', 'svg', 'xml', 'swf', 'apk', 'app', 'bin', 'dmg', 'iso', 'inf', 'gadget', 'docm', 'xlsm', 'pptm', 'dotm', 'xlam', 'zip', 'rar', '7z', 'gz', 'tar', 'cab', 'sys', 'drv', 'ocx', 'cpl'])
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** A safe display/storage name: no directories, control characters, reserved characters or dangerous double extensions. Returns '' if nothing usable is left. */
export function sanitizeFileName(name) {
  let n = String(name ?? '').normalize('NFKC')
  n = n.split(/[\\/]/).pop()
  n = n.replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').replace(/^[.\s]+|[.\s]+$/g, '')
  if (n.length > 150) { const e = extOf(n); n = `${n.slice(0, 140 - (e ? e.length : 0))}${e ? `.${e}` : ''}` }
  return n
}
/** Reasons a *submitted* name is unacceptable (as opposed to merely tidied up): traversal, separators, reserved names, dangerous extensions anywhere in the name. */
export function fileNameProblems(raw) {
  const problems = []
  const s = String(raw ?? '')
  if (/[\\/]/.test(s) || /(^|[\\/])\.\.($|[\\/])/.test(s) || s.includes('\u0000')) problems.push('The file name contains a path or traversal sequence.')
  const clean = sanitizeFileName(s)
  if (!clean) { problems.push('The file name is empty or unusable.'); return problems }
  const base = clean.replace(/\.[^.]*$/, '')
  if (RESERVED.test(base)) problems.push('That file name is reserved by the operating system.')
  const parts = clean.split('.').slice(1).map((p) => p.toLowerCase())
  const bad = parts.find((p) => DANGEROUS_EXT.has(p))
  if (bad) problems.push(`Files with the “.${bad}” extension are not allowed (including as part of a double extension).`)
  return problems
}

// ---- content checks -------------------------------------------------------------------------------------------------
const startsWith = (u8, sig, at = 0) => sig.every((b, i) => u8[at + i] === b)
const latin1 = (u8) => { let s = ''; const step = 0x8000; for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step)); return s }
const utf16 = (s) => s.split('').join('\u0000') + '\u0000'

/** File names inside a ZIP-based (OOXML) package, read from the central directory; null if the archive is damaged. */
export function zipEntryNames(u8) {
  if (u8.length < 22) return null
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i -= 1) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break } }
  if (eocd < 0) return null
  const count = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  if (cdOffset + cdSize > eocd) return null
  const names = []
  let p = cdOffset
  const dec = new TextDecoder('utf-8')
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) return null
    const nl = dv.getUint16(p + 28, true); const el = dv.getUint16(p + 30, true); const cl = dv.getUint16(p + 32, true)
    if (p + 46 + nl > u8.length) return null
    names.push(dec.decode(u8.subarray(p + 46, p + 46 + nl)))
    p += 46 + nl + el + cl
  }
  return names
}

const EXEC_MAGIC = [
  [[0x4d, 0x5a], 'a Windows executable'], [[0x7f, 0x45, 0x4c, 0x46], 'a Linux executable'], [[0xca, 0xfe, 0xba, 0xbe], 'a Java/Mach-O binary'], [[0xcf, 0xfa, 0xed, 0xfe], 'a macOS executable'],
  [[0x23, 0x21], 'a script'], [[0x4d, 0x53, 0x43, 0x46], 'a cabinet archive'], [[0x52, 0x61, 0x72, 0x21], 'a RAR archive'], [[0x37, 0x7a, 0xbc, 0xaf], 'a 7-Zip archive'], [[0x1f, 0x8b], 'a compressed archive'],
]
const SCRIPT_RE = /<\s*script\b|<\?php|<%@|javascript\s*:|<\s*iframe\b|<\s*object\b|<\s*embed\b/i

function checkSignature(ext, u8, bytesText) {
  const fail = (m) => m
  if (ext === 'pdf') {
    if (!startsWith(u8, [0x25, 0x50, 0x44, 0x46, 0x2d])) return fail('The content is not a PDF (missing the %PDF header).')
    const tail = latin1(u8.subarray(Math.max(0, u8.length - 2048)))
    if (!tail.includes('%%EOF')) return fail('The PDF is truncated or corrupted (no end-of-file marker).')
    if (/\/(JavaScript|JS|Launch|OpenAction)\b/.test(bytesText())) return fail('The PDF contains active content (scripts or launch actions), which is not allowed.')
    return ''
  }
  if (ext === 'png') {
    if (!startsWith(u8, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return fail('The content is not a PNG image.')
    if (!latin1(u8.subarray(Math.max(0, u8.length - 32))).includes('IEND')) return fail('The PNG is truncated or corrupted.')
    return ''
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    if (!startsWith(u8, [0xff, 0xd8, 0xff])) return fail('The content is not a JPEG image.')
    let end = u8.length
    while (end > 2 && u8[end - 1] === 0) end -= 1
    if (!(u8[end - 2] === 0xff && u8[end - 1] === 0xd9)) return fail('The JPEG is truncated or corrupted.')
    return ''
  }
  if (ext === 'webp') {
    if (!(startsWith(u8, [0x52, 0x49, 0x46, 0x46]) && startsWith(u8, [0x57, 0x45, 0x42, 0x50], 8))) return fail('The content is not a WebP image.')
    const declared = (u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24)) >>> 0
    if (declared + 8 > u8.length) return fail('The WebP image is truncated or corrupted.')
    return ''
  }
  if (['doc', 'xls', 'ppt'].includes(ext)) {
    if (!startsWith(u8, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return fail(`The content is not a genuine .${ext} file.`)
    const text = bytesText()
    const want = { doc: 'WordDocument', xls: 'Workbook', ppt: 'PowerPoint Document' }[ext]
    const alt = ext === 'xls' ? 'Book' : null
    if (!text.includes(utf16(want)) && !(alt && text.includes(utf16(alt)))) return fail(`The file is an Office container but not a .${ext} document.`)
    if (text.includes(utf16('_VBA_PROJECT'))) return fail('The document contains macros, which are not allowed.')
    return ''
  }
  if (['docx', 'xlsx', 'pptx'].includes(ext)) {
    if (!startsWith(u8, [0x50, 0x4b, 0x03, 0x04])) return fail(`The content is not a genuine .${ext} file.`)
    const names = zipEntryNames(u8)
    if (!names) return fail(`The .${ext} file is corrupted (damaged archive).`)
    if (!names.includes('[Content_Types].xml')) return fail(`The .${ext} file is not a valid Office document.`)
    const dir = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' }[ext]
    if (!names.some((n) => n.startsWith(dir))) return fail(`The file is a ZIP package but not a .${ext} document.`)
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) return fail('The document contains macros, which are not allowed.')
    if (names.some((n) => /\.(exe|dll|bat|cmd|com|scr|js|vbs|ps1|msi|jar)$/i.test(n)) || names.some((n) => /(^|\/)\.\.(\/|$)/.test(n) || n.startsWith('/'))) return fail('The document contains an embedded executable or an unsafe path.')
    return ''
  }
  if (ext === 'csv') {
    if (u8.includes(0)) return fail('The CSV contains binary data.')
    try { new TextDecoder('utf-8', { fatal: true }).decode(u8) } catch { return fail('The CSV is not valid UTF-8 text.') }
    if (/(^|[\r\n,;"])\s*=\s*(cmd|powershell|msexcel|dde)\s*\|/i.test(bytesText())) return fail('The CSV contains a command-execution formula.')
    return ''
  }
  return fail('Unsupported file type.')
}

/**
 * Validates one file. `bytes` is the real content. Returns { ok, errors, name, ext, mime, family }.
 * Never trusts the declared MIME type or extension on its own: the extension must be allowed, the declared type must agree with it,
 * the content signature must match the extension, empty/truncated/corrupt files, executables, macros and active content are rejected.
 */
export function validateFileContent({ name, mime, bytes, size }, config = DEFAULT_DOC_CONFIG) {
  const errors = []
  const raw = String(name ?? '')
  fileNameProblems(raw).forEach((p) => errors.push(p))
  const clean = sanitizeFileName(raw)
  const ext = extOf(clean)
  const bytesLen = bytes ? bytes.length : Number(size) || 0
  if (!bytes || bytesLen === 0) errors.push('The file is empty.')
  if (!ext) errors.push('The file has no extension.')
  else if (!FILE_TYPES[ext]) errors.push(`.${ext} files are not supported.`)
  else if (!config.allowedExtensions.includes(ext)) errors.push(`.${ext} files are not allowed by your organisation’s settings.`)
  const max = (Number(config.maxSizeMb) || 10) * 1024 * 1024
  if (bytesLen > max) errors.push(`The file is ${(bytesLen / 1048576).toFixed(1)} MB — the limit is ${config.maxSizeMb} MB.`)
  if (declaredMimeBad(ext, mime)) errors.push(`The declared type (${mime}) does not match a .${ext} file.`)
  if (bytes && bytesLen > 0 && FILE_TYPES[ext] && !errors.some((e) => /too large|MB —/.test(e))) {
    let cached
    const text = () => (cached ??= latin1(bytes))
    const head = bytes.subarray(0, 1024)
    const exec = EXEC_MAGIC.find(([sig]) => startsWith(head, sig))
    if (exec && !(ext === 'docx' || ext === 'xlsx' || ext === 'pptx')) errors.push(`The content is ${exec[1]}, not a ${ext.toUpperCase()} document.`)
    else {
      const sigErr = checkSignature(ext, bytes, text)
      if (sigErr) errors.push(sigErr)
      else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) && SCRIPT_RE.test(text())) errors.push('The image contains embedded script content.')
    }
  }
  return { ok: errors.length === 0, errors, name: clean, ext, mime: mimeFor(ext), family: familyOf(ext) }
}
function declaredMimeBad(ext, mime) {
  if (!mime || mime === 'application/octet-stream' || !FILE_TYPES[ext]) return false
  return !FILE_TYPES[ext].mimes.includes(mime)
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const sizeLabel = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`)
export const acceptAttr = (config = DEFAULT_DOC_CONFIG) => config.allowedExtensions.map((e) => `.${e}`).join(',')

// ---- permission model -----------------------------------------------------------------------------------------------
export const DOC_PERMISSIONS = [
  ['view', 'View documents'], ['upload', 'Upload documents'], ['editDetails', 'Edit document details'], ['download', 'Download documents'], ['preview', 'Preview documents'], ['replace', 'Replace documents'],
  ['delete', 'Delete documents'], ['share', 'Share documents'], ['createFolders', 'Create folders'], ['manageCategories', 'Manage categories'], ['manageVersions', 'Manage versions'],
  ['viewConfidential', 'View confidential documents'], ['viewTeam', 'View team documents'], ['viewDepartment', 'View department documents'], ['viewAll', 'View all documents'],
]
export const DOC_PERMISSION_KEYS = DOC_PERMISSIONS.map(([k]) => k)
const ALL = DOC_PERMISSION_KEYS
export const DOC_ROLE_CAPS = {
  'Super Admin': ALL,
  Admin: ALL,
  MD: ['view', 'preview', 'download', 'viewConfidential', 'viewTeam', 'viewDepartment', 'viewAll'],
  CEO: ['view', 'preview', 'download', 'viewConfidential', 'viewTeam', 'viewDepartment', 'viewAll'],
  'Sales Manager': ['view', 'upload', 'editDetails', 'download', 'preview', 'replace', 'delete', 'share', 'createFolders', 'manageVersions', 'viewTeam', 'viewDepartment'],
  'Sales Executive': ['view', 'upload', 'editDetails', 'download', 'preview', 'replace'],
  'Project Manager': ['view', 'upload', 'editDetails', 'download', 'preview', 'replace', 'share', 'createFolders', 'manageVersions', 'viewTeam', 'viewDepartment'],
  'Project Staff': ['view', 'upload', 'download', 'preview'],
  Accounts: ['view', 'upload', 'editDetails', 'download', 'preview', 'replace', 'share', 'viewDepartment'],
  Support: ['view', 'upload', 'download', 'preview'],
  Marketing: ['view', 'upload', 'download', 'preview'],
  HR: ['view', 'upload', 'editDetails', 'download', 'preview', 'replace', 'viewDepartment'],
}
export const ADMIN_DOC_ROLES = ['Super Admin', 'Admin']

/** The ordered list of CRM links a document can carry; the first one present is the most specific. `owner` = the field holding the record's responsible user. */
export const LINK_DEFS = [
  { key: 'contractId', collection: 'contracts', type: 'Contract', module: 'Contracts', href: (id) => `/contracts/${id}` },
  { key: 'projectId', collection: 'projects', type: 'Project', module: 'Projects', href: (id) => `/projects/${id}` },
  { key: 'salesOrderId', collection: 'salesOrders', type: 'Sales Order', module: 'Sales Orders', owner: 'salesperson', href: (id) => `/sales-orders/${id}` },
  { key: 'invoiceId', collection: 'invoices', type: 'Invoice', module: 'Invoices', href: (id) => `/invoices/${id}` },
  { key: 'expenseId', collection: 'expenses', type: 'Expense', module: 'Expenses', href: (id) => `/expenses/${id}` },
  { key: 'paymentId', collection: 'payments', type: 'Payment', module: 'Payments', href: (id) => `/payments/${id}` },
  { key: 'quotationId', collection: 'quotations', type: 'Quotation', module: 'Quotations', owner: 'assignedTo', href: (id) => `/quotations/${id}` },
  { key: 'proposalId', collection: 'proposals', type: 'Proposal', module: 'Proposals', owner: 'assignedTo', href: (id) => `/proposals/${id}` },
  { key: 'dealId', collection: 'deals', type: 'Deal', module: 'Deals', owner: 'salesperson', href: (id) => `/deals/${id}` },
  { key: 'leadId', collection: 'leads', type: 'Lead', module: 'Leads', owner: 'assignedTo', href: (id) => `/leads/${id}` },
  { key: 'enquiryId', collection: 'enquiries', type: 'Enquiry', module: 'Enquiries', owner: 'assignedUser', href: (id) => `/enquiries/${id}` },
  { key: 'taskId', collection: 'tasks', type: 'Task', module: 'Tasks', href: (id) => `/tasks/${id}` },
  { key: 'activityId', collection: 'activities', type: 'Activity', module: 'Activities', href: () => '/activities' },
  { key: 'contactId', collection: 'contacts', type: 'Contact', module: 'Contacts', href: (id) => `/contacts/${id}` },
  { key: 'companyId', collection: 'companies', type: 'Company', module: 'Companies', href: (id) => `/companies/${id}` },
  { key: 'customerId', collection: 'customers', type: 'Customer', module: 'Customers', href: (id) => `/customers/${id}` },
  { key: 'employeeId', collection: 'employees', type: 'Employee', module: 'Employees', href: (id) => `/employees/${id}` },
  { key: 'campaignId', collection: 'campaigns', type: 'Campaign', module: 'Campaigns', href: (id) => `/campaigns/${id}` },
]
export const LINK_KEYS = LINK_DEFS.map((d) => d.key)
export const LINK_BY_TYPE = Object.fromEntries(LINK_DEFS.map((d) => [d.type, d]))
export const LINK_BY_KEY = Object.fromEntries(LINK_DEFS.map((d) => [d.key, d]))
export const MODULE_FILTER_TYPES = ['Customer', 'Company', 'Contact', 'Lead', 'Enquiry', 'Deal', 'Proposal', 'Quotation', 'Sales Order', 'Project', 'Contract', 'Invoice', 'Payment', 'Expense', 'Campaign', 'Employee', 'Task', 'Activity']

/** Where a document "belongs": the record it was uploaded from, else its most specific link. */
export function primaryLink(doc) {
  if (doc.primary?.type && doc.primary?.id) return doc.primary
  const def = LINK_DEFS.find((d) => doc[d.key])
  return def ? { type: def.type, id: doc[def.key] } : null
}
