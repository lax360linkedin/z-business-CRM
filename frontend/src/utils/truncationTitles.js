// Table cells end in an ellipsis instead of stretching their column. This shows the full value on hover: the first time the pointer
// enters a cell whose text is cut off, the cell gets a `title` with its whole text (one listener for every table in the app).
const CELL = '.crm-cell, .crm-table td, .crm-table th'

function isCut(el) {
  if (el.scrollWidth > el.clientWidth + 1) return true
  for (const child of el.querySelectorAll('p, span, a, div')) if (child.scrollWidth > child.clientWidth + 1) return true
  return false
}

export function installTruncationTitles() {
  if (typeof document === 'undefined' || window.__crmTruncationTitles) return
  window.__crmTruncationTitles = true
  document.addEventListener('mouseover', (e) => {
    const cell = e.target instanceof Element ? e.target.closest(CELL) : null
    if (!cell || cell.dataset.fullChecked === cell.textContent) return
    cell.dataset.fullChecked = cell.textContent
    if (cell.hasAttribute('title') && !cell.dataset.fullTitle) return // an explicit title written by the page wins
    if (isCut(cell)) {
      const text = cell.innerText.replace(/\s+/g, ' ').trim()
      if (text) { cell.title = text; cell.dataset.fullTitle = '1' }
    } else if (cell.dataset.fullTitle) {
      cell.removeAttribute('title'); delete cell.dataset.fullTitle
    }
  }, { passive: true })
}
