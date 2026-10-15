import { useEffect, useState } from 'react'
import { api } from '../../api/http'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// Contract templates are text with {{Field}} placeholders. They are shared on the server and keep a version
// history. Word (.docx) and PDF files can be uploaded: their text becomes the editable template body.
const EVT = 'crm:contract-templates'

const SERVICE_BODY = `SERVICE AGREEMENT

This Agreement ({{ContractNumber}}) is made on {{TodayDate}} between {{ServiceProvider}} ("Service Provider") and {{CompanyName}} ("Client"), represented by {{ContactName}}.

1. SERVICES
The Service Provider shall deliver the following services to the Client: {{Scope}}

2. TERM
This Agreement starts on {{StartDate}} and continues until {{EndDate}}. Auto-renewal: {{AutoRenewal}}. Either party may end or decline renewal by giving {{NoticePeriod}} written notice.

3. FEES AND PAYMENT
The total contract value is {{ContractValue}}, billed {{BillingFrequency}}. Payment terms: {{PaymentTerms}}. Invoices are issued to {{BillingAddress}} (GSTIN {{GSTIN}}).

4. CONFIDENTIALITY
Each party shall keep the other's confidential information secret and use it only for the purposes of this Agreement.

5. LIABILITY
The Service Provider's total liability under this Agreement is limited to the fees paid in the preceding twelve months.

6. GOVERNING LAW
This Agreement is governed by the laws of India.

Signed for the Service Provider: ____________________   Signed for the Client ({{CustomerName}}): ____________________
Name: {{ContractOwner}}                                  Name: {{ContactName}}
Date: ______________                                     Date: ______________`

const NDA_BODY = `NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ({{ContractNumber}}) is entered into on {{TodayDate}} between {{ServiceProvider}} and {{CompanyName}}, represented by {{ContactName}}.

1. Confidential Information means all non-public information shared between the parties in connection with {{ContractTitle}}.
2. The receiving party shall protect Confidential Information with the same care it uses for its own, and shall not disclose it to any third party.
3. These obligations apply from {{StartDate}} until {{EndDate}} and survive for two years afterwards.
4. This Agreement is governed by the laws of India.

For {{ServiceProvider}}: ____________________    For {{CustomerName}}: ____________________`

const AMC_BODY = `ANNUAL MAINTENANCE CONTRACT

Contract {{ContractNumber}} between {{ServiceProvider}} and {{CompanyName}} (attention: {{ContactName}}, {{ContactEmail}}).

Scope of maintenance: {{Scope}}
Term: {{StartDate}} to {{EndDate}} (renewal date {{RenewalDate}}; notice period {{NoticePeriod}}; auto-renewal: {{AutoRenewal}}).
Annual maintenance fee: {{ContractValue}}, invoiced {{BillingFrequency}}. Payment terms: {{PaymentTerms}}.

The Service Provider will provide support, bug fixes and preventive maintenance during the term. Work outside the scope is quoted separately.

Authorised signatory (Service Provider): ____________________    Authorised signatory (Client): ____________________`

const starters = () => {
  const now = new Date().toISOString()
  const mk = (id, name, contractType, body) => ({ id, name, contractType, body, version: 1, versions: [{ version: 1, body, at: now, by: null, note: 'Initial version' }], active: true, source: 'built-in' })
  return [mk('CTPL-1', 'Service Agreement', 'Service Agreement', SERVICE_BODY), mk('CTPL-2', 'Mutual NDA', 'NDA', NDA_BODY), mk('CTPL-3', 'Annual Maintenance Contract', 'AMC / Maintenance Contract', AMC_BODY)]
}

// The shared list lives on the server; this module keeps the last answer so screens can read it synchronously and refreshes it when it changes.
let cache = []
let loaded = false
let inflight = null
export const getContractTemplates = () => cache
function publish(list) { cache = list; loaded = true; window.dispatchEvent(new Event(EVT)) }
export function loadContractTemplates(force = false) {
  if (inflight) return inflight
  if (loaded && !force) return Promise.resolve(cache)
  inflight = api.get('/contractTemplates', { params: { all: true } })
    .then(async (r) => {
      // first use: offer the three starter templates (only someone allowed to manage templates can create them; everyone else simply sees what exists)
      if (!r.data.length) {
        const made = await Promise.all(starters().map((t) => api.post('/contractTemplates', t).then((x) => x.data).catch(() => null)))
        publish(made.filter(Boolean))
      } else publish(r.data)
      return cache
    })
    .catch(() => cache)
    .finally(() => { inflight = null })
  return inflight
}
/** Saves the list as it should now be: new ids are created, changed ones updated, missing ones deleted. */
export async function saveContractTemplates(next) {
  const before = new Map(cache.map((t) => [t.id, t]))
  const after = new Map(next.map((t) => [t.id, t]))
  const ops = []
  next.forEach((t) => { if (!before.has(t.id)) ops.push(api.post('/contractTemplates', t)); else if (JSON.stringify(before.get(t.id)) !== JSON.stringify(t)) ops.push(api.put(`/contractTemplates/${t.id}`, t)) })
  cache.forEach((t) => { if (!after.has(t.id)) ops.push(api.delete(`/contractTemplates/${t.id}`)) })
  try { await Promise.all(ops) } finally { await loadContractTemplates(true) }
}
export function useContractTemplates() {
  const [list, setList] = useState(getContractTemplates)
  useEffect(() => {
    const h = () => setList(getContractTemplates())
    window.addEventListener(EVT, h)
    loadContractTemplates()
    return () => window.removeEventListener(EVT, h)
  }, [])
  return list
}

