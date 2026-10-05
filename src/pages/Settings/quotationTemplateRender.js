import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const MAX_FILE_BYTES = 10 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsDataURL(file)
  })
}

function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image dimensions.'))
    img.src = dataUrl
  })
}

/**
 * Reads an uploaded PDF or image letterhead into the shape stored on a QuotationTemplate record
 * (see src/data/quotationTemplates.js): the raw file as a data URL (used verbatim as the PDF
 * generation background — see quotationPdf.js), the source's exact page/image dimensions in PDF
 * points (so the generated document preserves the original page size/orientation untouched),
 * and a flat PNG `previewDataUrl` used only for on-screen display in the template list and the
 * field-mapping editor's canvas.
 */
export async function readTemplateFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File is too large — please upload a file under 10 MB.')
  }
  const isPdf = file.type === 'application/pdf'
  const isImage = file.type === 'image/png' || file.type === 'image/jpeg'
  const isDocx = file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')
  const isLegacyDoc = file.name.toLowerCase().endsWith('.doc') && !isDocx
  if (isLegacyDoc) {
    throw new Error('Legacy .doc files can\'t be read in the browser — please re-save this file as .docx in Word (File → Save As → Word Document) and upload that instead.')
  }
  if (!isPdf && !isImage && !isDocx) {
    throw new Error('Unsupported file type — please upload a PDF, PNG, JPG or Word (.docx) document.')
  }

  if (isDocx) return readDocxFile(file)

  const fileData = await fileToDataUrl(file)

  if (isPdf) {
    const bytes = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    const page = await pdf.getPage(1)
    const nativeViewport = page.getViewport({ scale: 1 })
    const renderScale = Math.min(2, 1400 / nativeViewport.width)
    const renderViewport = page.getViewport({ scale: renderScale })
    const canvas = document.createElement('canvas')
    canvas.width = renderViewport.width
    canvas.height = renderViewport.height
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise
    return {
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileData,
      pageWidth: nativeViewport.width,
      pageHeight: nativeViewport.height,
      previewDataUrl: canvas.toDataURL('image/png'),
      fileSize: file.size,
      fileName: file.name,
    }
  }

  const dims = await imageDimensions(fileData)
  // Pixel → PDF point conversion at a standard 96dpi, so the generated page matches the
  // uploaded image's own aspect ratio and resolution-implied size exactly.
  const pageWidth = (dims.width * 72) / 96
  const pageHeight = (dims.height * 72) / 96
  return {
    fileType: 'image',
    mimeType: file.type,
    fileData,
    pageWidth,
    pageHeight,
    previewDataUrl: fileData,
    fileSize: file.size,
    fileName: file.name,
  }
}

const A4 = { width: 595.28, height: 841.89 }

/**
 * Word (.docx) templates are handled fundamentally differently from PDF/image letterheads:
 * there's no flat background to draw CRM fields on top of, because the document's own text
 * *is* the editable content — headings, boilerplate paragraphs, terms & conditions, tables,
 * logo. mammoth.js converts the docx body to a constrained, safe HTML subset (p/h1-h6/strong/
 * em/u/a/ul/ol/li/table and inline images as base64 data URIs) which becomes this template's
 * editable baseline (`contentHtml`) — see PageDesigner.jsx for where a user then edits
 * that content in place and embeds CRM-field tokens directly into the text flow, and
 * quotationPdf.js's buildFromDocxContent() for how it's walked back into a real paginated PDF.
 * docx doesn't expose page size/margins in a form mammoth surfaces, so page geometry defaults
 * to standard A4 portrait with normal margins — an honest limit of client-side conversion, not
 * something this app can read back out of the original file.
 */
async function readDocxFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const convertImage = mammoth.images.imgElement((image) =>
    image.read('base64').then((imageBuffer) => ({ src: `data:${image.contentType};base64,${imageBuffer}` })),
  )
  const result = await mammoth.convertToHtml({ arrayBuffer }, { convertImage })
  const fileData = await fileToDataUrl(file)
  return {
    fileType: 'docx',
    mimeType: DOCX_MIME,
    fileData,
    contentHtml: result.value,
    pageWidth: A4.width,
    pageHeight: A4.height,
    previewDataUrl: null,
    fileSize: file.size,
    fileName: file.name,
  }
}
