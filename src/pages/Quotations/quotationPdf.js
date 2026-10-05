import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { formatDate } from '../../utils/format'
import { LOGO_SRC } from '../../components/common/Logo'
import { prepareDecorations, collectStyledRuns, wrapStyledRuns, drawStyledLine, blockAlign } from './pdfDecorations'

// Standard PDF fonts (Helvetica) use WinAnsi encoding, which has no Rupee-sign glyph — drawing
// "₹" with pdf-lib's built-in fonts throws an encoding error. Embedding a custom Unicode font
// just for one glyph is out of scope for this frontend-only build, so generated PDFs render
// amounts as "Rs." — the on-screen UI everywhere else still shows the real ₹ symbol.
function money(n) {
  return `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))}`
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 42
const ROWS_PER_PAGE_FIRST = 12
const ROWS_PER_PAGE_NEXT = 20
const TOTALS_RESERVE_ROWS = 10

function wrapLines(font, text, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines = []
  let line = ''
  words.forEach((w) => {
    const test = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  })
  if (line) lines.push(line)
  return lines
}

function chunkRows(rows) {
  const pages = []
  let i = 0
  let first = true
  if (!rows.length) return [[]]
  while (i < rows.length) {
    const capacity = first ? ROWS_PER_PAGE_FIRST : ROWS_PER_PAGE_NEXT
    pages.push(rows.slice(i, i + capacity))
    i += capacity
    first = false
  }
  const lastCapacity = pages.length === 1 ? ROWS_PER_PAGE_FIRST : ROWS_PER_PAGE_NEXT
  const last = pages[pages.length - 1]
  if (last.length > lastCapacity - TOTALS_RESERVE_ROWS) {
    const keep = Math.max(0, lastCapacity - TOTALS_RESERVE_ROWS)
    pages[pages.length - 1] = last.slice(0, keep)
    pages.push(last.slice(keep))
  }
  return pages
}

async function fetchLogoBytes() {
  try {
    const res = await fetch(LOGO_SRC)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The built-in layout used whenever no uploaded letterhead template is active yet (the state
 * this CRM starts in — see src/data/quotationTemplates.js). A clean, professional multi-page
 * quotation that mirrors the on-screen QuotationDetail design, generated as a real downloadable/
 * printable PDF rather than relying on window.print().
 */
async function buildDefaultLayout({ quotation, preparedByName }) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const logoBytes = await fetchLogoBytes()
  let logoImage = null
  if (logoBytes) {
    try { logoImage = await pdfDoc.embedJpg(logoBytes) } catch { logoImage = null }
  }

  const rows = quotation.items.length ? quotation.items : [{ _empty: true, name: 'No line items added yet.' }]
  const pagesOfRows = chunkRows(rows)
  const totalPages = pagesOfRows.length

  pagesOfRows.forEach((pageRows, pageIndex) => {
    const page = pdfDoc.addPage([A4.width, A4.height])
    let y = A4.height - MARGIN

    if (pageIndex === 0) {
      if (logoImage) {
        const scale = 26 / logoImage.height
        const dims = { width: logoImage.width * scale, height: logoImage.height * scale }
        page.drawImage(logoImage, { x: MARGIN, y: y - dims.height, width: dims.width, height: dims.height })
        page.drawText('LAX360 Business CRM', { x: MARGIN + dims.width + 10, y: y - 10, size: 12, font: bold })
        page.drawText('Design . Develop . Service', { x: MARGIN + dims.width + 10, y: y - 23, size: 8, font, color: rgb(0.45, 0.45, 0.45) })
      } else {
        page.drawText('LAX360 Business CRM', { x: MARGIN, y: y - 12, size: 14, font: bold })
      }
      const title = 'QUOTATION'
      page.drawText(title, { x: A4.width - MARGIN - bold.widthOfTextAtSize(title, 16), y: y - 12, size: 16, font: bold })
      const metaLines = [quotation.number, `Date: ${formatDate(quotation.createdDate)}`, `Valid Until: ${formatDate(quotation.validUntil)}`]
      metaLines.forEach((line, i) => {
        page.drawText(line, { x: A4.width - MARGIN - font.widthOfTextAtSize(line, 8), y: y - 27 - i * 11, size: 8, font, color: rgb(0.45, 0.45, 0.45) })
      })

      y -= 72
      page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y }, thickness: 0.75, color: rgb(0.85, 0.85, 0.85) })
      y -= 20

      const colWidth = (A4.width - MARGIN * 2) / 2
      page.drawText('BILL TO', { x: MARGIN, y, size: 8, font: bold, color: rgb(0.5, 0.5, 0.5) })
      let by = y - 14
      page.drawText(quotation.customerName || '-', { x: MARGIN, y: by, size: 10, font: bold }); by -= 13
      ;[quotation.contactName, quotation.contactEmail, quotation.contactPhone].filter(Boolean).forEach((line) => {
        page.drawText(line, { x: MARGIN, y: by, size: 9, font }); by -= 12
      })
      wrapLines(font, quotation.billingAddress, 9, colWidth - 10).forEach((line) => { page.drawText(line, { x: MARGIN, y: by, size: 9, font }); by -= 12 })
      if (quotation.gstin) { page.drawText(`GSTIN: ${quotation.gstin}`, { x: MARGIN, y: by, size: 9, font }); by -= 12 }

      const rx = MARGIN + colWidth
      page.drawText('QUOTATION OWNER', { x: rx, y, size: 8, font: bold, color: rgb(0.5, 0.5, 0.5) })
      let ry = y - 14
      page.drawText(preparedByName || '-', { x: rx, y: ry, size: 10, font: bold }); ry -= 13
      if (quotation.dealId) { page.drawText(`Linked Deal: ${quotation.dealId}`, { x: rx, y: ry, size: 9, font }); ry -= 12 }
      if (quotation.leadId) { page.drawText(`Source Lead: ${quotation.leadId}`, { x: rx, y: ry, size: 9, font }); ry -= 12 }

      y = Math.min(by, ry) - 16
    } else {
      page.drawText(`${quotation.number} (continued)`, { x: MARGIN, y, size: 10, font: bold, color: rgb(0.4, 0.4, 0.4) })
      y -= 24
    }

    const colX = { item: MARGIN, qty: A4.width - MARGIN - 230, price: A4.width - MARGIN - 170, disc: A4.width - MARGIN - 100, total: A4.width - MARGIN - 40 }
    page.drawRectangle({ x: MARGIN, y: y - 14, width: A4.width - MARGIN * 2, height: 18, color: rgb(0.96, 0.96, 0.97) })
    page.drawText('Item / Service', { x: colX.item + 4, y: y - 9, size: 8, font: bold })
    page.drawText('Qty', { x: colX.qty, y: y - 9, size: 8, font: bold })
    page.drawText('Unit Price', { x: colX.price, y: y - 9, size: 8, font: bold })
    page.drawText('Disc', { x: colX.disc, y: y - 9, size: 8, font: bold })
    page.drawText('Total', { x: colX.total, y: y - 9, size: 8, font: bold })
    y -= 24

    pageRows.forEach((item) => {
      if (item._empty) {
        page.drawText(item.name, { x: colX.item + 4, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) })
        y -= 16
        return
      }
      const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0) * (1 - (Number(item.discount) || 0) / 100)
      const nameLines = wrapLines(font, item.name, 9, colX.qty - colX.item - 10)
      nameLines.forEach((line, li) => page.drawText(line, { x: colX.item + 4, y: y - li * 11, size: 9, font }))
      page.drawText(String(item.qty), { x: colX.qty, y, size: 9, font })
      page.drawText(money(item.unitPrice), { x: colX.price, y, size: 9, font })
      page.drawText(`${item.discount || 0}%`, { x: colX.disc, y, size: 9, font })
      const totalStr = money(lineTotal)
      page.drawText(totalStr, { x: A4.width - MARGIN - font.widthOfTextAtSize(totalStr, 9), y, size: 9, font })
      y -= Math.max(16, nameLines.length * 11 + 5)
    })

    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: A4.width - MARGIN, y: y + 6 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) })

    if (pageIndex === totalPages - 1) {
      y -= 16
      const totalsX = A4.width - MARGIN - 160
      ;[['Subtotal', money(quotation.subtotal)], ['Tax (18%)', money(quotation.tax)]].forEach(([label, val]) => {
        page.drawText(label, { x: totalsX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) })
        page.drawText(val, { x: A4.width - MARGIN - font.widthOfTextAtSize(val, 9), y, size: 9, font })
        y -= 14
      })
      page.drawText('Grand Total', { x: totalsX, y, size: 11, font: bold })
      const totalStr = money(quotation.amount)
      page.drawText(totalStr, { x: A4.width - MARGIN - bold.widthOfTextAtSize(totalStr, 11), y, size: 11, font: bold })
      y -= 30

      if (quotation.paymentTerms) {
        page.drawText('PAYMENT TERMS', { x: MARGIN, y, size: 8, font: bold, color: rgb(0.5, 0.5, 0.5) }); y -= 13
        wrapLines(font, quotation.paymentTerms, 9, A4.width - MARGIN * 2).forEach((line) => { page.drawText(line, { x: MARGIN, y, size: 9, font }); y -= 12 })
        y -= 6
      }
      if (quotation.terms) {
        page.drawText('TERMS & CONDITIONS', { x: MARGIN, y, size: 8, font: bold, color: rgb(0.5, 0.5, 0.5) }); y -= 13
        wrapLines(font, quotation.terms, 9, A4.width - MARGIN * 2).forEach((line) => { page.drawText(line, { x: MARGIN, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) }); y -= 12 })
      }
    }

    if (totalPages > 1) {
      const label = `Page ${pageIndex + 1} of ${totalPages}`
      page.drawText(label, { x: A4.width - MARGIN - font.widthOfTextAtSize(label, 8), y: MARGIN - 20, size: 8, font, color: rgb(0.6, 0.6, 0.6) })
    }
  })

  return pdfDoc.save()
}

