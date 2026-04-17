'use client'

import { useState, useRef } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'
import { NotificationsPanel, type NotificationItem } from './NotificationsPanel'
import { HelpPanel } from './HelpPanel'
import { LocaleSwitcher } from './LocaleSwitcher'

interface TopNavProps {
  onMenuClick?: () => void
  sidebarCollapsed?: boolean
}

export function TopNav({ onMenuClick, sidebarCollapsed }: TopNavProps) {
  const format = useFormatter()
  const t = useTranslations('topNav')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // No user-facing notifications API exists yet. Start empty; replace with a
  // real fetch once /api/v1/notifications (or equivalent) is in place.
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const bellRef = useRef<HTMLButtonElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)

  const unreadCount = notifications.filter(n => n.unread).length
  const hasUnread = unreadCount > 0

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })))
  }

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
      className={`glass fixed top-0 right-0 left-0 z-50 transition-[left] duration-200 ease-in-out ${
        sidebarCollapsed ? 'md:left-[60px]' : 'md:left-[240px]'
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
        <div className="flex items-center gap-2">
          <LocaleSwitcher />

          <div className="relative">
            <button
              ref={bellRef}
              type="button"
              onClick={() => {
                setNotificationsOpen(prev => !prev)
                setHelpOpen(false)
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors relative"
              aria-label={hasUnread ? `${t('notifications')} — ${unreadCount}` : t('notifications')}
              aria-expanded={notificationsOpen}
            >
              <Icon name="notifications" size="md" />
              {/* Unread badge — only shown when there's actual unread state */}
              {hasUnread && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full border-2 border-white" />
              )}
            </button>
            <NotificationsPanel
              open={notificationsOpen}
              onClose={() => setNotificationsOpen(false)}
              anchorRef={bellRef}
              notifications={notifications}
              onMarkAllRead={handleMarkAllRead}
            />
          </div>

          <div className="relative">
            <button
              ref={helpRef}
              type="button"
              onClick={() => {
                setHelpOpen(prev => !prev)
                setNotificationsOpen(false)
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
              aria-label={t('help')}
              aria-expanded={helpOpen}
            >
              <Icon name="help_outline" size="md" />
            </button>
            <HelpPanel
              open={helpOpen}
              onClose={() => setHelpOpen(false)}
              anchorRef={helpRef}
            />
          </div>
        </div>
      </div>
    </header>
  )
}
