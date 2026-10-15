import clsx from 'clsx'
import { FileText, FileSpreadsheet, FileImage, Presentation, File as FileIcon, Lock, Users, Building2, Link2, Globe2, UserCheck, ShieldAlert, Star, History } from 'lucide-react'
import { familyOf, FAMILY_LABEL } from '../../utils/documentRules'

const FAMILY = {
  pdf: { icon: FileText, tone: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' },
  word: { icon: FileText, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300' },
  excel: { icon: FileSpreadsheet, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' },
  slides: { icon: Presentation, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' },
  image: { icon: FileImage, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300' },
  other: { icon: FileIcon, tone: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300' },
}

/** File-type tile: colour and icon by family, with the extension underneath. */
export function FileTile({ ext, size = 'md', className }) {
  const f = FAMILY[familyOf(ext)] || FAMILY.other
  const Icon = f.icon
  const dims = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  return (
    <span className={clsx('relative inline-flex shrink-0 items-center justify-center rounded-xl', dims, f.tone, className)} title={FAMILY_LABEL[familyOf(ext)] || 'File'}>
      <Icon size={size === 'lg' ? 26 : size === 'sm' ? 15 : 19} />
      {size !== 'sm' && <span className="absolute -bottom-1 rounded bg-white px-1 text-[8px] font-bold uppercase leading-3 text-ink-600 shadow-sm ring-1 ring-ink-100 dark:bg-ink-900 dark:text-ink-300 dark:ring-ink-700">{ext}</span>}
    </span>
  )
}

const VIS = {
  Private: [Lock, 'text-ink-600 bg-ink-100 dark:bg-ink-800 dark:text-ink-300'],
  'Assigned User': [UserCheck, 'text-sky-700 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300'],
  Team: [Users, 'text-sky-700 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300'],
  Department: [Building2, 'text-sky-700 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-300'],
  'Related CRM Users': [Link2, 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300'],
  Organization: [Globe2, 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300'],
  Confidential: [ShieldAlert, 'text-rose-700 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-300'],
}
/** Secure-access indicator: who can open the document. */
export function VisibilityBadge({ value, className, compact }) {
  const [Icon, tone] = VIS[value] || VIS.Private
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', tone, className)} title={`Visibility: ${value}`}><Icon size={11} />{!compact && value}</span>
}

const STATUS = { Active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', Archived: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', Deleted: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' }
export const DocStatus = ({ status }) => <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[status] || STATUS.Active)}>{status}</span>

export const VersionTag = ({ doc }) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300" title={`${doc.versions?.length || doc.version} version(s) — v${doc.version} is the current one`}><History size={10} />v{doc.version}</span>
)

export const FavButton = ({ on, onClick }) => (
  <button type="button" aria-label={on ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={on} onClick={(e) => { e.stopPropagation(); onClick() }} className={clsx('rounded p-1 transition-colors', on ? 'text-amber-500' : 'text-ink-300 hover:text-amber-500')}><Star size={14} fill={on ? 'currentColor' : 'none'} /></button>
)

export const docHref = (d) => `/documents/${d.id}`
