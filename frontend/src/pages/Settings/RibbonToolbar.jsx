import { useEffect, useRef } from 'react'
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Hash, Layers, Eraser } from 'lucide-react'
import { Select } from '../../components/common/FormField'
import { QUOTATION_TEMPLATE_FIELDS } from '../../data/constants'
import { BAND_FIELD_OPTIONS, BAND_FIELDS, buildFieldTokenHtml, fieldDef } from './templateFieldTokens'
import { PROPOSAL_INLINE_FIELDS, PROPOSAL_TEMPLATE_FIELDS } from '../../utils/proposalCalc'
import { FONT_SIZES } from './templateBands'

function RibbonButton({ icon: Icon, label, onClick, active, disabled }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      // Keeps the text selection alive in the document while a ribbon button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${active ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'}`}
    >
      <Icon size={15} />
    </button>
  )
}

function Group({ label, children }) {
  return (
    <div className="flex flex-col items-center border-r border-ink-100 px-2.5 last:border-r-0 dark:border-ink-800">
      <div className="flex min-h-[32px] items-center gap-0.5">{children}</div>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-400">{label}</span>
    </div>
  )
}

const ZONE_LABEL = { header: 'Header', footer: 'Footer', body: 'Document' }

// Chrome expresses execCommand("fontSize") only in the legacy 1–7 scale. 7 is used as a sentinel
// and rewritten here into an exact point size, so the size stored in the HTML is the one the PDF
// engine reads back.
function applyExactFontSize(root, pt) {
  root.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement('span')
    span.style.fontSize = `${pt}pt`
    while (f.firstChild) span.appendChild(f.firstChild)
    f.replaceWith(span)
  })
  // Nested size spans: the inner (most recent) size wins, so flatten redundant outer sizes.
  root.querySelectorAll('span[style*="font-size"] span[style*="font-size"]').forEach((inner) => {
    const outer = inner.parentElement
    if (outer && outer.childNodes.length === 1 && outer.tagName === 'SPAN') outer.style.fontSize = ''
  })
}

// Inserts markup exactly at the caret via the Range API. execCommand('insertHTML') can hoist a
// non-editable token out of its paragraph (it ended up as a stray root-level node at the end of a
// line), which would print the field on its own line instead of inline.
function insertAtCaret(root, html) {
  const sel = window.getSelection()
  let range = sel.rangeCount ? sel.getRangeAt(0) : null
  if (!range || !root.contains(range.commonAncestorContainer)) {
    range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
  }
  range.deleteContents()
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const frag = tpl.content
  const last = frag.lastChild
  range.insertNode(frag)
  // Keep typing possible after the token: a text node after it holds the caret.
  const after = document.createTextNode(' ')
  last.after(after)
  range.setStart(after, 1)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// Region tokens (items table, totals) are block-level: they go between paragraphs, directly under
// the editor root, because the PDF engine only treats a top-level [data-field] block as a region.
function insertBlockAfterCaret(root, html) {
  const sel = window.getSelection()
  const range = sel.rangeCount ? sel.getRangeAt(0) : null
  let anchor = range && root.contains(range.startContainer) ? range.startContainer : null
  while (anchor && anchor.parentNode !== root) anchor = anchor.parentNode
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const node = tpl.content.firstChild
  if (anchor) anchor.after(node)
  else root.appendChild(node)
}

const INLINE_TAGS = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'FONT', 'A', 'SUB', 'SUP', 'BR'])

// Sets text-align on exactly the paragraphs the selection touches. execCommand("justify*") was
// avoided because, with a non-editable CRM-field token on the line, Chrome splits the paragraph
// into nested <p> elements (which then re-parse as separate lines in the PDF).
function alignBlocks(root, align) {
  // Loose text typed straight into the root (e.g. after the last paragraph was deleted) is
  // wrapped into a paragraph first so it has something to align.
  let loose = null
  let wrapped = false
  Array.from(root.childNodes).forEach((n) => {
    const isInline = n.nodeType === 3 || (n.nodeType === 1 && INLINE_TAGS.has(n.tagName))
    if (isInline) {
      if (!loose) { loose = document.createElement('p'); n.before(loose); wrapped = true }
      loose.appendChild(n)
    } else loose = null
  })
  const sel = window.getSelection()
  let range = sel.rangeCount ? sel.getRangeAt(0) : null
  if (wrapped || !range || !root.contains(range.commonAncestorContainer)) {
    range = document.createRange()
    range.selectNodeContents(root)
  }
  const targets = []
  Array.from(root.children).forEach((child) => {
    if (!range.intersectsNode(child)) return
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      Array.from(child.children).forEach((li) => { if (range.intersectsNode(li)) targets.push(li) })
    } else targets.push(child)
  })
  targets.forEach((el) => { el.style.textAlign = align })
}

