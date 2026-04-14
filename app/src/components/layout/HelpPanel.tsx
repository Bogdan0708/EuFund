'use client'

import { useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Link from 'next/link'
import { Icon } from '@/components/ui/ds-icon'

interface HelpPanelProps {
  open: boolean
  onClose: () => void
  anchorRef?: React.RefObject<HTMLButtonElement | null>
}

interface HelpLink {
  icon: string
  titleKey: string
  descriptionKey: string
  href: string
  external?: boolean
}

const HELP_LINKS: HelpLink[] = [
  {
    icon: 'auto_awesome',
    titleKey: 'aiAssistantTitle',
    descriptionKey: 'aiAssistantDescription',
    href: '/asistent-ai',
  },
  {
    icon: 'work',
    titleKey: 'projectsTitle',
    descriptionKey: 'projectsDescription',
    href: '/proiecte',
  },
  {
    icon: 'account_balance',
    titleKey: 'fundingTitle',
    descriptionKey: 'fundingDescription',
    href: '/finantari',
  },
  {
    icon: 'menu_book',
    titleKey: 'legislationTitle',
    descriptionKey: 'legislationDescription',
    href: '/legislatie',
  },
]

export function HelpPanel({ open, onClose, anchorRef }: HelpPanelProps) {
  const t = useTranslations('help')
  const locale = useLocale()
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

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-3 w-[380px] max-w-[calc(100vw-2rem)] glass-card rounded-[1rem] border border-outline-variant/15 shadow-[0_20px_40px_rgba(0,0,0,0.08)] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-outline-variant/10">
        <h2 className="text-on-surface font-bold text-lg tracking-tight">
          {t('title')}
        </h2>
        <p className="text-xs text-on-surface-variant mt-1">
          {t('subtitle')}
        </p>
      </div>

      {/* Quick links */}
      <div className="p-2">
        {HELP_LINKS.map((link) => (
          <Link
            key={link.href}
            href={`/${locale}${link.href}`}
            onClick={onClose}
            className="flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-surface-container-low transition-colors group"
          >
            <div className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-fixed/30 text-primary shrink-0 group-hover:bg-primary-fixed/60 transition-colors">
              <Icon name={link.icon} size="sm" filled />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-on-surface leading-tight">
                {t(link.titleKey)}
              </h3>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                {t(link.descriptionKey)}
              </p>
            </div>
            <Icon name="chevron_right" size="sm" className="text-outline mt-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        ))}
      </div>

      {/* Keyboard shortcut hint */}
      <div className="px-5 py-3 border-t border-outline-variant/10 bg-surface-container-low/30">
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <span className="font-medium">{t('commandPalette')}</span>
          <kbd className="px-2 py-0.5 bg-surface-container-high rounded text-[10px] font-bold text-on-surface">
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* Contact footer */}
      <div className="px-5 py-3 text-center border-t border-outline-variant/10">
        <a
          href="mailto:support@platformafinantare.eu"
          className="text-primary text-xs font-bold hover:underline inline-flex items-center gap-1"
        >
          <Icon name="mail" size="sm" />
          {t('contactSupport')}
        </a>
      </div>
    </div>
  )
}
