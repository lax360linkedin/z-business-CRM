import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, ImagePlus, Trash2, Building2, Plus, AlertTriangle, PanelTop, PanelBottom, Droplets } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { FormField, Input } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { LOGO_SRC } from '../../components/common/Logo'
import { QUOTATION_TEMPLATE_FIELDS } from '../../data/constants'
import { RibbonToolbar } from './RibbonToolbar'
import { BAND_SIDE_MARGIN, HEADER_TOP, FOOTER_BOTTOM, BAND_GAP, BAND_DEFAULT_SIZE, BAND_LEADING, WATERMARK_H, WATERMARK_V, defaultBand, defaultWatermark } from './templateBands'

// The designer canvas is an A4 sheet laid out in CSS `pt` units — the same unit the PDF engine
// works in — so a 12 pt heading, a 54 pt margin or a 40 pt-tall logo takes exactly the proportion
// of the page here that it will in the generated quotation.
const PAGE_W = 595.28
const PAGE_H = 841.89
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
const PX_TO_PT = 0.75
const EMPTY_PARA = '<p><br></p>'

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { reject(new Error('Please choose a PNG or JPG image.')); return }
    if (file.size > MAX_IMAGE_BYTES) { reject(new Error('That image is over 1.5 MB — please use a smaller file.')); return }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

async function companyLogoDataUrl() {
  const res = await fetch(LOGO_SRC)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** One editable region (header, footer or document body). Populated once; afterwards the DOM is the source of truth and edits flow out through onChange. */
function RichZone({ html, onChange, onFocusZone, className = '', style, label }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html || EMPTY_PARA
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const emit = () => { if (ref.current) onChange(ref.current.innerHTML) }
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      onInput={emit}
      onBlur={emit}
      onFocus={() => {
        document.execCommand('defaultParagraphSeparator', false, 'p')
        onFocusZone(ref.current)
      }}
      onPaste={(e) => {
        // Plain-text paste keeps Word/web clipboard markup (fonts, spans, meta) out of the template.
        e.preventDefault()
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
      }}
      className={`focus:outline-none ${className}`}
      style={style}
    />
  )
}

const BAND_STYLE = { fontSize: `${BAND_DEFAULT_SIZE}pt`, lineHeight: BAND_LEADING, color: '#33333a', fontFamily: 'Helvetica, Arial, sans-serif', minHeight: `${BAND_DEFAULT_SIZE * BAND_LEADING}pt` }
const BAND_CLASS = '[&_p]:m-0 [&_p]:pb-[2pt] [&_div]:pb-[2pt]'
const BODY_CLASS = 'min-h-[300pt] [&_h1]:text-[16pt] [&_h1]:font-bold [&_h1]:mb-[6pt] [&_h2]:text-[14pt] [&_h2]:font-bold [&_h2]:mb-[6pt] [&_h3]:text-[12pt] [&_h3]:font-bold [&_h3]:mb-[6pt] [&_p]:mb-[4pt] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-ink-200 [&_td]:p-[4pt] [&_ul]:list-disc [&_ul]:pl-[14pt] [&_ol]:list-decimal [&_ol]:pl-[14pt] [&_img]:max-w-full'

function BandZone({ kind, band, onPatch, onFocusZone, panelSelected, zoneRef }) {
  const label = kind === 'header' ? 'Header' : 'Footer'
  const isHeader = kind === 'header'
  if (!band.enabled) {
    return (
      <div ref={zoneRef} className={`flex ${isHeader ? 'items-start' : 'items-end'}`} style={{ padding: `${isHeader ? 10 : 0}pt ${BAND_SIDE_MARGIN}pt ${isHeader ? 0 : 10}pt` }}>
        <button
          type="button"
          onClick={() => onPatch({ enabled: true, html: band.html || EMPTY_PARA })}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-ink-200 py-1.5 text-[11px] font-medium text-ink-400 hover:border-brand-400 hover:text-brand-600"
        >
          <Plus size={12} /> Add {label}
        </button>
      </div>
    )
  }
  const logo = band.logo
  const center = logo?.align === 'center'
  return (
    <div
      ref={zoneRef}
      className={`group relative ${panelSelected ? 'bg-brand-50/40' : ''}`}
      style={{ padding: `${isHeader ? HEADER_TOP : 0}pt ${BAND_SIDE_MARGIN}pt ${isHeader ? 0 : FOOTER_BOTTOM}pt` }}
    >
      <span className="pointer-events-none absolute right-2 top-1 rounded bg-brand-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white opacity-80">{label}</span>
      <div
        className="rounded-sm outline-dashed outline-1 outline-offset-2 outline-brand-300/70 focus-within:outline-brand-500"
        style={{ display: 'flex', flexDirection: center ? 'column' : 'row', gap: center ? '4pt' : '14pt', alignItems: center ? 'stretch' : 'flex-start' }}
      >
        {logo?.dataUrl && (
          <img
            src={logo.dataUrl}
            alt=""
            draggable={false}
            style={{ height: `${logo.height || 40}pt`, width: 'auto', order: logo.align === 'right' ? 2 : 0, alignSelf: center ? 'center' : 'flex-start', flexShrink: 0 }}
          />
        )}
        <RichZone
          label={`${label} content`}
          html={band.html}
          onChange={(html) => onPatch({ html })}
          onFocusZone={(el) => onFocusZone(kind, el)}
          className={`min-w-0 flex-1 ${BAND_CLASS}`}
          style={BAND_STYLE}
        />
      </div>
    </div>
  )
}