/** Resolves every placeholder a template field key can map to, as plain display strings. */
function fieldValues({ quotation, preparedByName }) {
  return {
    quotationNumber: quotation.number,
    quotationDate: formatDate(quotation.createdDate),
    validUntil: formatDate(quotation.validUntil),
    clientName: quotation.customerName || '',
    contactPerson: quotation.contactName || '',
    phone: quotation.contactPhone || '',
    email: quotation.contactEmail || '',
    billingAddress: quotation.billingAddress || '',
    shippingAddress: quotation.shippingAddress || quotation.billingAddress || '',
    gstin: quotation.gstin || '',
    dealId: quotation.dealId || '',
    quotationOwner: preparedByName || '',
    paymentTerms: quotation.paymentTerms || '',
    terms: quotation.terms || '',
  }
}

/**
 * Generates a quotation PDF using the EXACT uploaded letterhead/template as the background on
 * every page — never redesigned or approximated. The template's own page size, orientation and
 * every existing design element (logo, header, footer) are preserved as-is; dynamic quotation
 * content is drawn on top at the positions the user mapped in the Template Editor (see
 * src/pages/Settings/QuotationTemplateEditor.jsx). Falls back page-by-page to the same
 * background for continuation pages when the items table overflows one page.
 */
async function buildFromTemplate({ quotation, template, preparedByName }) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts = {
    regular: font, bold,
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  }
  const bytes = dataUrlToBytes(template.fileData)

  let background
  let pageSize
  if (template.fileType === 'pdf') {
    const srcDoc = await PDFDocument.load(bytes)
    const srcPage = srcDoc.getPages()[0]
    pageSize = srcPage.getSize()
    background = await pdfDoc.embedPage(srcPage)
  } else {
    const isPng = (template.mimeType || '').includes('png')
    background = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
    pageSize = { width: template.pageWidth, height: template.pageHeight }
  }

  const drawBackground = (page) => {
    if (template.fileType === 'pdf') page.drawPage(background, { x: 0, y: 0, width: pageSize.width, height: pageSize.height })
    else page.drawImage(background, { x: 0, y: 0, width: pageSize.width, height: pageSize.height })
  }

  const byKey = Object.fromEntries((template.fields || []).map((f) => [f.key, f]))
  const values = fieldValues({ quotation, preparedByName })
  const tableField = byKey.itemsTable
  const totalsField = byKey.totals

  const toXY = (f) => ({ x: (f.xPct / 100) * pageSize.width, yTop: (f.yPct / 100) * pageSize.height })

  const drawHeaderFields = (page) => {
    Object.entries(byKey).forEach(([key, f]) => {
      if (key === 'itemsTable' || key === 'totals') return
      const value = values[key]
      if (!value) return
      const { x, yTop } = toXY(f)
      const size = f.fontSize || 9
      const useFont = f.bold ? bold : font
      const maxWidth = f.wPct ? (f.wPct / 100) * pageSize.width : pageSize.width - x - 20
      const lines = wrapLines(useFont, value, size, Math.max(maxWidth, 40))
      lines.forEach((line, i) => {
        page.drawText(line, { x, y: pageSize.height - yTop - size - i * (size + 2), size, font: useFont, color: rgb(0.12, 0.12, 0.12) })
      })
    })
  }

  // Row-flow for the items table region, repeated across however many pages are needed.
  const rows = quotation.items.length ? quotation.items : [{ _empty: true, name: 'No line items added yet.' }]
  const deco = await prepareDecorations(pdfDoc, template, fonts, values, pageSize)
  const rawRect = tableField
    ? { x: (tableField.xPct / 100) * pageSize.width, yTop: (tableField.yPct / 100) * pageSize.height, w: (tableField.wPct / 100) * pageSize.width, h: (tableField.hPct / 100) * pageSize.height }
    : { x: MARGIN, yTop: 160, w: pageSize.width - MARGIN * 2, h: pageSize.height - 320 }
  // Keep the items table clear of the header/footer: its top can't start inside the header band
  // and its bottom can't run into the footer band. Only ever shrinks/moves the table inward.
  const clampedTop = Math.max(rawRect.yTop, deco.bodyTop)
  const maxBottom = pageSize.height - deco.bodyBottom
  const tableRect = { ...rawRect, yTop: clampedTop, h: Math.max(60, Math.min(rawRect.h - (clampedTop - rawRect.yTop), maxBottom - clampedTop)) }
  const rowHeight = 16
  const headerHeight = 18
  const rowsPerPage = Math.max(3, Math.floor((tableRect.h - headerHeight - (totalsField ? 0 : 90)) / rowHeight))
  const pagesOfRows = []
  for (let i = 0; i < rows.length; i += rowsPerPage) pagesOfRows.push(rows.slice(i, i + rowsPerPage))
  if (!pagesOfRows.length) pagesOfRows.push([])
  const totalPages = pagesOfRows.length

  pagesOfRows.forEach((pageRows, pageIndex) => {
    const page = pdfDoc.addPage([pageSize.width, pageSize.height])
    drawBackground(page)
    deco.drawWatermark(page)
    drawHeaderFields(page)

    const topY = pageSize.height - tableRect.yTop
    let y = topY - headerHeight + 5
    page.drawRectangle({ x: tableRect.x, y: topY - headerHeight, width: tableRect.w, height: headerHeight, color: rgb(0.96, 0.96, 0.97) })
    const colX = { item: tableRect.x + 4, qty: tableRect.x + tableRect.w * 0.52, price: tableRect.x + tableRect.w * 0.65, disc: tableRect.x + tableRect.w * 0.8, total: tableRect.x + tableRect.w * 0.88 }
    page.drawText('Item / Service', { x: colX.item, y, size: 8, font: bold })
    page.drawText('Qty', { x: colX.qty, y, size: 8, font: bold })
    page.drawText('Unit Price', { x: colX.price, y, size: 8, font: bold })
    page.drawText('Disc', { x: colX.disc, y, size: 8, font: bold })
    page.drawText('Total', { x: colX.total, y, size: 8, font: bold })
    y -= rowHeight

    pageRows.forEach((item) => {
      if (item._empty) {
        page.drawText(item.name, { x: colX.item, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) })
        y -= rowHeight
        return
      }
      const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0) * (1 - (Number(item.discount) || 0) / 100)
      const nameLines = wrapLines(font, item.name, 9, colX.qty - colX.item - 8)
      nameLines.slice(0, 2).forEach((line, li) => page.drawText(line, { x: colX.item, y: y - li * 10, size: 9, font }))
      page.drawText(String(item.qty), { x: colX.qty, y, size: 9, font })
      page.drawText(money(item.unitPrice), { x: colX.price, y, size: 9, font })
      page.drawText(`${item.discount || 0}%`, { x: colX.disc, y, size: 9, font })
      page.drawText(money(lineTotal), { x: colX.total, y, size: 9, font })
      y -= rowHeight
    })

    const isLastPage = pageIndex === totalPages - 1
    if (isLastPage) {
      const tx = totalsField ? (totalsField.xPct / 100) * pageSize.width : tableRect.x
      let ty = totalsField ? pageSize.height - (totalsField.yPct / 100) * pageSize.height : y - 16
      if (deco.bodyTop || deco.bodyBottom) ty = Math.min(pageSize.height - deco.bodyTop - 10, Math.max(ty, deco.bodyBottom + 30))
      ;[['Subtotal', money(quotation.subtotal)], ['Tax (18%)', money(quotation.tax)]].forEach(([label, val]) => {
        page.drawText(`${label}:`, { x: tx, y: ty, size: 9, font, color: rgb(0.4, 0.4, 0.4) })
        page.drawText(val, { x: tx + 90, y: ty, size: 9, font })
        ty -= 13
      })
      page.drawText('Grand Total:', { x: tx, y: ty, size: 10, font: bold })
      page.drawText(money(quotation.amount), { x: tx + 90, y: ty, size: 10, font: bold })
    }

    deco.drawBands(page, pageIndex + 1, totalPages)
    // The automatic "Page X of Y" label would collide with a user-designed footer, which can
    // carry its own page-number tokens.
    if (totalPages > 1 && !deco.hasFooter) {
      const label = `Page ${pageIndex + 1} of ${totalPages}`
      page.drawText(label, { x: pageSize.width - MARGIN - font.widthOfTextAtSize(label, 8), y: 18, size: 8, font, color: rgb(0.6, 0.6, 0.6) })
    }
  })

  return pdfDoc.save()
}

