import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { UploadCloud, FileStack, Clock3, UserRound, Share2, ShieldAlert, CalendarClock, Archive, Trash2, LayoutList, LayoutGrid, FolderTree, Eye, Download, FolderPlus, Settings2, X, Bookmark, AlertTriangle, FolderOpen, Layers } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterToggleButton } from '../../components/common/FilterPanel'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { CardSkeleton } from '../../components/common/LoadingSkeleton'
import { Pagination } from '../../components/common/Pagination'
import { Modal } from '../../components/common/Modal'
import { Input } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { USERS } from '../../data/users'
import { VISIBILITIES, ALL_EXTENSIONS, MODULE_FILTER_TYPES, sizeLabel } from '../../utils/documentRules'
import { formatDate, timeAgo } from '../../utils/format'
import { useDocuments, useDocConfig, useFolders, useSavedFilters, useFavorites, createFolder, removeFolder, errText } from './documentClient'
import { DocumentUploader } from './DocumentUploader'
import { DocumentMenu, useDocumentActions } from './DocumentActions'
import { FileTile, VisibilityBadge, VersionTag, DocStatus, FavButton } from './DocumentBits'
import { RelatedRecordPicker } from './RelatedRecordPicker'
import { sourceLabel } from './documentLinks'

const EMPTY = { category: 'all', type: 'all', uploader: 'all', customer: 'all', company: 'all', module: 'all', visibility: 'all', status: 'all', version: 'all', upFrom: '', upTo: '', updFrom: '', updTo: '' }
const QUICK = [['all', 'All documents'], ['recent', 'Recent'], ['mine', 'My documents'], ['shared', 'Shared'], ['confidential', 'Confidential'], ['favorites', 'Favourites'], ['review', 'Needs review'], ['archived', 'Archived'], ['bin', 'Bin']]
const VIEWS = [['list', 'List', LayoutList], ['grid', 'Grid', LayoutGrid], ['folders', 'Folders', FolderTree]]
const SORTS = [['updated', 'Recently updated'], ['uploaded', 'Recently uploaded'], ['name', 'Name'], ['size', 'Size']]
const sel = 'h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-xs text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200'
const PAGE_SIZE = 15
const TONE = { brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400', emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30', rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30', sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30', ink: 'bg-ink-100 text-ink-600 dark:bg-ink-800' }
const dayKey = (d) => new Date(d).toISOString().slice(0, 10)

