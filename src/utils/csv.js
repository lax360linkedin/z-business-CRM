export function downloadCsv(filename, rows, columns) {
  const header = columns.map((c) => c.label).join(',')
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const val = typeof c.value === 'function' ? c.value(row) : row[c.value]
        const str = String(val ?? '').replace(/"/g, '""')
        return /[",\n]/.test(str) ? `"${str}"` : str
      })
      .join(','),
  )
  const csv = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim())
    const row = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

export function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`
}