// --- Word (.docx) template rendering --------------------------------------------------------
// Unlike the PDF/image path above (a fixed background + positioned fields), a docx-derived
// template has no separate background: the edited HTML content (see PageDesigner.jsx)
// *is* the whole document, walked block-by-block into real paginated PDF output, with
// `[data-field]` tokens resolved to live quotation data inline wherever the user placed them.

const DOCX_MARGIN = 54 // ~0.75in, a normal Word default
const DOCX_PAGE = A4

function drawItemsTableBlock({ ctx, quotation, startY }) {
  const { page, fonts, contentWidth } = ctx
  let y = startY
  const colX = { item: DOCX_MARGIN, qty: DOCX_MARGIN + contentWidth * 0.52, price: DOCX_MARGIN + contentWidth * 0.65, disc: DOCX_MARGIN + contentWidth * 0.8, total: DOCX_MARGIN + contentWidth * 0.88 }
  page.drawRectangle({ x: DOCX_MARGIN, y: y - 14, width: contentWidth, height: 18, color: rgb(0.96, 0.96, 0.97) })
  page.drawText('Item / Service', { x: colX.item + 4, y: y - 9, size: 8, font: fonts.bold })
  page.drawText('Qty', { x: colX.qty, y: y - 9, size: 8, font: fonts.bold })
  page.drawText('Unit Price', { x: colX.price, y: y - 9, size: 8, font: fonts.bold })
  page.drawText('Disc', { x: colX.disc, y: y - 9, size: 8, font: fonts.bold })
  page.drawText('Total', { x: colX.total, y: y - 9, size: 8, font: fonts.bold })
  y -= 22
  const rows = quotation.items.length ? quotation.items : [{ _empty: true, name: 'No line items added yet.' }]
  rows.forEach((item) => {
    if (item._empty) {
      page.drawText(item.name, { x: colX.item + 4, y, size: 9, font: fonts.regular, color: rgb(0.5, 0.5, 0.5) })
      y -= 16
      return
    }
    const lineTotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0) * (1 - (Number(item.discount) || 0) / 100)
    const nameLines = wrapLines(fonts.regular, item.name, 9, colX.qty - colX.item - 10)
    nameLines.forEach((line, li) => page.drawText(line, { x: colX.item + 4, y: y - li * 11, size: 9, font: fonts.regular }))
    page.drawText(String(item.qty), { x: colX.qty, y, size: 9, font: fonts.regular })
    page.drawText(money(item.unitPrice), { x: colX.price, y, size: 9, font: fonts.regular })
    page.drawText(`${item.discount || 0}%`, { x: colX.disc, y, size: 9, font: fonts.regular })
    const totalStr = money(lineTotal)
    page.drawText(totalStr, { x: DOCX_MARGIN + contentWidth - fonts.regular.widthOfTextAtSize(totalStr, 9), y, size: 9, font: fonts.regular })
    y -= Math.max(16, nameLines.length * 11 + 5)
  })
  return y - 6
}