function Bars({ title, rows, onPick, active }) {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
      {!rows.length ? <p className="py-6 text-center text-xs text-ink-400">No data yet</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 7).map(([label, n]) => (
            <li key={label}>
              <button type="button" onClick={() => onPick(label)} aria-pressed={active === label} className="group flex w-full items-center gap-2 text-left text-xs">
                <span className={clsx('w-28 shrink-0 truncate', active === label ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-ink-600 dark:text-ink-300')}>{label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><span className={clsx('block h-full rounded-full', active === label ? 'bg-brand-600' : 'bg-brand-400 group-hover:bg-brand-500')} style={{ width: `${(n / max) * 100}%` }} /></span>
                <span className="w-6 text-right font-semibold text-ink-700 dark:text-ink-200">{n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Documents() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [quick, setQuick] = useState('all')
  const { docs, error, reload } = useDocuments({ trash: quick === 'bin' })
  const { config, has, matrix, activeCategories } = useDocConfig()
  const { folders, reload: reloadFolders } = useFolders()
  const saved = useSavedFilters()
  const favs = useFavorites()
  const actions = useDocumentActions({ onChanged: reload })
  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [f, setF] = useState(EMPTY)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState('updated')
  const [page, setPage] = useState(1)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [related, setRelated] = useState(null)
  const [folder, setFolder] = useState('') // folders view: '' = all, 'cat:Name' or a folder id
  const [folderModal, setFolderModal] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [saveName, setSaveName] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => { setPage(1) }, [search, f, quick, sort, view, folder])

  const warn = dayKey(Date.now() + config.reviewWarnDays * 86400000)
  const weekAgo = dayKey(Date.now() - 7 * 86400000)
  const needsReview = (d) => d.status === 'Active' && d.reviewBy && d.reviewBy <= warn
  const isShared = (d) => (d.access.shareLevel && !d.access.owner) || (d.access.owner && d.shareCount > 0)

  const m = useMemo(() => {
    const live = docs || []
    const cnt = (key) => { const o = {}; live.forEach((d) => { const k = key(d); if (k) o[k] = (o[k] || 0) + 1 }); return Object.entries(o).sort((a, b) => b[1] - a[1]) }
    return {
      total: live.length, recent: live.filter((d) => dayKey(d.uploadedDate) >= weekAgo).length, mine: live.filter((d) => d.access.owner).length, shared: live.filter(isShared).length, confidential: live.filter((d) => d.visibility === 'Confidential').length,
      review: live.filter(needsReview).length, archived: live.filter((d) => d.status === 'Archived').length, bytes: live.reduce((s, d) => s + (d.sizeBytes || 0), 0),
      byCategory: cnt((d) => d.category), byType: cnt((d) => d.fileType.toUpperCase()), byModule: cnt((d) => d.primary?.type || 'General'),
      recentlyUpdated: [...live].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5),
    }
  }, [docs, weekAgo, warn]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fav = new Set(favs.ids)
    const list = (docs || []).filter((d) => {
      if (quick === 'recent' && dayKey(d.uploadedDate) < weekAgo) return false
      if (quick === 'mine' && !d.access.owner) return false
      if (quick === 'shared' && !isShared(d)) return false
      if (quick === 'confidential' && d.visibility !== 'Confidential') return false
      if (quick === 'favorites' && !fav.has(d.id)) return false
      if (quick === 'review' && !needsReview(d)) return false
      if (quick === 'archived' && d.status !== 'Archived') return false
      if (q && !`${d.id} ${d.name} ${d.fileName} ${d.category} ${d.uploaderName} ${Object.values(d.refs || {}).join(' ')} ${(d.tags || []).join(' ')}`.toLowerCase().includes(q)) return false
      if (f.category !== 'all' && d.category !== f.category) return false
      if (f.type !== 'all' && d.fileType !== f.type) return false
      if (f.uploader !== 'all' && d.uploadedBy !== f.uploader) return false
      if (f.customer !== 'all' && d.customerId !== f.customer) return false
      if (f.company !== 'all' && d.companyId !== f.company) return false
      if (f.module !== 'all' && (d.primary?.type || 'General') !== f.module) return false
      if (f.visibility !== 'all' && d.visibility !== f.visibility) return false
      if (f.status !== 'all' && d.status !== f.status) return false
      if (f.version === '1' && d.version !== 1) return false
      if (f.version === '2+' && d.version < 2) return false
      if (f.upFrom && dayKey(d.uploadedDate) < f.upFrom) return false
      if (f.upTo && dayKey(d.uploadedDate) > f.upTo) return false
      if (f.updFrom && dayKey(d.updatedAt) < f.updFrom) return false
      if (f.updTo && dayKey(d.updatedAt) > f.updTo) return false
      if (view === 'folders' && folder) return folder.startsWith('cat:') ? d.category === folder.slice(4) : d.folderId === folder
      return true
    })
    const by = { updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)), uploaded: (a, b) => String(b.uploadedDate).localeCompare(String(a.uploadedDate)), name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => b.sizeBytes - a.sizeBytes }
    return list.sort(by[sort])
  }, [docs, quick, search, f, sort, view, folder, favs.ids, weekAgo, warn]) // eslint-disable-line react-hooks/exhaustive-deps

  const cards = [
    ['Total documents', m.total, FileStack, 'brand', () => { setQuick('all'); setF(EMPTY) }], ['Recent uploads', m.recent, Clock3, 'sky', () => setQuick('recent')], ['My documents', m.mine, UserRound, 'violet', () => setQuick('mine')],
    ['Shared', m.shared, Share2, 'emerald', () => setQuick('shared')], ['Confidential', m.confidential, ShieldAlert, 'rose', () => setQuick('confidential')], ['Review needed', m.review, CalendarClock, 'amber', () => setQuick('review')],
    ['Archived', m.archived, Archive, 'ink', () => setQuick('archived')], ['Storage used', sizeLabel(m.bytes), FolderOpen, 'ink'],
  ]
  const activeFilters = Object.entries(f).filter(([k, v]) => v !== EMPTY[k]).length
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const pageRows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const canUpload = has('upload') && matrix.create
  const uploaderBlocked = related && !related.id

  const customers = useMemo(() => { const o = new Map(); (docs || []).forEach((d) => { if (d.customerId && d.refs?.Customer) o.set(d.customerId, d.refs.Customer) }); return [...o] }, [docs])
  const companies = useMemo(() => { const o = new Map(); (docs || []).forEach((d) => { if (d.companyId && d.refs?.Company) o.set(d.companyId, d.refs.Company) }); return [...o] }, [docs])
  const uploaders = useMemo(() => USERS.filter((u) => (docs || []).some((d) => d.uploadedBy === u.id)), [docs])
  const types = useMemo(() => ALL_EXTENSIONS.filter((e) => (docs || []).some((d) => d.fileType === e)), [docs])

  const applySaved = (s) => { setF({ ...EMPTY, ...s.filters.f }); setQuick(s.filters.quick || 'all'); setSearch(s.filters.search || ''); setFiltersOpen(true) }
  const saveCurrent = () => { if (!saveName.trim()) return; saved.save(saveName.trim(), { f, quick, search }); toast(`Filter “${saveName.trim()}” saved.`, { type: 'success' }); setSaveName('') }
  const addFolder = () => { createFolder(folderName).then(() => { setFolderModal(false); setFolderName(''); toast('Folder created.', { type: 'success' }) }).catch((e) => toast(errText(e), { type: 'error' })) }
  const counts = (fn) => (docs || []).filter(fn).length

  if (error) return <EmptyState icon={AlertTriangle} title="Couldn’t load documents" description={error} action={<Button variant="secondary" onClick={reload}>Try again</Button>} />

  const row = (d) => (
    <div key={d.id} role="row" tabIndex={0} onClick={() => navigate(`/documents/${d.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/documents/${d.id}`)} className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-ink-50 px-4 py-3 text-sm last:border-0 hover:bg-ink-50/60 lg:grid-cols-[auto_2.2fr_1.2fr_1.3fr_6rem_6.5rem_auto] dark:border-ink-800/60 dark:hover:bg-ink-800/30">
      <FileTile ext={d.fileType} />
      <div className="min-w-0">
        <div className="flex items-center gap-2"><p className="truncate font-medium text-ink-900 dark:text-ink-50">{d.name}</p><VersionTag doc={d} />{d.status !== 'Active' && <DocStatus status={d.status} />}</div>
        <p className="truncate text-xs text-ink-400">{d.id} · {d.category} · {sizeLabel(d.sizeBytes)}{needsReview(d) ? <span className="text-amber-600"> · review by {formatDate(d.reviewBy)}</span> : null}</p>
      </div>
      <span className="hidden truncate text-xs text-ink-500 lg:block">{sourceLabel(d)}</span>
      <span className="hidden truncate text-xs text-ink-600 lg:block dark:text-ink-300">{d.refs?.Customer || d.relatedTo || '—'}</span>
      <span className="hidden lg:block"><VisibilityBadge value={d.visibility} compact /></span>
      <span className="hidden text-xs text-ink-500 lg:block" title={`${d.uploaderName} — ${formatDate(d.updatedAt)}`}>{timeAgo(d.updatedAt)}</span>
      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <FavButton on={favs.has(d.id)} onClick={() => favs.toggle(d.id)} />
        {d.access.preview && d.status !== 'Deleted' && <button type="button" aria-label={`Preview ${d.name}`} onClick={() => actions.run('preview', d)} className="hidden rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 sm:block dark:hover:bg-ink-800"><Eye size={15} /></button>}
        {d.access.download && d.status !== 'Deleted' && <button type="button" aria-label={`Download ${d.name}`} onClick={() => actions.run('download', d)} className="hidden rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 sm:block dark:hover:bg-ink-800"><Download size={15} /></button>}
        <DocumentMenu doc={d} run={actions.run} />
      </div>
    </div>
  )
  const card = (d) => (
    <article key={d.id} onClick={() => navigate(`/documents/${d.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/documents/${d.id}`)} className="flex cursor-pointer flex-col rounded-2xl border border-ink-100 bg-white p-4 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-start justify-between"><FileTile ext={d.fileType} size="lg" /><div className="flex items-center" onClick={(e) => e.stopPropagation()}><FavButton on={favs.has(d.id)} onClick={() => favs.toggle(d.id)} /><DocumentMenu doc={d} run={actions.run} /></div></div>
      <p className="mt-3 line-clamp-2 text-sm font-medium text-ink-900 dark:text-ink-50">{d.name}</p>
      <p className="mt-0.5 truncate text-xs text-ink-400">{d.id} · {d.category}</p>
      <p className="mt-1 truncate text-xs text-ink-500">{sourceLabel(d)}</p>
      <div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-1.5"><VersionTag doc={d} /><VisibilityBadge value={d.visibility} compact /></span><span className="text-[11px] text-ink-400">{sizeLabel(d.sizeBytes)} · {timeAgo(d.updatedAt)}</span></div>
    </article>
  )

  return (
    <div>
      <PageHeader title="Documents" description="The central, access-controlled repository for every file in the CRM — each one linked to the customer, deal, contract or project it belongs to."
        actions={<>
          {has('manageCategories') && <Button variant="secondary" icon={Settings2} onClick={() => navigate('/settings/modules/documents')}>Settings</Button>}
          {has('createFolders') && <Button variant="secondary" icon={FolderPlus} onClick={() => setFolderModal(true)}>New folder</Button>}
          {canUpload && <Button icon={uploadOpen ? X : UploadCloud} onClick={() => setUploadOpen((o) => !o)}>{uploadOpen ? 'Close upload' : 'Upload'}</Button>}
        </>} />

      {uploadOpen && canUpload && (
        <div className="mb-5">
          <DocumentUploader related={related?.id ? related : null} disabled={!!uploaderBlocked} disabledReason="Choose the record to link, or pick “General document”." onUploaded={() => reload()} defaults={{ category: 'Other' }}>
            <RelatedRecordPicker value={related} onChange={setRelated} />
          </DocumentUploader>
        </div>
      )}

      {!docs ? <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} className="h-20" />)}</div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" aria-label="Document metrics">
            {cards.map(([label, value, Icon, tone, click]) => (
              <button key={label} type="button" onClick={click} disabled={!click} className={clsx('rounded-xl border border-ink-100 bg-white p-3 text-left shadow-card dark:border-ink-800 dark:bg-ink-900', click ? 'transition-shadow hover:shadow-card-hover' : 'cursor-default')}>
                <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-500">{label}</span><span className={clsx('flex h-6 w-6 items-center justify-center rounded-lg', TONE[tone])}><Icon size={13} /></span></div>
                <p className="mt-1.5 text-xl font-bold text-ink-900 dark:text-ink-50">{value}</p>
              </button>
            ))}
          </div>
          <div className="mb-5 grid gap-4 lg:grid-cols-4">
            <Bars title="By category" rows={m.byCategory} active={f.category !== 'all' ? f.category : ''} onPick={(l) => { set({ category: f.category === l ? 'all' : l }); setQuick('all') }} />
            <Bars title="By file type" rows={m.byType} active={f.type !== 'all' ? f.type.toUpperCase() : ''} onPick={(l) => { set({ type: f.type === l.toLowerCase() ? 'all' : l.toLowerCase() }); setQuick('all') }} />
            <Bars title="By CRM module" rows={m.byModule} active={f.module !== 'all' ? f.module : ''} onPick={(l) => { set({ module: f.module === l ? 'all' : l }); setQuick('all') }} />
            <section className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><h3 className="mb-3 text-sm font-semibold text-ink-900 dark:text-ink-50">Recently updated</h3>
              {!m.recentlyUpdated.length ? <p className="py-6 text-center text-xs text-ink-400">No documents yet</p> : <ul className="space-y-2">{m.recentlyUpdated.map((d) => <li key={d.id}><Link to={`/documents/${d.id}`} className="flex items-center gap-2 text-xs hover:underline"><FileTile ext={d.fileType} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink-800 dark:text-ink-100">{d.name}</span><span className="text-ink-400">{timeAgo(d.updatedAt)} · v{d.version}</span></span></Link></li>)}</ul>}
            </section>
          </div>
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Document groups">
          {QUICK.filter(([k]) => k !== 'bin' || has('delete')).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={quick === k} onClick={() => setQuick(k)} className={clsx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium', quick === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300')}>{l}{k === 'favorites' && favs.ids.length ? ` (${favs.ids.length})` : ''}</button>)}
        </div>
        <div className="ml-auto flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="View">
          {VIEWS.map(([k, l, Icon]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', view === k ? 'bg-brand-600 text-white' : 'text-ink-500')}><Icon size={14} />{l}</button>)}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, ID, customer, company, deal, contract…" className="w-full max-w-sm" />
        <FilterToggleButton active={filtersOpen} count={activeFilters} onClick={() => setFiltersOpen((o) => !o)} />
        {activeFilters > 0 && <Button variant="ghost" icon={X} onClick={() => setF(EMPTY)}>Clear</Button>}
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-500">Sort<select aria-label="Sort documents" className={clsx(sel, '!w-40')} value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      {filtersOpen && (
        <div className="mb-4 rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[['Category', 'category', activeCategories.map((c) => [c.name, c.name])], ['File type', 'type', types.map((t) => [t, t.toUpperCase()])], ['Uploaded by', 'uploader', uploaders.map((u) => [u.id, u.name])], ['Customer', 'customer', customers],
              ['Company', 'company', companies], ['Related module', 'module', [['General', 'General (no record)'], ...MODULE_FILTER_TYPES.map((t) => [t, t])]], ['Visibility', 'visibility', VISIBILITIES.map((v) => [v, v])], ['Status', 'status', [['Active', 'Active'], ['Archived', 'Archived']]], ['Version', 'version', [['1', 'Original only (v1)'], ['2+', 'Revised (v2+)']]]].map(([label, key, opts]) => (
              <label key={key} className="text-xs font-medium text-ink-500">{label}<select aria-label={label} className={clsx(sel, 'mt-1')} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}><option value="all">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            ))}
            {[['Uploaded from', 'upFrom'], ['Uploaded to', 'upTo'], ['Updated from', 'updFrom'], ['Updated to', 'updTo']].map(([l, k]) => <label key={k} className="text-xs font-medium text-ink-500">{l}<input aria-label={l} type="date" className={clsx(sel, 'mt-1')} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
            <Bookmark size={14} className="text-ink-400" />
            {saved.list.length === 0 && <span className="text-xs text-ink-400">No saved filters yet.</span>}
            {saved.list.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 rounded-full bg-brand-50 pl-3 pr-1 text-xs font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                <button type="button" onClick={() => applySaved(s)} className="py-1">{s.name}</button><button type="button" aria-label={`Delete saved filter ${s.name}`} onClick={() => saved.remove(s.name)} className="rounded-full p-1 hover:bg-brand-100 dark:hover:bg-brand-900/50"><X size={11} /></button>
              </span>
            ))}
            <span className="ml-auto flex items-center gap-2"><Input aria-label="Name for this filter" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this filter" className="!h-8 !w-40 text-xs" /><Button size="sm" variant="secondary" disabled={!saveName.trim()} onClick={saveCurrent}>Save filter</Button></span>
          </div>
        </div>
      )}

      <div className={clsx(view === 'folders' && 'grid gap-4 lg:grid-cols-[14rem_1fr]')}>
        {view === 'folders' && (
          <nav aria-label="Folders" className="h-fit rounded-2xl border border-ink-100 bg-white p-2 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <button type="button" onClick={() => setFolder('')} className={clsx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm', !folder ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800')}><span className="flex items-center gap-2"><Layers size={14} />All</span><span className="text-xs opacity-80">{counts(() => true)}</span></button>
            <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Categories</p>
            {activeCategories.map((c) => <button key={c.id} type="button" onClick={() => setFolder(`cat:${c.name}`)} className={clsx('flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm', folder === `cat:${c.name}` ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800')}><span className="truncate">{c.name}</span><span className="text-xs opacity-80">{counts((d) => d.category === c.name)}</span></button>)}
            {folders.length > 0 && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Folders</p>}
            {folders.map((x) => (
              <div key={x.id} className={clsx('flex items-center rounded-lg', folder === x.id ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-800')}>
                <button type="button" onClick={() => setFolder(x.id)} className="flex flex-1 items-center justify-between px-3 py-1.5 text-sm"><span className="flex items-center gap-2 truncate"><FolderOpen size={13} />{x.name}</span><span className="text-xs opacity-80">{counts((d) => d.folderId === x.id)}</span></button>
                {has('createFolders') && !counts((d) => d.folderId === x.id) && <button type="button" aria-label={`Delete folder ${x.name}`} onClick={() => removeFolder(x.id).then(() => { setFolder('') }).catch((e) => toast(errText(e), { type: 'error' }))} className="mr-1 rounded p-1 opacity-70 hover:opacity-100"><Trash2 size={12} /></button>}
              </div>
            ))}
          </nav>
        )}
        <div className="min-w-0">
          {!docs ? <CardSkeleton className="h-72" /> : filtered.length === 0 ? (
            <EmptyState icon={quick === 'bin' ? Trash2 : FileStack} title={quick === 'bin' ? 'The bin is empty' : docs.length ? 'No documents match' : 'No documents yet'} description={quick === 'bin' ? 'Deleted documents stay here until the retention period ends.' : docs.length ? 'Change the group, search or filters.' : 'Upload a file, or add documents from a customer, deal, contract or project page.'} action={!docs.length && canUpload && <Button icon={UploadCloud} onClick={() => setUploadOpen(true)}>Upload</Button>} />
          ) : view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{pageRows.map(card)}</div>
          ) : (
            <div role="table" className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
              <div role="row" className="hidden grid-cols-[auto_2.2fr_1.2fr_1.3fr_6rem_6.5rem_auto] gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500 lg:grid dark:border-ink-800 dark:bg-ink-800/40"><span className="w-10" /><span>Document</span><span>Linked to</span><span>Customer</span><span>Access</span><span>Updated</span><span className="w-24" /></div>
              {pageRows.map(row)}
            </div>
          )}
          {docs && filtered.length > 0 && <div className="mt-4 rounded-2xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900"><Pagination page={cur} totalPages={totalPages} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} /></div>}
        </div>
      </div>

      <Modal open={folderModal} onClose={() => setFolderModal(false)} size="sm" title="New folder" description="Folders organise documents; they never change who can open them." footer={<><Button variant="ghost" onClick={() => setFolderModal(false)}>Cancel</Button><Button disabled={!folderName.trim()} onClick={addFolder}>Create</Button></>}>
        <Input aria-label="Folder name" autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && folderName.trim() && addFolder()} placeholder="e.g. Q4 audits" />
      </Modal>
      {actions.dialogs}
    </div>
  )
}