/**
 * A Word-style ribbon (grouped Font / Paragraph / Styles / Insert commands) that drives whichever
 * editable zone — header, footer or document body — the user last clicked into. `getTarget()`
 * returns that zone's contentEditable element; the ribbon restores the user's selection inside it
 * before each command, so dropdowns (which steal focus) behave like Word's.
 */
export function RibbonToolbar({ zone, getTarget, onNoTarget, fieldSet }) {
  const saved = useRef(null)
  const isBand = zone === 'header' || zone === 'footer'

  useEffect(() => {
    const onSel = () => {
      const t = getTarget()
      const sel = window.getSelection()
      if (t && sel && sel.rangeCount && t.contains(sel.anchorNode)) saved.current = { target: t, range: sel.getRangeAt(0).cloneRange() }
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [getTarget])

  const run = (fn) => {
    const t = getTarget()
    if (!t) { onNoTarget?.(); return }
    t.focus()
    const s = saved.current
    if (s && s.target === t) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(s.range)
    }
    fn(t)
    // React's onInput on the zone picks this up and pushes the new HTML into state.
    t.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const exec = (command, value) => run(() => document.execCommand(command, false, value))
  const setSize = (pt) => {
    if (!pt) return
    run((t) => {
      document.execCommand('fontSize', false, '7')
      applyExactFontSize(t, pt)
    })
  }
  const insertField = (key) => {
    if (!key) return
    run((t) => (fieldDef(key)?.isRegion ? insertBlockAfterCaret(t, buildFieldTokenHtml(key)) : insertAtCaret(t, buildFieldTokenHtml(key))))
  }

  const proposal = fieldSet === 'proposal'
  const fieldOptions = proposal
    ? (isBand ? [...PROPOSAL_INLINE_FIELDS, ...BAND_FIELDS] : PROPOSAL_TEMPLATE_FIELDS)
    : (isBand ? BAND_FIELD_OPTIONS : QUOTATION_TEMPLATE_FIELDS)

  return (
    <div className="sticky top-[68px] z-[15] rounded-xl border border-ink-100 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-1 text-[11px] dark:border-ink-800">
        <span className="font-semibold text-brand-600">Home</span>
        <span className="text-ink-400">{zone ? <>Editing: <b className="text-ink-600 dark:text-ink-200">{ZONE_LABEL[zone]}</b></> : 'Click into the header, footer or document to start editing'}</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-y-1 px-1 py-1.5">
        <Group label="Font">
          <Select
            value=""
            onChange={(e) => { setSize(Number(e.target.value)); e.target.value = '' }}
            className="!h-8 !w-[78px] text-xs"
            title="Font size"
            aria-label="Font size"
          >
            <option value="">Size</option>
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
          </Select>
          <RibbonButton icon={Bold} label="Bold (Ctrl+B)" onClick={() => exec('bold')} />
          <RibbonButton icon={Italic} label="Italic (Ctrl+I)" onClick={() => exec('italic')} />
          <RibbonButton icon={Underline} label="Underline (Ctrl+U)" onClick={() => exec('underline')} />
          <RibbonButton icon={Eraser} label="Clear formatting" onClick={() => exec('removeFormat')} />
        </Group>
        <Group label="Paragraph">
          <RibbonButton icon={AlignLeft} label="Align left" onClick={() => run((t) => alignBlocks(t, 'left'))} />
          <RibbonButton icon={AlignCenter} label="Center" onClick={() => run((t) => alignBlocks(t, 'center'))} />
          <RibbonButton icon={AlignRight} label="Align right" onClick={() => run((t) => alignBlocks(t, 'right'))} />
          {!isBand && (
            <>
              <RibbonButton icon={List} label="Bullet list" onClick={() => exec('insertUnorderedList')} />
              <RibbonButton icon={ListOrdered} label="Numbered list" onClick={() => exec('insertOrderedList')} />
            </>
          )}
        </Group>
        {!isBand && (
          <Group label="Styles">
            <Select value="" onChange={(e) => { if (e.target.value) exec('formatBlock', e.target.value); e.target.value = '' }} className="!h-8 !w-[112px] text-xs" aria-label="Paragraph style">
              <option value="">Style…</option>
              <option value="P">Normal</option>
              <option value="H1">Heading 1</option>
              <option value="H2">Heading 2</option>
              <option value="H3">Heading 3</option>
            </Select>
          </Group>
        )}
        <Group label="Insert">
          <Select value="" onChange={(e) => { insertField(e.target.value); e.target.value = '' }} className="!h-8 !w-[150px] text-xs" aria-label="Insert CRM field">
            <option value="">CRM field…</option>
            {fieldOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
          {isBand && (
            <>
              <RibbonButton icon={Hash} label="Insert page number" onClick={() => insertField('pageNumber')} />
              <RibbonButton icon={Layers} label="Insert total page count" onClick={() => insertField('pageCount')} />
            </>
          )}
        </Group>
      </div>
    </div>
  )
}