function drawTotalsBlock({ ctx, quotation, startY }) {
  const { page, fonts, contentWidth } = ctx
  let y = startY
  const totalsX = DOCX_MARGIN + contentWidth - 180
  ;[['Subtotal', money(quotation.subtotal)], ['Tax (18%)', money(quotation.tax)]].forEach(([label, val]) => {
    page.drawText(label, { x: totalsX, y, size: 9, font: fonts.regular, color: rgb(0.4, 0.4, 0.4) })
    page.drawText(val, { x: DOCX_MARGIN + contentWidth - fonts.regular.widthOfTextAtSize(val, 9), y, size: 9, font: fonts.regular })
    y -= 14
  })
  page.drawText('Grand Total', { x: totalsX, y, size: 11, font: fonts.bold })
  const totalStr = money(quotation.amount)
  page.drawText(totalStr, { x: DOCX_MARGIN + contentWidth - fonts.bold.widthOfTextAtSize(totalStr, 11), y, size: 11, font: fonts.bold })
  return y - 24
}

/**
 * Walks a docx-derived template's edited HTML content (headings, paragraphs, lists, tables,
 * inline images, and embedded CRM-field tokens) into a real paginated PDF — preserving the
 * original document's text, structure and basic formatting (bold/italic, headings, lists) as
 * closely as a client-side conversion reasonably can, per the spec's "as closely as technically
 * possible." Page breaks happen between lines/rows, never mid-word, so long content always
 * continues cleanly onto a new page rather than being cut off or overlapping.
 */
