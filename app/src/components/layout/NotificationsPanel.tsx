'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

interface NotificationItem {
  id: string
  type: 'match' | 'status' | 'ai' | 'warning'
  titleKey: string
  descriptionKey: string
  timeKey: string
  unread?: boolean
}

const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: '1',
    type: 'match',
    titleKey: 'matchTitle',
    descriptionKey: 'matchDescription',
    timeKey: 'twoHoursAgo',
    unread: true,
  },
  {
    id: '2',
    type: 'status',
    titleKey: 'statusTitle',
    descriptionKey: 'statusDescription',
    timeKey: 'yesterday',
  },
  {
    id: '3',
    type: 'ai',
    titleKey: 'aiTitle',
    descriptionKey: 'aiDescription',
    timeKey: 'twoDaysAgo',
  },
  {
    id: '4',
    type: 'warning',
    titleKey: 'warningTitle',
    descriptionKey: 'warningDescription',
    timeKey: 'threeDaysAgo',
  },
]

const TYPE_CONFIG: Record<string, { icon: string; colorClass: string }> = {
  match: { icon: 'fiber_new', colorClass: 'text-primary' },
  status: { icon: 'check_circle', colorClass: 'text-emerald-500' },
  ai: { icon: 'auto_awesome', colorClass: 'text-secondary' },
  warning: { icon: 'warning', colorClass: 'text-amber-500' },
}

interface NotificationsPanelProps {
  open: boolean
  onClose: () => void
  anchorRef?: React.RefObject<HTMLButtonElement | null>
}

export function NotificationsPanel({ open, onClose, anchorRef }: NotificationsPanelProps) {
  const t = useTranslations('notifications')
  const panelRef = useRef<HTMLDivElement>(null)
  const [notifications, setNotifications] = useState(DEMO_NOTIFICATIONS)

  // Close on click outside
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose()
      }
    }

    // Delay binding to avoid the click that opened the panel from immediately closing it
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, onClose, anchorRef])

  // Close on Escape
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })))
  }

  const hasUnread = notifications.some(n => n.unread)

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-3 w-[360px] max-w-[calc(100vw-2rem)] glass-card rounded-[1rem] border border-outline-variant/15 shadow-[0_20px_40px_rgba(0,0,0,0.08)] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-outline-variant/10">
        <h2 className="text-on-surface font-bold text-lg tracking-tight">
          {t('title')}
        </h2>
        {hasUnread && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="text-primary text-xs font-semibold hover:underline"
          >
            {t('markAllRead')}
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="max-h-[480px] overflow-y-auto">
        {notifications.map((notification) => {
          const config = TYPE_CONFIG[notification.type]
          return (
            <div
              key={notification.id}
              className={`px-5 py-4 cursor-pointer transition-colors duration-200 border-b border-outline-variant/5 last:border-b-0 ${
                notification.unread
                  ? 'bg-primary/5 border-l-4 border-l-primary hover:bg-primary/10'
                  : 'hover:bg-surface-container-low'
              }`}
            >
              <div className="flex gap-4">
                <div className="mt-1 flex-shrink-0">
                  {notification.unread ? (
                    <div className="w-2 h-2 bg-primary rounded-full mt-2" />
                  ) : (
                    <Icon
                      name={config.icon}
                      size="md"
                      className={config.colorClass}
                    />
                  )}
                </div>
                <div className="flex-1">
                  <h3
                    className={`text-sm leading-snug text-on-surface ${
                      notification.unread ? 'font-bold' : 'font-semibold'
                    }`}
                  >
                    {t(notification.titleKey)}
                  </h3>
                  <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                    {t(notification.descriptionKey)}
                  </p>
                  <span className="text-[10px] font-medium text-outline mt-2 block uppercase tracking-wider">
                    {t(notification.timeKey)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* AI Curator Advisory Card */}
      <div className="mx-4 my-3 glass-card rounded-[0.75rem] p-4 relative overflow-hidden border border-secondary/10">
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-secondary/20 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="bolt" size="sm" className="text-secondary" />
            <span className="font-bold text-xs tracking-tight uppercase text-on-surface">
              {t('aiCuratorTitle')}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-on-surface-variant mb-3">
            {t('aiCuratorMessage')}
          </p>
          <button
            type="button"
            className="w-full bg-secondary text-on-secondary py-2.5 rounded-xl font-bold text-xs hover:opacity-90 transition-opacity"
          >
            {t('aiCuratorAction')}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 text-center border-t border-outline-variant/10">
        <button
          type="button"
          className="text-primary text-xs font-bold hover:underline"
        >
          {t('viewAll')}
        </button>
      </div>
    </div>
  )
}
