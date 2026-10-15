import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { safeText } from '../Quotations/pdfDecorations'
import { formatDate } from '../../utils/format'

const money = (n) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`

/** A payment receipt as a PDF, from the stored payment and its invoice: seller details, receipt number, payer, invoice, amount, method, reference, previous balance, amount received, remaining balance, receiver and notes. */
export async function buildReceiptPdf({ payment, config }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595.28, 520])
  const W = 595.28; const M = 44
  const ink = rgb(0.1, 0.1, 0.14); const grey = rgb(0.45, 0.45, 0.5); const brand = rgb(0.35, 0.2, 0.75)
  let y = 520 - M
  const t = (s, x, size = 10, f = font, c = ink) => page.drawText(safeText(s, f), { x, y, size, font: f, color: c })
  const r = (s, size = 10, f = font, c = ink) => { const v = safeText(s, f); page.drawText(v, { x: W - M - f.widthOfTextAtSize(v, size), y, size, font: f, color: c }) }
  const org = config.org
  t(org.name, M, 16, bold, brand); r('PAYMENT RECEIPT', 15, bold); y -= 14
  t(org.address, M, 8.5, font, grey); r(payment.number, 11, bold); y -= 11
  t([org.gstin && `GSTIN ${org.gstin}`, org.email, org.phone].filter(Boolean).join('  |  '), M, 8.5, font, grey); r(`Date: ${formatDate(payment.date)}`, 9); y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.88, 0.88, 0.92) }); y -= 20
  const row = (k, v, bigger) => { t(k, M, 9, font, grey); t(String(v ?? '—'), M + 150, bigger ? 11 : 10, bigger ? bold : font); y -= 17 }
  row('Received from', payment.customerName)
  if (payment.companyName && payment.companyName !== payment.customerName) row('Company', payment.companyName)
  if (payment.contactName) row('Contact', payment.contactName)
  row('Against invoice', payment.invoiceNumber)
  row('Payment method', `${payment.method}${payment.bankAccount ? ` — ${payment.bankAccount}` : ''}`)
  row('Transaction reference', payment.reference || '—')
  row('Payment status', payment.status)
  y -= 6
  page.drawRectangle({ x: M, y: y - 62, width: W - M * 2, height: 72, color: rgb(0.96, 0.95, 0.99) })
  y -= 8
  t('Invoice total', M + 12, 9, font, grey); r(money(payment.invoiceTotal), 10); y -= 16
  t('Previous balance', M + 12, 9, font, grey); r(money(payment.previousBalance), 10); y -= 16
  t('Amount received', M + 12, 11, bold, brand); r(money(payment.netAmount ?? payment.amount), 12, bold, brand); y -= 17
  t('Remaining balance', M + 12, 9, font, grey); r(money(payment.balanceAfter), 10, bold); y -= 30
  row('Received by', payment.receivedByName || '—')
  if (payment.notes) row('Notes', payment.notes.slice(0, 90))
  if (payment.refundedAmount > 0) row('Refunded', money(payment.refundedAmount))
  y = 52; t('This is a computer-generated receipt and needs no signature.', M, 8, font, grey)
  r(config.footer.slice(0, 60), 8, font, grey)
  return pdf.save()
}
