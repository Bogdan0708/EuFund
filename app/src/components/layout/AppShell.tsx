'use client'

import { type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { MobileNav } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { LiveBackground } from '@/components/ui/LiveBackground'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useSidebar } from '@/hooks/useSidebar'

interface AppShellProps {
  locale: string
  userName: string
  userInitials: string
  userImage?: string | null
  children: ReactNode
}

export function AppShell({ locale, userName, userInitials, children }: AppShellProps) {
  const { open: cmdOpen, close: cmdClose } = useCommandPalette()
  const { collapsed, toggle } = useSidebar()

  return (
    <>
      {/* Live animated background */}
      <LiveBackground />

      {/* Sidebar — desktop only */}
      <div className="hidden md:flex">
        <Sidebar
          userName={userName}
          userInitials={userInitials}
          collapsed={collapsed}
          onToggle={toggle}
        />
      </div>

      {/* TopNav — fixed glass header */}
      <TopNav
        onMenuClick={toggle}
        sidebarCollapsed={collapsed}
      />

      {/* Main content area — z-10 above live background */}
      <main
        className={`
          relative z-10 min-h-screen transition-[margin-left] duration-300 ease-out
          pb-20 md:pb-0
          pt-20
          ${collapsed ? 'md:ml-[60px]' : 'md:ml-[240px]'}
        `}
      >
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 lg:px-24 py-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <MobileNav locale={locale} />

      {/* Command palette (Cmd+K) */}
      <CommandPalette open={cmdOpen} onClose={cmdClose} />
    </>
  )
}
