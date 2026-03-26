'use client'
import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'
import { SidebarItem } from './SidebarItem'
import { signOut } from 'next-auth/react'

interface SidebarProps {
  userName?: string
  userInitials?: string
  collapsed: boolean
  onToggle: () => void
}

const NAV_ITEMS = [
  { route: '', icon: 'home', labelKey: 'home' },
  { route: '/proiecte', icon: 'folder_open', labelKey: 'projects' },
  { route: '/finantari', icon: 'euro_symbol', labelKey: 'fundingCalls' },
  { route: '/documente', icon: 'description', labelKey: 'files' },
  { route: '/asistent-ai', icon: 'smart_toy', labelKey: 'aiAssistant' },
] as const

export function Sidebar({ userName, userInitials, collapsed, onToggle: _onToggle }: SidebarProps) {
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
        bg-background
        transition-[width] duration-300 ease-out z-40
        ${collapsed ? 'w-[60px]' : 'w-[240px]'}
      `}
    >
      {/* Logo section */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center text-white shrink-0">
          <Icon name="account_balance" filled size="md" />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span className="text-xl font-bold tracking-tighter text-slate-900">FondEU</span>
            <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold opacity-60">
              The Digital Curator
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map(item => {
          const href = item.route === '' ? `${prefix}/panou` : `${prefix}${item.route}`
          return (
            <SidebarItem
              key={item.route}
              href={href}
              icon={item.icon}
              label={collapsed ? '' : t(item.labelKey)}
              active={isActive(item.route)}
            />
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="flex flex-col gap-3 px-4 pb-5">
        {/* Storage indicator */}
        {!collapsed && (
          <div className="px-1">
            <div className="flex items-center justify-between text-[11px] text-on-surface-variant mb-1.5">
              <span>{t('storage')}</span>
              <span className="opacity-60">2.4 / 5 GB</span>
            </div>
            <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: '48%' }} />
            </div>
          </div>
        )}

        {/* Settings */}
        <SidebarItem
          href={`${prefix}/setari`}
          icon="settings"
          label={collapsed ? '' : t('settings')}
          active={isActive('/setari')}
        />

        {/* User profile */}
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-semibold shrink-0">
            {userInitials || '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{userName}</p>
              <button
                onClick={() => signOut({ callbackUrl: `/${locale}/autentificare` })}
                className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {t('signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
