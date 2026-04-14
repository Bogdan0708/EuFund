'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

interface MobileNavProps {
  locale: string
}

const NAV_ITEMS = [
  { route: '/panou', icon: 'home', labelKey: 'home' },
  { route: '/proiecte', icon: 'folder_open', labelKey: 'projects' },
  { route: '/asistent-ai', icon: 'smart_toy', labelKey: 'ai' },
  { route: '/documente', icon: 'description', labelKey: 'files' },
  { route: '/setari', icon: 'settings', labelKey: 'settings' },
] as const

export function MobileNav({ locale }: MobileNavProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const prefix = `/${locale}`

  const isActive = (route: string) => {
    const href = `${prefix}${route}`
    if (route === '/panou') {
      return pathname === prefix || pathname === `${prefix}/` || pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-6 pb-6 pt-3 bg-white/80 backdrop-blur-lg border-t border-slate-200/15 shadow-2xl z-50">
      {NAV_ITEMS.map((item) => {
        const href = `${prefix}${item.route}`
        const active = isActive(item.route)
        return (
          <Link
            key={item.route}
            href={href}
            className={`
              flex flex-col items-center justify-center
              ${active
                ? 'bg-[#0071E3] text-white rounded-full w-12 h-12 active:scale-95 transition-transform'
                : 'text-black active:scale-95 transition-transform'
              }
            `}
          >
            <Icon name={item.icon} filled={active} size="md" />
            {!active && (
              <span className="text-[10px] font-bold uppercase tracking-widest">{t(item.labelKey)}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
