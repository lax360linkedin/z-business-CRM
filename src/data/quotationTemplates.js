// Uploaded quotation letterheads/templates (Settings → Quotation Templates). Starts empty —
// no official letterhead has been supplied yet, so quotation PDFs fall back to the built-in
// default layout (see src/pages/Quotations/quotationPdf.js) until one is uploaded and activated.
//
// Shape once a template exists:
// {
//   id, name, fileType: 'pdf'|'image', mimeType, fileData (data URL), fileSize,
//   pageWidth, pageHeight (points — the exact source page/image dimensions, preserved as-is),
//   fields: [{ key, xPct, yPct, wPct, hPct, fontSize, align, bold }] — see
//     QUOTATION_TEMPLATE_FIELDS in src/data/constants.js for the full key vocabulary,
//   isDefault, isActive, version, previousVersionId, uploadedBy, uploadedByName, uploadedAt,
// }
export const QUOTATION_TEMPLATES = []

export function getQuotationTemplateById(id) {
  return QUOTATION_TEMPLATES.find((t) => t.id === id)
}
