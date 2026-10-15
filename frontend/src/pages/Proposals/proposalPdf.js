import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { prepareDecorations, collectStyledRuns, wrapStyledRuns, drawStyledLine, blockAlign, safeText } from '../Quotations/pdfDecorations'
import { formatDate } from '../../utils/format'
import { NARRATIVE_SECTIONS, computeCommercial } from '../../utils/proposalCalc'

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 54
const ACCENT = rgb(0.35, 0.2, 0.75)
const INK = rgb(0.12, 0.12, 0.14)
const GREY = rgb(0.45, 0.45, 0.5)

export const money = (n) => `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n) || 0)}`

const DEFAULT_ORDER = [
  'executiveSummary', 'requirement', 'proposedSolution', 'objectives', 'scopeOfWork', 'modules', 'deliverables', 'implementationApproach',
  'timeline', 'technology', 'responsibilities', 'assumptions', 'exclusions', 'support', 'commercialSummary', 'paymentTerms', 'termsConditions',
]
const LABELS = Object.fromEntries([
  ...NARRATIVE_SECTIONS.map((s) => [s.key, s.label]),
  ['modules', 'Modules / Features'], ['deliverables', 'Deliverables'], ['timeline', 'Project Timeline'], ['responsibilities', 'Responsibilities'], ['commercialSummary', 'Commercial Summary'],
])

