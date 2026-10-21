import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload, XCircle } from 'lucide-react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { TemplateButton } from './TemplateButton'
import { useToast } from '../../context/ToastContext'
import { api, errorMessage } from '../../api/http'
import { buildProblemReport, downloadBytes, readImportFile } from '../../utils/importKit'

const MAX_BYTES = 2 * 1024 * 1024
const CHUNK = 10 // records are saved a few at a time, so a big file shows progress and one slow moment cannot lose the lot
const SHOWN = { leads: ['name', 'company', 'email', 'phone', 'assignedTo'], enquiries: ['name', 'company', 'email', 'phone', 'assignedUser'], employees: ['fullName', 'officialEmail', 'designation', 'department', 'team', 'joinDate', 'branch'] }
const OWNER_KEY = { leads: 'assignedTo', enquiries: 'assignedUser' }
const input = 'h-7 w-full min-w-[110px] rounded border border-ink-200 bg-white px-1.5 text-xs dark:border-ink-700 dark:bg-ink-900'

const Tile = ({ label, value, tone }) => (
  <div className="rounded-xl border border-ink-100 px-3.5 py-2.5 dark:border-ink-800"><p className="text-xs text-ink-500 dark:text-ink-400">{label}</p><p className={`text-xl font-bold ${tone || 'text-ink-900 dark:text-ink-50'}`}>{value}</p></div>
)

/**
 * The one import screen for Leads, Enquiries and Employees: choose an Excel / CSV file -> every row is checked (nothing is saved yet) -> you see what would be imported and why any row would not ->
 * import -> a summary of what was created and what was refused, with the reasons. `distribute` (leads / enquiries): { people: [{ id, name }] } offers to share ownerless records equally.
 */
