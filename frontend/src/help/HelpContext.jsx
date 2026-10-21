import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getPageHelp } from './helpContent'
import { HelpPanel } from '../components/help/HelpPanel'

const HelpContext = createContext({ open: false, help: null, openHelp: () => {}, closeHelp: () => {}, toggleHelp: () => {} })
export const useHelp = () => useContext(HelpContext)

const typing = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)

/** Owns the help panel for the signed-in app: which page's help applies (from the address), whether the panel is open, and the "?" keyboard shortcut. */
export function HelpProvider({ children }) {
  const { pathname } = useLocation()
  const help = useMemo(() => getPageHelp(pathname), [pathname])
  const [open, setOpen] = useState(false)
  // the browser tab / history title follows the page ('Administration · Security · LAX360 Business CRM')
  useEffect(() => { document.title = help.title && help.title !== 'LAX360 Business CRM' ? `${help.title} · LAX360 Business CRM` : 'LAX360 Business CRM' }, [help.title])
  const openHelp = useCallback(() => setOpen(true), [])
  const closeHelp = useCallback(() => setOpen(false), [])
  const toggleHelp = useCallback(() => setOpen((o) => !o), [])

  // "?" opens / closes the help for the current page - never while typing in a field, and not on top of another dialog (the help panel itself does not count as "another" one)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([aria-labelledby="help-title"])')) return
      e.preventDefault()
      setOpen((o) => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(() => ({ open, help, openHelp, closeHelp, toggleHelp }), [open, help, openHelp, closeHelp, toggleHelp])
  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpPanel open={open} onClose={closeHelp} help={help} />
    </HelpContext.Provider>
  )
}
