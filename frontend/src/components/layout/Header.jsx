import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Bell, Plus, Sun, Moon, HelpCircle, Menu, LogOut, User, Settings as SettingsIcon,
  KeyRound, ChevronDown, ShieldCheck } from 'lucide-react'
import { Dropdown, DropdownItem, DropdownLabel, DropdownDivider } from '../common/Dropdown'
import { IconButton, Button } from '../common/Button'
import { Avatar } from '../common/Avatar'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useNotifications, markNotificationRead, markAllNotificationsRead } from '../../hooks/useNotifications'
import { useRefreshHandler } from '../../api/refresh'
import { useSidebar } from '../../context/SidebarContext'
import { QUICK_CREATE_ITEMS } from '../../routes/navConfig'
import { GlobalSearchModal } from './GlobalSearchModal'
import { useGlobalSearchShortcut, SEARCH_SHORTCUT_LABEL } from '../../hooks/useGlobalSearchShortcut'
import { BranchSelector } from './BranchSelector'
import { timeAgo } from '../../utils/format'
import { relatedHref } from '../../utils/activityRules'
import { useHelp } from '../../help/HelpContext'

export function Header() {
  const { theme, toggleTheme } = useTheme()
  const { user, logout, hasPermission } = useAuth()
  const { setMobileOpen } = useSidebar()
  const { openHelp } = useHelp()
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const { items: notifications, unread, reload: loadNotifications } = useNotifications()
  useRefreshHandler(loadNotifications)

  // the shared, polled list of my notifications (hooks/useNotifications.js): the bell, the Tasks menu badge and the Notifications page all read the same copy

  useGlobalSearchShortcut(() => setSearchOpen((open) => !open)) // Ctrl+K / Cmd+K opens the search over the current page, and closes it again

  const openNotification = (n) => {
    if (!n.read) markNotificationRead(n.id)
    const href = n.relatedType === 'Task' ? `/tasks/${n.relatedId}` : relatedHref(n.relatedType, n.relatedId)
    if (n.relatedId && href) navigate(href)
  }

  const markAllRead = () => { markAllNotificationsRead() }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-ink-100 bg-white/80 px-3 backdrop-blur-md sm:gap-3 sm:px-6 dark:border-ink-800 dark:bg-ink-950/80">
      <IconButton icon={Menu} className="lg:hidden" onClick={() => setMobileOpen(true)} />

      <button
        onClick={() => setSearchOpen(true)}
        className="hidden min-w-0 max-w-sm flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-400 hover:border-ink-300 sm:flex dark:border-ink-800 dark:bg-ink-900 dark:hover:border-ink-700"
      >
        <Search size={15} />
        <span className="flex-1 truncate text-left">Search anything…</span>
        <kbd className="hidden rounded-md border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-400 dark:border-ink-700 lg:inline-block dark:bg-ink-800">{SEARCH_SHORTCUT_LABEL}</kbd>
      </button>
      <IconButton icon={Search} className="sm:hidden" onClick={() => setSearchOpen(true)} />
      <BranchSelector />

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <Dropdown
          align="right"
          width="w-64"
          trigger={
            <Button size="md" icon={Plus} className="hidden sm:inline-flex">Create</Button>
          }
        >
          <DropdownLabel>Quick Create</DropdownLabel>
          {QUICK_CREATE_ITEMS.filter((item) => hasPermission(item.module, 'create')).map((item) => (
            <DropdownItem key={item.label} onClick={() => navigate(item.to)}>{item.label}</DropdownItem>
          ))}
        </Dropdown>
        <IconButton icon={Plus} className="sm:hidden" onClick={() => navigate('/leads?create=1')} />

        <Dropdown
          align="right"
          width="w-80"
          trigger={
            <span className="relative inline-flex">
              <IconButton icon={Bell} />
              {unread > 0 && (
                <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-rose-500 ring-2 ring-white dark:ring-ink-950" />
              )}
            </span>
          }
        >
          <div className="flex items-center justify-between px-3.5 pb-2">
            <DropdownLabel>Notifications</DropdownLabel>
            <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Mark all read</button>
          </div>
          <div className="scrollbar-thin max-h-80 overflow-y-auto">
            {notifications.slice(0, 8).map((n) => (
              <div key={n.id} onClick={() => openNotification(n)} className="flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 hover:bg-ink-50 dark:hover:bg-ink-800">
                {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                <div className={n.read ? 'pl-3.5' : ''}>
                  <p className="text-xs font-medium text-ink-700 dark:text-ink-200">{n.type}</p>
                  <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{n.message}</p>
                  <p className="mt-1 text-[11px] text-ink-400">{timeAgo(n.date)}</p>
                </div>
              </div>
            ))}
          </div>
          <DropdownDivider />
          {hasPermission('Notifications', 'view') && <DropdownItem onClick={() => navigate('/notifications')}>View all notifications</DropdownItem>}
        </Dropdown>

        <IconButton icon={theme === 'dark' ? Sun : Moon} onClick={toggleTheme} />
        <IconButton icon={SettingsIcon} onClick={() => navigate(hasPermission('Settings', 'view') ? '/settings' : '/settings/personalization')} aria-label="Settings" title="Settings" />
        <IconButton icon={HelpCircle} className="hidden sm:inline-flex" onClick={openHelp} aria-label="Help for this page" title="Help for this page (?)" />

        <div className="mx-1 hidden h-6 w-px bg-ink-200 sm:block dark:bg-ink-800" />

        <Dropdown
          align="right"
          width="w-64"
          trigger={
            <button className="flex items-center gap-2 rounded-lg p-1 pr-1.5 hover:bg-ink-100 dark:hover:bg-ink-800">
              <Avatar name={user?.name || 'Guest User'} size="sm" />
              <span className="hidden text-left md:block">
                <span className="block text-sm font-medium leading-tight text-ink-800 dark:text-ink-100">{user?.name?.split(' ')[0] || 'Guest'}</span>
                <span className="block text-xs leading-tight text-ink-400">{user?.accessLevel || user?.role}</span>
              </span>
              <ChevronDown size={14} className="hidden text-ink-400 md:block" />
            </button>
          }
        >
          <div className="px-3.5 py-2.5">
            <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{user?.name}</p>
            <p className="text-xs text-ink-400">{user?.email}</p>
            <p className="mt-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-400">{user?.accessLevel}{user?.branch ? ` · ${user.branch} branch` : ''}</p>
          </div>
          <DropdownDivider />
          <DropdownItem icon={User} onClick={() => navigate('/profile')}>My Profile</DropdownItem>
          <DropdownItem icon={SettingsIcon} onClick={() => navigate('/settings')}>Settings</DropdownItem>
          {['Branches', 'User Management', 'Roles & Permissions'].some((m) => hasPermission(m, 'view')) && <DropdownItem icon={ShieldCheck} onClick={() => navigate('/administration')}>Administration</DropdownItem>}
          <DropdownItem icon={HelpCircle} className="sm:hidden" onClick={openHelp}>Help for this page</DropdownItem>
          <DropdownItem icon={KeyRound} onClick={() => navigate('/change-password')}>Change Password</DropdownItem>
          <DropdownDivider />
          <DropdownItem icon={LogOut} danger onClick={() => { logout(); navigate('/login') }}>Log Out</DropdownItem>
        </Dropdown>
      </div>

      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
