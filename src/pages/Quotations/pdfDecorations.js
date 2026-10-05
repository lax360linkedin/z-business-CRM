import { rgb, degrees } from 'pdf-lib'
import {
  BAND_SIDE_MARGIN, HEADER_TOP, FOOTER_BOTTOM, BAND_GAP, BAND_DEFAULT_SIZE, BAND_LEADING,
  WATERMARK_H, WATERMARK_V, normalizeDecorations, hexToRgb01,
} from '../Settings/templateBands'

// --- Text safety -----------------------------------------------------------------------------
// Standard PDF fonts only encode WinAnsi; drawing any other glyph throws. Replace the Rupee sign
// the same way the rest of the PDF does, and drop anything the font genuinely can't encode so a
// stray emoji in a header never fails the whole quotation.
const charsetCache = new Map()
function charset(font) {
  if (!charsetCache.has(font)) {
    let set
    try { set = new Set(font.getCharacterSet()) } catch { set = null }
    charsetCache.set(font, set)
  }
  return charsetCache.get(font)
}
export function safeText(text, font) {
  const t = String(text ?? '').replace(/₹/g, 'Rs.').replace(/ /g, ' ')
  const set = charset(font)
  let out = ''
  for (const ch of t) {
    const cp = ch.codePointAt(0)
    if (set ? set.has(cp) : cp < 256) out += ch
  }
  return out
}

// --- Styled runs -----------------------------------------------------------------------------
const FONT_TAG_SIZES = [0, 8, 10, 12, 14, 18, 24, 36]

function sizeOf(el, inherited) {
  const fs = el.style?.fontSize
  if (fs) {
    const n = parseFloat(fs)
    if (!Number.isNaN(n)) return fs.endsWith('px') ? n * 0.75 : n
  }
  if (el.tagName === 'FONT' && el.getAttribute('size')) return FONT_TAG_SIZES[Number(el.getAttribute('size'))] || inherited
  return inherited
}

/**
 * Walks an element's children into {text, bold, italic, underline, size} runs, resolving any
 * [data-field] token to its live value (page tokens included). `<br>` becomes a '\n' run.
 */
export function collectStyledRuns(node, values, base = {}) {
  const runs = []
  const walk = (n, st) => {
    if (n.nodeType === 3) {
      if (n.textContent) runs.push({ text: n.textContent, ...st })
      return
    }
    if (n.nodeType !== 1) return
    const tag = n.tagName.toLowerCase()
    if (tag === 'br') { runs.push({ text: '\n', ...st }); return }
    if (n.hasAttribute('data-field')) {
      const val = values[n.getAttribute('data-field')]
      if (val) runs.push({ text: String(val), ...st })
      return
    }
    const next = {
      bold: st.bold || tag === 'strong' || tag === 'b' || /^(bold|[6-9]00)$/.test(n.style?.fontWeight || ''),
      italic: st.italic || tag === 'em' || tag === 'i' || n.style?.fontStyle === 'italic',
      underline: st.underline || tag === 'u' || (n.style?.textDecoration || '').includes('underline'),
      size: sizeOf(n, st.size),
    }
    Array.from(n.childNodes).forEach((c) => walk(c, next))
  }
  walk(node, { bold: !!base.bold, italic: !!base.italic, underline: false, size: base.size })
  // A trailing <br> is just the browser's end-of-block placeholder, not a real blank line.
  while (runs.length > 1 && runs[runs.length - 1].text === '\n') runs.pop()
  return runs
}

export function blockAlign(el, fallback = 'left') {
  const a = el.style?.textAlign || el.getAttribute?.('align') || fallback
  return ['left', 'center', 'right', 'justify'].includes(a) ? (a === 'justify' ? 'left' : a) : fallback
}

/** Greedy word-wrap of styled runs into lines of {tokens:[{text,font,size,underline}], width, height}. */
export function wrapStyledRuns(runs, fonts, defaultSize, maxWidth, leading = (s) => s + 6) {
  const fontFor = (r) => (r.bold && r.italic ? fonts.boldItalic : r.bold ? fonts.bold : r.italic ? fonts.italic : fonts.regular)
  const lines = []
  let tokens = []
  let width = 0
  const flush = () => {
    const size = tokens.length ? Math.max(...tokens.map((t) => t.size)) : defaultSize
    lines.push({ tokens, width, size, height: leading(size) })
    tokens = []
    width = 0
  }
  runs.forEach((r) => {
    const font = fontFor(r)
    const size = r.size || defaultSize
    if (r.text === '\n') { flush(); return }
    safeText(r.text, font).split(/(\s+)/).forEach((piece) => {
      if (!piece) return
      const isSpace = /^\s+$/.test(piece)
      if (isSpace && tokens.length === 0) return
      const w = font.widthOfTextAtSize(piece, size)
      if (width + w > maxWidth && tokens.length) {
        // Trailing space at the wrap point shouldn't count toward alignment width.
        while (tokens.length && /^\s+$/.test(tokens[tokens.length - 1].text)) width -= tokens.pop().w
        flush()
        if (isSpace) return
      }
      tokens.push({ text: piece, font, size, underline: !!r.underline, w })
      width += w
    })
  })
  if (tokens.length || lines.length === 0) flush()
  return lines
}