function AlignToggle({ value, onChange }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
      {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([v, Icon]) => (
        <button
          key={v}
          type="button"
          title={`Logo ${v}`}
          onClick={() => onChange(v)}
          className={`flex h-8 w-9 items-center justify-center ${value === v ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

function Range({ label, value, min, max, step = 1, suffix = '', onChange }) {
  return (
    <FormField label={`${label}: ${value}${suffix}`} className="mb-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-600" />
    </FormField>
  )
}

function BandPanel({ kind, band, onPatch, onRemove }) {
  const { toast } = useToast()
  const label = kind === 'header' ? 'Header' : 'Footer'
  const fileRef = useRef(null)
  const setLogo = (dataUrl, keep = {}) => onPatch({ enabled: true, html: band.html || EMPTY_PARA, logo: { dataUrl, height: keep.height || 40, align: keep.align || 'left' } })

  const useCompanyLogo = () => companyLogoDataUrl().then((u) => setLogo(u, band.logo || {})).catch(() => toast('Could not load the company logo.', { type: 'error' }))
  const upload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    readImageFile(file).then((u) => setLogo(u, band.logo || {})).catch((err) => toast(err.message, { type: 'error' }))
  }

  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
        <input type="checkbox" checked={band.enabled} onChange={(e) => onPatch(e.target.checked ? { enabled: true, html: band.html || EMPTY_PARA } : { enabled: false })} />
        Show {label.toLowerCase()} on every page
      </label>
      {band.enabled ? (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Company logo</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" icon={Building2} onClick={useCompanyLogo}>Use company logo</Button>
            <Button size="sm" variant="secondary" icon={ImagePlus} onClick={() => fileRef.current?.click()}>Upload…</Button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={upload} />
          </div>
          {band.logo?.dataUrl && (
            <>
              <Range label="Logo height" value={band.logo.height || 40} min={16} max={120} suffix=" pt" onChange={(height) => onPatch({ logo: { ...band.logo, height } })} />
              <FormField label="Logo position" className="mb-3">
                <AlignToggle value={band.logo.align || 'left'} onChange={(align) => onPatch({ logo: { ...band.logo, align } })} />
              </FormField>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onPatch({ logo: null })}>Remove logo</Button>
            </>
          )}
          <p className="mb-3 mt-3 text-xs text-ink-400">Click the {label.toLowerCase()} on the page to type. Use the ribbon for size, bold, alignment, CRM fields and page numbers.</p>
          <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove}>Remove {label}</Button>
        </>
      ) : (
        <p className="text-xs text-ink-400">Turned off — nothing is printed in the {label.toLowerCase()} area. Click “Add {label}” on the page or tick the box above.</p>
      )}
    </div>
  )
}

function WatermarkPanel({ wm, onPatch, onRemove }) {
  const { toast } = useToast()
  const fileRef = useRef(null)
  const upload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    readImageFile(file).then((u) => onPatch({ enabled: true, type: 'image', imageDataUrl: u })).catch((err) => toast(err.message, { type: 'error' }))
  }
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
        <input type="checkbox" checked={wm.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} />
        Show watermark on every page
      </label>
      {wm.enabled ? (
        <>
          <div className="mb-3 inline-flex overflow-hidden rounded-lg border border-ink-200 text-xs dark:border-ink-700">
            {[['text', 'Text'], ['image', 'Image']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => onPatch({ type: v })} className={`px-4 py-1.5 font-medium ${wm.type === v ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-800'}`}>{l}</button>
            ))}
          </div>
          {wm.type === 'text' ? (
            <>
              <FormField label="Watermark text" className="mb-3">
                <Input value={wm.text} maxLength={40} onChange={(e) => onPatch({ text: e.target.value })} placeholder="e.g. CONFIDENTIAL, DRAFT" />
              </FormField>
              <div className="mb-3 flex gap-3">
                <FormField label="Colour" className="w-16">
                  <input type="color" value={wm.color} onChange={(e) => onPatch({ color: e.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-ink-200 bg-transparent p-0.5 dark:border-ink-700" />
                </FormField>
                <FormField label="Font size (pt)" className="flex-1">
                  <Input type="number" min="20" max="200" value={wm.fontSize} onChange={(e) => onPatch({ fontSize: Math.min(200, Math.max(20, Number(e.target.value) || 72)) })} />
                </FormField>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Button size="sm" variant="secondary" icon={ImagePlus} onClick={() => fileRef.current?.click()}>{wm.imageDataUrl ? 'Replace image…' : 'Upload image…'}</Button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={upload} />
                {wm.imageDataUrl && <img src={wm.imageDataUrl} alt="" className="h-8 w-8 rounded border border-ink-200 object-contain dark:border-ink-700" />}
              </div>
              <Range label="Image width" value={wm.imageWidthPct} min={10} max={100} suffix="% of page" onChange={(imageWidthPct) => onPatch({ imageWidthPct })} />
            </>
          )}
          <Range label="Opacity" value={Math.round(wm.opacity * 100)} min={5} max={100} step={5} suffix="%" onChange={(v) => onPatch({ opacity: v / 100 })} />
          <Range label="Rotation" value={wm.rotation} min={-90} max={90} suffix="°" onChange={(rotation) => onPatch({ rotation })} />
          <FormField label="Position" className="mb-3">
            <div className="grid w-28 grid-cols-3 gap-1">
              {Object.keys(WATERMARK_V).flatMap((v) => Object.keys(WATERMARK_H).map((h) => (
                <button
                  key={`${v}-${h}`}
                  type="button"
                  title={`${v} ${h}`}
                  aria-label={`Position ${v} ${h}`}
                  onClick={() => onPatch({ hAlign: h, vAlign: v })}
                  className={`h-7 rounded border ${wm.hAlign === h && wm.vAlign === v ? 'border-brand-600 bg-brand-600' : 'border-ink-200 bg-ink-50 hover:border-brand-400 dark:border-ink-700 dark:bg-ink-800'}`}
                />
              )))}
            </div>
          </FormField>
          <Button size="sm" variant="danger" icon={Trash2} onClick={onRemove}>Remove watermark</Button>
        </>
      ) : (
        <p className="text-xs text-ink-400">Turned off — turn it on to print text or an image faintly behind every page.</p>
      )}
    </div>
  )
}

function WatermarkLayer({ wm }) {
  if (!wm.enabled) return null
  const style = {
    position: 'absolute',
    left: `${(WATERMARK_H[wm.hAlign] ?? 0.5) * 100}%`,
    top: `${(WATERMARK_V[wm.vAlign] ?? 0.5) * PAGE_H}pt`,
    transform: `translate(-50%, -50%) rotate(${-(wm.rotation || 0)}deg)`,
    opacity: Math.min(1, Math.max(0.02, wm.opacity)),
    whiteSpace: 'nowrap',
    userSelect: 'none',
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-testid="watermark-layer">
      {wm.type === 'image' && wm.imageDataUrl ? (
        <img src={wm.imageDataUrl} alt="" draggable={false} style={{ ...style, width: `${wm.imageWidthPct}%`, height: 'auto' }} />
      ) : wm.type === 'text' && wm.text?.trim() ? (
        <span style={{ ...style, fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, fontSize: `${wm.fontSize}pt`, lineHeight: 1, color: wm.color }}>{wm.text}</span>
      ) : null}
    </div>
  )
}

/**
 * Word-style visual editor for a quotation template's page furniture: an A4 sheet you edit
 * directly — click into the header or footer on the page and type, format with the ribbon, drop in
 * a logo, add a watermark — with the document body shown in place so you see exactly how the
 * pieces sit together. Header/footer/watermark are saved with the template and applied to every
 * page of every quotation generated from it.
 *
 * `body` is either {kind:'docx', html, onHtmlChange} (the document text is editable on the page
 * too) or {kind:'image', previewDataUrl, aspect, fields} (a letterhead background with its mapped
 * CRM fields shown as ghost boxes, so any overlap with the header/footer is visible).
 */
export function PageDesigner({ value, onChange, body, fieldSet }) {
  const { toast } = useToast()
  const [zone, setZone] = useState(null) // which contentEditable the ribbon drives
  const [panel, setPanel] = useState('header')
  const activeEl = useRef(null)
  const headerRef = useRef(null)
  const footerRef = useRef(null)
  const [heights, setHeights] = useState({ header: 0, footer: 0 })

  const { header, footer, watermark } = value
  // Functional updates so back-to-back edits (e.g. an async logo load finishing while another band is edited) never overwrite each other.
  const patch = (key, p) => onChange((v) => ({ ...v, [key]: { ...v[key], ...p } }))

  const getTarget = useCallback(() => (activeEl.current && activeEl.current.isConnected ? activeEl.current : null), [])
  const focusZone = (kind, el) => {
    activeEl.current = el
    setZone(kind)
    if (kind === 'header' || kind === 'footer') setPanel(kind)
  }

  // Measured band heights (px → pt) drive the overlap check for letterhead-background templates.
  useLayoutEffect(() => {
    const measure = () => setHeights({
      header: header.enabled && headerRef.current ? headerRef.current.offsetHeight * PX_TO_PT : 0,
      footer: footer.enabled && footerRef.current ? footerRef.current.offsetHeight * PX_TO_PT : 0,
    })
    measure()
    const ro = new ResizeObserver(measure)
    if (headerRef.current) ro.observe(headerRef.current)
    if (footerRef.current) ro.observe(footerRef.current)
    return () => ro.disconnect()
  }, [header.enabled, footer.enabled, header.logo?.height, footer.logo?.height, header.html, footer.html, header.logo?.align, footer.logo?.align])

  // 'generated' = a built-in layout filled from the record at PDF time (proposal templates): flows like a Word page but the body isn't editable here.
  const isDocx = body.kind === 'docx' || body.kind === 'generated'
  const sheetH = isDocx ? PAGE_H : PAGE_W * body.aspect

  const overlaps = []
  if (!isDocx) {
    const topLimit = heights.header ? heights.header + BAND_GAP : 0
    const bottomLimit = heights.footer ? sheetH - heights.footer - BAND_GAP : sheetH
    ;(body.fields || []).forEach((f) => {
      const def = QUOTATION_TEMPLATE_FIELDS.find((q) => q.key === f.key)
      const top = (f.yPct / 100) * sheetH
      const h = f.hPct ? (f.hPct / 100) * sheetH : (f.fontSize || 9) * 1.4
      const isRegion = f.key === 'itemsTable' || f.key === 'totals'
      if (isRegion && f.key === 'itemsTable') return // the engine moves/shrinks the items table clear of both bands automatically
      if (top < topLimit - 0.5 || top + h > bottomLimit + 0.5) overlaps.push(def?.label || f.key)
    })
  }

  const noTarget = () => toast('Click inside the header, footer or document first, then use the ribbon.', { type: 'info' })

  const sidePad = `${BAND_SIDE_MARGIN}pt`
  const sheetStyle = isDocx
    ? { width: `${PAGE_W}pt`, minHeight: `${PAGE_H}pt`, display: 'flex', flexDirection: 'column' }
    : { width: `${PAGE_W}pt`, height: `${sheetH}pt`, backgroundImage: `url(${body.previewDataUrl})`, backgroundSize: '100% 100%' }

  return (
    <div className="min-w-0 space-y-4">
      <RibbonToolbar zone={zone} getTarget={getTarget} onNoTarget={noTarget} fieldSet={fieldSet} />

      {overlaps.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {overlaps.join(', ')} {overlaps.length > 1 ? 'are' : 'is'} placed inside the header/footer area and would print over it. Move {overlaps.length > 1 ? 'them' : 'it'} in Field Mapping, or shorten the header/footer.
          </span>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="scrollbar-thin overflow-auto rounded-2xl border border-ink-100 bg-ink-100/70 p-5 dark:border-ink-800 dark:bg-ink-950">
          <div className="relative mx-auto bg-white text-ink-900 shadow-card" style={sheetStyle} data-testid="page-sheet">
            <WatermarkLayer wm={watermark} />

            {/* header */}
            <div className={isDocx ? 'relative z-10' : 'absolute inset-x-0 top-0 z-10'}>
              <BandZone kind="header" band={header} zoneRef={headerRef} panelSelected={panel === 'header'} onPatch={(p) => patch('header', p)} onFocusZone={focusZone} />
            </div>

            {/* body */}
            {body.kind === 'generated' ? (
              <div className="relative z-10 flex-1" style={{ padding: `${header.enabled ? BAND_GAP : 54}pt ${sidePad} ${footer.enabled ? BAND_GAP : 54}pt` }}>
                <div className="rounded-xl border border-dashed border-ink-200 px-5 py-8 text-center text-xs text-ink-400 dark:border-ink-700">
                  <p className="mb-1 text-sm font-semibold text-ink-500">Proposal content</p>
                  <p>{body.note || 'The proposal sections are generated from each proposal and placed here, clear of the header and footer.'}</p>
                </div>
              </div>
            ) : isDocx ? (
              <div className="relative z-10 flex-1" style={{ padding: `${header.enabled ? BAND_GAP : 54}pt ${sidePad} ${footer.enabled ? BAND_GAP : 54}pt` }}>
                <RichZone
                  label="Document body"
                  html={body.html}
                  onChange={body.onHtmlChange}
                  onFocusZone={(el) => focusZone('body', el)}
                  className={BODY_CLASS}
                  style={{ fontSize: '9.5pt', lineHeight: 1.6, fontFamily: 'Helvetica, Arial, sans-serif' }}
                />
              </div>
            ) : (
              <div className="pointer-events-none absolute inset-0 z-[5]">
                {(body.fields || []).map((f) => {
                  const def = QUOTATION_TEMPLATE_FIELDS.find((q) => q.key === f.key)
                  const isRegion = f.key === 'itemsTable' || f.key === 'totals'
                  return (
                    <div
                      key={f.key}
                      className="absolute overflow-hidden rounded border border-dashed border-ink-300 bg-white/50 px-1 text-[8pt] text-ink-400"
                      style={{ left: `${f.xPct}%`, top: `${f.yPct}%`, width: isRegion ? `${f.wPct}%` : undefined, height: isRegion ? `${f.hPct}%` : undefined, maxWidth: isRegion ? undefined : `${f.wPct || 24}%` }}
                    >
                      {def?.label}
                    </div>
                  )
                })}
              </div>
            )}

            {/* footer */}
            <div className={isDocx ? 'relative z-10' : 'absolute inset-x-0 bottom-0 z-10'}>
              <BandZone kind="footer" band={footer} zoneRef={footerRef} panelSelected={panel === 'footer'} onPatch={(p) => patch('footer', p)} onFocusZone={focusZone} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
            <div className="mb-4 flex rounded-lg bg-ink-50 p-0.5 text-xs font-medium dark:bg-ink-800">
              {[['header', 'Header', PanelTop, header.enabled], ['footer', 'Footer', PanelBottom, footer.enabled], ['watermark', 'Watermark', Droplets, watermark.enabled]].map(([k, l, Icon, on]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPanel(k)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 ${panel === k ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-900' : 'text-ink-500'}`}
                >
                  <Icon size={12} /> {l}{on && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
              ))}
            </div>
            {panel === 'header' && <BandPanel kind="header" band={header} onPatch={(p) => patch('header', p)} onRemove={() => onChange((v) => ({ ...v, header: defaultBand() }))} />}
            {panel === 'footer' && <BandPanel kind="footer" band={footer} onPatch={(p) => patch('footer', p)} onRemove={() => onChange((v) => ({ ...v, footer: defaultBand() }))} />}
            {panel === 'watermark' && <WatermarkPanel wm={watermark} onPatch={(p) => patch('watermark', p)} onRemove={() => onChange((v) => ({ ...v, watermark: defaultWatermark() }))} />}
          </div>
          <div className="rounded-2xl border border-ink-100 bg-white p-4 text-xs text-ink-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-400">
            <p className="mb-1.5 font-semibold text-ink-700 dark:text-ink-200">How it prints</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Header, footer and watermark repeat on every page of every quotation made from this template.</li>
              <li>Quotation content is kept clear of the header and footer automatically.</li>
              <li>Use <b>Preview</b> to see the real PDF before saving.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
