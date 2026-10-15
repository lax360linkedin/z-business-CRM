import { MapPin, Check, ChevronDown, Globe2 } from 'lucide-react'
import clsx from 'clsx'
import { Dropdown, DropdownItem, DropdownLabel } from '../common/Dropdown'
import { useBranch } from '../../context/BranchContext'
import { ALL_BRANCHES } from '../../data/branches'

/** Branch chip: a selector for the Super Admin, a plain label (the assigned branch) for everyone else. */
export function BranchSelector({ className }) {
  const { isGlobal, scope, label, assigned, activeNames, setBranch, unassigned } = useBranch()

  if (!isGlobal) {
    return (
      <span
        title={unassigned ? 'No branch has been assigned to your account yet - ask your Super Admin.' : `You work in the ${assigned} branch`}
        className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', unassigned ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300' : 'border-ink-200 bg-ink-50 text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200', className)}
      >
        <MapPin size={13} className="shrink-0" />
        <span className="hidden whitespace-nowrap sm:inline">{unassigned ? 'No branch assigned' : `${assigned} branch`}</span>
        <span className="sm:hidden">{unassigned ? '—' : assigned}</span>
      </span>
    )
  }

  return (
    <Dropdown
      align="left"
      width="w-56"
      trigger={
        <button aria-label={`Branch: ${label}. Change branch`} className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:border-ink-300 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-200', className)}>
          {scope === ALL_BRANCHES ? <Globe2 size={13} className="shrink-0 text-brand-600 dark:text-brand-400" /> : <MapPin size={13} className="shrink-0 text-brand-600 dark:text-brand-400" />}
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown size={13} className="shrink-0 text-ink-400" />
        </button>
      }
    >
      <DropdownLabel>View data for</DropdownLabel>
      <DropdownItem icon={scope === ALL_BRANCHES ? Check : Globe2} onClick={() => setBranch(ALL_BRANCHES)}>All branches</DropdownItem>
      {activeNames.map((name) => (
        <DropdownItem key={name} icon={scope === name ? Check : MapPin} onClick={() => setBranch(name)}>{name}</DropdownItem>
      ))}
    </Dropdown>
  )
}

/** Small read-only branch tag used in tables and record headers. */
export function BranchBadge({ branch, className }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:border-ink-700 dark:bg-ink-800/60 dark:text-ink-300', className)}>
      <MapPin size={10} className="shrink-0" />
      {branch || 'No branch'}
    </span>
  )
}
