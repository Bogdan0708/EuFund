'use client'
import { type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useSidebar } from '@/hooks/useSidebar'

interface AppShellProps {
  children: ReactNode
  userName?: string
  userInitials?: string
}

export function AppShell({ children, userName, userInitials }: AppShellProps) {
  const { open: cmdOpen, close: cmdClose } = useCommandPalette()
  const { collapsed, toggle } = useSidebar()

  return (
    <>
      <div className="hidden md:block">
        <Sidebar userName={userName} userInitials={userInitials} collapsed={collapsed} onToggle={toggle} />
      </div>
      <main
        className={`min-h-screen transition-[margin-left] duration-200 ease-in-out pb-16 md:pb-0 ${collapsed ? 'md:ml-[var(--sidebar-collapsed)]' : 'md:ml-[var(--sidebar-width)]'}`}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>
      <MobileNav />
      <CommandPalette open={cmdOpen} onClose={cmdClose} />
    </>
  )
}