export function ImportDialog({ module, file: firstFile = null, onClose, onDone, distribute = null }) {
  const { toast } = useToast()
  const fileRef = useRef(null)
  const [schema, setSchema] = useState(null)
  const [phase, setPhase] = useState('pick') // pick | reading | checking | review | importing | done
  const [rows, setRows] = useState([])
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState([])
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [share, setShare] = useState(!!distribute?.people?.length)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const shown = useMemo(() => SHOWN[module] || schema?.columns.slice(0, 5).map((c) => c.key) || [], [module, schema])
  const header = (key) => schema?.columns.find((c) => c.key === key)?.header || key

  const check = useCallback((list) => {
    setPhase('checking'); setError('')
    return api.post(`/imports/${module}/preview`, { rows: list }, { silent: true })
      .then((res) => { setReport(res.data); setPhase('review') })
      .catch((e) => { setError(errorMessage(e, 'The file could not be checked.')); setReport(null); setPhase('review') })
  }, [module])

  const openFile = useCallback(async (file, sch) => {
    if (!file) return
    setError(''); setNotes([]); setResult(null); setReport(null)
    if (file.size > MAX_BYTES) { setError('That file is larger than 2 MB. Split it into smaller files.'); setPhase('pick'); return }
    setPhase('reading')
    try {
      const parsed = await readImportFile(file, sch)
      if (parsed.problem) { setError(parsed.problem); setPhase('pick'); return }
      setNotes(parsed.unknownHeaders.length ? [`These columns are not part of the import and were ignored: ${parsed.unknownHeaders.join(', ')}.`] : [])
      setRows(parsed.rows)
      await check(parsed.rows)
    } catch (e) { setError(e?.message || 'That file could not be read. Use the Excel template (.xlsx) or a .csv file.'); setPhase('pick') }
  }, [check])

  useEffect(() => {
    let alive = true
    api.get(`/imports/${module}/schema`, { noCache: true }).then((res) => { if (!alive) return; setSchema(res.data); if (firstFile) openFile(firstFile, res.data) })
      .catch((e) => { if (alive) setError(errorMessage(e, 'Could not load the import settings.')) })
    return () => { alive = false }
  }, [module]) // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => new Map((report?.rows || []).map((r) => [r.row, r.errors])), [report])
  const bad = report ? report.invalid : 0
  const ready = report ? report.valid : 0
  const atomic = schema?.mode === 'atomic'
  const edit = (index, key, value) => { setRows((list) => list.map((r, i) => (i === index ? { ...r, [key]: value } : r))); setReport(null) }

  const run = async () => {
    setPhase('importing'); setError('')
    const send = rows.filter((r) => !problems.get(r._row)?.length)
    const owners = share && distribute?.people?.length && OWNER_KEY[module] ? distribute.people : null
    let turn = 0
    const prepared = send.map((r) => (owners && !r[OWNER_KEY[module]] ? { ...r, [OWNER_KEY[module]]: owners[turn++ % owners.length].id } : r))
    const created = []
    const failed = []
    setProgress({ done: 0, total: prepared.length })
    try {
      for (let i = 0; i < prepared.length; i += atomic ? prepared.length : CHUNK) {
        const part = prepared.slice(i, i + (atomic ? prepared.length : CHUNK))
        const res = await api.post(`/imports/${module}/commit`, { rows: part }, { silent: true })
        created.push(...res.data.created); failed.push(...res.data.failed)
        setProgress({ done: Math.min(i + part.length, prepared.length), total: prepared.length })
      }
    } catch (e) {
      const stopped = prepared.slice(created.length + failed.length)
      setError(`${errorMessage(e, 'The import stopped.')}${stopped.length ? ` ${stopped.length} row(s) were not attempted.` : ''}`)
      if (atomic) { await check(rows); return } // nothing was written: show the rows' problems again
      failed.push(...stopped.map((r) => ({ row: r._row, errors: ['Not imported: the import stopped before this row.'] })))
    }
    const refused = new Map([...problems].filter(([, e]) => e.length))
    failed.forEach((f) => refused.set(f.row, f.errors))
    setResult({ created, failed: failed.length ? failed : [], refused })
    setPhase('done')
    onDone?.({ created: created.length })
    if (created.length) toast(`${created.length} ${created.length === 1 ? 'row' : 'rows'} imported as ${schema.label.toLowerCase()}${refused.size ? `; ${refused.size} not imported` : ''}.`, { type: refused.size ? 'warning' : 'success' })
  }

  const downloadProblems = async (map) => downloadBytes(await buildProblemReport(schema, rows, map), `LAX360-${schema.label}-rows-to-fix.xlsx`)
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyProblems || problems.get(r._row)?.length)
  const refusedCount = result ? result.refused.size : 0

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>{phase === 'done' ? 'Close' : 'Cancel'}</Button>
      {phase === 'review' && rows.length > 0 && !report && <Button variant="secondary" icon={RefreshCw} onClick={() => check(rows)}>Check again</Button>}
      {phase === 'review' && report && (
        <Button disabled={!ready || !!report.blocked || (atomic && bad > 0)} onClick={run}>
          {atomic && bad ? `Fix ${bad} row${bad === 1 ? '' : 's'} first` : `Import ${ready} ${ready === 1 ? 'row' : 'rows'}`}
        </Button>
      )}
    </>
  )

  return (
    <Modal open onClose={phase === 'importing' ? () => {} : onClose} size="xl" title={`Import ${schema?.label.toLowerCase() || ''}`.trim()}
      description="Upload the Excel template (or a CSV file). Every row is checked first; nothing is saved until you choose Import." footer={footer}>
      <div className="space-y-4">
        {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"><XCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}
        {notes.map((n) => <p key={n} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{n}</p>)}
        {report?.blocked && <p role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{report.blocked}</p>}

        {phase !== 'importing' && phase !== 'done' && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Choose Excel or CSV file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && schema) openFile(f, schema) }} />
            <Button icon={Upload} variant={rows.length ? 'secondary' : 'primary'} disabled={!schema} onClick={() => fileRef.current?.click()}>{rows.length ? 'Choose another file' : 'Choose Excel or CSV file'}</Button>
            <TemplateButton module={module} variant="ghost" />
            {(phase === 'reading' || phase === 'checking') && <span className="text-sm text-ink-500">{phase === 'reading' ? 'Reading the file…' : 'Checking every row…'}</span>}
          </div>
        )}
        {phase === 'pick' && !rows.length && !error && (
          <div className="rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-500 dark:border-ink-700 dark:text-ink-400">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-ink-300" />
            Start from <b>Download Excel Template</b>: it has the right columns, marks the required ones and offers dropdowns for the fields with fixed values. Fill it in, save it, then choose it here.
          </div>
        )}

        {phase === 'review' && report && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Tile label="Rows in the file" value={report.total} />
              <Tile label="Ready to import" value={ready} tone="text-emerald-600 dark:text-emerald-400" />
              <Tile label="With problems" value={bad} tone={bad ? 'text-rose-600 dark:text-rose-400' : undefined} />
            </div>
            {atomic && bad > 0 && <p className="text-xs text-ink-500 dark:text-ink-400">Employees are imported all together: fix the rows below (edit them here, or correct the file and choose it again), then check again.</p>}
            {!atomic && bad > 0 && <p className="text-xs text-ink-500 dark:text-ink-400">Rows with a problem are not imported; the others are. You can download them to correct and upload again.</p>}
            {distribute?.people?.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                Share records that have no “Assigned To” equally among the sales team ({distribute.people.length} {distribute.people.length === 1 ? 'person' : 'people'}); otherwise they stay unassigned.</label>
            )}
          </>
        )}

        {phase === 'importing' && (
          <div role="status" className="space-y-2 py-4"><p className="text-sm text-ink-700 dark:text-ink-200">Importing… {progress.done} of {progress.total}</p>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full bg-brand-600 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            <p className="text-xs text-ink-400">Please keep this window open.</p></div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3"><Tile label="Imported" value={result.created.length} tone="text-emerald-600 dark:text-emerald-400" /><Tile label="Not imported" value={refusedCount} tone={refusedCount ? 'text-rose-600 dark:text-rose-400' : undefined} /></div>
            {result.created.length > 0 && <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={16} />{result.created.length} {result.created.length === 1 ? 'record was' : 'records were'} created in {schema.label}. {result.created.length === 1 ? 'It is' : 'They are'} now in the list.</p>}
            {refusedCount > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-ink-800 dark:text-ink-100">Why some rows were not imported</p><Button size="sm" variant="secondary" icon={Download} onClick={() => downloadProblems(result.refused)}>Download rows to fix (.xlsx)</Button></div>
                <div className="max-h-64 overflow-auto rounded-xl border border-ink-100 dark:border-ink-800"><table className="crm-table crm-table-wrap w-full text-xs"><thead className="sticky top-0 bg-ink-50 text-left font-semibold uppercase text-ink-500 dark:bg-ink-800"><tr><th className="px-2 py-2">Row</th><th className="px-2">{header(shown[0])}</th><th className="px-2">Reason</th></tr></thead>
                  <tbody>{[...result.refused].map(([rowNo, errs]) => (<tr key={rowNo} className="border-t border-ink-100 align-top dark:border-ink-800"><td className="px-2 py-1.5 text-ink-400">{rowNo}</td><td className="px-2">{rows.find((r) => r._row === rowNo)?.[shown[0]] || '—'}</td><td className="px-2 py-1.5 text-rose-600 dark:text-rose-400">{errs.join('; ')}</td></tr>))}</tbody></table></div>
              </>
            )}
          </div>
        )}

        {phase === 'review' && rows.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600" />Show only rows with problems</label>
              {bad > 0 && <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadProblems(problems)}>Download rows to fix (.xlsx)</Button>}
            </div>
            <div className="max-h-[42vh] overflow-auto rounded-xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[820px] text-xs">
                <thead className="sticky top-0 bg-ink-50 dark:bg-ink-800"><tr className="text-left font-semibold uppercase text-ink-500"><th className="px-2 py-2">Row</th>{shown.map((k) => <th key={k} className="px-2">{header(k)}</th>)}<th className="px-2">Result</th></tr></thead>
                <tbody>
                  {visible.map(({ r, i }) => {
                    const errs = problems.get(r._row)
                    return (
                      <tr key={r._row} className={`border-t border-ink-100 align-top dark:border-ink-800 ${errs?.length ? 'bg-rose-50/60 dark:bg-rose-900/10' : ''}`}>
                        <td className="px-2 py-2 text-ink-400">{r._row}</td>
                        {shown.map((k) => <td key={k} className="px-1 py-1"><input aria-label={`${header(k)} row ${r._row}`} className={input} value={r[k] || ''} onChange={(e) => edit(i, k, e.target.value)} /></td>)}
                        <td className="px-2 py-2">{!report ? '…' : errs?.length ? <ul className="space-y-0.5 text-rose-600 dark:text-rose-400">{errs.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="text-emerald-600 dark:text-emerald-400">Ready</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!report && !error && <p className="mt-2 text-xs text-ink-400">You changed a row. Check again before importing.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
