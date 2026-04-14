'use client'

import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'
import { SidebarItem } from './SidebarItem'

interface SidebarProps {
  userName?: string
  userInitials?: string
  collapsed: boolean
  onToggle: () => void
}

const NAV_ITEMS = [
  { route: '', icon: 'home', labelKey: 'home' },
  { route: '/proiecte', icon: 'folder_open', labelKey: 'projects' },
  { route: '/documente', icon: 'description', labelKey: 'files' },
  { route: '/asistent-ai', icon: 'smart_toy', labelKey: 'aiAssistant' },
] as const

export function Sidebar({ userName, userInitials, collapsed }: SidebarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const prefix = `/${locale}`

  const isActive = (route: string) => {
    const href = `${prefix}${route}`
    if (route === '') return pathname === prefix || pathname === `${prefix}/` || pathname === `${prefix}/panou`
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        fixed top-0 left-0 h-screen flex flex-col
        bg-[#F5F5F7] border-r-0
        transition-[width] duration-300 ease-out z-40
        py-8 px-4
        ${collapsed ? 'w-[60px]' : 'w-[240px]'}
      `}
    >
      {/* Logo — matches Stitch: auto_awesome icon + FondEU + THE DIGITAL CURATOR */}
      <div className="flex items-center gap-3 px-4 mb-12">
        <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-white shrink-0">
          <Icon name="auto_awesome" filled size="sm" />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <h1 className="text-xl font-bold tracking-tighter text-slate-900">FondEU</h1>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
              The Digital Curator
            </p>
          </div>
        )}
      </div>

      {/* Navigation — 4 items (funding calls removed) */}
      <nav className="flex-1 space-y-2">
        {NAV_ITEMS.map(item => {
          const href = item.route === '' ? `${prefix}/panou` : `${prefix}${item.route}`
          return (
            <SidebarItem
              key={item.route}
              href={href}
              icon={item.icon}
              label={t(item.labelKey)}
              active={isActive(item.route)}
              collapsed={collapsed}
            />
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto pt-8 px-4">
        {/* Settings */}
        <SidebarItem
          href={`${prefix}/setari`}
          icon="settings"
          label={t('settings')}
          active={isActive('/setari')}
          collapsed={collapsed}
        />

        {/* User profile — matches Stitch: avatar + name + role */}
        {!collapsed && (
          <div className="mt-6 flex items-center gap-3 p-2 bg-surface-container-low rounded-xl">
            <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-sm font-bold shrink-0">
              {userInitials || '?'}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{userName || '—'}</p>
              <p className="text-[10px] text-on-surface-variant truncate">Premium Curator</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
