import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText, FileDown } from 'lucide-react'
import { Button } from './Button'
import { Dropdown, DropdownItem, DropdownLabel, DropdownDivider } from './Dropdown'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useBranch } from '../../context/BranchContext'
import { getModuleForPath } from '../../routes/moduleAccess'
import { listDocument, exportDocument, FORMATS } from '../../utils/exporter'

const ICONS = { xlsx: FileSpreadsheet, csv: FileText, pdf: FileDown }

/**
 * The one Export control of the app: Excel, CSV or PDF of what the page is showing right now.
 *
 *   list pages   <ExportMenu title="Leads" columns={[{ label, value: 'key' | (row) => cell, align? }]} rows={() => crud.allFiltered} filters="Status: New" />
 *                `rows` is every row that matches the page's search and filters (not just the visible page); an array, or a function returning one (or a promise of one).
 *   reports etc. <ExportMenu title="Sales Report" getDocument={async (format, { user, branch }) => doc} />   (the document shape is in utils/exporter.js)
 *   extras       extraItems={[{ label: 'Print', icon: Printer, onClick }]} adds page-specific entries under the formats
 *   several      <ExportMenu title="Marketing" datasets={[{ label: 'Campaign report', name: 'campaigns', getDocument }, ...]} />   one menu, one block of formats per dataset
 *
 * It is hidden for roles without the Export right on the module (the module is found from the page's address); `permission` overrides that for pages whose right comes from the
 * server. The rows are what the signed-in person was allowed to load, in the branch they are working in, so a file never holds more than the screen could show.
 */
export function ExportMenu({ title, name, columns, rows, filters, getDocument, datasets, extraItems, extraMeta, permission, disabled = false, variant = 'secondary', label = 'Export', noun = 'record', className }) {
  const { toast } = useToast()
  const { user, hasPermission } = useAuth()
  const { pathname } = useLocation()
  const { label: branchLabel } = useBranch()
  const [busy, setBusy] = useState(false)
  // shown only to people whose role allows exporting from this module (Roles & Permissions -> Export)
  const allowed = permission !== undefined ? !!permission : hasPermission(getModuleForPath(pathname), 'export')
  if (!allowed) return null

  const sets = datasets || [{ label: null, name: name || title, title, columns, rows, filters, getDocument, noun }]

  const run = async (format, set) => {
    if (busy) return
    setBusy(true)
    try {
      const ctx = { user: user?.name || user?.email, branch: branchLabel }
      let doc
      let count = null
      if (set.getDocument) {
        doc = await set.getDocument(format, ctx)
      } else {
        const list = typeof set.rows === 'function' ? await set.rows() : set.rows
        if (!list?.length) { toast('Nothing to export for the current filters.', { type: 'warning' }); return }
        count = list.length
        doc = listDocument({ title: set.title || title, columns: set.columns, rows: list, filters: set.filters, user: ctx.user, branch: ctx.branch, extraMeta })
      }
      if (!doc) { toast('Nothing to export for the current filters.', { type: 'warning' }); return }
      if (count === null) count = doc.sections?.length === 1 && doc.sections[0].type === 'table' ? doc.sections[0].rows.length : null
      const file = await exportDocument(doc, format, set.name || set.title || title)
      const what = set.noun || noun
      toast(count !== null ? `Exported ${count} ${what}${count === 1 ? '' : 's'} to ${file}.` : `Exported ${file}.`, { type: 'success' })
    } catch (e) {
      toast(e?.response?.data?.message || e?.message || 'The export could not be created. Please try again.', { type: 'error', title: 'Export failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dropdown width="w-60" trigger={<Button variant={variant} icon={Download} loading={busy} disabled={disabled} className={className} aria-haspopup="menu">{label}</Button>}>
      {sets.map((set, i) => (
        <div key={set.name || i}>
          {i > 0 && <DropdownDivider />}
          <DropdownLabel>{set.label || 'Export what you see as'}</DropdownLabel>
          {FORMATS.map((f) => {
            const Icon = ICONS[f.key]
            return <DropdownItem key={f.key} icon={Icon} onClick={() => run(f.key, set)}>{f.label}</DropdownItem>
          })}
        </div>
      ))}
      {extraItems?.length > 0 && <DropdownDivider />}
      {extraItems?.map((it) => <DropdownItem key={it.label} icon={it.icon} onClick={it.onClick}>{it.label}</DropdownItem>)}
    </Dropdown>
  )
}
