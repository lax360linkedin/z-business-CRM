import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { safeText } from '../Quotations/pdfDecorations'
import { formatDate } from '../../utils/format'

const A4 = { w: 595.28, h: 841.89 }
const M = 42
const money = (n) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`

function wrap(font, text, size, maxW) {
  const words = safeText(text, font).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  words.forEach((w) => {
    const test = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(test, size) > maxW && line) { lines.push(line); line = w } else line = test
  })
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** Sales Order as a PDF — straight from the stored order record (so it always matches what the CRM shows). */
export async function buildSalesOrderPdf({ order, ownerName, invoice }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const grey = rgb(0.45, 0.45, 0.5)
  let page = pdf.addPage([A4.w, A4.h])
  let y = A4.h - M

  const newPage = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - M }
  const ensure = (need) => { if (y - need < M + 20) newPage() }
  const text = (t, x, size = 9, f = font, color = rgb(0.1, 0.1, 0.12)) => page.drawText(safeText(t, f), { x, y, size, font: f, color })
  const right = (t, xRight, size = 9, f = font) => { const s = safeText(t, f); page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color: rgb(0.1, 0.1, 0.12) }) }

  text('SALES ORDER', M, 20, bold, rgb(0.35, 0.2, 0.75))
  right(order.number, A4.w - M, 14, bold)
  y -= 16
  right(`Order date: ${formatDate(order.orderDate)}`, A4.w - M, 9)
  y -= 12
  right(`Expected delivery: ${formatDate(order.expectedDeliveryDate)}`, A4.w - M, 9)
  y -= 12
  right(`Status: ${order.status}${order.revision > 1 ? ` · Revision ${order.revision}` : ''}`, A4.w - M, 9)
  y -= 26

  const colW = (A4.w - M * 2 - 20) / 2
  const block = (title, lines, x) => {
    let yy = y
    page.drawText(title.toUpperCase(), { x, y: yy, size: 8, font: bold, color: grey })
    yy -= 13
    lines.filter(Boolean).forEach((l) => wrap(font, l, 9, colW).forEach((w) => { page.drawText(w, { x, y: yy, size: 9, font }); yy -= 12 }))
    return yy
  }
  const left = block('Customer', [order.customerName, order.contactName && `Attn: ${order.contactName}`, order.contactEmail, order.contactPhone, order.gstin && `GSTIN: ${order.gstin}`], M)
  const rightY = block('Order details', [
    `Quotation: ${order.quotationNumber || '—'}`, order.dealId && `Deal: ${order.dealId}`, `Owner: ${ownerName || '—'}`,
    `Payment terms: ${order.paymentTerms}`, invoice && `Invoice: ${invoice.number}`,
  ], M + colW + 20)
  y = Math.min(left, rightY) - 8
  const b = block('Billing address', [order.billingAddress], M)
  const s = block('Shipping / service address', [order.shippingAddress || order.billingAddress], M + colW + 20)
  y = Math.min(b, s) - 12

  // table
  const cols = { name: M, qty: M + 250, price: M + 300, disc: M + 372, tax: M + 412, total: A4.w - M }
  const head = () => {
    page.drawRectangle({ x: M, y: y - 5, width: A4.w - M * 2, height: 18, color: rgb(0.95, 0.95, 0.97) })
    text('Item / service', cols.name + 4, 8, bold); text('Qty', cols.qty, 8, bold); text('Unit price', cols.price, 8, bold)
    text('Disc', cols.disc, 8, bold); text('Tax', cols.tax, 8, bold); right('Total', cols.total - 4, 8, bold)
    y -= 20
  }
  head()
  const calc = (it) => { const g = it.qty * it.unitPrice; const d = g * (it.discount / 100); const t = (g - d) * (it.taxRate / 100); return g - d + t }
  order.items.forEach((it) => {
    const lines = [...wrap(font, it.name, 9, 235), ...(it.description ? wrap(font, it.description, 8, 235) : [])]
    ensure(lines.length * 11 + 8)
    if (y > A4.h - M - 5) head()
    let yy = y
    lines.forEach((l, i) => { page.drawText(l, { x: cols.name + 4, y: yy, size: i === 0 ? 9 : 8, font, color: i === 0 ? rgb(0.1, 0.1, 0.12) : grey }); yy -= 11 })
    text(String(it.qty), cols.qty); text(money(it.unitPrice), cols.price, 8.5); text(`${it.discount}%`, cols.disc); text(`${it.taxRate}%`, cols.tax)
    right(money(calc(it)), cols.total - 4, 9)
    y = yy - 6
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: A4.w - M, y: y + 3 }, thickness: 0.4, color: rgb(0.88, 0.88, 0.9) })
  })

  ensure(130)
  y -= 8
  const tx = A4.w - M - 210
  const row = (label, value, f = font, size = 9) => { page.drawText(label, { x: tx, y, size, font: f }); right(value, A4.w - M, size, f); y -= 14 }
  row('Subtotal', money(order.subtotal))
  if (order.discountAmount) row('Discount', `- ${money(order.discountAmount)}`)
  row('Taxable amount', money(order.taxableAmount))
  if (order.taxType === 'inter') row('IGST', money(order.igst))
  else { row('CGST', money(order.cgst)); row('SGST', money(order.sgst)) }
  page.drawLine({ start: { x: tx, y: y + 10 }, end: { x: A4.w - M, y: y + 10 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.65) })
  row('Grand total', money(order.amount), bold, 11)
  y -= 8

  const para = (title, t) => {
    if (!t) return
    const lines = wrap(font, t, 9, A4.w - M * 2)
    ensure(lines.length * 12 + 24)
    text(title.toUpperCase(), M, 8, bold, grey); y -= 13
    lines.forEach((l) => { page.drawText(l, { x: M, y, size: 9, font }); y -= 12 })
    y -= 8
  }
  para('Delivery terms', order.deliveryTerms)
  para('Notes', order.notes)

  pdf.getPages().forEach((p, i, all) => {
    p.drawText(`${order.number} · Page ${i + 1} of ${all.length}`, { x: M, y: 22, size: 8, font, color: grey })
  })
  return pdf.save()
}