async function buildFromDocxContent({ quotation, template, preparedByName }) {
  const pdfDoc = await PDFDocument.create()
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  }
  const contentWidth = DOCX_PAGE.width - DOCX_MARGIN * 2
  const values = fieldValues({ quotation, preparedByName })
  const deco = await prepareDecorations(pdfDoc, template, fonts, values, DOCX_PAGE)

  // Body content lives between the header and footer bands (or the plain page margins when a
  // band is off), so it can never run underneath either one.
  const topInset = Math.max(DOCX_MARGIN, deco.bodyTop)
  const bottomInset = Math.max(DOCX_MARGIN, deco.bodyBottom)

  const pages = []
  let page
  let y
  const newPage = () => {
    page = pdfDoc.addPage([DOCX_PAGE.width, DOCX_PAGE.height])
    deco.drawWatermark(page) // drawn first, so it sits behind everything else
    pages.push(page)
    y = DOCX_PAGE.height - topInset
  }
  newPage()

  const ensureSpace = (needed) => {
    if (y - needed < bottomInset) newPage()
  }

  const ctx = () => ({ page, fonts, contentWidth })

  const doc = new DOMParser().parseFromString(template.contentHtml || '', 'text/html')
  const blocks = Array.from(doc.body.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()))

  for (const block of blocks) {
    const tag = block.nodeType === 1 ? block.tagName.toLowerCase() : 'p'

    if (block.nodeType === 1 && block.hasAttribute?.('data-field')) {
      const key = block.getAttribute('data-field')
      if (key === 'itemsTable') {
        ensureSpace(60)
        y = drawItemsTableBlock({ ctx: ctx(), quotation, startY: y })
        continue
      }
      if (key === 'totals') {
        ensureSpace(70)
        y = drawTotalsBlock({ ctx: ctx(), quotation, startY: y })
        continue
      }
      // Any other field token that ended up as its own direct body-level node (the browser's
      // insertHTML sometimes places it as a sibling rather than nesting it inside the
      // paragraph the cursor was in) still needs to render as real resolved text here, not be
      // silently dropped — fall through to the normal text-block handling below, since
      // collectStyledRuns() resolves a [data-field] element correctly at any nesting depth.
    }

    if (tag === 'table') {
      const rowsEls = Array.from(block.querySelectorAll('tr'))
      rowsEls.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll('td,th'))
        if (!cells.length) return
        const colWidth = contentWidth / cells.length
        const cellLines = cells.map((td) => wrapLines(fonts.regular, td.textContent, 9, colWidth - 8))
        const rowHeight = Math.max(16, Math.max(...cellLines.map((l) => l.length)) * 11 + 6)
        ensureSpace(rowHeight)
        cells.forEach((td, ci) => {
          page.drawRectangle({ x: DOCX_MARGIN + ci * colWidth, y: y - rowHeight, width: colWidth, height: rowHeight, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 })
          cellLines[ci].forEach((line, li) => page.drawText(line, { x: DOCX_MARGIN + ci * colWidth + 4, y: y - 11 - li * 11, size: 9, font: fonts.regular }))
        })
        y -= rowHeight
      })
      y -= 8
      continue
    }

    // A standalone image, or a paragraph whose only content is an image (the common shape
    // mammoth emits a letterhead logo as) — embedded and drawn inline, scaled to fit the
    // content width while preserving its aspect ratio, rather than silently dropped.
    const imgEl = tag === 'img' ? block : (block.nodeType === 1 ? block.querySelector?.('img') : null)
    if (imgEl && (tag === 'img' || !block.textContent || !block.textContent.trim())) {
      try {
        const src = imgEl.getAttribute('src') || ''
        const bytes = dataUrlToBytes(src)
        const isPng = src.includes('image/png')
        const img = await pdfDoc[isPng ? 'embedPng' : 'embedJpg'](bytes)
        const maxH = DOCX_PAGE.height - topInset - bottomInset
        const scale = Math.min(1, contentWidth / img.width, maxH / img.height)
        const dims = { width: img.width * scale, height: img.height * scale }
        ensureSpace(dims.height)
        page.drawImage(img, { x: DOCX_MARGIN, y: y - dims.height, width: dims.width, height: dims.height })
        y -= dims.height + 8
      } catch {
        // Unreadable/unsupported embedded image format — content still renders without it
        // rather than failing the whole quotation.
      }
      continue
    }

    const isHeading = /^h[1-6]$/.test(tag)
    const isListItem = tag === 'li'
    const baseSize = tag === 'h1' ? 16 : tag === 'h2' ? 14 : tag === 'h3' ? 12 : 9.5
    const runs = block.nodeType === 1
      ? collectStyledRuns(block, values, { size: baseSize, bold: isHeading })
      : [{ text: block.textContent, size: baseSize, bold: false, italic: false }]
    if (!runs.length) { y -= 8; continue }
    const indent = isListItem ? 14 : 0
    const prefix = isListItem ? (block.parentElement?.tagName.toLowerCase() === 'ol' ? `${Array.from(block.parentElement.children).indexOf(block) + 1}. ` : '• ') : ''
    if (prefix) runs.unshift({ text: prefix, bold: false, italic: false, underline: false, size: baseSize })
    const align = block.nodeType === 1 ? blockAlign(block) : 'left'
    const lines = wrapStyledRuns(runs, fonts, baseSize, contentWidth - indent)
    for (const line of lines) {
      ensureSpace(line.height)
      drawStyledLine(page, line, DOCX_MARGIN + indent, y, align, contentWidth - indent)
      y -= line.height
    }
    y -= isHeading ? 6 : 4
  }

  pages.forEach((p, i) => {
    deco.drawBands(p, i + 1, pages.length)
    // The automatic "Page X of Y" label would collide with a user-designed footer, which can
    // carry its own page-number tokens.
    if (pages.length > 1 && !deco.hasFooter) {
      const label = `Page ${i + 1} of ${pages.length}`
      p.drawText(label, { x: DOCX_PAGE.width - DOCX_MARGIN - fonts.regular.widthOfTextAtSize(label, 8), y: DOCX_MARGIN - 20, size: 8, font: fonts.regular, color: rgb(0.6, 0.6, 0.6) })
    }
  })

  return pdfDoc.save()
}

