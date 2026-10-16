// The company logo as bytes a PDF can embed (PNG or JPEG). An uploaded SVG is drawn onto a canvas and turned into a PNG, because PDF libraries cannot embed SVG.
import { getLogoSrc } from '../hooks/useBranding'

const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8
const MAX_WIDTH = 800

function rasterize(svgBytes) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgBytes], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const ratio = (img.naturalWidth || 300) / (img.naturalHeight || 100)
      const width = Math.min(MAX_WIDTH, Math.max(img.naturalWidth || 300, 300))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = Math.max(1, Math.round(width / ratio))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))) : reject(new Error('Could not convert the logo.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the logo.')) }
    img.src = url
  })
}

/** { bytes, kind: 'png' | 'jpg' } for the logo currently in use, or null when it cannot be loaded. */
export async function logoForPdf() {
  try {
    const res = await fetch(getLogoSrc())
    if (!res.ok) return null
    let bytes = new Uint8Array(await res.arrayBuffer())
    if (!isPng(bytes) && !isJpg(bytes)) bytes = await rasterize(bytes) // an SVG
    return { bytes, kind: isPng(bytes) ? 'png' : 'jpg' }
  } catch {
    return null
  }
}

export async function logoDataUrl() {
  const logo = await logoForPdf()
  if (!logo) throw new Error('Could not load the company logo.')
  let binary = ''
  logo.bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return `data:image/${logo.kind === 'png' ? 'png' : 'jpeg'};base64,${btoa(binary)}`
}
