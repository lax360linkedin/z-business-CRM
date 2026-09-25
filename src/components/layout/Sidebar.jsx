import { NavLink } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronsLeft, ChevronsRight, X, Lock } from 'lucide-react'
import clsx from 'clsx'
import { NAV_SECTIONS } from '../../routes/navConfig'
import { useSidebar } from '../../context/SidebarContext'
import { useAuth } from '../../context/AuthContext'
import { LOGO_SRC } from '../common/Logo'

// Menu Visibility Validation: items the current role has no view access to are shown
// dimmed with a lock icon rather than hidden, so users understand a module exists without
// being able to reach it — the actual security boundary is AppLayout's route-level gate
// (and would be backend-enforced in production); this is purely a UX affordance.
function NavItem({ item, collapsed, allowed }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          !allowed
            ? 'text-ink-400 opacity-50 hover:bg-ink-100 hover:opacity-70 dark:text-ink-500 dark:hover:bg-white/5'
            : isActive
              ? 'bg-brand-600 text-white shadow-sm'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <item.icon size={17} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && !allowed && <Lock size={12} className="ml-auto shrink-0 text-ink-400 dark:text-ink-500" />}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-popover transition-opacity duration-150 group-hover:opacity-100 z-50">
          {item.label}{!allowed && ' (no access)'}
        </span>
      )}
    </NavLink>
  )
}

function SidebarContent({ collapsed, onNavigate }) {
  const { hasPermission } = useAuth()
  return (
    <div className="flex h-full flex-col">
      <div className={clsx('flex h-16 shrink-0 items-center border-b border-ink-100 px-4 dark:border-ink-800', collapsed && 'justify-center px-0')}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-md ring-1 ring-ink-100 dark:ring-0">
            <img src={LOGO_SRC} alt="LAX360" className="h-7 w-7 object-contain" />
          </span>
          {!collapsed && (
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-tight text-ink-900 dark:text-white">LAX360</span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-ink-400">Business CRM</span>
            </span>
          )}
        </div>
      </div>
      <nav onClick={onNavigate} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, i) => (
          <div key={i}>
            {section.title && !collapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">{section.title}</p>
            )}
            {section.title && collapsed && <div className="mb-1.5 h-px bg-ink-100 dark:bg-ink-800" />}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItem key={item.to} item={item} collapsed={collapsed} allowed={hasPermission(item.label, 'view')} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )
}

export function Sidebar() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar()

  return (
    <>
      {/* Desktop sidebar — same theme tokens as the top navbar (bg-white/dark:bg-ink-950,
          border-ink-100/dark:border-ink-800, brand-600 active state) so the two never drift
          into independent color schemes. */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 260 }}
        transition={{ type: 'tween', duration: 0.2 }}
        className="fixed inset-y-0 left-0 z-30 hidden shrink-0 border-r border-ink-100 bg-white shadow-sm lg:block dark:border-ink-800 dark:bg-ink-950 dark:shadow-none"
      >
        <SidebarContent collapsed={collapsed} />
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 shadow-md hover:bg-ink-50 hover:text-ink-900 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700 dark:hover:text-white"
        >
          {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
        </button>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink-900/50 dark:bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="relative flex h-full w-72 flex-col bg-white shadow-popover dark:bg-ink-950"
            >
              <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-white">
                <X size={18} />
              </button>
              <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
