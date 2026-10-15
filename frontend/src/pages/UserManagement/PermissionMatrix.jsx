import { Fragment } from 'react'
import { Lock } from 'lucide-react'
import { NAV_SECTIONS } from '../../routes/navConfig'
import { ACTIONS, FULL, NONE, VIEW_ONLY, SUPER_ADMIN_ONLY_MODULES } from '../../data/permissions'

/** A fresh, complete { module label: { view, create, edit, delete, export } } map built from whatever (possibly partial) permissions are passed in. */
export function normalizePermissions(perms = {}) {
  const out = {}
  NAV_SECTIONS.forEach((s) => s.items.forEach((i) => { out[i.label] = { ...NONE, ...(perms[i.label] || {}) } }))
  return out
}

/**
 * Module-by-module permission editor (view / create / edit / delete / export). Used when the Super Admin creates an account, grants an employee
 * CRM access, or edits an existing account. User Management and Roles & Permissions are shown locked: they can never be granted to anyone but the Super Admin.
 */
export function PermissionMatrix({ value, onChange, disabled = false, maxHeight = 'max-h-80' }) {
  const perms = normalizePermissions(value)
  const set = (label, patch) => onChange({ ...perms, [label]: { ...perms[label], ...patch } })
  const toggle = (label, key) => !disabled && set(label, { [key]: !perms[label][key], ...(key !== 'view' && !perms[label][key] ? { view: true } : {}), ...(key === 'view' && perms[label].view ? { create: false, edit: false, delete: false, export: false } : {}) })
  const setAll = (preset) => !disabled && onChange(Object.fromEntries(Object.keys(perms).map((l) => [l, SUPER_ADMIN_ONLY_MODULES.includes(l) ? { ...NONE } : { ...preset }])))

  return (
    <div>
      {!disabled && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-500">Quick set:</span>
          <button type="button" onClick={() => setAll(NONE)} className="rounded-md border border-ink-200 px-2 py-1 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800">No access</button>
          <button type="button" onClick={() => setAll(VIEW_ONLY)} className="rounded-md border border-ink-200 px-2 py-1 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800">View only</button>
          <button type="button" onClick={() => setAll(FULL)} className="rounded-md border border-ink-200 px-2 py-1 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800">Full access</button>
        </div>
      )}
      <div className={`scrollbar-thin overflow-auto rounded-xl border border-ink-100 dark:border-ink-800 ${maxHeight}`}>
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-ink-50 dark:bg-ink-800">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Module</th>
              {ACTIONS.map((a) => <th key={a.key} className="w-16 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-500">{a.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {NAV_SECTIONS.map((section) => (
              <Fragment key={section.title || 'general'}>
                {section.title && (
                  <tr className="bg-ink-50/50 dark:bg-ink-800/30"><td colSpan={ACTIONS.length + 1} className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-400">{section.title}</td></tr>
                )}
                {section.items.map((item) => {
                  const locked = SUPER_ADMIN_ONLY_MODULES.includes(item.label)
                  return (
                    <tr key={item.label} className="border-t border-ink-50 dark:border-ink-800/60">
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-ink-700 dark:text-ink-200">
                        {item.label}
                        {locked && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-amber-600"><Lock size={10} /> Super Admin only</span>}
                      </td>
                      {ACTIONS.map((a) => (
                        <td key={a.key} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${item.label} ${a.label}`}
                            disabled={disabled || locked}
                            checked={!locked && !!perms[item.label][a.key]}
                            onChange={() => toggle(item.label, a.key)}
                            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