/** Saves a template; an edit to the body creates a new version and keeps the old one. */
export function upsertTemplate(list, input, userId) {
  const now = new Date().toISOString()
  const existing = list.find((t) => t.id === input.id)
  if (!existing) {
    const id = `CTPL-${Math.max(0, ...list.map((t) => Number(String(t.id).replace('CTPL-', '')) || 0)) + 1}`
    return [...list, { id, name: input.name.trim(), contractType: input.contractType, body: input.body, version: 1, versions: [{ version: 1, body: input.body, at: now, by: userId, note: input.note || 'Created' }], active: true, source: input.source || 'created', sourceFile: input.sourceFile || null, updatedAt: now, updatedBy: userId }]
  }
  const bodyChanged = existing.body !== input.body
  return list.map((t) => (t.id !== input.id ? t : { ...t, name: input.name.trim(), contractType: input.contractType, body: input.body, active: input.active ?? t.active, ...(bodyChanged ? { version: t.version + 1, versions: [...t.versions, { version: t.version + 1, body: input.body, at: now, by: userId, note: input.note || 'Edited' }] } : {}), updatedAt: now, updatedBy: userId }))
}

/** Text of an uploaded Word / PDF / text file, to become the template body. */
export async function extractTemplateText(file) {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] || '').toLowerCase()
  const buffer = await file.arrayBuffer()
  let text = ''
  if (ext === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: buffer.slice(0) })).value
  else if (ext === 'txt') text = new TextDecoder().decode(buffer)
  else if (ext === 'pdf') {
    const task = pdfjsLib.getDocument({ data: buffer.slice(0) })
    const pdf = await task.promise
    const pages = []
    for (let i = 1; i <= Math.min(pdf.numPages, 40); i += 1) { const c = await (await pdf.getPage(i)).getTextContent(); pages.push(c.items.map((it) => it.str).join(' ')) }
    text = pages.join('\n\n')
    await task.destroy()
  } else throw new Error('Upload a Word (.docx), PDF or text file.')
  text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 20) throw new Error('No readable text was found in that file (scanned PDFs can’t be read).')
  return text
}

// ---- PDF generation ------------------------------------------------------------------------------------------------
const clean = (s) => String(s).replace(/₹/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?')
function wrap(font, text, size, max) {
  const out = []
  clean(text).split('\n').forEach((para) => {
    if (!para.trim()) { out.push(''); return }
    let line = ''
    para.split(/\s+/).forEach((w) => { const t = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = w } else line = t })
    out.push(line)
  })
  return out
}

/** Merged contract text -> a clean A4 PDF (title, numbered pages). Returns a data URL and its size. */
export async function generateContractPdf({ title, number, text }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = 595.28; const H = 841.89; const M = 56; const size = 10.5; const lead = 15
  const lines = wrap(font, text, size, W - M * 2)
  const pages = []
  let page = pdf.addPage([W, H]); let y = H - M; pages.push(page)
  page.drawText(clean(title), { x: M, y, size: 15, font: bold, color: rgb(0.1, 0.1, 0.2) }); y -= 30
  lines.forEach((ln, i) => {
    if (y < M + 30) { page = pdf.addPage([W, H]); pages.push(page); y = H - M }
    const heading = /^([0-9]+\.\s+[A-Z][A-Z \/&-]+|[A-Z][A-Z \/&-]{6,})$/.test(ln.trim()) && i > 0
    if (ln) page.drawText(ln, { x: M, y, size, font: heading ? bold : font, color: rgb(0.1, 0.1, 0.12) })
    y -= ln ? lead : lead * 0.6
  })
  pages.forEach((p, i) => p.drawText(`${clean(number)}  |  Page ${i + 1} of ${pages.length}`, { x: M, y: 28, size: 8, font, color: rgb(0.45, 0.45, 0.5) }))
  const dataUrl = await pdf.saveAsBase64({ dataUri: true })
  return { dataUrl, sizeKb: Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024)) }
}
