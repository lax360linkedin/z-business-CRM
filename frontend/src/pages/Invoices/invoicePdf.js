import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { safeText } from '../Quotations/pdfDecorations'
import { formatDate } from '../../utils/format'

const A4 = { w: 595.28, h: 841.89 }
const M = 40
const money = (n) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`
const plain = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

function wrap(font, text, size, maxW) {
  const lines = []
  String(text ?? '').split('\n').forEach((para) => {
    const words = safeText(para, font).split(/\s+/).filter(Boolean)
    let line = ''
    words.forEach((w) => { const t = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(t, size) > maxW && line) { lines.push(line); line = w } else line = t })
    lines.push(line)
  })
  return lines.length ? lines : ['']
}

/**
 * The invoice as a PDF, straight from the stored record (so it always matches what the CRM shows): header with the seller's details, bill-to / ship-to
 * (from the billing snapshot, so a later change to the customer record never rewrites an issued invoice), line items, tax breakup, totals, payments
 * received, notes, terms and bank details. Returns the PDF bytes.
 */
export async function buildInvoicePdf({ invoice, config, payments = [] }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.14); const grey = rgb(0.45, 0.45, 0.5); const brand = rgb(0.35, 0.2, 0.75)
  const org = config.org
  const snap = invoice.snapshot || {}
  let page = pdf.addPage([A4.w, A4.h])
  let y = A4.h - M
  const pages = [page]
  const newPage = () => { page = pdf.addPage([A4.w, A4.h]); pages.push(page); y = A4.h - M }
  const ensure = (need) => { if (y - need < M + 30) newPage() }
  const text = (t, x, size = 9, f = font, color = ink) => page.drawText(safeText(t, f), { x, y, size, font: f, color })
  const right = (t, xr, size = 9, f = font, color = ink) => { const s = safeText(t, f); page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y, size, font: f, color }) }
  const rule = (yy = y, color = rgb(0.88, 0.88, 0.92)) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4.w - M, y: yy }, thickness: 0.6, color })

  // header
  text(org.name, M, 16, bold, brand)
  const orgLines = [...wrap(font, org.address, 8.5, 250), org.gstin && `GSTIN: ${org.gstin}`, org.pan && `PAN: ${org.pan}`, [org.email, org.phone].filter(Boolean).join('  |  ')].filter(Boolean)
  let yy = y - 14
  orgLines.forEach((l) => { page.drawText(safeText(l, font), { x: M, y: yy, size: 8.5, font, color: grey }); yy -= 11 })
  const title = invoice.status === 'Void' ? 'VOID INVOICE' : invoice.status === 'Cancelled' ? 'CANCELLED INVOICE' : invoice.status === 'Draft' ? 'DRAFT INVOICE' : 'TAX INVOICE'
  right(title, A4.w - M, 16, bold, invoice.status === 'Void' || invoice.status === 'Cancelled' ? rgb(0.75, 0.15, 0.2) : ink)
  y -= 16; right(invoice.number, A4.w - M, 11, bold)
  y -= 14; right(`Invoice date: ${formatDate(invoice.issueDate)}`, A4.w - M, 9)
  y -= 12; right(`Due date: ${formatDate(invoice.dueDate)}`, A4.w - M, 9)
  y -= 12; right(`Status: ${invoice.status}`, A4.w - M, 9, bold)
  if (invoice.salesOrderNumber) { y -= 12; right(`Sales order: ${invoice.salesOrderNumber}`, A4.w - M, 9, font, grey) }
  y = Math.min(y, yy) - 14
  rule(); y -= 16

  // parties
  const colW = (A4.w - M * 2 - 24) / 2
  const block = (title2, lines, x) => {
    let b = y
    page.drawText(title2.toUpperCase(), { x, y: b, size: 8, font: bold, color: grey }); b -= 13
    lines.filter(Boolean).forEach((l, i) => wrap(i === 0 ? bold : font, l, 9, colW).forEach((w) => { page.drawText(w, { x, y: b, size: 9, font: i === 0 ? bold : font, color: ink }); b -= 12 }))
    return b
  }
  const left = block('Bill to', [snap.customerName || invoice.customerName, snap.companyName && snap.companyName !== snap.customerName ? snap.companyName : '', snap.contactName && `Attn: ${snap.contactName}`, invoice.billingAddress, (snap.gstin || invoice.gstin) && `GSTIN: ${snap.gstin || invoice.gstin}`, [snap.contactEmail, snap.contactPhone].filter(Boolean).join('  |  ')], M)
  const rt = block('Ship to / service address', [snap.customerName || invoice.customerName, invoice.shippingAddress || invoice.billingAddress, `Payment terms: ${invoice.paymentTerms || '—'}`], M + colW + 24)
  y = Math.min(left, rt) - 10

  // items
  const cols = [['#', M, 'l'], ['Item', M + 18, 'l'], ['Qty', 318, 'r'], ['Rate', 372, 'r'], ['Disc %', 408, 'r'], ['GST %', 446, 'r'], ['Amount', A4.w - M, 'r']]
  const header = () => {
    page.drawRectangle({ x: M, y: y - 4, width: A4.w - M * 2, height: 16, color: rgb(0.95, 0.94, 0.99) })
    cols.forEach(([h, x, al]) => { if (al === 'r') right(h, x, 8, bold, grey); else text(h, x, 8, bold, grey) })
    y -= 18
  }
  header()
  const fin = !invoice.financialHidden
  ;(invoice.items || []).forEach((it, i) => {
    const gross = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
    const net = gross * (1 - (Number(it.discount) || 0) / 100)
    const desc = [it.name, it.description].filter(Boolean)
    const lines = [...wrap(bold, desc[0] || '', 9, 230), ...(desc[1] ? wrap(font, desc[1], 8, 230) : [])]
    ensure(12 * lines.length + 8)
    if (y > A4.h - M - 5) header()
    text(String(i + 1), M, 9, font, grey)
    lines.forEach((l, k) => { page.drawText(l, { x: M + 18, y: y - k * 11, size: k === 0 ? 9 : 8, font: k === 0 ? bold : font, color: k === 0 ? ink : grey }) })
    right(`${it.qty}${it.unit ? ` ${it.unit}` : ''}`, 318, 9)
    right(fin ? plain(it.unitPrice) : '—', 372, 9)
    right(fin ? `${it.discount || 0}` : '—', 408, 9)
    right(fin ? `${it.taxRate ?? 0}` : '—', 446, 9)
    right(fin ? plain(net) : '—', A4.w - M, 9)
    y -= 11 * lines.length + 5
    rule(y + 3)
  })
  y -= 10

  // totals
  if (fin) {
    const rows = [['Subtotal', invoice.subtotal], invoice.discountAmount > 0 && ['Discount', -invoice.discountAmount], ['Taxable amount', invoice.taxableAmount],
      ...(invoice.taxType === 'inter' ? [['IGST', invoice.igst]] : [['CGST', invoice.cgst], ['SGST', invoice.sgst]]),
      ...(invoice.extraTaxes || []).map((t) => [`${t.name} (${t.rate}%)`, t.amount]), invoice.roundOff ? ['Round off', invoice.roundOff] : null].filter(Boolean)
    ensure(rows.length * 13 + 70)
    rows.forEach(([k, v]) => { text(k, 380, 9, font, grey); right(`${v < 0 ? '- ' : ''}${money(Math.abs(v))}`, A4.w - M, 9); y -= 13 })
    page.drawLine({ start: { x: 380, y: y + 8 }, end: { x: A4.w - M, y: y + 8 }, thickness: 0.8, color: ink })
    text('Grand total', 380, 11, bold); right(money(invoice.amount), A4.w - M, 11, bold); y -= 15
    text('Amount paid', 380, 9, font, grey); right(money(invoice.paidAmount), A4.w - M, 9); y -= 13
    text('Balance due', 380, 11, bold, brand); right(money(invoice.balance), A4.w - M, 11, bold, brand); y -= 20
  } else { text('Financial details are restricted for your role.', M, 9, font, grey); y -= 18 }

  const live = payments.filter((p) => p.status === 'Completed')
  if (fin && live.length) {
    ensure(live.length * 12 + 30)
    text('PAYMENTS RECEIVED', M, 8, bold, grey); y -= 13
    live.forEach((p) => { text(`${formatDate(p.date)}   ${p.reference}   ${p.method}`, M, 8.5); right(money(p.amount), A4.w - M, 8.5); y -= 12 })
    y -= 6
  }
  const section = (title2, body2) => {
    if (!body2) return
    const lines = wrap(font, body2, 8.5, A4.w - M * 2)
    ensure(lines.length * 11 + 22)
    text(title2.toUpperCase(), M, 8, bold, grey); y -= 12
    lines.forEach((l) => { text(l, M, 8.5, font, ink); y -= 11 })
    y -= 6
  }
  section('Notes', invoice.notes)
  section('Terms & conditions', invoice.terms)
  section('Bank details', config.bankDetails)
  if (invoice.status === 'Void' || invoice.status === 'Cancelled') section(`${invoice.status} — reason`, invoice.closeReason)
  pages.forEach((p, i) => {
    p.drawText(safeText(config.footer, font).slice(0, 110), { x: M, y: 24, size: 7.5, font, color: grey })
    const label = `${invoice.number}  |  Page ${i + 1} of ${pages.length}`
    p.drawText(label, { x: A4.w - M - font.widthOfTextAtSize(label, 7.5), y: 24, size: 7.5, font, color: grey })
  })
  return pdf.save()
}
