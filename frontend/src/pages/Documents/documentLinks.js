/** The record a document was uploaded from, as { type, label, href } — undefined if it has none or the caller can't open it. */
export function primaryLinkOf(doc) {
  const p = doc?.primary
  if (!p) return undefined
  const r = (doc.related || []).find((x) => x.type === p.type && x.id === p.id && !x.restricted)
  return r ? { type: r.type, label: r.label, href: r.href, id: r.id } : undefined
}

/** Where a document came from, in words: "Contract CNT-2026-7016" or "General document". */
export function sourceLabel(doc) {
  const p = doc?.primary
  if (!p) return 'General document'
  const r = (doc.related || []).find((x) => x.type === p.type && x.id === p.id)
  return r && !r.restricted ? `${p.type} · ${r.label}` : `${p.type} (restricted)`
}