/**
 * Entry point used everywhere a quotation PDF is needed (Preview / Generate / Download / Print).
 * Uses the quotation's own assigned template if one is set and active; otherwise the built-in
 * default layout (today's state, since no official letterhead has been uploaded yet). Returns a
 * Uint8Array of PDF bytes — callers wrap it in a Blob for preview/download/print.
 */
export async function buildQuotationPdf({ quotation, preparedByName, template }) {
  // isActive only gates which template NEW quotations default to (see getDefaultTemplate() in
  // quotationActions.js) — a quotation that already has a templateId keeps rendering with it
  // even if that template is later deactivated, so an in-flight document is never retroactively
  // broken by an admin toggling a different template's status.
  if (template?.fileType === 'docx' && template.contentHtml) {
    try {
      return await buildFromDocxContent({ quotation, template, preparedByName })
    } catch {
      return buildDefaultLayout({ quotation, preparedByName })
    }
  }
  if (template && template.fields?.length) {
    try {
      return await buildFromTemplate({ quotation, template, preparedByName })
    } catch {
      // Falls back to the default layout rather than failing the whole action if the stored
      // template bytes are somehow corrupt/unreadable — the quotation itself is never blocked.
      return buildDefaultLayout({ quotation, preparedByName })
    }
  }
  return buildDefaultLayout({ quotation, preparedByName })
}

export function pdfBytesToBlobUrl(bytes) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}
