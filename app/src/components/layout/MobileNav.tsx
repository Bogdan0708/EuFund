'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Home, FolderOpen, Search, Sparkles } from 'lucide-react'

export function MobileNav() {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('nav')
  const prefix = `/${locale}`

  const items = [
    { href: prefix, icon: Home, labelKey: 'home' as const },
    { href: `${prefix}/projects`, icon: FolderOpen, labelKey: 'projects' as const },
    { href: `${prefix}/calls`, icon: Search, labelKey: 'calls' as const },
    { href: `${prefix}/ai`, icon: Sparkles, labelKey: 'ai' as const },
  ]

  const isActive = (href: string) => {
    if (href === prefix) return pathname === prefix || pathname === `${prefix}/`
    return pathname.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-around py-2">
        {items.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 ${isActive(item.href) ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}`}
          >
            <item.icon size={20} />
            <span className="text-[10px]">{t(item.labelKey)}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
