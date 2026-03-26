'use client'

import { useFormatter } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

interface TopNavProps {
  onMenuClick?: () => void
  onNotificationsClick?: () => void
  sidebarCollapsed?: boolean
}

export function TopNav({ onMenuClick, onNotificationsClick, sidebarCollapsed }: TopNavProps) {
  const format = useFormatter()

  const now = new Date()
  const formattedDate = format.dateTime(now, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  // Capitalize first letter (Romanian weekday names are lowercase)
  const displayDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1)

  return (
    <header
      className={`fixed top-0 right-0 left-0 z-50 bg-white/[0.72] backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.04)] transition-[left] duration-200 ease-in-out ${
        sidebarCollapsed ? 'md:left-[var(--sidebar-collapsed)]' : 'md:left-[var(--sidebar-width)]'
      }`}
    >
      <div className="flex items-center justify-between h-16 px-4 md:px-8 max-w-[1440px] mx-auto">
        {/* Left side — mobile: hamburger + brand, desktop: date */}
        <div className="flex items-center gap-3 md:hidden">
          <button
            type="button"
            onClick={onMenuClick}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
            aria-label="Menu"
          >
            <Icon name="menu" size="md" />
          </button>
          <span className="text-lg font-bold tracking-tighter text-on-surface">FondEU</span>
        </div>

        <span className="hidden md:block text-on-surface-variant text-sm font-medium">
          {displayDate}
        </span>

        {/* Right side — action buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNotificationsClick}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
            aria-label="Notifications"
          >
            <Icon name="notifications" size="md" />
          </button>
          <button
            type="button"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
            aria-label="Help"
          >
            <Icon name="help_outline" size="md" />
          </button>
        </div>
      </div>
    </header>
  )
}