function dataUrlToBytes(dataUrl) {
  const bin = atob((dataUrl || '').split(',')[1] || '')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Token values for a proposal — the same vocabulary the template editor offers (PROPOSAL_INLINE_FIELDS). */
export function proposalValues(proposal, { ownerName = '', ownerEmail = '' } = {}) {
  const c = proposal.clientSnapshot || {}
  return {
    proposalNumber: proposal.number, proposalTitle: proposal.title, proposalVersion: String(proposal.version || 1),
    clientName: c.companyName, contactPerson: c.contactName, designation: c.designation, phone: c.phone, email: c.email,
    billingAddress: c.billingAddress, shippingAddress: c.shippingAddress, gstin: c.gstin, website: c.website,
    dealName: proposal.dealName || '', createdDate: formatDate(proposal.createdDate), validUntil: formatDate(proposal.validUntil),
    proposalValue: money(computeCommercial(proposal.content?.items || []).value), owner: ownerName, ownerEmail,
  }
}

/**
 * Proposal → PDF. Header / footer / watermark / logo come from the selected proposal template
 * (same decoration engine as quotations, so body text is always kept clear of them); the body is
 * the proposal's own content — either the built-in solution layout, or the template's edited Word
 * content with CRM tokens resolved. A PDF/image letterhead template is drawn behind every page.
 */
export async function buildProposalPdf({ proposal, template, ownerName, ownerEmail }) {
  const pdfDoc = await PDFDocument.create()
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  }
  let pageSize = A4
  let background = null
  if (template?.fileType === 'pdf' && template.fileData) {
    try {
      const src = await PDFDocument.load(dataUrlToBytes(template.fileData))
      const first = src.getPages()[0]
      pageSize = first.getSize()
      background = { kind: 'pdf', page: await pdfDoc.embedPage(first) }
    } catch { background = null }
  } else if (template?.fileType === 'image' && template.fileData) {
    try {
      const png = (template.mimeType || '').includes('png')
      const img = png ? await pdfDoc.embedPng(dataUrlToBytes(template.fileData)) : await pdfDoc.embedJpg(dataUrlToBytes(template.fileData))
      pageSize = { width: template.pageWidth || A4.width, height: template.pageHeight || A4.height }
      background = { kind: 'image', img }
    } catch { background = null }
  }

  const content = proposal.content || {}
  const values = proposalValues(proposal, { ownerName, ownerEmail })
  const deco = await prepareDecorations(pdfDoc, template || {}, fonts, values, pageSize)
  const topInset = Math.max(MARGIN, deco.bodyTop)
  const bottomInset = Math.max(MARGIN, deco.bodyBottom)
  const width = pageSize.width - MARGIN * 2
  const pages = []
  let page
  let y

  const newPage = () => {
    page = pdfDoc.addPage([pageSize.width, pageSize.height])
    if (background?.kind === 'pdf') page.drawPage(background.page, { x: 0, y: 0, width: pageSize.width, height: pageSize.height })
    else if (background?.kind === 'image') page.drawImage(background.img, { x: 0, y: 0, width: pageSize.width, height: pageSize.height })
    deco.drawWatermark(page)
    pages.push(page)
    y = pageSize.height - topInset
  }
  const ensure = (h) => { if (y - h < bottomInset) newPage() }
  newPage()

  // ---- layout primitives --------------------------------------------------------------------
  const drawText = (t, x, size, font, color = INK) => page.drawText(safeText(t, font), { x, y: y - size, size, font, color })
  const paragraph = (text, { size = 10, x = MARGIN, w = width, color = INK, bold = false, gap = 5 } = {}) => {
    String(text || '').split(/\n+/).filter((s) => s.trim()).forEach((chunk) => {
      const lines = wrapStyledRuns([{ text: chunk, bold, italic: false, underline: false, size }], fonts, size, w, (s) => s * 1.45)
      lines.forEach((line) => {
        ensure(line.height)
        drawStyledLine(page, line, x, y, 'left', w, color)
        y -= line.height
      })
      y -= gap
    })
  }
  const heading = (text) => {
    ensure(40)
    y -= 6
    drawText(text.toUpperCase(), MARGIN, 11, fonts.bold, ACCENT)
    y -= 16
    page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + width, y: y + 2 }, thickness: 0.6, color: rgb(0.85, 0.82, 0.95) })
    y -= 8
  }
  const bullets = (items) => items.forEach((t) => {
    const lines = wrapStyledRuns([{ text: t, bold: false, italic: false, underline: false, size: 10 }], fonts, 10, width - 14, (s) => s * 1.45)
    lines.forEach((line, i) => {
      ensure(line.height)
      if (i === 0) page.drawText('•', { x: MARGIN + 2, y: y - 10, size: 10, font: fonts.regular, color: ACCENT })
      drawStyledLine(page, line, MARGIN + 14, y, 'left', width - 14, INK)
      y -= line.height
    })
    y -= 2
  })
  const table = (cols, rows) => {
    // cols: [{label, frac, align}]
    const xs = []
    let acc = MARGIN
    cols.forEach((c) => { xs.push(acc); acc += c.frac * width })
    const drawHead = () => {
      ensure(24)
      page.drawRectangle({ x: MARGIN, y: y - 16, width, height: 18, color: rgb(0.95, 0.94, 0.98) })
      cols.forEach((c, i) => {
        const w = fonts.bold.widthOfTextAtSize(safeText(c.label, fonts.bold), 8)
        const x = c.align === 'right' ? xs[i] + c.frac * width - 4 - w : xs[i] + 4
        page.drawText(safeText(c.label, fonts.bold), { x, y: y - 11, size: 8, font: fonts.bold, color: GREY })
      })
      y -= 20
    }
    drawHead()
    rows.forEach((row) => {
      const cells = row.map((cell, i) => wrapStyledRuns([{ text: String(cell ?? ''), bold: false, italic: false, underline: false, size: 9 }], fonts, 9, cols[i].frac * width - 8, (s) => s * 1.35))
      const h = Math.max(...cells.map((l) => l.reduce((s, ln) => s + ln.height, 0))) + 6
      if (y - h < bottomInset) { newPage(); drawHead() }
      cells.forEach((lines, i) => {
        let yy = y - 3
        lines.forEach((ln) => {
          drawStyledLine(page, ln, xs[i] + 4, yy, cols[i].align === 'right' ? 'right' : 'left', cols[i].frac * width - 8, INK)
          yy -= ln.height
        })
      })
      y -= h
      page.drawLine({ start: { x: MARGIN, y: y + 1 }, end: { x: MARGIN + width, y: y + 1 }, thickness: 0.4, color: rgb(0.9, 0.9, 0.92) })
    })
    y -= 6
  }

  // ---- section renderers -----------------------------------------------------------------------
  const renderSection = (key) => {
    const label = LABELS[key]
    if (!label) return
    if (key === 'modules') {
      if (!content.modules?.length) return
      heading(label); table([{ label: 'Module / Feature', frac: 0.32 }, { label: 'Description', frac: 0.68 }], content.modules.map((m) => [m.name, m.description]))
    } else if (key === 'deliverables') {
      if (!content.deliverables?.length) return
      heading(label); bullets(content.deliverables)
    } else if (key === 'timeline') {
      if (!content.timeline?.length) return
      heading(label); table([{ label: 'Phase', frac: 0.26 }, { label: 'Activities', frac: 0.5 }, { label: 'Duration', frac: 0.24 }], content.timeline.map((t) => [t.phase, t.description, t.duration]))
    } else if (key === 'responsibilities') {
      if (!content.responsibilities?.company && !content.responsibilities?.client) return
      heading(label)
      if (content.responsibilities.company) { paragraph('Our responsibilities', { bold: true, gap: 2 }); paragraph(content.responsibilities.company) }
      if (content.responsibilities.client) { paragraph('Client responsibilities', { bold: true, gap: 2 }); paragraph(content.responsibilities.client) }
    } else if (key === 'commercialSummary') {
      const items = (content.items || []).filter((i) => i.name)
      if (!items.length) return
      const calc = computeCommercial(items)
      heading(label)
      table(
        [{ label: 'Item / service', frac: 0.42 }, { label: 'Qty', frac: 0.08, align: 'right' }, { label: 'Unit price', frac: 0.18, align: 'right' }, { label: 'Disc', frac: 0.1, align: 'right' }, { label: 'Amount', frac: 0.22, align: 'right' }],
        items.map((it, i) => [it.description ? `${it.name} — ${it.description}` : it.name, it.qty, money(it.unitPrice), `${it.discount}%`, money(calc.lines[i].net)]),
      )
      const row = (l, v, f = fonts.regular, size = 10) => { ensure(16); page.drawText(l, { x: MARGIN + width - 220, y: y - size, size, font: f, color: INK }); const s = safeText(v, f); page.drawText(s, { x: MARGIN + width - f.widthOfTextAtSize(s, size), y: y - size, size, font: f, color: INK }); y -= size + 6 }
      if (calc.discount) row('Discount', `- ${money(calc.discount)}`)
      row('Proposal value (excl. taxes)', money(calc.value), fonts.bold, 10.5)
      row('Estimated GST @ 18%', money(calc.estimatedTax))
      row('Estimated total', money(calc.estimatedTotal), fonts.bold)
      y -= 2
      paragraph('Indicative figures for discussion. The binding price offer is issued separately as a Quotation.', { size: 8.5, color: GREY })
    } else if (content[key]) {
      heading(label); paragraph(content[key])
    }
  }
  const renderAll = () => DEFAULT_ORDER.forEach(renderSection)

  const cover = () => {
    drawText('PROPOSAL', MARGIN, 11, fonts.bold, ACCENT); y -= 18
    paragraph(proposal.title, { size: 20, bold: true, gap: 4 })
    paragraph(`Prepared for ${values.clientName}`, { size: 12, color: GREY, gap: 8 })
    const meta = [['Proposal no.', `${proposal.number} — Version ${proposal.version}`], ['Date', values.createdDate], ['Valid until', values.validUntil], ['Prepared by', [ownerName, ownerEmail].filter(Boolean).join(' · ')]]
    meta.filter(([, v]) => v).forEach(([k, v]) => { ensure(14); page.drawText(k, { x: MARGIN, y: y - 9, size: 9, font: fonts.bold, color: GREY }); page.drawText(safeText(v, fonts.regular), { x: MARGIN + 90, y: y - 9, size: 9, font: fonts.regular, color: INK }); y -= 14 })
    y -= 8
    heading('Client')
    ;[values.clientName, [values.contactPerson, values.designation].filter(Boolean).join(', '), values.email, values.phone, values.billingAddress, values.gstin && `GSTIN: ${values.gstin}`, values.website]
      .filter(Boolean).forEach((l) => paragraph(l, { gap: 1 }))
    y -= 4
  }

  // ---- body ------------------------------------------------------------------------------------------
  if (template?.fileType === 'docx' && template.contentHtml) {
    const doc = new DOMParser().parseFromString(template.contentHtml, 'text/html')
    const blocks = Array.from(doc.body.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))
    for (const block of blocks) {
      const tag = block.nodeType === 1 ? block.tagName.toLowerCase() : 'p'
      const field = block.nodeType === 1 ? block.getAttribute?.('data-field') : null
      if (field === 'allSections') { renderAll(); continue }
      if (field && LABELS[field]) { renderSection(field); continue }
      if (tag === 'table') {
        const rows = Array.from(block.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => td.textContent))
        const n = Math.max(...rows.map((r) => r.length), 1)
        if (rows.length) table(Array.from({ length: n }, (_, i) => ({ label: '', frac: 1 / n, align: 'left', i })), rows.map((r) => Array.from({ length: n }, (_, i) => r[i] || '')))
        continue
      }
      const imgEl = tag === 'img' ? block : block.querySelector?.('img')
      if (imgEl && (tag === 'img' || !block.textContent?.trim())) {
        try {
          const src = imgEl.getAttribute('src') || ''
          const img = await pdfDoc[src.includes('image/png') ? 'embedPng' : 'embedJpg'](dataUrlToBytes(src))
          const scale = Math.min(1, width / img.width, (pageSize.height - topInset - bottomInset) / img.height)
          ensure(img.height * scale)
          page.drawImage(img, { x: MARGIN, y: y - img.height * scale, width: img.width * scale, height: img.height * scale })
          y -= img.height * scale + 8
        } catch { /* unreadable embedded image — skip it rather than fail the proposal */ }
        continue
      }
      const heading_ = /^h[1-6]$/.test(tag)
      const size = tag === 'h1' ? 18 : tag === 'h2' ? 14 : tag === 'h3' ? 12 : 10
      const runs = block.nodeType === 1 ? collectStyledRuns(block, values, { size, bold: heading_ }) : [{ text: block.textContent, size, bold: false, italic: false, underline: false }]
      if (!runs.length) { y -= 8; continue }
      const li = tag === 'li'
      if (li) runs.unshift({ text: '• ', bold: false, italic: false, underline: false, size })
      const align = block.nodeType === 1 ? blockAlign(block) : 'left'
      wrapStyledRuns(runs, fonts, size, width - (li ? 14 : 0), (s) => s * 1.45).forEach((line) => {
        ensure(line.height)
        drawStyledLine(page, line, MARGIN + (li ? 14 : 0), y, align, width - (li ? 14 : 0))
        y -= line.height
      })
      y -= heading_ ? 6 : 4
    }
  } else {
    cover()
    renderAll()
  }

  pages.forEach((p, i) => {
    deco.drawBands(p, i + 1, pages.length)
    if (pages.length > 1 && !deco.hasFooter) {
      const label = `${proposal.number} · v${proposal.version} · Page ${i + 1} of ${pages.length}`
      p.drawText(label, { x: pageSize.width - MARGIN - fonts.regular.widthOfTextAtSize(label, 8), y: 24, size: 8, font: fonts.regular, color: GREY })
    }
  })
  return pdfDoc.save()
}

export function pdfBytesToDataUrl(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8000) bin += String.fromCharCode(...bytes.subarray(i, i + 8000))
  return `data:application/pdf;base64,${btoa(bin)}`
}
