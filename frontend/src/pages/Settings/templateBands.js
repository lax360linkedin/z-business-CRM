// Header / Footer / Watermark model for quotation templates, shared by the visual designer
// (PageDesigner.jsx) and the PDF engine (pages/Quotations/pdfDecorations.js) so both agree on
// geometry. All distances are PDF points measured on the template's own page, 1pt = 1 CSS px in
// the designer's 1:1 page canvas.
//
// These live on the template record next to its content, for every template type (docx, PDF
// background, image background): a template saved with them is rendered with them on every page
// of every quotation generated from it, and edits only ever affect quotations generated later.

export const BAND_SIDE_MARGIN = 54 // left/right inset of header/footer content
export const HEADER_TOP = 28 // page top edge → top of header content
export const FOOTER_BOTTOM = 28 // page bottom edge → bottom of footer content
export const BAND_GAP = 14 // minimum clear space between a band and the quotation body
export const BAND_DEFAULT_SIZE = 10
export const BAND_LEADING = 1.25 // line height multiple inside header/footer

export const WATERMARK_H = { left: 0.25, center: 0.5, right: 0.75 }
export const WATERMARK_V = { top: 0.2, middle: 0.5, bottom: 0.8 }

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]

export function defaultBand() {
  return { enabled: false, html: '', logo: null }
}

export function defaultWatermark() {
  return {
    enabled: false,
    type: 'text',
    text: 'CONFIDENTIAL',
    color: '#6b7280',
    fontSize: 72,
    imageDataUrl: null,
    imageWidthPct: 50,
    opacity: 0.15,
    rotation: 45,
    hAlign: 'center',
    vAlign: 'middle',
  }
}

/** Fills in defaults for any template (including ones saved before this feature existed). */
export function normalizeDecorations(template) {
  return {
    header: { ...defaultBand(), ...(template?.header || {}) },
    footer: { ...defaultBand(), ...(template?.footer || {}) },
    watermark: { ...defaultWatermark(), ...(template?.watermark || {}) },
  }
}

export function hasDecorations(template) {
  const { header, footer, watermark } = normalizeDecorations(template)
  return header.enabled || footer.enabled || watermark.enabled
}

export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return [0.42, 0.45, 0.5]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
