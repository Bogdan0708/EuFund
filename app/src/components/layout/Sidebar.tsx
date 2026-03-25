'use client'
import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Home, FolderOpen, Search, Paperclip, Sparkles, Settings, Menu } from 'lucide-react'
import { SidebarItem } from './SidebarItem'
import { signOut } from 'next-auth/react'

interface SidebarProps {
  userName?: string
  userInitials?: string
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ userName, userInitials, collapsed, onToggle }: SidebarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const prefix = `/${locale}`

  const navItems = [
    { href: prefix, icon: Home, labelKey: 'home' as const },
    { href: `${prefix}/projects`, icon: FolderOpen, labelKey: 'projects' as const },
    { href: `${prefix}/calls`, icon: Search, labelKey: 'calls' as const },
    { href: `${prefix}/files`, icon: Paperclip, labelKey: 'files' as const },
    { href: `${prefix}/ai`, icon: Sparkles, labelKey: 'ai' as const },
  ]

  const isActive = (href: string) => {
    if (href === prefix) return pathname === prefix || pathname === `${prefix}/`
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        fixed top-0 left-0 h-screen flex flex-col
        bg-[var(--bg-base)] border-r border-[var(--border-subtle)]
        transition-[width] duration-200 ease-in-out z-40
        ${collapsed ? 'w-[var(--sidebar-collapsed)]' : 'w-[var(--sidebar-width)]'}
      `}
    >
      <div className="flex items-center gap-3 px-3 py-4">
        <button onClick={onToggle} className="p-1.5 rounded-[var(--btn-radius)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]">
          <Menu size={20} />
        </button>
        {!collapsed && <span className="text-[var(--text-primary)] font-semibold text-base">FondEU</span>}
      </div>

      <nav className="flex-1 flex flex-col gap-1 px-2 py-2">
        {navItems.map(item => (
          <SidebarItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            active={isActive(item.href)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className="flex flex-col gap-1 px-2 py-3 border-t border-[var(--border-subtle)]">
        <SidebarItem
          href={`${prefix}/settings`}
          icon={Settings}
          label={t('settings')}
          active={isActive(`${prefix}/settings`)}
          collapsed={collapsed}
        />
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center text-sm font-medium shrink-0">
            {userInitials || '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--text-primary)] truncate">{userName}</p>
              <button
                onClick={() => signOut({ callbackUrl: `/${locale}/autentificare` })}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
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
