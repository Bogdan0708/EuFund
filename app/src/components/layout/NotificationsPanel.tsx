'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

export interface NotificationItem {
  id: string
  type: 'match' | 'status' | 'ai' | 'warning'
  titleKey: string
  descriptionKey: string
  timeKey: string
  unread?: boolean
}

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
  notifications: NotificationItem[]
  onMarkAllRead: () => void
}

export function NotificationsPanel({ open, onClose, anchorRef, notifications, onMarkAllRead }: NotificationsPanelProps) {
  const t = useTranslations('notifications')
  const panelRef = useRef<HTMLDivElement>(null)

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
            onClick={onMarkAllRead}
            className="text-primary text-xs font-semibold hover:underline"
          >
            {t('markAllRead')}
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="max-h-[480px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
            <Icon name="notifications_none" size="lg" className="text-outline" />
            <p className="text-sm font-medium text-on-surface-variant">
              {t('emptyTitle')}
            </p>
            <p className="text-xs text-outline leading-relaxed max-w-[240px]">
              {t('emptyDescription')}
            </p>
          </div>
        ) : (
          notifications.map((notification) => {
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
          })
        )}
      </div>
    </div>
  )
}