/** Draws one wrapped line with its top edge at `top`; baseline sits one font-size below it. */
export function drawStyledLine(page, line, x, top, align, maxWidth, color = rgb(0.12, 0.12, 0.12)) {
  let cx = x
  if (align === 'center') cx = x + (maxWidth - line.width) / 2
  else if (align === 'right') cx = x + maxWidth - line.width
  const baseline = top - line.size
  line.tokens.forEach((t) => {
    page.drawText(t.text, { x: cx, y: baseline, size: t.size, font: t.font, color })
    if (t.underline) page.drawLine({ start: { x: cx, y: baseline - 1.5 }, end: { x: cx + t.w, y: baseline - 1.5 }, thickness: 0.6, color })
    cx += t.w
  })
}

// --- Header / footer -------------------------------------------------------------------------
async function embedDataUrlImage(pdfDoc, dataUrl) {
  if (!dataUrl) return null
  try {
    const base64 = dataUrl.split(',')[1] || ''
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return dataUrl.includes('image/png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes)
  } catch {
    return null
  }
}

function bandBlocks(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  // Text typed straight into the editor (before any Enter) lands as loose inline nodes at the
  // root; gather consecutive ones into a single paragraph so "Acme <b>Ltd</b>" stays one line.
  const INLINE = new Set(['span', 'b', 'strong', 'i', 'em', 'u', 'font', 'a', 'sub', 'sup', 'br'])
  const blocks = []
  let loose = null
  Array.from(doc.body.childNodes).forEach((n) => {
    const isInline = n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.tagName.toLowerCase()))
    if (isInline) {
      if (!loose) { loose = doc.createElement('div'); loose.__loose = true; blocks.push(loose) }
      loose.appendChild(n.cloneNode(true))
    } else {
      loose = null
      if (n.nodeType === 1) blocks.push(n)
    }
  })
  return blocks.filter((b) => !(b.tagName === 'DIV' && b.__loose && !b.textContent.trim() && !b.querySelector('[data-field]')))
}

/** Lays a band out for one page: returns its total height and a draw(page, topY) closure. */
function layoutBand(band, logoImg, fonts, values, pageWidth) {
  const width = pageWidth - BAND_SIDE_MARGIN * 2
  let logoW = 0
  let logoH = 0
  if (logoImg && band.logo) {
    logoH = band.logo.height || 40
    logoW = (logoImg.width / logoImg.height) * logoH
  }
  const sideBySide = logoImg && band.logo?.align !== 'center'
  const textWidth = sideBySide ? Math.max(60, width - logoW - 14) : width
  const textLeft = sideBySide && band.logo.align === 'left' ? BAND_SIDE_MARGIN + logoW + 14 : BAND_SIDE_MARGIN

  const paragraphs = bandBlocks(band.html).map((block) => {
    const el = block.nodeType === 1 ? block : null
    const size = el ? sizeOf(el, BAND_DEFAULT_SIZE) : BAND_DEFAULT_SIZE
    const runs = el ? collectStyledRuns(el, values, { size }) : [{ text: block.textContent, size, bold: false, italic: false }]
    return { align: el ? blockAlign(el) : 'left', lines: wrapStyledRuns(runs, fonts, size, textWidth, (s) => s * BAND_LEADING) }
  })
  const textHeight = paragraphs.reduce((h, p) => h + p.lines.reduce((s, l) => s + l.height, 0) + 2, 0)
  const empty = !logoImg && paragraphs.every((p) => p.lines.every((l) => l.tokens.length === 0))
  if (empty) return { height: 0, draw: () => {} }

  const height = sideBySide ? Math.max(logoH, textHeight) : logoH + (logoH && textHeight ? 4 : 0) + textHeight
  const draw = (page, topY) => {
    let textTop = topY
    if (logoImg) {
      const lx = band.logo.align === 'center' ? BAND_SIDE_MARGIN + (width - logoW) / 2 : band.logo.align === 'right' ? BAND_SIDE_MARGIN + width - logoW : BAND_SIDE_MARGIN
      page.drawImage(logoImg, { x: lx, y: topY - logoH, width: logoW, height: logoH })
      if (!sideBySide) textTop = topY - logoH - 4
    }
    const color = rgb(0.2, 0.2, 0.22)
    paragraphs.forEach((p) => {
      p.lines.forEach((line) => {
        drawStyledLine(page, line, textLeft, textTop, p.align, textWidth, color)
        textTop -= line.height
      })
      textTop -= 2
    })
  }
  return { height, draw }
}

