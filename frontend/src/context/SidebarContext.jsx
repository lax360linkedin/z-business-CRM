import { createContext, useContext, useEffect, useState } from 'react'

const SidebarContext = createContext(null)

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('crm_sidebar_collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('crm_sidebar_collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggleCollapsed: () => setCollapsed((c) => !c), mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