/**
 * Embeds logo/watermark images once per document and measures the header and footer, so the
 * caller can (a) keep body content inside [topLimit, bottomLimit] and (b) draw the bands on every
 * page. Heights are measured with a representative page number — a page token never changes a
 * line's height, so every page's band is the same size.
 */
export async function prepareDecorations(pdfDoc, template, fonts, baseValues, pageSize) {
  const { header, footer, watermark } = normalizeDecorations(template)
  const hLogo = header.enabled ? await embedDataUrlImage(pdfDoc, header.logo?.dataUrl) : null
  const fLogo = footer.enabled ? await embedDataUrlImage(pdfDoc, footer.logo?.dataUrl) : null
  const wmImage = watermark.enabled && watermark.type === 'image' ? await embedDataUrlImage(pdfDoc, watermark.imageDataUrl) : null
  const withPage = (n, total) => ({ ...baseValues, pageNumber: String(n), pageCount: String(total) })

  const measure = (band, logo) => (band.enabled ? layoutBand(band, logo, fonts, withPage(1, 1), pageSize.width).height : 0)
  const headerHeight = measure(header, hLogo)
  const footerHeight = measure(footer, fLogo)

  return {
    header, footer, watermark, hLogo, fLogo, wmImage, headerHeight, footerHeight,
    // y-from-top where body content may begin / y-from-bottom where it must stop.
    bodyTop: headerHeight ? HEADER_TOP + headerHeight + BAND_GAP : 0,
    bodyBottom: footerHeight ? FOOTER_BOTTOM + footerHeight + BAND_GAP : 0,
    hasFooter: footerHeight > 0,
    drawWatermark: (page) => drawWatermark(page, watermark, wmImage, fonts, pageSize),
    drawBands: (page, pageNumber, pageCount) => {
      const values = withPage(pageNumber, pageCount)
      if (header.enabled && headerHeight) layoutBand(header, hLogo, fonts, values, pageSize.width).draw(page, pageSize.height - HEADER_TOP)
      if (footer.enabled && footerHeight) layoutBand(footer, fLogo, fonts, values, pageSize.width).draw(page, FOOTER_BOTTOM + footerHeight)
    },
  }
}

// --- Watermark -------------------------------------------------------------------------------
function drawWatermark(page, wm, image, fonts, pageSize) {
  if (!wm.enabled) return
  const cx = pageSize.width * (WATERMARK_H[wm.hAlign] ?? 0.5)
  const cy = pageSize.height * (1 - (WATERMARK_V[wm.vAlign] ?? 0.5))
  const theta = ((wm.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const opacity = Math.min(1, Math.max(0.02, Number(wm.opacity) || 0.15))
  // pdf-lib rotates around the object's bottom-left corner, so place that corner such that the
  // object's centre lands on (cx, cy) after rotation.
  const place = (w, h) => ({ x: cx - ((w / 2) * cos - (h / 2) * sin), y: cy - ((w / 2) * sin + (h / 2) * cos) })

  if (wm.type === 'image' && image) {
    const w = pageSize.width * ((wm.imageWidthPct || 50) / 100)
    const h = (w * image.height) / image.width
    const { x, y } = place(w, h)
    page.drawImage(image, { x, y, width: w, height: h, opacity, rotate: degrees(wm.rotation || 0) })
    return
  }
  if (wm.type === 'text' && wm.text?.trim()) {
    const font = fonts.bold
    const size = wm.fontSize || 72
    const text = safeText(wm.text, font)
    if (!text) return
    const w = font.widthOfTextAtSize(text, size)
    const h = size * 0.72 // cap height, so the visual (not the em box) is what gets centred
    const { x, y } = place(w, h)
    const [r, g, b] = hexToRgb01(wm.color)
    page.drawText(text, { x, y, size, font, color: rgb(r, g, b), opacity, rotate: degrees(wm.rotation || 0) })
  }
}
